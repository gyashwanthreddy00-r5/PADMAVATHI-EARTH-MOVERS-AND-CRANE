import { useState, useEffect, type ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLang } from '@/context/LangContext';
import { useSettings } from '@/context/SettingsContext';
import { useToast } from '@/components/ui/Toast';
import {
  LayoutDashboard, Truck, Users, Tag, FileText, ClipboardList, ClipboardCheck,
  Fuel, CalendarCheck, Wrench, CreditCard, Receipt,
  BarChart3, TrendingUp, Settings as SettingsIcon, LogOut, Menu, Globe, ChevronDown,
  Shield, Users as UsersIcon, FileText as FileTextIcon, Link as LinkIcon, Wallet, IndianRupee,
} from 'lucide-react';
import { classNames } from '@/lib/utils';
import type { TranslationKey } from '@/lib/i18n';
import { NotificationBell } from '@/components/NotificationBell';

interface NavItem {
  key: string;
  label: TranslationKey;
  icon: React.ElementType;
  path: string;
  children?: NavItem[];
}
interface NavSection {
  title: TranslationKey;
  items: NavItem[];
}

const nav: NavSection[] = [
  {
    title: 'dashboard',
    items: [
      { key: 'dashboard', label: 'dashboard', icon: LayoutDashboard, path: '/' },
      { key: 'staff-dashboard', label: 'staffDashboard', icon: ClipboardCheck, path: '/staff-dashboard' },
    ],
  },
  {
    title: 'masters',
    items: [
      { key: 'vehicles', label: 'craneMaster', icon: Truck, path: '/vehicles' },
      { key: 'employees', label: 'employeeMaster', icon: Users, path: '/employees' },
      { key: 'rates', label: 'rateMaster', icon: Tag, path: '/rates' },
      { key: 'customers', label: 'customers', icon: Users, path: '/customers' },
      { key: 'contracts', label: 'monthlyContracts', icon: FileText, path: '/contracts' },
      { key: 'quotations', label: 'quotations', icon: ClipboardList, path: '/quotations' },
    ],
  },
  {
    title: 'operations',
    items: [
      { key: 'trips', label: 'tripEntries', icon: ClipboardList, path: '/trips', children: [
        { key: 'cash-upi', label: 'cashUpi', icon: Receipt, path: '/cash-upi' },
        { key: 'gst-billing', label: 'gstCompanyBilling', icon: FileText, path: '/gst-billing' },
      ] },
      { key: 'diesel', label: 'dieselEntry', icon: Fuel, path: '/diesel' },
      { key: 'attendance', label: 'attendance', icon: CalendarCheck, path: '/attendance' },
      { key: 'maintenance', label: 'maintenance', icon: Wrench, path: '/maintenance' },
      { key: 'emi', label: 'emiVehicles', icon: CreditCard, path: '/emi' },
    ],
  },
  {
    title: 'billing',
    items: [
      { key: 'invoices', label: 'customerInvoices', icon: FileText, path: '/invoices' },
      { key: 'settlement-report', label: 'settlementReport', icon: Wallet, path: '/settlement-report' },
      { key: 'cash-payment-report', label: 'cashPaymentReport', icon: IndianRupee, path: '/reports/cash-payment' },
      { key: 'customer-billing', label: 'customerBillingReport', icon: BarChart3, path: '/reports/customer-billing' },
    ],
  },
  {
    title: 'reports',
    items: [
      { key: 'report-diesel', label: 'dieselReport', icon: BarChart3, path: '/reports/diesel' },
      { key: 'report-attendance', label: 'attendanceReport', icon: BarChart3, path: '/reports/attendance' },
      { key: 'report-maintenance', label: 'maintenanceReport', icon: BarChart3, path: '/reports/maintenance' },
      { key: 'report-emi', label: 'emiReport', icon: BarChart3, path: '/reports/emi' },
      { key: 'report-salary', label: 'salaryStatement', icon: BarChart3, path: '/reports/salary' },
      { key: 'report-daily-vehicle', label: 'dailyVehicleReport', icon: BarChart3, path: '/reports/daily-vehicle' },
      { key: 'report-monthly', label: 'monthlyReport', icon: BarChart3, path: '/reports/monthly' },
      { key: 'report-profit-loss', label: 'profitLoss', icon: TrendingUp, path: '/reports/profit-loss' },
      { key: 'report-vehicle-wise', label: 'vehicleWiseReport', icon: TrendingUp, path: '/reports/vehicle-wise' },
    ],
  },
  {
    title: 'settings',
    items: [
      { key: 'settings', label: 'settings', icon: SettingsIcon, path: '/settings' },
      { key: 'maintenance-types', label: 'maintenanceTypes', icon: Wrench, path: '/settings/maintenance-types' },
      { key: 'roles', label: 'rolesAndPermissions', icon: Shield, path: '/settings/roles' },
      { key: 'users', label: 'userManagement', icon: UsersIcon, path: '/settings/users' },
      { key: 'pages', label: 'pagesManagement', icon: FileTextIcon, path: '/settings/pages' },
      { key: 'role-pages', label: 'rolePageAssignment', icon: LinkIcon, path: '/settings/role-pages' },
    ],
  },
];

