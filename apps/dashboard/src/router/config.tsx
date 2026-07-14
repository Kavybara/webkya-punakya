import { Navigate, type RouteObject } from "react-router-dom";
import HomePage from "../pages/home/page";
import LoginPage from "../pages/login/page";
import ForgotPasswordPage from "../pages/forgot-password/page";
import ProductsPage from "../pages/products/page";
import OrderTrackingPage from "../pages/order-tracking/page";
import OwnerOverviewPage from "../pages/dashboard/page";
import DashboardSearchPage from "../pages/dashboard/search/page";
import StockPage from "../pages/dashboard/stock/page";
import DashboardProductsPage from "../pages/dashboard/products/page";
import AccountsPage from "../pages/dashboard/accounts/page";
import OrdersPage from "../pages/dashboard/orders/page";
import DashboardOperationsPage from "../pages/dashboard/operations/page";
import ResellersPage from "../pages/dashboard/resellers/page";
import ActivitiesPage from "../pages/dashboard/activities/page";
import WhatsAppPage from "../pages/dashboard/whatsapp/page";
import DashboardSettings from "../pages/dashboard/settings/page";
import ResellerOverviewPage from "../pages/reseller/page";
import ResellerCatalogPage from "../pages/reseller/catalog/page";
import ResellerManageAccountPage from "../pages/reseller/manage-account/page";
import ResellerHistoryPage from "../pages/reseller/history/page";
import ResellerAccountsPage from "../pages/reseller/accounts/page";
import ResellerWarrantyPage from "../pages/reseller/warranty/page";
import ResellerSettings from "../pages/reseller/settings/page";
import NotFound from "../pages/NotFound";
import { readSession } from "../lib/session";

function ResellerCatalogGate() {
  const session = readSession();
  if (session?.token && session?.role === "reseller") return <Navigate to="/reseller/catalog" replace />;
  if (session?.token && session?.role === "owner") return <Navigate to="/dashboard" replace />;
  return <Navigate to="/login?next=/reseller/catalog" replace />;
}

export const routes: RouteObject[] = [
  { path: "/", element: <HomePage /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/masuk", element: <Navigate to="/login" replace /> },
  { path: "/forgot-password", element: <ForgotPasswordPage /> },
  { path: "/products", element: <ResellerCatalogGate /> },
  { path: "/katalog", element: <ResellerCatalogGate /> },
  { path: "/order", element: <ResellerCatalogGate /> },
  { path: "/order-tracking", element: <OrderTrackingPage /> },
  { path: "/track-order", element: <Navigate to="/order-tracking" replace /> },
  { path: "/dashboard", element: <OwnerOverviewPage /> },
  { path: "/dashboard/search", element: <DashboardSearchPage /> },
  { path: "/dashboard/stock", element: <StockPage /> },
  { path: "/dashboard/products", element: <DashboardProductsPage /> },
  { path: "/dashboard/accounts", element: <AccountsPage /> },
  { path: "/dashboard/orders", element: <OrdersPage /> },
  { path: "/dashboard/operations", element: <DashboardOperationsPage /> },
  { path: "/dashboard/resellers", element: <ResellersPage /> },
  { path: "/dashboard/activities", element: <ActivitiesPage /> },
  { path: "/dashboard/whatsapp", element: <WhatsAppPage /> },
  { path: "/dashboard/profile", element: <Navigate to="/dashboard/settings?tab=profile" replace /> },
  { path: "/dashboard/settings", element: <DashboardSettings /> },
  { path: "/reseller", element: <ResellerOverviewPage /> },
  { path: "/reseller/catalog", element: <ResellerCatalogPage /> },
  { path: "/reseller/checkout", element: <ProductsPage /> },
  { path: "/reseller/stock", element: <Navigate to="/reseller/manage-account" replace /> },
  { path: "/reseller/orders", element: <Navigate to="/reseller/manage-account" replace /> },
  { path: "/reseller/manage-account", element: <ResellerManageAccountPage /> },
  { path: "/reseller/history", element: <ResellerHistoryPage /> },
  { path: "/reseller/accounts", element: <ResellerAccountsPage /> },
  { path: "/reseller/warranty", element: <ResellerWarrantyPage /> },
  { path: "/reseller/profile", element: <ResellerSettings /> },
  { path: "/reseller/settings", element: <ResellerSettings /> },
  { path: "*", element: <NotFound /> },
];
