import { lazy, Suspense, type ComponentType } from "react";
import { Navigate, type RouteObject } from "react-router-dom";
import { readSession } from "../lib/session";

const HomePage = lazy(() => import("../pages/home/page"));
const LoginPage = lazy(() => import("../pages/login/page"));
const RegisterPage = lazy(() => import("../pages/register/page"));
const ForgotPasswordPage = lazy(() => import("../pages/forgot-password/page"));
const ProductsPage = lazy(() => import("../pages/products/page"));
const OrderTrackingPage = lazy(() => import("../pages/order-tracking/page"));
const OwnerConsoleOverviewPage = lazy(() => import("../pages/owner-v2/page"));
const OwnerConsoleOrdersPage = lazy(
  () => import("../pages/owner-v2/orders/page"),
);
const OwnerConsoleProductsPage = lazy(
  () => import("../pages/owner-v2/products/page"),
);
const OwnerConsoleStockPage = lazy(
  () => import("../pages/owner-v2/stock/page"),
);
const OwnerConsoleAccountsPage = lazy(
  () => import("../pages/owner-v2/accounts/page"),
);
const OwnerConsoleAccountAccessPage = lazy(
  () => import("../pages/owner-v2/account-access/page"),
);
const OwnerConsoleResellersPage = lazy(
  () => import("../pages/owner-v2/resellers/page"),
);
const OwnerConsoleWarrantyPage = lazy(
  () => import("../pages/owner-v2/warranty/page"),
);
const OwnerConsoleHealthPage = lazy(
  () => import("../pages/owner-v2/health/page"),
);
const OwnerConsoleOperationsPage = lazy(
  () => import("../pages/owner-v2/operations/page"),
);
const OwnerConsoleWhatsappPage = lazy(
  () => import("../pages/owner-v2/whatsapp/page"),
);
const OwnerConsoleActivitiesPage = lazy(
  () => import("../pages/owner-v2/activities/page"),
);
const OwnerConsoleIntegrationsPage = lazy(
  () => import("../pages/owner-v2/integrations/page"),
);
const OwnerConsoleIntegrationConfigurePage = lazy(
  () => import("../pages/owner-v2/integrations/configure/page"),
);
const OwnerConsoleSettingsPage = lazy(
  () => import("../pages/owner-v2/settings/page"),
);
const ResellerV2OverviewPage = lazy(() => import("../pages/reseller-v2/page"));
const ResellerV2CatalogPage = lazy(
  () => import("../pages/reseller-v2/catalog/page"),
);
const ResellerV2OrdersPage = lazy(() => import("../pages/reseller-v2/orders/page"));
const ResellerV2AccountsPage = lazy(
  () => import("../pages/reseller-v2/accounts/page"),
);
const ResellerV2AccessPage = lazy(() => import("../pages/reseller-v2/access/page"));
const ResellerV2GuidesPage = lazy(
  () => import("../pages/reseller-v2/guides/page"),
);
const ResellerV2WarrantyPage = lazy(
  () => import("../pages/reseller-v2/warranty/page"),
);
const ResellerV2SettingsPage = lazy(
  () => import("../pages/reseller-v2/settings/page"),
);
const NotFound = lazy(() => import("../pages/NotFound"));

function page(Component: ComponentType) {
  return (
    <Suspense
      fallback={
        // The canvas token, not a colour. This was the last cream hex in the
        // app -- the loading flash a route change shows, which meant every
        // navigation started by flashing a different product than the one the
        // visitor was on.
        <div
          className="theme-dark min-h-screen bg-[var(--bg-canvas)]"
          aria-label="Memuat halaman"
        />
      }
    >
      <Component />
    </Suspense>
  );
}

function ResellerCatalogGate() {
  const session = readSession();
  if (session?.role === "reseller")
    return <Navigate to="/reseller-v2/catalog" replace />;
  if (session?.role === "owner") return <Navigate to="/owner-v2" replace />;
  return <Navigate to="/login?next=/reseller-v2/catalog" replace />;
}