interface LayoutProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  children: ReactNode;
}

export function Layout({ currentPath, onNavigate, children }: LayoutProps) {
  const { user, profile, signOut, allowedPages, isAdmin } = useAuth();
  // Owner and Admin both see the admin dashboard, but only Admin bypasses page assignments.
  // Owner is restricted to pages assigned via role-page assignment, so isAllowed uses isAdmin only.
  const { t, lang, setLang } = useLang();
  const { settings } = useSettings();
  const { show } = useToast();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem('sidebar-collapsed') === 'true';
  });
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    masters: true, operations: true, billing: true, reports: true,
  });
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>({});

  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(collapsed));
  }, [collapsed]);

  const toggleSection = (key: string) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  const handleToggleSidebar = () => setCollapsed(c => !c);

  const handleSignOut = async () => {
    await signOut();
    show(t('logout'), 'info');
  };

  const isAllowed = (path: string): boolean => isAdmin || allowedPages.includes(path);

  const filteredNav = nav.map(section => ({
    ...section,
    items: section.items
      .map(item => ({
        ...item,
        children: item.children?.filter(c => isAllowed(c.path)),
      }))
      .filter(item => isAllowed(item.path) || (item.children?.length ?? 0) > 0),
  })).filter(section => section.items.length > 0);

  const currentItem = filteredNav.flatMap(s => [...s.items, ...(s.items.flatMap(i => i.children ?? []))]).find(i => i.path === currentPath);

  const sidebarWidth = collapsed ? 'w-[68px]' : 'w-64';

  const renderTooltip = (key: string, text: string) => {
    if (!collapsed && !mobileOpen) return null;
    if (hoveredItem !== key) return null;
    return (
      <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 z-50 px-2.5 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-md whitespace-nowrap shadow-lg pointer-events-none">
        {text}
        <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-slate-900" />
      </div>
    );
  };

  const sidebar = (
    <div className={classNames('flex flex-col h-full bg-slate-900 text-slate-300 transition-all duration-300 ease-in-out', sidebarWidth)}>
      {/* Logo / Company Name */}
      <div className={classNames('flex items-center border-b border-slate-800 flex-shrink-0 h-16', collapsed ? 'justify-center px-2' : 'gap-3 px-5')}>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden bg-white">
          <img src="/coreone_icon_.png" alt="Logo" className="w-full h-full object-contain" />
        </div>
        {!collapsed && (
          <div className="min-w-0 overflow-hidden">
            <h1 className="text-[11px] font-bold text-white leading-tight truncate">{settings?.company_name ?? t('appName')}</h1>
            <p className="text-[10px] text-slate-500 truncate">{t('appTagline')}</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 px-2 space-y-0.5 sidebar-scroll">
        {filteredNav.map(section => {
          const isSection = section.items.length > 1;
          const sectionKey = section.title;
          const isOpen = openSections[sectionKey] ?? true;

          if (collapsed) {
            return (
              <div key={sectionKey} className="space-y-0.5 pt-2">
                <div className="border-t border-slate-700/60 my-1" />
                {section.items.map(item => {
                  const active = currentPath === item.path;
                  return (
                    <div
                      key={item.key}
                      className="relative"
                      onMouseEnter={() => setHoveredItem(item.key)}
                      onMouseLeave={() => setHoveredItem(null)}
                    >
                      <button
                        onClick={() => { onNavigate(item.path); setMobileOpen(false); }}
                        className={classNames(
                          'w-full flex items-center justify-center p-2.5 rounded-lg transition-all duration-200 relative',
                          active
                            ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                            : 'text-slate-300 hover:bg-slate-800/80 hover:text-white',
                        )}
                      >
                        {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 bg-white rounded-r-full" />}
                        <item.icon className="w-5 h-5 flex-shrink-0" />
                      </button>
                      {renderTooltip(item.key, t(item.label))}
                    </div>
                  );
                })}
              </div>
            );
          }

          return (
            <div key={sectionKey}>
              {isSection ? (
                <button
                  onClick={() => toggleSection(sectionKey)}
                  className="w-full flex items-center justify-between px-3 py-2 text-[12px] font-bold text-white uppercase tracking-[0.12em] hover:text-white transition-colors group"
                >
                  <span>{t(section.title)}</span>
                  <ChevronDown className={classNames('w-3.5 h-3.5 transition-transform text-slate-400 group-hover:text-white', isOpen ? '' : '-rotate-90')} />
                </button>
              ) : (
                <div className="px-3 py-2 text-[12px] font-bold text-white uppercase tracking-[0.12em]">
                  {t(section.title)}
                </div>
              )}
              {(!isSection || isOpen) && (
                <div className="mt-0.5 space-y-0.5">
                  {section.items.map(item => {
                    const active = currentPath === item.path || (item.children?.some(c => c.path === currentPath) ?? false);
                    const hasChildren = (item.children?.length ?? 0) > 0;
                    const childActive = hasChildren && item.children!.some(c => c.path === currentPath);
                    const itemOpen = hasChildren ? (expandedParents[item.key] ?? childActive) : false;
                    return (
                      <div key={item.key}>
                        <button
                          onClick={() => {
                            if (hasChildren) {
                              setExpandedParents(prev => ({ ...prev, [item.key]: !itemOpen }));
                            } else {
                              onNavigate(item.path);
                              setMobileOpen(false);
                            }
                          }}
                          className={classNames(
                            'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 relative',
                            active && !hasChildren
                              ? 'bg-blue-600 text-white font-medium shadow-sm shadow-blue-600/30'
                              : childActive
                                ? 'text-white font-medium'
                                : 'text-slate-300 hover:bg-slate-800/70 hover:text-white font-normal',
                          )}
                        >
                          {active && !hasChildren && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 bg-white rounded-r-full" />}
                          <item.icon className={classNames('w-4 h-4 flex-shrink-0', active || childActive ? 'text-white' : 'text-slate-400')} />
                          <span className="truncate">{t(item.label)}</span>
                          {hasChildren && (
                            <ChevronDown className={classNames('w-3 h-3 ml-auto flex-shrink-0 transition-transform', itemOpen ? '' : '-rotate-90')} />
                          )}
                        </button>
                        {hasChildren && itemOpen && (
                          <div className="mt-0.5 ml-4 space-y-0.5 border-l border-slate-700/60 pl-2">
                            {item.children!.map(child => {
                              const childActiveItem = currentPath === child.path;
                              return (
                                <button
                                  key={child.key}
                                  onClick={() => { onNavigate(child.path); setMobileOpen(false); }}
                                  className={classNames(
                                    'w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm transition-all duration-200 relative',
                                    childActiveItem
                                      ? 'bg-blue-600 text-white font-medium shadow-sm shadow-blue-600/30'
                                      : 'text-slate-400 hover:bg-slate-800/70 hover:text-white font-normal',
                                  )}
                                >
                                  {childActiveItem && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 bg-white rounded-r-full" />}
                                  <child.icon className={classNames('w-3.5 h-3.5 flex-shrink-0', childActiveItem ? 'text-white' : 'text-slate-500')} />
                                  <span className="truncate">{t(child.label)}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* User Profile + Logout */}
      <div className="border-t border-slate-700/60 p-2 flex-shrink-0">
        <div className={classNames('flex items-center gap-3 px-2 py-2 mb-1', collapsed && 'justify-center')}>
          <div className="w-8 h-8 bg-slate-700 rounded-full flex items-center justify-center text-xs font-medium text-white flex-shrink-0">
            {(profile?.display_name ?? profile?.username ?? user?.email ?? 'U')[0]?.toUpperCase()}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0 overflow-hidden">
              <p className="text-xs text-white truncate">{profile?.display_name ?? profile?.username ?? user?.email}</p>
              {profile && <p className="text-[10px] text-slate-400 capitalize">{profile.role}</p>}
            </div>
          )}
        </div>
        <div className="relative" onMouseEnter={() => setHoveredItem('logout')} onMouseLeave={() => setHoveredItem(null)}>
          <button
            onClick={handleSignOut}
            className={classNames(
              'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-red-600/20 hover:text-red-400 transition-all duration-200',
              collapsed && 'justify-center',
            )}
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span>{t('logout')}</span>}
          </button>
          {renderTooltip('logout', t('logout'))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Desktop sidebar */}
      <div className="hidden lg:block flex-shrink-0 transition-all duration-300 ease-in-out">
        {sidebar}
      </div>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={() => setMobileOpen(false)} />
          <div className="relative animate-slide-in-right">{sidebar}</div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="bg-white border-b border-slate-200 px-4 lg:px-6 py-3 flex items-center justify-between flex-shrink-0 h-16">
          <div className="flex items-center gap-3">
            {/* Hamburger - desktop */}
            <button
              onClick={handleToggleSidebar}
              className="hidden lg:flex p-2 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors"
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <Menu className="w-5 h-5" />
            </button>
            {/* Hamburger - mobile */}
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="hidden sm:block">
              <h2 className="text-lg font-bold text-slate-800 tracking-tight">
                {currentItem ? t(currentItem.label) : t('dashboard')}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <NotificationBell onNavigate={onNavigate} />
            <button
              onClick={() => setLang(lang === 'en' ? 'te' : 'en')}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              <Globe className="w-4 h-4" />
              <span className="font-medium">{lang === 'en' ? 'English' : 'తెలుగు'}</span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
