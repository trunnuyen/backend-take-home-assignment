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

export const allMyFriendRouter = router({
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
