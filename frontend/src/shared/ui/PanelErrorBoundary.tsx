import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

type PanelErrorBoundaryProps = {
  children: ReactNode
}

type PanelErrorBoundaryState = {
  hasError: boolean
}

export class PanelErrorBoundary extends Component<
  PanelErrorBoundaryProps,
  PanelErrorBoundaryState
> {
  state: PanelErrorBoundaryState = {
    hasError: false,
  }

  static getDerivedStateFromError(): PanelErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Workspace panel failed to render', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="grid min-h-0 flex-1 place-items-center bg-page p-6">
          <div className="max-w-md rounded-[10px] border border-line bg-card p-6 text-center">
            <h2 className="t-h2 text-ink">This page could not be opened</h2>
            <p className="t-body mt-2 text-ink-secondary">
              The rest of the workspace is still available. Reload to fetch the latest page files
              and try again.
            </p>
            <button
              className="t-body mt-4 rounded-md bg-accent px-4 py-2 font-semibold text-white hover:bg-accent-hover"
              onClick={() => window.location.reload()}
              type="button"
            >
              Reload page
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
