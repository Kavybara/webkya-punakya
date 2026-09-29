import { AlertCircle, Check, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The three states a data region can be in besides "has data".
 *
 * The owner console had only one of them: a failure rendered as a red banner
 * above an empty table, so "the request failed" and "there is nothing here"
 * looked the same. The reseller had all three but the empty state's icon was a
 * tick, which reads as success -- exactly wrong for the most common state on
 * most pages. Both fixes are in here.
 */

export function LoadingState({ label = "Memuat data" }: { label?: string }) {
  return (
    <div className="ui-state" role="status" aria-live="polite">
      <span className="ui-state-icon"><LoaderCircle className="ui-spin" size={19} aria-hidden="true" /></span>
      <strong>{label}</strong>
    </div>
  );
}

/** Placeholder bars for a region that is loading in place. */
export function LoadingSkeleton({ lines = 1 }: { lines?: number }) {
  return (
    <div className="ui-skeleton" aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => <span key={index} />)}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="ui-state">
      {/* Deliberately not a tick. A checkmark on an empty region tells the
          reader something succeeded, when in fact there is nothing to see. */}
      <span className="ui-state-icon"><EmptyGlyph /></span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

function EmptyGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h16v12H4z" />
      <path d="M4 11h16" />
      <path d="M9 15h6" />
    </svg>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="ui-state is-error" role="alert">
      <span className="ui-state-icon"><AlertCircle size={19} aria-hidden="true" /></span>
      <strong>Data belum dapat dimuat</strong>
      <p>{message}</p>
      {onRetry ? <button type="button" onClick={onRetry}>Coba Lagi</button> : null}
    </div>
  );
}

/** Success confirmation for a region that has finished a job. */
export function SuccessState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="ui-state is-success">
      <span className="ui-state-icon"><Check size={19} aria-hidden="true" /></span>
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}
