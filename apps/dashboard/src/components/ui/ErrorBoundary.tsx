import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
/*
 * Sibling imports, NOT `from "./index"` -- deliberately breaking the rule the
 * rest of the kit follows, for the reason spelled out at the import site in
 * `src/main.tsx`. Short version: this module is reachable from the eager graph,
 * and the barrel's stylesheet imports would move 47 kB of kit CSS into the
 * entry chunk.
 *
 * It is still exported from the barrel like everything else, so any component
 * inside a route may import it the normal way.
 */
import { BentoCell } from "./Bento";
import { Button } from "./Button";

/*
 * The last line of defence.
 *
 * A render error anywhere below used to leave a blank white page: no message,
 * no way back, nothing in the console beyond the stack React already prints.
 * For an owner or reseller mid-order that reads as the site being down, and
 * they have no way to report what happened.
 *
 * Two instances exist, and the difference between them is the whole subtlety:
 *
 *   - `src/main.tsx` wraps `<App />`, which means it wraps the router itself.
 *   - `src/router/index.tsx` wraps the routes, and resets on every pathname so
 *     a failed page stops being failed once the reader navigates away.
 *
 * This is a class component because `getDerivedStateFromError` has no hook
 * equivalent. That is not a style preference to be argued with later.
 */

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
 * it has to look right on the public pages, inside the owner console, and
 * inside the reseller panel. That is why it reads every colour from a token
 * rather than naming one: the tokens resolve to whatever palette is in force,
 * and the same markup is correct in all three.
 *
 * The one thing it does not inherit is the canvas. No background of its own and
 * a `min-h-[60vh]` rather than a full screen, so the surface behind it is the
 * surface that failed -- which is the information the reader actually needs.
 *
 * "Ke beranda" is a plain `<a href>`, deliberately, and this is the reason the
 * boundary in `main.tsx` cannot use a router `Link`: that boundary wraps
 * `<App />`, so it is above `BrowserRouter`, and a `Link` rendered with no
 * router above it throws. A full page load is also the honest recovery here --
 * it discards whatever module state caused the crash. The styling is the kit's
 * own `.ui-button` class rather than the `Button` component, because an anchor
 * is not a button and only the class is shared between the two.
 */
export function ErrorScreen({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-16">
      {/* Not `emphasis`. That flag is the bento's hero cell and it deepens the
          glass to `--surface-glass-strong`; this screen resolves to the plain
          `--surface` the rest of the product uses for a static panel. */}
      <BentoCell as="section" className="w-full max-w-lg p-8 text-center">
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
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button weight="primary" onClick={onRetry}>
            <RefreshCw size={16} aria-hidden="true" />
            Coba lagi
          </Button>
          <a href={__BASE_PATH__ || "/"} className="ui-button is-secondary">
            Ke beranda
          </a>
        </div>
      </BentoCell>
    </div>
  );
}
