import { forwardRef, Children } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:   'bg-primary text-white hover:bg-primary-dark',
        secondary: 'bg-grey-50 text-text-primary hover:bg-grey-100 border border-grey-100',
        ghost:     'text-text-secondary hover:bg-grey-50 hover:text-text-primary',
        danger:    'bg-error text-white hover:opacity-90',
        link:      'text-primary underline-offset-4 hover:underline p-0 h-auto',
        outline:   'border border-grey-100 bg-background-paper text-text-primary hover:bg-grey-20',
      },
      size: {
        sm:   'h-8 px-3 text-xs',
        md:   'h-9 px-4',
        lg:   'h-10 px-6',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled ?? loading}
      {...props}
    >
      {loading && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {loading
        ? Children.map(children, child => (typeof child === 'string' || typeof child === 'number' ? child : null))
        : children}
    </button>
  ),
)
Button.displayName = 'Button'
