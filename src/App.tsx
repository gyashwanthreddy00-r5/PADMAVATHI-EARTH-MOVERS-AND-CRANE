import { useState, useEffect, useRef } from 'react';
import { Shield } from 'lucide-react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { LangProvider } from '@/context/LangContext';
import { SettingsProvider } from '@/context/SettingsContext';
import { ToastProvider } from '@/components/ui/Toast';
import { Layout } from '@/components/Layout';
import { LoadingSpinner } from '@/components/ui/common';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import StaffDashboard from '@/pages/StaffDashboard';
import Vehicles from '@/pages/Vehicles';
import Employees from '@/pages/Employees';
import Rates from '@/pages/Rates';
import Customers from '@/pages/Customers';
import Contracts from '@/pages/Contracts';
import Trips from '@/pages/Trips';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import Diesel from '@/pages/Diesel';
import Attendance from '@/pages/Attendance';
import Maintenance from '@/pages/Maintenance';
import Emi from '@/pages/Emi';
import CashBills from '@/pages/CashBills';
import Invoices from '@/pages/Invoices';
import SettlementReport from '@/pages/SettlementReport';
import CashPaymentReport from '@/pages/CashPaymentReport';
import Reports from '@/pages/Reports';
import VehicleWiseReport from '@/pages/VehicleWiseReport';
import SettingsPage from '@/pages/Settings';
import MaintenanceTypes from '@/pages/MaintenanceTypes';
import RolesPermissions from '@/pages/RolesPermissions';
import UserManagement from '@/pages/UserManagement';
import PagesManagement from '@/pages/PagesManagement';
import RolePagesManagement from '@/pages/RolePagesManagement';
import Quotations from '@/pages/Quotations';

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

  useEffect(() => {
    if (session && !loading && profile && !isAdmin && !isOwner && path !== '/') {
      navigate('/');
    }
  }, [session, loading, profile?.id, isAdmin, isOwner]);

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
      case '/contracts': return <Contracts />;
      case '/trips': return <Trips />;
      case '/diesel': return <Diesel />;
      case '/attendance': return <Attendance />;
      case '/maintenance': return <Maintenance />;
      case '/emi': return <Emi />;
      case '/cash-upi': return <CashBills />;
      case '/gst-billing': return <Invoices />;
      case '/invoices': return <Invoices />;
      case '/quotations': return <Quotations />;
      case '/settlement-report': return <SettlementReport />;
      case '/reports/cash-payment': return <CashPaymentReport />;
      case '/settings': return <SettingsPage />;
      case '/settings/maintenance-types': return <MaintenanceTypes />;
      case '/settings/roles': return <RolesPermissions />;
      case '/settings/users': return <UserManagement />;
      case '/settings/pages': return <PagesManagement />;
      case '/settings/role-pages': return <RolePagesManagement />;
      case '/reports/trips': return <Reports type="trips" />;
      case '/reports/diesel': return <Reports type="diesel" />;
      case '/reports/attendance': return <Reports type="attendance" />;
      case '/reports/maintenance': return <Reports type="maintenance" />;
      case '/reports/emi': return <Reports type="emi" />;
      case '/reports/salary': return <Reports type="salary" />;
      case '/reports/daily-vehicle': return <Reports type="daily-vehicle" />;
      case '/reports/monthly': return <Reports type="monthly" />;
      case '/reports/profit-loss': return <Reports type="profit-loss" />;
      case '/reports/cash-bills': return <Reports type="cash-bills" />;
      case '/reports/customer-billing': return <Reports type="customer-billing" />;
      case '/reports/vehicle-wise': return <VehicleWiseReport />;
      default: return (isAdmin || isOwner) ? <Dashboard onNavigate={navigate} /> : <StaffDashboard onNavigate={navigate} />;
    }
  };

  return (
    <Layout currentPath={path} onNavigate={navigate}>
      <ErrorBoundary key={path}>
        {renderPage()}
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
