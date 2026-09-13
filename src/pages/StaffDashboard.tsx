import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useLang } from '@/context/LangContext';
import { useNotifications } from '@/hooks/useNotifications';
import { LoadingSpinner } from '@/components/ui/common';
import { DatePicker } from '@/components/ui/DatePicker';
import { formatCurrency, formatDate, todayISO, toISODate, classNames } from '@/lib/utils';
import {
  Truck, Wrench, Fuel, AlertCircle, Calendar, FileText, AlertTriangle,
  RefreshCw, X, ArrowRight, CalendarClock, ShieldCheck, ClipboardCheck,
  CreditCard, Eye, ClipboardList, CheckCircle2, Clock, MapPin,
  TrendingUp, Gauge, IndianRupee,
} from 'lucide-react';
import type {
  Vehicle, TripWithRelations, DieselWithRelations, MaintenanceWithRelations,
  EmiWithRelations, MonthlyContract, Employee, Quotation, PoOrder, InvoiceWithRelations,
} from '@/types';

type WorkProgressStatus = 'Completed' | 'In Progress' | 'Pending';
interface WorkProgressRow {
  id: string;
  name: string;
  workType: string;
  status: WorkProgressStatus;
}

// Today's Work Progress card + Work Progress List row navigation — each module name
// used above maps to its own page. ('/diesel-entry' was requested but the app's real
// route for this page is '/diesel' - see App.tsx - so that's what's used here; every
// other path below matches the app's routes exactly.)
const WORK_TYPE_ROUTES: Record<string, string> = {
  'Diesel Entry': '/diesel',
  // Displayed as "Log Book Entry" (PO Orders renamed in the UI only) - the route
  // itself is still /po-orders, unchanged.
  'Log Book Entry': '/po-orders',
  'Maintenance Entry': '/maintenance',
  'Customer Invoice': '/invoices',
};

type DateRangeKey = 'today' | 'week' | 'month' | 'custom';

interface StaffData {
  vehicles: Vehicle[];
  contracts: MonthlyContract[];
  todayTrips: TripWithRelations[];
  periodTrips: TripWithRelations[];
  todayDiesel: DieselWithRelations[];
  periodDiesel: DieselWithRelations[];
  todayMaintenance: MaintenanceWithRelations[];
  periodMaintenance: MaintenanceWithRelations[];
  emiRecords: EmiWithRelations[];
  employees: Employee[];
  quotations: Quotation[];
  activePoOrders: (PoOrder & { customer?: { id: string; name: string } | null })[];
  todayInvoices: InvoiceWithRelations[];
}

function getRangeDates(range: DateRangeKey, customStart?: string, customEnd?: string): { start: string; end: string } {
  const today = todayISO();
  const now = new Date();
  let start: string, end: string;

  switch (range) {
    case 'today':
      start = today; end = today;
      break;
    case 'week': {
      const day = now.getDay();
      const weekStart = new Date(now); weekStart.setDate(now.getDate() - day);
      const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
      start = toISODate(weekStart); end = toISODate(weekEnd);
      break;
    }
    case 'month':
      start = toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
      end = toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
      break;
    case 'custom':
      start = customStart ?? today; end = customEnd ?? today;
      break;
  }
  return { start, end };
}

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

interface KpiProps {
  label: string;
  value: string | number;
  icon: React.ElementType;
  iconColor: string;
  bgColor: string;
  subtitle?: string;
  subtitleColor?: string;
  onClick?: () => void;
}

function Kpi({ label, value, icon: Icon, iconColor, bgColor, subtitle, subtitleColor, onClick }: KpiProps) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      onClick={onClick}
      className={classNames(
        'bg-white rounded-2xl border border-slate-200 shadow-sm p-4 text-left transition-all w-full min-w-0 group',
        onClick && 'hover:shadow-lg hover:border-slate-300 cursor-pointer hover:-translate-y-0.5',
      )}
    >
      <div className="flex items-start justify-between mb-2.5 gap-2">
        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider leading-tight">{label}</span>
        <div className={classNames('flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110', bgColor)}>
          <Icon className={classNames('w-4 h-4', iconColor)} />
        </div>
      </div>
      <p className="text-2xl font-bold text-slate-800 tabular-nums leading-none">{value}</p>
      {subtitle && <p className={classNames('text-xs font-medium mt-2 truncate', subtitleColor ?? 'text-slate-500')}>{subtitle}</p>}
    </Wrapper>
  );
}

