import {defineMutator, defineMutators} from '@rocicorp/zero'
import {z} from 'zod'
import {zql} from './schema'
import {requireUserID} from './context'

const createItemArgs = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  createdAt: z.string().datetime(),
})

const updateItemArgs = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  updatedAt: z.string().datetime(),
})

const deleteItemArgs = z.object({
  id: z.string().min(1),
})

export const mutators = defineMutators({
  items: {
    create: defineMutator(createItemArgs, async ({tx, ctx, args}) => {
      const userID = requireUserID(ctx)
      await tx.mutate.items.insert({
        id: args.id,
        userId: userID,
        title: args.title,
        createdAt: args.createdAt,
        updatedAt: args.createdAt,
      })
    }),
    update: defineMutator(updateItemArgs, async ({tx, ctx, args}) => {
      const userID = requireUserID(ctx)
      const item = await tx.run(zql.items.where('id', args.id).one())

      if (!item || item.userId !== userID) {
        throw new Error('Item not found')
      }

      await tx.mutate.items.update({
        id: args.id,
        title: args.title,
        updatedAt: args.updatedAt,
      })
    }),
    delete: defineMutator(deleteItemArgs, async ({tx, ctx, args}) => {
      const userID = requireUserID(ctx)
      const item = await tx.run(zql.items.where('id', args.id).one())

      if (!item || item.userId !== userID) {
        throw new Error('Item not found')
      }

      await tx.mutate.items.delete({id: args.id})
    }),
  },
})
