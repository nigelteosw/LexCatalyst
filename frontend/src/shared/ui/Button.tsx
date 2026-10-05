import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'selected'
export type ButtonSize = 'icon' | 'sm' | 'md' | 'lg'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
}

const baseClasses =
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400'

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover',
  secondary: 'bg-transparent text-neutral-800 hover:bg-neutral-100 hover:text-neutral-950',
  ghost: 'bg-transparent text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950',
  danger: 'bg-transparent text-red-700 hover:bg-red-50 hover:text-red-800',
  selected: 'bg-neutral-200 text-neutral-950 hover:bg-neutral-200',
}

const sizeClasses: Record<ButtonSize, string> = {
  icon: 'h-9 w-9 p-0',
  sm: 'h-8 px-2.5 text-xs',
  md: 'h-10 px-3 text-sm',
  lg: 'h-11 px-4 text-sm',
}

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
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      type={type}
      {...props}
    >
      {children}
    </button>
  )
}
