import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'selected'
export type ButtonSize = 'icon' | 'sm' | 'md' | 'lg'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
}

const baseClasses =
  'inline-flex items-center justify-center gap-2 rounded-md text-body font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-fill disabled:text-ink-tertiary'

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-accent font-semibold text-white hover:bg-accent-hover',
  secondary: 'border border-line bg-card text-ink hover:bg-fill',
  ghost: 'bg-transparent text-ink-secondary hover:bg-fill hover:text-ink',
  danger: 'bg-transparent text-danger hover:bg-danger-tint',
  selected: 'bg-fill-pressed text-ink hover:bg-fill-pressed',
}

const sizeClasses: Record<ButtonSize, string> = {
  icon: 'h-9 w-9 p-0',
  sm: 'h-8 px-2.5',
  md: 'h-10 px-3',
  lg: 'h-11 px-4',
}

// Icon-only delete buttons sit on every row; keep them quiet until hovered so the
// most destructive action is never the loudest thing on screen.
const quietDangerIcon = 'bg-transparent text-ink-tertiary hover:bg-danger-tint hover:text-danger'

export function Button({
  children,
  className = '',
  size = 'md',
  type = 'button',
  variant = 'secondary',
  ...props
}: ButtonProps) {
  return (
    <button
      className={`${baseClasses} ${variant === 'danger' && size === 'icon' ? quietDangerIcon : variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      type={type}
      {...props}
    >
      {children}
    </button>
  )
}
