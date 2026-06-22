import {Slot} from '@radix-ui/react-slot'
import {cva, type VariantProps} from 'class-variance-authority'
import type * as React from 'react'
import {cn} from '@/lib/utils'

const badgeVariants = cva('inline-flex items-center rounded-sm border border-transparent px-1.5 py-0.5 text-xs font-medium', {
  variants: {
    variant: {
      default: 'bg-primary text-primary-foreground',
      secondary: 'bg-secondary text-secondary-foreground',
      muted: 'bg-muted text-muted-foreground',
      destructive: 'bg-destructive text-white',
      outline: 'border-input text-foreground',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

type BadgeProps = React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & {asChild?: boolean}

function Badge({className, variant, asChild = false, ...props}: BadgeProps) {
  const Comp = asChild ? Slot : 'span'
  return <Comp className={cn(badgeVariants({variant, className}))} {...props} />
}

export {Badge, badgeVariants}
