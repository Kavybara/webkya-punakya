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

export function ErrorScreen({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
          <TriangleAlert className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold text-slate-900">Halaman ini gagal ditampilkan</h1>
        <p className="mt-2 text-sm text-slate-600">
          Data kamu tidak hilang. Muat ulang halaman ini, atau kembali ke beranda kalau masalahnya
          terus muncul.
        </p>
        <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-left font-mono text-xs break-words text-slate-500">
          {message}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-red-600 bg-red-600 px-4 text-sm font-medium text-white transition-colors hover:bg-red-700"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Coba lagi
          </button>
          <a
            href={__BASE_PATH__ || "/"}
            className="inline-flex h-10 items-center rounded-md border border-gray-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Ke beranda
          </a>
        </div>
      </div>
    </div>
  );
}
