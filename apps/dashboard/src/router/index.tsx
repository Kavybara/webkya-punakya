import { BrowserRouter, useRoutes } from "react-router-dom";
import { routes } from "./config";

function AppRoutes() {
  return useRoutes(routes);
}

export function AppRouter() {
  return (
    <BrowserRouter basename={__BASE_PATH__}>
      <AppRoutes />
    </BrowserRouter>
  );
}