export default function StaffDashboard({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { t } = useLang();
  const { notifications } = useNotifications();
  const [data, setData] = useState<StaffData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dismissedAlertIds, setDismissedAlertIds] = useState<Set<string>>(() => new Set());
  const [dateRange, setDateRange] = useState<DateRangeKey>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const workProgressListRef = useRef<HTMLDivElement>(null);

  const today = todayISO();

  const fetchData = useCallback(async () => {
    const { start, end } = getRangeDates(dateRange, customStart, customEnd);

    const [vRes, cRes, ttRes, ptRes, tdRes, pdRes, tmRes, pmRes, eRes, empRes, qRes, poRes, invRes] = await Promise.all([
      supabase.from('vehicles').select('*'),
      supabase.from('monthly_contracts').select('*'),
      supabase.from('trips').select('*, vehicle:vehicles(id,registration_number,model,type,capacity,hourly_rate,daily_rate,tons), driver:employees(id,name,role,phone,license_number,license_expiry,salary), customer:customers(id,name,address,gstin,phone)').eq('trip_date', today).eq('is_cancelled', false),
      supabase.from('trips').select('*, vehicle:vehicles(id,registration_number,model,type), driver:employees(id,name,role), customer:customers(id,name)').gte('trip_date', start).lte('trip_date', end).eq('is_cancelled', false),
      supabase.from('diesel_entries').select('*, vehicle:vehicles(id,registration_number,type)').eq('diesel_date', today).eq('is_cancelled', false),
      supabase.from('diesel_entries').select('*, vehicle:vehicles(id,registration_number,type)').gte('diesel_date', start).lte('diesel_date', end).eq('is_cancelled', false),
      supabase.from('maintenance').select('*, vehicle:vehicles(id,registration_number,type)').eq('maintenance_date', today).eq('is_cancelled', false),
      supabase.from('maintenance').select('*, vehicle:vehicles(id,registration_number,type)').gte('maintenance_date', start).lte('maintenance_date', end).eq('is_cancelled', false),
      supabase.from('emi_records').select('*, vehicle:vehicles(id,registration_number,model)'),
      supabase.from('employees').select('*').eq('active', true),
      supabase.from('quotations').select('*').order('created_at', { ascending: false }),
      // Today's Work Progress card/list (Staff Dashboard only). Customer Invoices are
      // scoped to today (same "today" concept used above for diesel/maintenance), but
      // PO Orders is deliberately NOT date-scoped — it shows every currently Active PO
      // Order (ongoing work), not just ones created today; a Completed PO disappears
      // immediately (filtered server-side here, not by date).
      supabase.from('po_orders').select('*, customer:customers(id,name)').eq('status', 'Active'),
      supabase.from('invoices').select('*, customer:customers(id,name)').eq('invoice_date', today).eq('is_cancelled', false).in('invoice_type', ['GST', 'MONTHLY_CONTRACT']),
    ]);

    setData({
      vehicles: (vRes.data ?? []) as Vehicle[],
      contracts: (cRes.data ?? []) as MonthlyContract[],
      todayTrips: (ttRes.data ?? []) as TripWithRelations[],
      periodTrips: (ptRes.data ?? []) as TripWithRelations[],
      todayDiesel: (tdRes.data ?? []) as DieselWithRelations[],
      periodDiesel: (pdRes.data ?? []) as DieselWithRelations[],
      todayMaintenance: (tmRes.data ?? []) as MaintenanceWithRelations[],
      periodMaintenance: (pmRes.data ?? []) as MaintenanceWithRelations[],
      emiRecords: (eRes.data ?? []) as EmiWithRelations[],
      employees: (empRes.data ?? []) as Employee[],
      quotations: (qRes.data ?? []) as Quotation[],
      activePoOrders: (poRes.data ?? []) as (PoOrder & { customer?: { id: string; name: string } | null })[],
      todayInvoices: (invRes.data ?? []) as InvoiceWithRelations[],
    });
    setLoading(false);
    setRefreshing(false);
  }, [today, dateRange, customStart, customEnd]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    const channel = supabase
      .channel('staff-dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'diesel_entries' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'monthly_contracts' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quotations' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'po_orders' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, fetchData)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchData]);

  const handleRefresh = () => {
    setDismissedAlertIds(new Set());
    setRefreshing(true);
    fetchData();
  };

  const visibleNotifications = notifications.filter(n => !dismissedAlertIds.has(n.id));
  const visibleCounts = {
    total: visibleNotifications.length,
    expired: visibleNotifications.filter(n => n.severity === 'expired' || n.severity === 'overdue').length,
    dueSoon: visibleNotifications.filter(n => n.severity === 'due-soon').length,
    dueToday: visibleNotifications.filter(n => n.severity === 'due-today').length,
  };

  const handleDismissAllAlerts = () => {
    setDismissedAlertIds(new Set(notifications.map(n => n.id)));
  };

  const rangeLabel = useMemo(() => {
    const { start, end } = getRangeDates(dateRange, customStart, customEnd);
    if (start === end) return formatDate(start);
    return `${formatDate(start)} - ${formatDate(end)}`;
  }, [dateRange, customStart, customEnd]);

  const computed = useMemo(() => {
    if (!data) return null;

    const bookedVehicleIds = new Set<string>();
    data.contracts.forEach(c => {
      if (c.status === 'Active' && c.vehicle_id && c.start_date <= today && (!c.end_date || c.end_date >= today)) {
        bookedVehicleIds.add(c.vehicle_id);
      }
    });

    const activeVehicles = data.vehicles.filter(v => v.active);
    const availableVehicles = activeVehicles.filter(v => v.status === 'Available' && !bookedVehicleIds.has(v.id));
    const workingVehicles = activeVehicles.filter(v => v.status === 'Working' || bookedVehicleIds.has(v.id));
    const maintenanceVehicles = activeVehicles.filter(v => v.status === 'Maintenance');
    const inactiveVehicles = data.vehicles.filter(v => !v.active || v.status === 'Inactive');

    const todayTripsCount = data.todayTrips.length;
    const completedTodayTrips = data.todayTrips.filter(tr => tr.bill_status === 'Paid').length;
    const pendingTodayTrips = data.todayTrips.filter(tr => tr.bill_status !== 'Paid').length;

    const periodTripsCount = data.periodTrips.length;
    const completedPeriodTrips = data.periodTrips.filter(tr => tr.bill_status === 'Paid').length;
    const activePeriodTrips = data.periodTrips.filter(tr => tr.bill_status === 'Pending' || tr.bill_status === 'Partially Paid').length;
    const periodRevenue = data.periodTrips.reduce((s, tr) => s + Number(tr.total_amount), 0);
    const periodBatha = data.periodTrips.reduce((s, tr) => s + Number(tr.batha), 0);

    const todayDieselEntries = data.todayDiesel.length;
    const periodDieselEntries = data.periodDiesel.length;
    const periodDieselCost = data.periodDiesel.reduce((s, d) => s + Number(d.total_amount), 0);

    const todayMaintenanceCount = data.todayMaintenance.length;
    const periodMaintenanceCount = data.periodMaintenance.length;
    const periodMaintenanceCost = data.periodMaintenance.reduce((s, m) => s + Number(m.amount), 0);

    const emiDueToday = data.emiRecords.filter(e => e.status !== 'Paid' && e.due_date === today).length;
    const emiOverdue = data.emiRecords.filter(e => e.status !== 'Paid' && new Date(e.due_date) < new Date()).length;
    const emiDueSoon = data.emiRecords.filter(e => {
      if (e.status === 'Paid') return false;
      const d = daysUntil(e.due_date);
      return d >= 0 && d <= 7;
    }).length;

    const docExpiry = {
      fitnessExpired: data.vehicles.filter(v => v.fitness_expiry_date && daysUntil(v.fitness_expiry_date) < 0).length,
      fitnessExpiring: data.vehicles.filter(v => v.fitness_expiry_date && daysUntil(v.fitness_expiry_date) >= 0 && daysUntil(v.fitness_expiry_date) <= 30).length,
      licenseExpired: data.employees.filter(e => e.license_expiry && daysUntil(e.license_expiry) < 0).length,
      licenseExpiring: data.employees.filter(e => e.license_expiry && daysUntil(e.license_expiry) >= 0 && daysUntil(e.license_expiry) <= 30).length,
      insuranceExpired: data.vehicles.filter(v => v.insurance_expiry_date && daysUntil(v.insurance_expiry_date) < 0).length,
      insuranceExpiring: data.vehicles.filter(v => v.insurance_expiry_date && daysUntil(v.insurance_expiry_date) >= 0 && daysUntil(v.insurance_expiry_date) <= 7).length,
    };

    const quotationBreakdown = {
      draft: data.quotations.filter(q => q.status === 'Draft').length,
      sent: data.quotations.filter(q => q.status === 'Sent').length,
      accepted: data.quotations.filter(q => q.status === 'Accepted').length,
      expiringSoon: data.quotations.filter(q => q.valid_until && daysUntil(q.valid_until) >= 0 && daysUntil(q.valid_until) <= 7).length,
    };

    const recentMaintenance = data.periodMaintenance.slice(0, 5);

    const upcomingEvents: { label: string; date: string; type: string; navigateTo: string }[] = [];
    data.emiRecords.forEach(e => {
      if (e.status !== 'Paid') { const d = daysUntil(e.due_date); if (d >= 0 && d <= 7) upcomingEvents.push({ label: `EMI due - ${e.vehicle?.registration_number ?? 'N/A'}`, date: e.due_date, type: 'emi', navigateTo: '/emi' }); }
    });
    data.vehicles.forEach(v => {
      if (v.fitness_expiry_date) { const d = daysUntil(v.fitness_expiry_date); if (d >= 0 && d <= 7) upcomingEvents.push({ label: `Fitness expiry - ${v.registration_number}`, date: v.fitness_expiry_date, type: 'doc', navigateTo: '/vehicles' }); }
    });
    data.quotations.forEach(q => {
      if (q.valid_until && q.status === 'Sent') { const d = daysUntil(q.valid_until); if (d >= 0 && d <= 7) upcomingEvents.push({ label: `Quotation expiry - ${q.quotation_number}`, date: q.valid_until, type: 'quotation', navigateTo: '/quotations' }); }
    });
    upcomingEvents.sort((a, b) => a.date.localeCompare(b.date));

    // Today's Work Progress — one row per entry across the four modules named in the
    // card (Diesel Entries, Maintenance Entries, Customer Invoices are today-only;
    // PO Orders is every currently Active one, already fetched pre-filtered to
    // status='Active' above — a Completed PO is never in data.activePoOrders at all,
    // so it disappears from both the count and the Work Progress List immediately,
    // and reopening one (back to Active) brings it right back via the realtime
    // po_orders subscription re-running this fetch).
    const todayPoOrdersCount = data.activePoOrders.length;
    const todayInvoicesCount = data.todayInvoices.length;
    const totalTodayEntries = todayDieselEntries + todayPoOrdersCount + todayMaintenanceCount + todayInvoicesCount;

    const workProgressRows: WorkProgressRow[] = [
      ...data.todayDiesel.map(d => ({
        id: `diesel-${d.id}`,
        name: d.vehicle?.registration_number ?? '-',
        workType: 'Diesel Entry',
        status: (d.payment_status === 'Paid' ? 'Completed' : d.payment_status === 'Partially Paid' ? 'In Progress' : 'Pending') as WorkProgressStatus,
      })),
      ...data.activePoOrders.map(p => ({
        id: `po-${p.id}`,
        name: p.customer?.name ?? p.po_number,
        workType: 'Log Book Entry',
        status: 'In Progress' as WorkProgressStatus,
      })),
      ...data.todayMaintenance.map(m => ({
        id: `maint-${m.id}`,
        name: m.vehicle?.registration_number ?? '-',
        workType: 'Maintenance Entry',
        status: (Number(m.balance) <= 0 ? 'Completed' : Number(m.paid_amount) > 0 ? 'In Progress' : 'Pending') as WorkProgressStatus,
      })),
      ...data.todayInvoices.map(i => ({
        id: `inv-${i.id}`,
        name: i.customer?.name ?? i.customer_name ?? '-',
        workType: 'Customer Invoice',
        status: (i.payment_status === 'Paid' ? 'Completed' : i.payment_status === 'Partially Paid' ? 'In Progress' : 'Pending') as WorkProgressStatus,
      })),
    ];

    return {
      availableVehicles: availableVehicles.length,
      workingVehicles: workingVehicles.length,
      maintenanceVehicles: maintenanceVehicles.length,
      inactiveVehicles: inactiveVehicles.length,
      totalVehicles: data.vehicles.length,
      todayTripsCount, completedTodayTrips, pendingTodayTrips,
      periodTripsCount, completedPeriodTrips, activePeriodTrips,
      periodRevenue, periodBatha,
      todayDieselEntries, periodDieselEntries, periodDieselCost,
      todayMaintenanceCount, periodMaintenanceCount, periodMaintenanceCost,
      emiDueToday, emiOverdue, emiDueSoon,
      docExpiry, quotationBreakdown,
      recentMaintenance,
      upcomingEvents,
      todayTrips: data.todayTrips,
      todayPoOrdersCount, todayInvoicesCount, totalTodayEntries,
      workProgressRows,
    };
  }, [data, today, dateRange, customStart, customEnd]);

  if (loading || !data || !computed) return <LoadingSpinner size="lg" />;

  const rangeOptions: { key: DateRangeKey; label: string }[] = [
    { key: 'today', label: t('today') },
    { key: 'week', label: t('thisWeek') },
    { key: 'month', label: t('thisMonth') },
    { key: 'custom', label: t('customRange') },
  ];

  return (
    <div className="space-y-5 min-w-0">
      {/* Header + Date Range Filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">{t('staffDashboardTitle')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('staffDashboardSubtitle')} - {rangeLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            {rangeOptions.map(opt => (
              <button
                key={opt.key}
                onClick={() => { setDateRange(opt.key); setShowCustom(opt.key === 'custom'); }}
                className={classNames(
                  'px-3 py-2 text-xs font-semibold transition-all whitespace-nowrap',
                  dateRange === opt.key ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {showCustom && (
            <div className="flex items-center gap-1">
              <DatePicker value={customStart} onChange={v => setCustomStart(v)} className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
              <span className="text-slate-400 text-xs">-</span>
              <DatePicker value={customEnd} onChange={v => setCustomEnd(v)} className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
            </div>
          )}
          <button onClick={handleRefresh} className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-colors shadow-sm" title={t('refresh')}>
            <RefreshCw className={classNames('w-4 h-4', refreshing && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* ALERTS */}
      {visibleCounts.total > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-100 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <h3 className="text-sm font-bold text-slate-800">{t('importantAlerts')}</h3>
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              {visibleCounts.expired > 0 && <span className="px-2.5 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-bold">{visibleCounts.expired} {t('expired')}</span>}
              {visibleCounts.dueToday > 0 && <span className="px-2.5 py-0.5 rounded-full bg-orange-100 text-orange-700 text-xs font-bold">{visibleCounts.dueToday} {t('dueToday')}</span>}
              {visibleCounts.dueSoon > 0 && <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">{visibleCounts.dueSoon} {t('expiringSoon')}</span>}
              <button type="button" onClick={handleDismissAllAlerts} className="flex-shrink-0 p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors" title={t('dismissAllAlerts')} aria-label={t('dismissAllAlerts')}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="divide-y divide-slate-50 max-h-44 overflow-y-auto">
            {visibleNotifications.slice(0, 10).map(n => {
              const isExpired = n.severity === 'expired' || n.severity === 'overdue';
              const isToday = n.severity === 'due-today';
              const icon = n.category === 'eye_test' ? Eye : n.category === 'emi' ? CreditCard : n.category === 'fitness' ? Truck : n.category === 'insurance' ? ShieldCheck : n.category === 'po_low_balance' ? IndianRupee : AlertCircle;
              const Icon = icon;
              return (
                <button key={n.id} type="button" onClick={() => onNavigate(n.navigateTo)} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors text-left">
                  <div className={classNames('flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center', isExpired ? 'bg-red-50' : isToday ? 'bg-orange-50' : 'bg-amber-50')}>
                    <Icon className={classNames('w-4 h-4', isExpired ? 'text-red-600' : isToday ? 'text-orange-600' : 'text-amber-600')} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{n.title}</p>
                  </div>
                  <span className={classNames('text-xs font-semibold whitespace-nowrap', isExpired ? 'text-red-600' : isToday ? 'text-orange-600' : 'text-amber-600')}>{n.subtitle}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* TODAY'S QUICK STATS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label={t('availableCranes')} value={computed.availableVehicles} icon={Truck} iconColor="text-emerald-600" bgColor="bg-emerald-50" subtitle={t('readyForDispatch')} onClick={() => onNavigate('/vehicles')} />
        <Kpi label={t('onRent')} value={computed.workingVehicles} icon={Truck} iconColor="text-blue-600" bgColor="bg-blue-50" subtitle={t('currentlyDeployed')} onClick={() => onNavigate('/vehicles')} />
        <Kpi label={t('maintenance')} value={computed.maintenanceVehicles} icon={Wrench} iconColor="text-amber-600" bgColor="bg-amber-50" subtitle={t('underRepair')} onClick={() => onNavigate('/maintenance')} />
        <Kpi label={t('dieselEntries')} value={computed.todayDieselEntries} icon={Fuel} iconColor="text-orange-600" bgColor="bg-orange-50" subtitle={t('loggedToday')} onClick={() => onNavigate('/diesel')} />
      </div>

      {/* PERIOD SUMMARY CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Kpi label={t('dieselEntries')} value={computed.periodDieselEntries} icon={Fuel} iconColor="text-orange-600" bgColor="bg-orange-50" subtitle={formatCurrency(computed.periodDieselCost)} subtitleColor="text-orange-500" onClick={() => onNavigate('/diesel')} />
        <Kpi label={t('maintenance')} value={computed.periodMaintenanceCount} icon={Wrench} iconColor="text-amber-600" bgColor="bg-amber-50" subtitle={formatCurrency(computed.periodMaintenanceCost)} subtitleColor="text-amber-500" onClick={() => onNavigate('/maintenance')} />
      </div>

      {/* TODAY'S WORK PROGRESS — replaces the old Today's Jobs card/table. Compact
          per-module count summary + a simple Name/Work Type/Progress list, today only. */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 min-w-0">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
            <ClipboardList className="w-4 h-4 text-blue-600" />
          </div>
          <h3 className="text-sm font-bold text-slate-800">Today's Work Progress</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button type="button" onClick={() => onNavigate(WORK_TYPE_ROUTES['Diesel Entry'])} className="text-center p-2.5 rounded-lg bg-orange-50 cursor-pointer transition-all hover:shadow-md hover:ring-1 hover:ring-orange-300">
            <p className="text-lg font-bold text-orange-700 tabular-nums">{computed.todayDieselEntries}</p>
            <p className="text-[10px] font-semibold text-orange-600 uppercase mt-0.5">Diesel Entries</p>
          </button>
          <button type="button" onClick={() => onNavigate(WORK_TYPE_ROUTES['Log Book Entry'])} className="text-center p-2.5 rounded-lg bg-blue-50 cursor-pointer transition-all hover:shadow-md hover:ring-1 hover:ring-blue-300">
            <p className="text-lg font-bold text-blue-700 tabular-nums">{computed.todayPoOrdersCount}</p>
            <p className="text-[10px] font-semibold text-blue-600 uppercase mt-0.5">Log Book Entries</p>
          </button>
          <button type="button" onClick={() => onNavigate(WORK_TYPE_ROUTES['Maintenance Entry'])} className="text-center p-2.5 rounded-lg bg-amber-50 cursor-pointer transition-all hover:shadow-md hover:ring-1 hover:ring-amber-300">
            <p className="text-lg font-bold text-amber-700 tabular-nums">{computed.todayMaintenanceCount}</p>
            <p className="text-[10px] font-semibold text-amber-600 uppercase mt-0.5">Maintenance Entries</p>
          </button>
          <button type="button" onClick={() => onNavigate(WORK_TYPE_ROUTES['Customer Invoice'])} className="text-center p-2.5 rounded-lg bg-slate-50 cursor-pointer transition-all hover:shadow-md hover:ring-1 hover:ring-slate-300">
            <p className="text-lg font-bold text-slate-700 tabular-nums">{computed.todayInvoicesCount}</p>
            <p className="text-[10px] font-semibold text-slate-500 uppercase mt-0.5">Customer Invoices</p>
          </button>
        </div>
        <button
          type="button"
          onClick={() => workProgressListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="w-full flex items-center justify-between mt-3 pt-3 border-t border-slate-100 cursor-pointer transition-all hover:bg-slate-50 rounded-b-lg -mb-1 pb-1"
        >
          <span className="text-sm font-bold text-slate-700">Total Today's Entries</span>
          <span className="text-lg font-bold text-blue-700 tabular-nums">{computed.totalTodayEntries}</span>
        </button>
      </div>

      {/* WORK PROGRESS LIST */}
      <div ref={workProgressListRef} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden min-w-0">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 bg-gradient-to-r from-blue-50/50 to-transparent">
          <Calendar className="w-4 h-4 text-blue-600 flex-shrink-0" />
          <h3 className="text-sm font-bold text-slate-800">Work Progress List</h3>
        </div>
        {computed.workProgressRows.length === 0 ? (
          <p className="text-sm text-slate-400 italic px-4 py-8 text-center">No entries today.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-3 py-2.5 text-[10px] font-bold text-slate-600 uppercase tracking-wider text-left whitespace-nowrap">Name</th>
                  <th className="px-3 py-2.5 text-[10px] font-bold text-slate-600 uppercase tracking-wider text-left whitespace-nowrap">Work Type</th>
                  <th className="px-3 py-2.5 text-[10px] font-bold text-slate-600 uppercase tracking-wider text-center whitespace-nowrap">Progress</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {computed.workProgressRows.map(row => (
                  <tr
                    key={row.id}
                    onClick={() => { const path = WORK_TYPE_ROUTES[row.workType]; if (path) onNavigate(path); }}
                    className="hover:bg-slate-50 hover:shadow-sm transition-all cursor-pointer"
                  >
                    <td className="px-3 py-2.5 text-sm font-medium text-slate-800 whitespace-nowrap max-w-[160px] truncate">{row.name}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-600 whitespace-nowrap">{row.workType}</td>
                    <td className="px-3 py-2.5 text-center whitespace-nowrap">
                      <span className={classNames(
                        'inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold',
                        row.status === 'Completed' ? 'bg-emerald-100 text-emerald-700' :
                        row.status === 'In Progress' ? 'bg-blue-100 text-blue-700' :
                        'bg-orange-100 text-orange-700',
                      )}>{row.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* FLEET STATUS */}
      <div className="grid grid-cols-1 gap-4">
        {/* Fleet Status */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 min-w-0">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <Truck className="w-4 h-4 text-blue-600" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">{t('fleetStatus')}</h3>
            </div>
            <button onClick={() => onNavigate('/vehicles')} className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 flex-shrink-0">
              {t('viewAll')} <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div className="text-center p-3 rounded-xl bg-emerald-50 transition-transform hover:scale-105">
              <p className="text-2xl font-bold text-emerald-700 tabular-nums">{computed.availableVehicles}</p>
              <p className="text-[10px] font-semibold text-emerald-600 uppercase mt-1">{t('vehicleStatusAvailable')}</p>
            </div>
            <div className="text-center p-3 rounded-xl bg-blue-50 transition-transform hover:scale-105">
              <p className="text-2xl font-bold text-blue-700 tabular-nums">{computed.workingVehicles}</p>
              <p className="text-[10px] font-semibold text-blue-600 uppercase mt-1">{t('onRent')}</p>
            </div>
            <div className="text-center p-3 rounded-xl bg-amber-50 transition-transform hover:scale-105">
              <p className="text-2xl font-bold text-amber-700 tabular-nums">{computed.maintenanceVehicles}</p>
              <p className="text-[10px] font-semibold text-amber-600 uppercase mt-1">{t('maintenance')}</p>
            </div>
            <div className="text-center p-3 rounded-xl bg-slate-100 transition-transform hover:scale-105">
              <p className="text-2xl font-bold text-slate-600 tabular-nums">{computed.inactiveVehicles}</p>
              <p className="text-[10px] font-semibold text-slate-500 uppercase mt-1">{t('inactive')}</p>
            </div>
          </div>
          {/* Fleet utilization bar */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5 text-slate-400" />
                {t('fleetUtilization')}
              </span>
              <span className="text-xs font-bold text-slate-800">{computed.totalVehicles > 0 ? Math.round(((computed.workingVehicles + computed.maintenanceVehicles) / computed.totalVehicles) * 100) : 0}%</span>
            </div>
            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={classNames(
                  'h-full rounded-full transition-all duration-500',
                  (computed.workingVehicles + computed.maintenanceVehicles) / Math.max(computed.totalVehicles, 1) >= 0.7 ? 'bg-emerald-500' :
                  (computed.workingVehicles + computed.maintenanceVehicles) / Math.max(computed.totalVehicles, 1) >= 0.4 ? 'bg-amber-500' : 'bg-red-400',
                )}
                style={{ width: `${Math.min(Math.round(((computed.workingVehicles + computed.maintenanceVehicles) / Math.max(computed.totalVehicles, 1)) * 100), 100)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* MAINTENANCE + COMPLIANCE */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Maintenance */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden min-w-0">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-amber-50/50 to-transparent">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                <Wrench className="w-4 h-4 text-amber-600" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">{t('recentMaintenance')}</h3>
            </div>
            <button onClick={() => onNavigate('/maintenance')} className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 flex-shrink-0">
              {t('viewAll')} <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          {computed.recentMaintenance.length === 0 ? (
            <p className="text-xs text-slate-400 italic px-4 py-6 text-center">{t('noMaintenanceThisMonth')}</p>
          ) : (
            <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto">
              {computed.recentMaintenance.map(m => (
                <div key={m.id} className="flex items-center gap-3 px-4 py-2.5 min-w-0 hover:bg-slate-50 transition-colors">
                  <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                    <Wrench className="w-3.5 h-3.5 text-amber-600" />
                  </div>
                  <span className="text-sm font-medium text-slate-700 truncate flex-1 min-w-0">{m.vehicle?.registration_number ?? '-'} - {m.maintenance_type}</span>
                  <span className="text-xs text-slate-500 whitespace-nowrap flex-shrink-0">{formatDate(m.maintenance_date)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Compliance & Expiry */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 min-w-0">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                <ShieldCheck className="w-4 h-4 text-slate-600" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">{t('complianceExpiry')}</h3>
            </div>
            <button onClick={() => onNavigate('/vehicles')} className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 flex-shrink-0">
              {t('details')} <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-2">
            <button onClick={() => onNavigate('/vehicles')} className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 transition-colors text-left group">
              <div className={classNames('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110', computed.docExpiry.fitnessExpired > 0 ? 'bg-red-50' : 'bg-amber-50')}>
                <ShieldCheck className={classNames('w-4 h-4', computed.docExpiry.fitnessExpired > 0 ? 'text-red-600' : 'text-amber-600')} />
              </div>
              <span className="text-sm text-slate-700 flex-1">{t('fitnessExpiringExpired')}</span>
              <span className={classNames('text-sm font-bold tabular-nums', computed.docExpiry.fitnessExpired > 0 ? 'text-red-600' : 'text-slate-800')}>{computed.docExpiry.fitnessExpiring + computed.docExpiry.fitnessExpired}</span>
            </button>
            <button onClick={() => onNavigate('/vehicles')} className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 transition-colors text-left group">
              <div className={classNames('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110', computed.docExpiry.insuranceExpired > 0 ? 'bg-red-50' : 'bg-amber-50')}>
                <ShieldCheck className={classNames('w-4 h-4', computed.docExpiry.insuranceExpired > 0 ? 'text-red-600' : 'text-amber-600')} />
              </div>
              <span className="text-sm text-slate-700 flex-1">{t('insuranceExpiringExpired')}</span>
              <span className={classNames('text-sm font-bold tabular-nums', computed.docExpiry.insuranceExpired > 0 ? 'text-red-600' : 'text-slate-800')}>{computed.docExpiry.insuranceExpiring + computed.docExpiry.insuranceExpired}</span>
            </button>
            <button onClick={() => onNavigate('/employees')} className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 transition-colors text-left group">
              <div className={classNames('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110', computed.docExpiry.licenseExpired > 0 ? 'bg-red-50' : 'bg-amber-50')}>
                <ClipboardCheck className={classNames('w-4 h-4', computed.docExpiry.licenseExpired > 0 ? 'text-red-600' : 'text-amber-600')} />
              </div>
              <span className="text-sm text-slate-700 flex-1">{t('licenseExpiringExpired')}</span>
              <span className={classNames('text-sm font-bold tabular-nums', computed.docExpiry.licenseExpired > 0 ? 'text-red-600' : 'text-slate-800')}>{computed.docExpiry.licenseExpiring + computed.docExpiry.licenseExpired}</span>
            </button>
            <button onClick={() => onNavigate('/emi')} className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 transition-colors text-left group">
              <div className={classNames('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110', computed.emiOverdue > 0 ? 'bg-red-50' : computed.emiDueSoon > 0 ? 'bg-amber-50' : 'bg-slate-50')}>
                <CreditCard className={classNames('w-4 h-4', computed.emiOverdue > 0 ? 'text-red-600' : computed.emiDueSoon > 0 ? 'text-amber-600' : 'text-slate-400')} />
              </div>
              <span className="text-sm text-slate-700 flex-1">{t('emiDueOverdue')}</span>
              <span className={classNames('text-sm font-bold tabular-nums', computed.emiOverdue > 0 ? 'text-red-600' : 'text-slate-800')}>{computed.emiDueSoon + computed.emiDueToday + computed.emiOverdue}</span>
            </button>
            <button onClick={() => onNavigate('/maintenance')} className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 transition-colors text-left group">
              <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110">
                <Wrench className="w-4 h-4 text-amber-600" />
              </div>
              <span className="text-sm text-slate-700 flex-1">{t('maintenanceThisMonth')}</span>
              <span className="text-sm font-bold text-slate-800 tabular-nums">{computed.periodMaintenanceCount}</span>
            </button>
          </div>
        </div>
      </div>

      {/* PERIOD SUMMARY + UPCOMING */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Period Summary */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 min-w-0">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-blue-600" />
            </div>
            <h3 className="text-sm font-bold text-slate-800">{t('thisMonthSummary')}</h3>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => onNavigate('/trips')} className="p-3.5 rounded-xl bg-blue-50 text-left transition-all hover:bg-blue-100 hover:scale-[1.02]">
              <div className="flex items-center gap-2 mb-1.5">
                <ClipboardList className="w-3.5 h-3.5 text-blue-600" />
                <p className="text-[10px] font-semibold text-blue-600 uppercase">{t('totalJobs')}</p>
              </div>
              <p className="text-2xl font-bold text-blue-800 tabular-nums">{computed.periodTripsCount}</p>
            </button>
            <button onClick={() => onNavigate('/trips')} className="p-3.5 rounded-xl bg-emerald-50 text-left transition-all hover:bg-emerald-100 hover:scale-[1.02]">
              <div className="flex items-center gap-2 mb-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <p className="text-[10px] font-semibold text-emerald-600 uppercase">{t('completedJobs')}</p>
              </div>
              <p className="text-2xl font-bold text-emerald-800 tabular-nums">{computed.completedPeriodTrips}</p>
            </button>
            <button onClick={() => onNavigate('/trips')} className="p-3.5 rounded-xl bg-amber-50 text-left transition-all hover:bg-amber-100 hover:scale-[1.02]">
              <div className="flex items-center gap-2 mb-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-600" />
                <p className="text-[10px] font-semibold text-amber-600 uppercase">{t('activeJobs')}</p>
              </div>
              <p className="text-2xl font-bold text-amber-800 tabular-nums">{computed.activePeriodTrips}</p>
            </button>
            <button onClick={() => onNavigate('/diesel')} className="p-3.5 rounded-xl bg-orange-50 text-left transition-all hover:bg-orange-100 hover:scale-[1.02]">
              <div className="flex items-center gap-2 mb-1.5">
                <Fuel className="w-3.5 h-3.5 text-orange-600" />
                <p className="text-[10px] font-semibold text-orange-600 uppercase">{t('dieselEntries')}</p>
              </div>
              <p className="text-2xl font-bold text-orange-800 tabular-nums">{computed.periodDieselEntries}</p>
            </button>
          </div>
          {/* Quotation status */}
          <div className="mt-4 pt-3 border-t border-slate-100">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2">
                <FileText className="w-3.5 h-3.5 text-slate-500" />
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{t('quotations')}</p>
              </div>
              <button onClick={() => onNavigate('/quotations')} className="text-xs font-semibold text-blue-600 hover:text-blue-700">{t('viewAll')}</button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div className="text-center p-2.5 rounded-lg bg-slate-50 transition-transform hover:scale-105">
                <p className="text-sm font-bold text-slate-700 tabular-nums">{computed.quotationBreakdown.draft}</p>
                <p className="text-[9px] font-semibold text-slate-500 uppercase mt-0.5">{t('draft')}</p>
              </div>
              <div className="text-center p-2.5 rounded-lg bg-blue-50 transition-transform hover:scale-105">
                <p className="text-sm font-bold text-blue-700 tabular-nums">{computed.quotationBreakdown.sent}</p>
                <p className="text-[9px] font-semibold text-blue-600 uppercase mt-0.5">{t('sent')}</p>
              </div>
              <div className="text-center p-2.5 rounded-lg bg-emerald-50 transition-transform hover:scale-105">
                <p className="text-sm font-bold text-emerald-700 tabular-nums">{computed.quotationBreakdown.accepted}</p>
                <p className="text-[9px] font-semibold text-emerald-600 uppercase mt-0.5">{t('accepted')}</p>
              </div>
              <div className="text-center p-2.5 rounded-lg bg-amber-50 transition-transform hover:scale-105">
                <p className="text-sm font-bold text-amber-700 tabular-nums">{computed.quotationBreakdown.expiringSoon}</p>
                <p className="text-[9px] font-semibold text-amber-600 uppercase mt-0.5">{t('expiring')}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Upcoming Events */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 min-w-0">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
              <CalendarClock className="w-4 h-4 text-blue-600" />
            </div>
            <h3 className="text-sm font-bold text-slate-800">{t('upcomingNext7Days')}</h3>
          </div>
          {computed.upcomingEvents.length === 0 ? (
            <p className="text-xs text-slate-400 italic px-4 py-6 text-center">{t('noUpcomingEvents')}</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {computed.upcomingEvents.slice(0, 10).map((ev, i) => {
                const iconMap: Record<string, React.ElementType> = { rental: Calendar, emi: CreditCard, doc: ShieldCheck, quotation: FileText };
                const EvIcon = iconMap[ev.type] ?? AlertCircle;
                const days = daysUntil(ev.date);
                return (
                  <button key={i} onClick={() => onNavigate(ev.navigateTo)} className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 transition-colors text-left min-w-0 group">
                    <div className={classNames('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110',
                      days <= 1 ? 'bg-red-50' : days <= 3 ? 'bg-orange-50' : 'bg-blue-50')}>
                      <EvIcon className={classNames('w-4 h-4', days <= 1 ? 'text-red-600' : days <= 3 ? 'text-orange-600' : 'text-blue-600')} />
                    </div>
                    <span className="text-sm text-slate-700 truncate flex-1 min-w-0">{ev.label}</span>
                    <span className="text-xs font-medium text-slate-500 whitespace-nowrap flex-shrink-0">{formatDate(ev.date)}</span>
                    <span className={classNames('text-xs font-bold whitespace-nowrap flex-shrink-0 px-2 py-0.5 rounded-md',
                      days <= 1 ? 'text-red-600 bg-red-50' : days <= 3 ? 'text-orange-600 bg-orange-50' : 'text-blue-600 bg-blue-50')}>{days}d</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
