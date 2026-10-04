import { Link } from "react-router-dom";
import { BentoCell } from "../components/ui";

/*
 * The 404.
 *
 * This was the one page still on the old light language -- `bg-cream`, a
 * Tailwind colour that existed only here, with slate ink on top. It is the
 * first thing a mistyped URL shows, and it was showing a different product from
 * the one the visitor had just been looking at.
 *
 * `.theme-dark` puts it on the same canvas as everything else, which also means
 * the backdrop the token file paints behind that root reaches this page too.
 *
 * Migrated onto the shared kit. The cell is a `BentoCell` rather than a bare
 * `<section>` because it resolves to the same tokens a static panel uses
 * everywhere else -- `--surface`, `--radius-lg`, `--shadow-lift`,
 * `--glass-blur` -- so the page looks the same without carrying its own copy
 * of them. `as="section"` because this cell has its own heading.
 *
 * The call to action is a `Link` carrying `.ui-button` rather than a `Button`
 * inside a `Link`. It was the latter, which nests a `<button>` in an `<a>`:
 * invalid HTML, and a screen reader announces two controls where there is one
 * action. Styling the anchor directly keeps it one focusable link that still
 * looks like a button.
 */
export default function NotFound() {
  return (
    <main className="theme-dark flex min-h-screen items-center justify-center bg-[var(--bg-canvas)] px-4 py-16 text-[var(--text-primary)]">
      <BentoCell as="section" className="w-full max-w-md p-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--text-muted)]">404</p>
        <h1 className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">Halaman tidak ditemukan</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Alamat yang kamu buka tidak ada, atau sudah dipindahkan.
        </p>
        <Link to="/" className="ui-button is-primary mt-6">
          Kembali ke Beranda
        </Link>
      </BentoCell>
    </main>
  );
}
