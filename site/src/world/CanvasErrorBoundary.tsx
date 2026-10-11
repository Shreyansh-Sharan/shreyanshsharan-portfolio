import { Component, type ReactNode } from 'react'

/**
 * Catches render/runtime errors from the 3D world so a failure shows the 2D background
 * (rendered underneath) instead of a permanent black canvas.
 */
export class CanvasErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    // Keep a breadcrumb for debugging; the user just sees the 2D background.
    console.error('[world] render error, falling back to 2D background:', error)
  }

  render() {
    if (this.state.failed) return null
    return this.props.children
  }
}
