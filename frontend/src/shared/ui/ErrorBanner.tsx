import { AlertCircle, X } from 'lucide-react'
import { Button } from './Button'

type ErrorBannerProps = {
  message: string
  className?: string
  onDismiss?: () => void
}

export function ErrorBanner({ className = '', message, onDismiss }: ErrorBannerProps) {
  return (
    <div
      className={`t-body flex items-center gap-2 rounded-md bg-danger-tint px-3 py-2 text-danger ${className}`}
      role="alert"
    >
      <AlertCircle className="shrink-0" size={16} strokeWidth={1.5} />
      <span className="min-w-0 flex-1">{message}</span>
      {onDismiss && (
        <Button aria-label="Dismiss error" onClick={onDismiss} size="icon" variant="danger">
          <X size={14} />
        </Button>
      )}
    </div>
  )
}
