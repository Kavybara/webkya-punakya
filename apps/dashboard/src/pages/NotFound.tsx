import { Link } from "react-router-dom";
import { Button } from "../components/base/Button";
import { Card, CardBody } from "../components/base/Card";

/*
 * The 404.
 *
 * This was the one page still on the old light language -- `bg-cream`, a
 * Tailwind colour that existed only here, with slate ink on top. It is the
 * first thing a mistyped URL shows, and it was showing a different product from
 * the one the visitor had just been looking at.
 *
 * `.theme-dark` puts it on the same midnight canvas as everything else, which
 * also means the aurora the token file paints behind that root reaches this
 * page too. The card is glass for the same reason it is everywhere else.
 */
export default function NotFound() {
  return (
    <main className="theme-dark flex min-h-screen items-center justify-center bg-[var(--bg-canvas)] px-4 py-16 text-[var(--text-primary)]">
      <Card className="w-full max-w-md text-center">
        <CardBody>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--text-muted)]">404</p>
          <h1 className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">Halaman tidak ditemukan</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Alamat yang kamu buka tidak ada, atau sudah dipindahkan.
          </p>
          <Link to="/" className="mt-6 inline-block">
            <Button>Kembali ke Beranda</Button>
          </Link>
        </CardBody>
      </Card>
    </main>
  );
}
