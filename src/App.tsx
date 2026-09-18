import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Shield } from 'lucide-react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { LangProvider } from '@/context/LangContext';
import { SettingsProvider } from '@/context/SettingsContext';
import { ToastProvider } from '@/components/ui/Toast';
import { Layout } from '@/components/Layout';
import { LoadingSpinner } from '@/components/ui/common';
import Login from '@/pages/Login';
import { ErrorBoundary } from '@/components/ErrorBoundary';

// Lazy-loaded so each page ships as its own chunk, downloaded only when actually
// opened, instead of every page (and every export library) landing in one bundle.
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const StaffDashboard = lazy(() => import('@/pages/StaffDashboard'));
const Vehicles = lazy(() => import('@/pages/Vehicles'));
const Employees = lazy(() => import('@/pages/Employees'));
const Rates = lazy(() => import('@/pages/Rates'));
const Customers = lazy(() => import('@/pages/Customers'));
const Trips = lazy(() => import('@/pages/Trips'));
const Diesel = lazy(() => import('@/pages/Diesel'));
const Attendance = lazy(() => import('@/pages/Attendance'));
const Maintenance = lazy(() => import('@/pages/Maintenance'));
const Emi = lazy(() => import('@/pages/Emi'));
const CashBills = lazy(() => import('@/pages/CashBills'));
const Invoices = lazy(() => import('@/pages/Invoices'));
const SettlementReport = lazy(() => import('@/pages/SettlementReport'));
const CashPaymentReport = lazy(() => import('@/pages/CashPaymentReport'));
const Reports = lazy(() => import('@/pages/Reports'));
const VehicleWiseReport = lazy(() => import('@/pages/VehicleWiseReport'));
const SettingsPage = lazy(() => import('@/pages/Settings'));
const MaintenanceTypes = lazy(() => import('@/pages/MaintenanceTypes'));
const RolesPermissions = lazy(() => import('@/pages/RolesPermissions'));
const UserManagement = lazy(() => import('@/pages/UserManagement'));
const PagesManagement = lazy(() => import('@/pages/PagesManagement'));
const RolePagesManagement = lazy(() => import('@/pages/RolePagesManagement'));
const Quotations = lazy(() => import('@/pages/Quotations'));
const PoOrders = lazy(() => import('@/pages/PoOrders'));
const PurchaseOrders = lazy(() => import('@/pages/PurchaseOrders'));
const Purchase = lazy(() => import('@/pages/Purchase'));
const PoOrdersReport = lazy(() => import('@/pages/PoOrdersReport'));
const PurchaseReport = lazy(() => import('@/pages/PurchaseReport'));
const DailyVehicleReport = lazy(() => import('@/pages/DailyVehicleReport'));
const Gst = lazy(() => import('@/pages/Gst/Gst'));
const Bank = lazy(() => import('@/pages/Bank'));
const SalaryPayments = lazy(() => import('@/pages/SalaryPayments'));

function AppContent() {
  const { session, profile, loading, allowedPages, isAdmin, isOwner } = useAuth();
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = (p: string) => {
    window.history.pushState({}, '', p);
    setPath(p);
  };

  const prevUserId = useRef<string | null>(null);
  useEffect(() => {
    const currentUserId = session?.user?.id ?? null;
    if (prevUserId.current !== null && prevUserId.current !== currentUserId) {
      navigate('/');
    }
    prevUserId.current = currentUserId;
  }, [session?.user?.id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!session) {
    return <Login />;
  }

  const isAllowed = (p: string): boolean => isAdmin || allowedPages.includes(p);

  const renderPage = () => {
    if (!isAllowed(path) && path !== '/') {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <Shield className="w-12 h-12 text-slate-300 mb-4" />
          <h2 className="text-lg font-bold text-slate-700">Access Restricted</h2>
          <p className="text-sm text-slate-400 mt-1">You do not have permission to view this page.</p>
        </div>
      );
    }
    switch (path) {
      case '/': return (isAdmin || isOwner) ? <Dashboard onNavigate={navigate} /> : <StaffDashboard onNavigate={navigate} />;
      case '/staff-dashboard': return <StaffDashboard onNavigate={navigate} />;
      case '/vehicles': return <Vehicles />;
      case '/employees': return <Employees />;
      case '/rates': return <Rates />;
      case '/customers': return <Customers />;
      case '/trips': return <Trips />;
      case '/diesel': return <Diesel />;
      case '/attendance': return <Attendance />;
      case '/purchase': return <Purchase />;
      case '/maintenance': return <Maintenance />;
      case '/emi': return <Emi />;
      case '/cash-upi': return <CashBills />;
      case '/gst-billing': return <Invoices />;
      case '/invoices': return <Invoices />;
      case '/quotations': return <Quotations />;
      case '/po-orders': return <PoOrders />;
      case '/purchase-orders': return <PurchaseOrders />;
      case '/settlement-report': return <SettlementReport />;
      case '/reports/cash-payment': return <CashPaymentReport />;
      case '/settings': return <SettingsPage />;
      case '/settings/maintenance-types': return <MaintenanceTypes />;
      case '/settings/roles': return <RolesPermissions />;
      case '/settings/users': return <UserManagement />;
      case '/settings/pages': return <PagesManagement />;
      case '/settings/role-pages': return <RolePagesManagement />;
      case '/reports/diesel': return <Reports type="diesel" />;
      case '/reports/attendance': return <Reports type="attendance" />;
      case '/reports/maintenance': return <Reports type="maintenance" />;
      case '/reports/emi': return <Reports type="emi" />;
      case '/reports/salary': return <Reports type="salary" />;
      case '/reports/daily-vehicle': return <DailyVehicleReport />;
      case '/reports/monthly': return <Reports type="monthly" />;
      case '/reports/profit-loss': return <Reports type="profit-loss" />;
      case '/reports/cash-bills': return <Reports type="cash-bills" />;
      case '/reports/customer-billing': return <Reports type="customer-billing" />;
      case '/reports/vehicle-wise': return <VehicleWiseReport />;
      case '/reports/po-orders': return <PoOrdersReport />;
      case '/reports/purchase': return <PurchaseReport />;
      case '/gst': return <Gst />;
      case '/bank': return <Bank />;
      case '/salary-payments': return <SalaryPayments />;
      default: return (isAdmin || isOwner) ? <Dashboard onNavigate={navigate} /> : <StaffDashboard onNavigate={navigate} />;
    }
  };

  return (
    <Layout currentPath={path} onNavigate={navigate}>
      <ErrorBoundary key={path}>
        <Suspense fallback={<div className="flex items-center justify-center min-h-[60vh]"><LoadingSpinner size="lg" /></div>}>
          {renderPage()}
        </Suspense>
      </ErrorBoundary>
    </Layout>
  );
}

export default function App() {
  return (
    <LangProvider>
      <AuthProvider>
        <SettingsProvider>
          <ToastProvider>
            <AppContent />
          </ToastProvider>
        </SettingsProvider>
      </AuthProvider>
    </LangProvider>
  );
}
