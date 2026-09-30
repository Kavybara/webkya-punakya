import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";

type ErrorBoundaryProps = {
  children: ReactNode;
  /** Shown instead of the default screen. Lets a section fail without the
   *  whole page going blank. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Changing any value here clears the error, e.g. the current pathname. */
  resetKeys?: unknown[];
};

type ErrorBoundaryState = {
  error: Error | null;
};

/**
 * A render error anywhere below this point used to leave a blank white page:
 * no message, no way back, nothing in the console beyond the stack React
 * already prints. For an owner or reseller mid-order that reads as the site
 * being down, and they have no way to report what happened.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidUpdate(previous: ErrorBoundaryProps) {
    if (!this.state.error) return;
    const before = previous.resetKeys;
    const after = this.props.resetKeys;
    const moved = before?.length !== after?.length
      || before?.some((key, index) => key !== after?.[index]);
    if (moved) this.reset();
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the component stack; it is the only part that says *where*.
    console.error("Kavya render error", error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return <ErrorScreen error={error} onRetry={this.reset} />;
  }
}

/*
 * The error screen.
 *
 * It renders *inside* whatever subtree failed, so it cannot assume a theme --
 * it has to look right on the dark marketing pages, inside a dark console, and
 * inside a light one. That is why it reads every colour from a token rather
 * than naming one: on a dark ground the tokens resolve to the dark palette and
 * on a light ground to the light palette, and the same markup is correct in
 * both.
 *
 * The one thing it does not inherit is the canvas. `min-h-[60vh]` and no
 * background of its own, so the surface behind it is the surface that failed.
 */
export function ErrorScreen({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-8 text-center shadow-[var(--shadow-lift)] backdrop-blur-[var(--glass-blur)]">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--status-danger)_12%,transparent)] text-[var(--status-danger)]">
          <TriangleAlert className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">Halaman ini gagal ditampilkan</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Data kamu tidak hilang. Muat ulang halaman ini, atau kembali ke beranda kalau masalahnya
          terus muncul.
        </p>
        <p className="mt-4 rounded-[var(--radius-md)] bg-[var(--bg-raised)] px-3 py-2 text-left font-mono text-xs break-words text-[var(--text-muted)]">
          {message}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-[var(--radius-pill)] border border-transparent bg-[var(--text-primary)] px-4 text-sm font-medium text-[var(--text-inverse)] transition-[background-color,transform,box-shadow] duration-[--duration-normal] ease-[--ease-out-expo] hover:-translate-y-px hover:bg-[color-mix(in_srgb,var(--status-success)_84%,black)] hover:shadow-[var(--shadow-lift)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-cyan)]"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Coba lagi
          </button>
          <a
            href={__BASE_PATH__ || "/"}
            className="inline-flex h-10 items-center rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-medium text-[var(--text-primary)] transition-[background-color,border-color,transform,box-shadow] duration-[--duration-normal] ease-[--ease-out-expo] hover:-translate-y-px hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] hover:shadow-[var(--shadow-lift)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-cyan)]"
          >
            Ke beranda
          </a>
        </div>
      </div>
    </div>
  );
}