export const routes: RouteObject[] = [
  { path: "/", element: page(HomePage) },
  { path: "/login", element: page(LoginPage) },
  { path: "/register", element: page(RegisterPage) },
  { path: "/daftar", element: <Navigate to="/register" replace /> },
  { path: "/masuk", element: <Navigate to="/login" replace /> },
  { path: "/forgot-password", element: page(ForgotPasswordPage) },
  { path: "/store", element: <Navigate to="/#produk" replace /> },
  { path: "/products", element: <ResellerCatalogGate /> },
  { path: "/katalog", element: <ResellerCatalogGate /> },
  { path: "/order", element: <ResellerCatalogGate /> },
  { path: "/order-tracking", element: page(OrderTrackingPage) },
  { path: "/track-order", element: <Navigate to="/order-tracking" replace /> },
  { path: "/dashboard", element: <Navigate to="/owner-v2" replace /> },
  { path: "/owner-v2", element: page(OwnerConsoleOverviewPage) },
  { path: "/owner-v2/orders", element: page(OwnerConsoleOrdersPage) },
  { path: "/owner-v2/products", element: page(OwnerConsoleProductsPage) },
  { path: "/owner-v2/stock", element: page(OwnerConsoleStockPage) },
  { path: "/owner-v2/accounts", element: page(OwnerConsoleAccountsPage) },
  { path: "/owner-v2/account-access", element: page(OwnerConsoleAccountAccessPage) },
  { path: "/owner-v2/warranty", element: page(OwnerConsoleWarrantyPage) },
  { path: "/owner-v2/resellers", element: page(OwnerConsoleResellersPage) },
  { path: "/owner-v2/health", element: page(OwnerConsoleHealthPage) },
  { path: "/owner-v2/operations", element: page(OwnerConsoleOperationsPage) },
  { path: "/owner-v2/whatsapp", element: page(OwnerConsoleWhatsappPage) },
  { path: "/owner-v2/activities", element: page(OwnerConsoleActivitiesPage) },
  {
    path: "/owner-v2/integrations",
    element: page(OwnerConsoleIntegrationsPage),
  },
  {
    path: "/owner-v2/integrations/configure",
    element: page(OwnerConsoleIntegrationConfigurePage),
  },
  { path: "/owner-v2/settings", element: page(OwnerConsoleSettingsPage) },
  { path: "/dashboard/search", element: <Navigate to="/owner-v2" replace /> },
  {
    path: "/dashboard/stock",
    element: <Navigate to="/owner-v2/stock" replace />,
  },
  {
    path: "/dashboard/products",
    element: <Navigate to="/owner-v2/products" replace />,
  },
  {
    path: "/dashboard/accounts",
    element: <Navigate to="/owner-v2/accounts" replace />,
  },
  {
    path: "/dashboard/orders",
    element: <Navigate to="/owner-v2/orders" replace />,
  },
  {
    path: "/dashboard/operations",
    element: <Navigate to="/owner-v2/health" replace />,
  },
  {
    path: "/dashboard/resellers",
    element: <Navigate to="/owner-v2/resellers" replace />,
  },
  {
    path: "/dashboard/activities",
    element: <Navigate to="/owner-v2/activities" replace />,
  },
  {
    path: "/dashboard/whatsapp",
    element: <Navigate to="/owner-v2/whatsapp" replace />,
  },
  {
    path: "/dashboard/profile",
    element: <Navigate to="/owner-v2/settings" replace />,
  },
  {
    path: "/dashboard/settings",
    element: <Navigate to="/owner-v2/integrations" replace />,
  },
  {
    path: "/reseller",
    element: <Navigate to="/reseller-v2/ringkasan" replace />,
  },
  {
    path: "/reseller/catalog",
    element: <Navigate to="/reseller-v2/catalog" replace />,
  },
  { path: "/reseller/checkout", element: page(ProductsPage) },
  {
    path: "/reseller/stock",
    element: <Navigate to="/reseller-v2/accounts" replace />,
  },
  {
    path: "/reseller/orders",
    element: <Navigate to="/reseller-v2/orders" replace />,
  },
  {
    path: "/reseller/manage-account",
    element: <Navigate to="/reseller-v2/accounts" replace />,
  },
  {
    path: "/reseller/history",
    element: <Navigate to="/reseller-v2/orders" replace />,
  },
  {
    path: "/reseller/accounts",
    element: <Navigate to="/reseller-v2/access" replace />,
  },
  {
    path: "/reseller/warranty",
    element: <Navigate to="/reseller-v2/warranty" replace />,
  },
  {
    path: "/reseller/profile",
    element: <Navigate to="/reseller-v2/settings" replace />,
  },
  {
    path: "/reseller/settings",
    element: <Navigate to="/reseller-v2/settings" replace />,
  },
  {
    path: "/reseller-v2",
    element: <Navigate to="/reseller-v2/ringkasan" replace />,
  },
  {
    path: "/reseller-v2/overview",
    element: <Navigate to="/reseller-v2/ringkasan" replace />,
  },
  { path: "/reseller-v2/ringkasan", element: page(ResellerV2OverviewPage) },
  { path: "/reseller-v2/catalog", element: page(ResellerV2CatalogPage) },
  { path: "/reseller-v2/orders", element: page(ResellerV2OrdersPage) },
  { path: "/reseller-v2/accounts", element: page(ResellerV2AccountsPage) },
  { path: "/reseller-v2/access", element: page(ResellerV2AccessPage) },
  { path: "/reseller-v2/guides", element: page(ResellerV2GuidesPage) },
  { path: "/reseller-v2/warranty", element: page(ResellerV2WarrantyPage) },
  { path: "/reseller-v2/settings", element: page(ResellerV2SettingsPage) },
  { path: "*", element: page(NotFound) },
];
