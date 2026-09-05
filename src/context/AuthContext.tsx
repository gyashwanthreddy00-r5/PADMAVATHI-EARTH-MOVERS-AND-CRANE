import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  allowedPages: string[];
  isAdmin: boolean;
  isOwner: boolean;
  signIn: (username: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [allowedPages, setAllowedPages] = useState<string[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setProfileLoaded(true);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      (async () => {
        setSession(newSession);
        if (!newSession) {
          setProfileLoaded(true);
          setLoading(false);
        }
      })();
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setProfileLoaded(false);
    (async () => {
      if (!session?.user?.id) {
        setProfile(null);
        setAllowedPages([]);
        setIsAdmin(false);
        setIsOwner(false);
        setProfileLoaded(true);
        return;
      }
      const { data } = await supabase
        .from('user_profiles')
        .select('id, auth_user_id, username, display_name, role, active, created_at, updated_at')
        .eq('auth_user_id', session.user.id)
        .maybeSingle();
      const userProfile = data as Profile | null;
      setProfile(userProfile);

      if (userProfile) {
        const { data: roleData } = await supabase
          .from('user_roles')
          .select('role_id, roles!inner(id, name, is_active)')
          .eq('user_id', userProfile.id);

        const activeRoles = (roleData as Array<{ roles: { id: string; name: string; is_active: boolean } }> | null) ?? [];
        const adminRole = activeRoles.some(r => r.roles.name === 'Admin' && r.roles.is_active);
        const ownerRole = activeRoles.some(r => r.roles.name === 'Owner' && r.roles.is_active);
        const roleIds = activeRoles.filter(r => r.roles.is_active).map(r => r.role_id);

        setIsAdmin(adminRole);
        setIsOwner(ownerRole);

        // Auto-sync: register any new app routes into the pages table.
        // Only admin users trigger this to avoid unnecessary calls for every user.
        if (adminRole) {
          const appRoutes: Array<{ path: string; label_key: string; label: string; section: string; icon: string; sort_order: number }> = [
            { path: '/', label_key: 'dashboard', label: 'Dashboard', section: 'dashboard', icon: 'LayoutDashboard', sort_order: 1 },
            { path: '/staff-dashboard', label_key: 'staffDashboard', label: 'Staff Dashboard', section: 'dashboard', icon: 'ClipboardCheck', sort_order: 1 },
            { path: '/vehicles', label_key: 'craneMaster', label: 'Crane Master', section: 'masters', icon: 'Truck', sort_order: 2 },
            { path: '/employees', label_key: 'employeeMaster', label: 'Employee Master', section: 'masters', icon: 'Users', sort_order: 3 },
            { path: '/rates', label_key: 'rateMaster', label: 'Rate Master', section: 'masters', icon: 'Tag', sort_order: 4 },
            { path: '/customers', label_key: 'customers', label: 'Customers', section: 'masters', icon: 'Users', sort_order: 5 },
            { path: '/contracts', label_key: 'monthlyContracts', label: 'Monthly Contracts', section: 'masters', icon: 'FileText', sort_order: 6 },
            { path: '/quotations', label_key: 'quotations', label: 'Quotations', section: 'masters', icon: 'ClipboardList', sort_order: 33 },
            { path: '/trips', label_key: 'tripEntries', label: 'Trip Entries', section: 'operations', icon: 'ClipboardList', sort_order: 7 },
            { path: '/cash-upi', label_key: 'cashUpi', label: 'Cash / UPI', section: 'operations', icon: 'Receipt', sort_order: 8 },
            { path: '/gst-billing', label_key: 'gstCompanyBilling', label: 'GST / Company Billing', section: 'operations', icon: 'FileText', sort_order: 9 },
            { path: '/diesel', label_key: 'dieselEntry', label: 'Diesel Entry', section: 'operations', icon: 'Fuel', sort_order: 10 },
            { path: '/attendance', label_key: 'attendance', label: 'Attendance', section: 'operations', icon: 'CalendarCheck', sort_order: 11 },
            { path: '/maintenance', label_key: 'maintenance', label: 'Maintenance', section: 'operations', icon: 'Wrench', sort_order: 12 },
            { path: '/emi', label_key: 'emiVehicles', label: 'EMI Vehicles', section: 'operations', icon: 'CreditCard', sort_order: 13 },
            { path: '/invoices', label_key: 'customerInvoices', label: 'Customer Invoices', section: 'billing', icon: 'FileText', sort_order: 14 },
            { path: '/settlement-report', label_key: 'settlementReport', label: 'Settlement Report', section: 'billing', icon: 'Wallet', sort_order: 34 },
            { path: '/reports/cash-payment', label_key: 'cashPaymentReport', label: 'Cash Payment Report', section: 'billing', icon: 'IndianRupee', sort_order: 35 },
            { path: '/reports/customer-billing', label_key: 'customerBillingReport', label: 'Customer Billing Report', section: 'billing', icon: 'BarChart3', sort_order: 29 },
            { path: '/settings', label_key: 'settings', label: 'Settings', section: 'settings', icon: 'Settings', sort_order: 15 },
            { path: '/settings/maintenance-types', label_key: 'maintenanceTypes', label: 'Maintenance Types', section: 'settings', icon: 'Wrench', sort_order: 16 },
            { path: '/settings/roles', label_key: 'rolesAndPermissions', label: 'Roles & Permissions', section: 'settings', icon: 'Shield', sort_order: 17 },
            { path: '/settings/users', label_key: 'userManagement', label: 'User Management', section: 'settings', icon: 'Users', sort_order: 18 },
            { path: '/settings/pages', label_key: 'pagesManagement', label: 'Pages Management', section: 'settings', icon: 'FileText', sort_order: 31 },
            { path: '/settings/role-pages', label_key: 'rolePageAssignment', label: 'Role-Page Assignment', section: 'settings', icon: 'Link', sort_order: 32 },
            { path: '/reports/trips', label_key: 'tripReport', label: 'Trip Report', section: 'reports', icon: 'BarChart3', sort_order: 19 },
            { path: '/reports/diesel', label_key: 'dieselReport', label: 'Diesel Report', section: 'reports', icon: 'BarChart3', sort_order: 20 },
            { path: '/reports/attendance', label_key: 'attendanceReport', label: 'Attendance Report', section: 'reports', icon: 'BarChart3', sort_order: 21 },
            { path: '/reports/maintenance', label_key: 'maintenanceReport', label: 'Maintenance Report', section: 'reports', icon: 'BarChart3', sort_order: 22 },
            { path: '/reports/emi', label_key: 'emiReport', label: 'EMI Report', section: 'reports', icon: 'BarChart3', sort_order: 23 },
            { path: '/reports/salary', label_key: 'salaryStatement', label: 'Salary Statement', section: 'reports', icon: 'BarChart3', sort_order: 24 },
            { path: '/reports/daily-vehicle', label_key: 'dailyVehicleReport', label: 'Daily Vehicle Report', section: 'reports', icon: 'BarChart3', sort_order: 25 },
            { path: '/reports/monthly', label_key: 'monthlyReport', label: 'Monthly Report', section: 'reports', icon: 'BarChart3', sort_order: 26 },
            { path: '/reports/profit-loss', label_key: 'profitLoss', label: 'Profit & Loss', section: 'reports', icon: 'TrendingUp', sort_order: 27 },
            { path: '/reports/cash-bills', label_key: 'cashBillReport', label: 'Cash Bill Report', section: 'reports', icon: 'BarChart3', sort_order: 28 },
            { path: '/reports/vehicle-wise', label_key: 'vehicleWiseReport', label: 'Vehicle-Wise Report', section: 'reports', icon: 'TrendingUp', sort_order: 30 },
          ];
          // Fire-and-forget: upsert each route. Errors are silently ignored
          // so they never block the login flow.
          Promise.all(appRoutes.map(r => supabase.rpc('upsert_page', r))).catch(() => {});
        }

        if (adminRole) {
          const { data: allPages } = await supabase.from('pages').select('path').eq('is_active', true);
          setAllowedPages((allPages as Array<{ path: string }> | null)?.map(p => p.path) ?? []);
        } else if (ownerRole || roleIds.length > 0) {
          const { data: pageData } = await supabase
            .from('role_pages')
            .select('pages!inner(path, is_active)')
            .in('role_id', roleIds);

          const paths = ((pageData as Array<{ pages: { path: string; is_active: boolean } }> | null) ?? [])
            .filter(rp => rp.pages.is_active)
            .map(rp => rp.pages.path);
          setAllowedPages([...new Set(paths)]);
        } else {
          setAllowedPages([]);
        }
      } else {
        setAllowedPages([]);
        setIsAdmin(false);
        setIsOwner(false);
      }
      setProfileLoaded(true);
    })();
  }, [session?.user?.id]);

  const signIn = async (username: string, password: string) => {
    try {
      const { data: email, error: resolveError } = await supabase.rpc('resolve_username', {
        p_username: username,
      });

      if (resolveError || !email) {
        return { error: 'Invalid username or password' };
      }

      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        return { error: 'Invalid username or password' };
      }

      return { error: null };
    } catch {
      return { error: 'Network error. Please check your connection and try again.' };
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setAllowedPages([]);
    setIsAdmin(false);
    setIsOwner(false);
    setProfileLoaded(true);
  };

  const authReady = loading || (session ? !profileLoaded : false);

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, profile, loading: authReady, allowedPages, isAdmin, isOwner, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
