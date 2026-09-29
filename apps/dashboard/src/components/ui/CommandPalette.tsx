import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Command, Search, X, type LucideIcon } from "lucide-react";
import { useOverlayFocus } from "./Overlay";

export type CommandHit = {
  /** Unique within the palette. Two hits with the same id are one hit as far as React is concerned. */
  id: string;
  label: string;
  detail?: string;
  href: string;
  /** Rendered at the left of the row. Group name alone is a weaker signal than a shape. */
  icon?: LucideIcon;
};

export type CommandGroup = { label: string; hits: CommandHit[] };

type Status = "idle" | "loading" | "error" | "empty" | "results";

const SKELETON_ROWS = 4;

/**
 * The search box that opens with Ctrl/Cmd+K.
 *
 * There were two of these and they were the same dialog twice: the owner's
 * called a server on every settled keystroke, the reseller's filtered a copy of
 * its own data in the browser, and both then re-implemented the parts that are
 * not about where the data comes from -- a search field, three waiting states,
 * grouped results, and a dismissal story. Neither moved focus into the panel,
 * so a keyboard reader typed into nothing while the page behind stayed
 * reachable with Tab; neither restored focus on close.
 *
 * What this deliberately does not know is where results come from. `search`
 * returns groups, or a promise of them, and the caller decides which: a console
 * that queries the server passes a promise and a `debounceMs` so a request is
 * not made per keystroke, and a console that already holds its data passes a
 * plain array and no debounce so the list narrows as the reader types. The
 * palette is the shell around that decision, not a second opinion on it.
 */
export function CommandPalette({
  open,
  onClose,
  onSelect,
  search,
  title,
  placeholder,
  label,
  hint,
  minChars = 1,
  debounceMs = 0,
  busy = false,
  idle,
  empty,
  limit = 10,
}: {
  open: boolean;
  onClose: () => void;
  /** Given the chosen hit. The palette does not navigate -- routing is the caller's. */
  onSelect: (hit: CommandHit) => void;
  search: (query: string) => CommandGroup[] | Promise<CommandGroup[]>;
  /** The dialog's accessible name. Also the heading above the results. */
  title: string;
  placeholder: string;
  /** The input's accessible name, when the placeholder is not the whole story. */
  label: string;
  /** A key hint at the right of the field, e.g. a kbd element. */
  hint?: ReactNode;
  /** Characters required before a search runs. Two is right for a server round trip. */
  minChars?: number;
  /** Wait this long after the last keystroke before searching. Zero searches on every keystroke. */
  debounceMs?: number;
  /**
   * The caller is still fetching whatever it is going to search. The palette
   * shows its loading state and does not ask for results, which is how the
   * reseller avoids answering "no matches" with the empty state while three
   * requests are still in the air.
   */
  busy?: boolean;
  /** Shown before the reader has typed enough to search. */
  idle?: ReactNode;
  /** Shown when a search ran and matched nothing. */
  empty?: ReactNode;
  /** How many hits to show in total. */
  limit?: number;
}) {
  const titleId = useId();
  const { panelRef, closeRef } = useOverlayFocus(open, onClose);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [groups, setGroups] = useState<CommandGroup[]>([]);
  const [error, setError] = useState("");

  // A caller that builds its `search` inline would otherwise re-run the effect
  // on every render -- and because each run produces a new array, setting it
  // would render again, forever. The function is read through a ref so the
  // effect can depend on the query alone.
  const searchRef = useRef(search);
  searchRef.current = search;

  useEffect(() => {
    if (!open) {
      setQuery("");
      setGroups([]);
      setStatus("idle");
      return undefined;
    }
    const trimmed = query.trim();
    if (busy) {
      setStatus("loading");
      return undefined;
    }
    if (trimmed.length < minChars) {
      setGroups([]);
      setStatus("idle");
      return undefined;
    }

    let active = true;
    function apply(next: CommandGroup[], failure = "") {
      if (!active) return;
      if (failure) {
        setError(failure);
        setStatus("error");
        return;
      }
      setError("");
      const limited = next
        .map((group) => ({ label: group.label, hits: group.hits.slice(0, limit) }))
        .filter((group) => group.hits.length);
      setGroups(limited);
      setStatus(limited.length ? "results" : "empty");
    }
    function run() {
      setStatus("loading");
      let outcome: CommandGroup[] | Promise<CommandGroup[]>;
      try {
        outcome = searchRef.current(trimmed);
      } catch (thrown) {
        apply([], thrown instanceof Error ? thrown.message : "Pencarian gagal dijalankan.");
        return;
      }
      if (outcome instanceof Promise) {
        outcome.then(
          (resolved) => apply(resolved),
          (rejection) => apply([], rejection instanceof Error ? rejection.message : "Pencarian gagal dimuat."),
        );
        return;
      }
      apply(outcome);
    }

    if (!debounceMs) {
      run();
      return () => {
        active = false;
      };
    }
    const timer = window.setTimeout(run, debounceMs);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [busy, debounceMs, limit, minChars, open, query]);

  // The close button is the trap's guaranteed first node, but this dialog opens
  // to be typed into, so the field takes focus instead.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="ui-overlay has-command"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div ref={panelRef} className="ui-command" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="ui-command-field">
          <Search size={19} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={placeholder}
            aria-label={label}
          />
          {hint ? <span className="ui-command-hint">{hint}</span> : null}
          <button ref={closeRef} type="button" className="ui-icon-button" onClick={onClose} aria-label="Tutup pencarian">
            <X size={18} />
          </button>
        </div>

        <div className="ui-command-body">
          <div className="ui-command-heading">
            <span id={titleId}>{title}</span>
            {status === "results" ? <span>{groups.reduce((total, group) => total + group.hits.length, 0)} hasil</span> : null}
          </div>

          {status === "loading" ? (
            <div className="ui-command-skeleton" aria-label="Memuat hasil pencarian">
              {Array.from({ length: SKELETON_ROWS }, (_, index) => (
                <span key={index} />
              ))}
            </div>
          ) : status === "error" ? (
            // The one state that is genuinely a failure, and so the one that is
            // allowed to announce itself.
            <p className="ui-command-state is-error" role="alert">
              {error}
            </p>
          ) : status === "empty" ? (
            <div className="ui-command-state">{empty ?? <>Tidak ada hasil untuk "{query.trim()}".</>}</div>
          ) : status === "idle" ? (
            <div className="ui-command-state">{idle ?? `Ketik minimal ${minChars} karakter untuk mencari.`}</div>
          ) : (
            <div>
              {groups.map((group) => (
                <div key={group.label} className="ui-command-group">
                  <p>{group.label}</p>
                  {group.hits.map((hit) => {
                    const Icon = hit.icon;
                    return (
                      <button
                        key={hit.id}
                        type="button"
                        onClick={() => {
                          onClose();
                          onSelect(hit);
                        }}
                      >
                        {Icon ? (
                          <span className="ui-command-hit-icon">
                            <Icon size={16} aria-hidden="true" />
                          </span>
                        ) : null}
                        <span>
                          <strong>{hit.label}</strong>
                          {hit.detail ? <small>{hit.detail}</small> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The key hint the shell's own trigger advertises, so the two cannot disagree. */
export function CommandKeyHint() {
  return (
    <span className="ui-command-keys" aria-hidden="true">
      <Command size={13} /> K
    </span>
  );
}
