import type { Database } from '@/server/db'

import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { FriendshipStatusSchema } from '@/utils/server/friendship-schemas'
import { protectedProcedure } from '@/server/trpc/procedures'
import { router } from '@/server/trpc/router'
import {
  NonEmptyStringSchema,
  CountSchema,
  IdSchema,
} from '@/utils/server/base-schemas'

export const myFriendRouter = router({
  getById: protectedProcedure
    .input(
      z.object({
        friendUserId: IdSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.connection().execute(async (conn) => {
        /**
         * Question 4: Implement mutual friend count
         *
         * Add `mutualFriendCount` to the returned result of this query. You can
         * either:
         *  (1) Make a separate query to count the number of mutual friends,
         *  then combine the result with the result of this query
         *  (2) BONUS: Use a subquery (hint: take a look at how
         *  `totalFriendCount` is implemented)
         *
         * Instructions:
         *  - Go to src/server/tests/friendship-request.test.ts, enable the test
         * scenario for Question 3
         *  - Run `yarn test` to verify your answer
         *
         * Documentation references:
         *  - https://kysely-org.github.io/kysely/classes/SelectQueryBuilder.html#innerJoin
         */
        const result = await conn
          .selectFrom('users as friends')
          .innerJoin('friendships', 'friendships.friendUserId', 'friends.id')
          .innerJoin(
            userTotalFriendCount(conn).as('userTotalFriendCount'),
            'userTotalFriendCount.userId',
            'friends.id'
          )
          .where('friendships.userId', '=', ctx.session.userId)
          .where('friendships.friendUserId', '=', input.friendUserId)
          .where(
            'friendships.status',
            '=',
            FriendshipStatusSchema.Values['accepted']
          )
          .select([
            'friends.id',
            'friends.fullName',
            'friends.phoneNumber',
            'totalFriendCount',
          ])
          .executeTakeFirstOrThrow(() => new TRPCError({ code: 'NOT_FOUND' }))
          .then(
            z.object({
              id: IdSchema,
              fullName: NonEmptyStringSchema,
              phoneNumber: NonEmptyStringSchema,
              totalFriendCount: CountSchema,
            }).parse
          )

        const userMutualFriendCount = await conn
          .selectFrom('friendships as a')
          .where('a.status', '=', FriendshipStatusSchema.Values['accepted'])
          .where('a.userId', '=', ctx.session.userId)
          .innerJoin('friendships as b', 'b.friendUserId', 'a.friendUserId')
          .where('b.userId', '=', input.friendUserId)
          .where('a.friendUserId', '!=', input.friendUserId)
          .where('b.friendUserId', '!=', ctx.session.userId)
          .select((eb) => eb.fn.count('a.friendUserId').as('mutualFriendCount'))
          .executeTakeFirstOrThrow(() => new TRPCError({ code: 'NOT_FOUND' }))
          .then(
            z.object({
              mutualFriendCount: CountSchema,
            }).parse
          )

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const extendedResult = result as any
        extendedResult.mutualFriendCount =
          userMutualFriendCount.mutualFriendCount
        return extendedResult
      })
    }),

  getAll: protectedProcedure.mutation(async ({ ctx }) => {
    return ctx.db.connection().execute(async (conn) => {
      const allFriendsInfolist: Array<object> = []

      const friendIdList = await conn
        .selectFrom('friendships')
        .innerJoin('users as friends', 'friends.id', 'friendships.friendUserId')
        .where('friendships.userId', '=', ctx.session.userId)
        .select('friends.id')
        .execute()
        .then(
          z.array(
            z.object({
              id: IdSchema,
            })
          ).parse
        )

      for (let i = 0; i < friendIdList.length; i++) {
        const query1 = await conn
          .selectFrom('users as friends')
          .innerJoin('friendships', 'friendships.friendUserId', 'friends.id')
          .innerJoin(
            userTotalFriendCount(conn).as('userTotalFriendCount'),
            'userTotalFriendCount.userId',
            'friends.id'
          )
          .where('friendships.userId', '=', ctx.session.userId)
          .where('friendships.friendUserId', '=', friendIdList[i]!.id)
          .select([
            'friends.id',
            'friends.fullName',
            'friends.phoneNumber',
            'totalFriendCount',
          ])
          .executeTakeFirstOrThrow(() => new TRPCError({ code: 'BAD_REQUEST' }))
          .then(
            z.object({
              id: IdSchema,
              fullName: NonEmptyStringSchema,
              phoneNumber: NonEmptyStringSchema,
              totalFriendCount: CountSchema,
            }).parse
          )

        const userMutualFriendCount = await conn
          .selectFrom('friendships as a')
          .where('a.status', '=', FriendshipStatusSchema.Values['accepted'])
          .where('a.userId', '=', ctx.session.userId)
          .innerJoin('friendships as b', 'b.friendUserId', 'a.friendUserId')
          .where('b.userId', '=', friendIdList[i]!.id)
          .where('a.friendUserId', '!=', friendIdList[i]!.id)
          .where('b.friendUserId', '!=', ctx.session.userId)
          .select((eb) => eb.fn.count('a.friendUserId').as('mutualFriendCount'))
          .executeTakeFirstOrThrow(() => new TRPCError({ code: 'NOT_FOUND' }))
          .then(
            z.object({
              mutualFriendCount: CountSchema,
            }).parse
          )

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const extendedResult = query1 as any

        extendedResult.mutualFriendCount =
          userMutualFriendCount.mutualFriendCount

        allFriendsInfolist.push(extendedResult)
      }
      return allFriendsInfolist
    })
  }),
})

const userTotalFriendCount = (db: Database) => {
  return db
    .selectFrom('friendships')
    .where('friendships.status', '=', FriendshipStatusSchema.Values['accepted'])
    .select((eb) => [
      'friendships.userId',
      eb.fn.count('friendships.friendUserId').as('totalFriendCount'),
    ])
    .groupBy('friendships.userId')
}
