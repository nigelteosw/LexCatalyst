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
        <div className="grid min-h-0 flex-1 place-items-center bg-[#fafaf8] p-6">
          <div className="max-w-md rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm">
            <h2 className="text-base font-semibold text-[#171717]">This page could not be opened</h2>
            <p className="mt-2 text-sm leading-6 text-[#6f6f69]">
              The rest of the workspace is still available. Reload to fetch the latest page files
              and try again.
            </p>
            <button
              className="mt-4 rounded-lg bg-[#0f0f0f] px-4 py-2 text-sm font-medium text-white"
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
