import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let friendly = 'Something went wrong while rendering minisocial.';
    try {
      const parsed = JSON.parse(error.message);
      if (parsed && typeof parsed.error === 'string') {
        friendly = `Cloud sync error: ${parsed.error}`;
      }
    } catch {
      if (error?.message) {
        friendly = error.message;
      }
    }
    return { hasError: true, message: friendly };
  }

  componentDidCatch(error: Error) {
    console.error('Uncaught application error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[100dvh] w-full flex items-center justify-center p-6 bg-[var(--sf-bg)] text-[var(--sf-text)]">
          <div className="w-full max-w-md rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface)] p-6 text-center shadow-xl">
            <h1 className="text-[15px] font-semibold text-[var(--sf-text)]">
              Unable to continue
            </h1>
            <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--sf-text-muted)] break-words">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 px-4 py-2 text-[12.5px] font-medium bg-[var(--sf-btn-active-bg)] text-[var(--sf-btn-active-text)] rounded-md hover:opacity-90 transition-opacity"
            >
              Reload minisocial
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
