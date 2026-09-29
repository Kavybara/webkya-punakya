import { BrowserRouter, useLocation, useRoutes } from "react-router-dom";
import { ErrorBoundary } from "../components/base/ErrorBoundary";
import { routes } from "./config";

function AppRoutes() {
  const location = useLocation();
  return (
    // A failed page should not stay failed once the reader navigates away.
    // Without this the boundary holds the error and every later route
    // renders the error screen too.
    <ErrorBoundary resetKeys={[location.pathname]}>
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
