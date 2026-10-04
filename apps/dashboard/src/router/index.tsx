import { BrowserRouter, useLocation, useRoutes } from "react-router-dom";
// The leaf module rather than the barrel -- see the note in `main.tsx`. This
// file is in the eager graph, and the barrel's `ui.css`/`shell.css` imports
// would move 47 kB of kit CSS out of the lazy route chunks and into the entry
// chunk. Every other component in the product imports the barrel normally.
import { ErrorBoundary } from "../components/ui/ErrorBoundary";
import { FarmVideoBackdrop } from "../components/feature/FarmVideoBackdrop";
import { routes } from "./config";

/**
 * The routes that get the farm playing behind them.
 *
 * Matched by prefix, so `/`, `/harga`, `/login`, `/register` and
 * `/forgot-password` all qualify, and `/order-tracking` does too -- it is
 * public and just nobody links it from the navbar.
 *
 * `/products`, `/katalog` and `/order` are deliberately absent: they sit behind
 * the reseller gate and render `ProductsPage`, which is the dense checkout
 * table. A moving background behind a checkout form is the wrong trade, and
 * those visitors are on a slow connection by definition.
 *
 * The console paths are absent for the same reason and more strongly. Those
 * screens are tables of order IDs, stock counts and QRIS statuses that the
 * owner scans in a hurry; they keep the daylight canvas without the video.
 */
const PUBLIC_PREFIXES = [
  "/",
  "/harga",
  "/store",
  "/login",
  "/masuk",
  "/register",
  "/daftar",
  "/forgot-password",
  "/order-tracking",
  "/track-order",
];

function hasFarmBackdrop(pathname: string) {
  // Exact "/" first: it is a prefix of everything, so a naive `startsWith`
  // would put the video on every route in the product including the console.
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some(
    (prefix) => prefix !== "/" && pathname.startsWith(prefix),
  );
}

function AppRoutes() {
  const location = useLocation();
  return (
    // A failed page should not stay failed once the reader navigates away.
    // Without this the boundary holds the error and every later route
    // renders the error screen too.
    <ErrorBoundary resetKeys={[location.pathname]}>
      {/* Mounted here rather than inside each page, so that moving from / to
          /harga does not tear down the <video> and restart the 12-second clip
          from its first frame: same element type in the same position, so
          React keeps the instance across public-to-public navigation.

          It is conditionally rendered rather than always-mounted-and-hidden,
          because a hidden <video> still downloads 3.7MB and still decodes it.
          A visitor who signs in and lands on the console should not pay for
          footage they will never see. The only remount this causes is
          public -> console, which is the transition where the video has to go
          anyway. */}
      {hasFarmBackdrop(location.pathname) ? <FarmVideoBackdrop /> : null}
      {useRoutes(routes)}
    </ErrorBoundary>
  );
}

export function AppRouter() {
  return (
    <BrowserRouter basename={__BASE_PATH__}>
      <AppRoutes />
    </BrowserRouter>
  );
}
