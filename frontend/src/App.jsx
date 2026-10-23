import { Suspense, lazy } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import AppLayout from "@/components/layout/AppLayout";
import { EmptyState, Loading } from "@/components/common";
import { Button } from "@/components/ui/button";
import LoginPage from "@/pages/LoginPage";
import { t, useLanguage } from "@/i18n";

const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const PosPage = lazy(() => import("@/pages/PosPage"));
const BillsPage = lazy(() => import("@/pages/BillsPage"));
const BillDetailPage = lazy(() => import("@/pages/BillDetailPage"));
const ReceiptPage = lazy(() => import("@/pages/ReceiptPage"));
const PaymentsPage = lazy(() => import("@/pages/PaymentsPage"));
const CustomersPage = lazy(() => import("@/pages/CustomersPage"));
const CustomerDetailPage = lazy(() => import("@/pages/CustomerDetailPage"));
const DuesPage = lazy(() => import("@/pages/DuesPage"));
const ProductsPage = lazy(() => import("@/pages/ProductsPage"));
const ProductDetailPage = lazy(() => import("@/pages/ProductDetailPage"));
const LabelsPage = lazy(() => import("@/pages/LabelsPage"));
const PurchasesPage = lazy(() => import("@/pages/PurchasesPage"));
const SuppliersPage = lazy(() => import("@/pages/SuppliersPage"));
const SupplierDetailPage = lazy(() => import("@/pages/SupplierDetailPage"));
const AdjustmentsPage = lazy(() => import("@/pages/AdjustmentsPage"));
const StockCountsPage = lazy(() => import("@/pages/StockCountsPage"));
const StockCountDetailPage = lazy(() => import("@/pages/StockCountDetailPage"));
const MovementsPage = lazy(() => import("@/pages/MovementsPage"));
const ReconciliationPage = lazy(() => import("@/pages/ReconciliationPage"));
const ReportsPage = lazy(() => import("@/pages/ReportsPage"));
const StaffPage = lazy(() => import("@/pages/StaffPage"));
const AuditPage = lazy(() => import("@/pages/AuditPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const CustomerDisplayPage = lazy(() => import("@/pages/CustomerDisplayPage"));
const PublicPayPage = lazy(() => import("@/pages/PublicPayPage"));

function RequireAuth({ children }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <Loading className="min-h-screen" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}

function OwnerOnly({ children }) {
  const { isOwner } = useAuth();
  if (!isOwner) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title={t("Owner access only")}
        description={t("Money totals, analytics and settings are visible to the shop owner.")}
        action={
          <Button asChild variant="outline" className="mt-2">
            <Link to="/pos">{t("Go to billing")}</Link>
          </Button>
        }
      />
    );
  }
  return children;
}

function Home() {
  const { isOwner } = useAuth();
  return <Navigate to={isOwner ? "/dashboard" : "/pos"} replace />;
}

function NotFound() {
  return (
    <EmptyState
      title={t("Page not found")}
      description={t("The page you opened does not exist.")}
      action={
        <Button asChild variant="outline" className="mt-2">
          <Link to="/">{t("Go home")}</Link>
        </Button>
      }
    />
  );
}

const owner = (el) => <OwnerOnly>{el}</OwnerOnly>;

export default function App() {
  // Subscribing here re-renders every page when the language changes, so all t() calls pick it up
  useLanguage();
  return (
    <Suspense fallback={<Loading className="min-h-[50vh]" />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/pay/:token" element={<PublicPayPage />} />
        <Route path="/display" element={<RequireAuth><CustomerDisplayPage /></RequireAuth>} />
        <Route path="/bills/:id/receipt" element={<RequireAuth><ReceiptPage /></RequireAuth>} />
        <Route path="/labels" element={<RequireAuth><LabelsPage /></RequireAuth>} />
        <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route index element={<Home />} />
          <Route path="dashboard" element={owner(<DashboardPage />)} />
          <Route path="pos" element={<PosPage />} />
          <Route path="pos/:billId" element={<PosPage />} />
          <Route path="bills" element={<BillsPage />} />
          <Route path="bills/:id" element={<BillDetailPage />} />
          <Route path="payments" element={<PaymentsPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="customers/:id" element={<CustomerDetailPage />} />
          <Route path="dues" element={owner(<DuesPage />)} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="products/:id" element={<ProductDetailPage />} />
          <Route path="purchases" element={owner(<PurchasesPage />)} />
          <Route path="suppliers" element={owner(<SuppliersPage />)} />
          <Route path="suppliers/:id" element={owner(<SupplierDetailPage />)} />
          <Route path="stock/adjustments" element={<AdjustmentsPage />} />
          <Route path="stock/counts" element={<StockCountsPage />} />
          <Route path="stock/counts/:id" element={<StockCountDetailPage />} />
          <Route path="stock/movements" element={<MovementsPage />} />
          <Route path="reconciliation" element={owner(<ReconciliationPage />)} />
          <Route path="reports" element={owner(<ReportsPage />)} />
          <Route path="staff" element={owner(<StaffPage />)} />
          <Route path="audit" element={owner(<AuditPage />)} />
          <Route path="settings" element={owner(<SettingsPage />)} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
