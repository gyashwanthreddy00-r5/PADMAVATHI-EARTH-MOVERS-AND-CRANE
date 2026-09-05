import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useLang } from '@/context/LangContext';
import { LoadingSpinner } from '@/components/ui/common';
import { DatePicker } from '@/components/ui/DatePicker';
import { RevenueBarChart } from '@/components/ui/Charts';
import { formatCurrency, formatDate, todayISO, toISODate, classNames, vehicleTypeLabel } from '@/lib/utils';
import { useNotifications } from '@/hooks/useNotifications';
import {
  Truck, Wrench, Fuel, IndianRupee,
  CreditCard, AlertCircle, Calendar, FileText, AlertTriangle, Eye,
  RefreshCw, Download, X, ArrowRight, CalendarClock,
  ShieldCheck, ClipboardCheck, TrendingUp, Activity,
} from 'lucide-react';
import type {
  Vehicle, TripWithRelations, DieselWithRelations, MaintenanceWithRelations,
  EmiWithRelations, MonthlyContract, Customer, Employee, InvoiceWithRelations,
  Quotation, InvoicePayment,
} from '@/types';

type DateRangeKey = 'today' | 'week' | 'month' | 'year' | 'custom';

interface DashboardData {
  vehicles: Vehicle[];
  contracts: MonthlyContract[];
  periodTrips: TripWithRelations[];
  prevPeriodTrips: TripWithRelations[];
  periodDiesel: DieselWithRelations[];
  allDiesel: DieselWithRelations[];
  periodMaintenance: MaintenanceWithRelations[];
  allMaintenance: MaintenanceWithRelations[];
  emiRecords: EmiWithRelations[];
  invoices: InvoiceWithRelations[];
  customers: Customer[];
  employees: Employee[];
  allTrips: TripWithRelations[];
  quotations: Quotation[];
  allPayments: (InvoicePayment & { invoice?: { invoice_number: string; customer_name: string | null; customer_id: string | null } })[];
}

function getRangeDates(range: DateRangeKey, customStart?: string, customEnd?: string): { start: string; end: string; prevStart: string; prevEnd: string } {
  const today = todayISO();
  const now = new Date();
  let start: string, end: string, prevStart: string, prevEnd: string;

  switch (range) {
    case 'today':
      start = today; end = today;
      { const d = new Date(now); d.setDate(d.getDate() - 1); prevStart = prevEnd = toISODate(d); }
      break;
    case 'week': {
      const day = now.getDay();
      const weekStart = new Date(now); weekStart.setDate(now.getDate() - day);
      const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
      start = toISODate(weekStart); end = toISODate(weekEnd);
      const prevWeekStart = new Date(weekStart); prevWeekStart.setDate(weekStart.getDate() - 7);
      const prevWeekEnd = new Date(weekStart); prevWeekEnd.setDate(weekStart.getDate() - 1);
      prevStart = toISODate(prevWeekStart); prevEnd = toISODate(prevWeekEnd);
      break;
    }
    case 'month':
      start = toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
      end = toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
      prevStart = toISODate(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      prevEnd = toISODate(new Date(now.getFullYear(), now.getMonth(), 0));
      break;
    case 'year':
      start = `${now.getFullYear()}-01-01`;
      end = `${now.getFullYear()}-12-31`;
      prevStart = `${now.getFullYear() - 1}-01-01`;
      prevEnd = `${now.getFullYear() - 1}-12-31`;
      break;
    case 'custom':
      start = customStart ?? today; end = customEnd ?? today;
      prevStart = start; prevEnd = end;
      break;
  }
  return { start, end, prevStart, prevEnd };
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function formatPct(p: number | null): string {
  if (p === null) return '-';
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
}

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

interface CompactKpiProps {
  label: string;
  value: string | number;
  icon: React.ElementType;
  iconColor: string;
  bgColor: string;
  subtitle?: string;
  subtitleColor?: string;
  onClick?: () => void;
}

function CompactKpi({ label, value, icon: Icon, iconColor, bgColor, subtitle, subtitleColor, onClick }: CompactKpiProps) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      onClick={onClick}
      className={classNames(
        'bg-white rounded-xl border border-slate-200 shadow-sm p-3.5 text-left transition-all w-full min-w-0 relative overflow-hidden',
        onClick && 'hover:shadow-lg hover:-translate-y-0.5 cursor-pointer',
      )}
    >
      <div className={classNames('absolute top-0 left-0 right-0 h-1', bgColor)} />
      <div className="flex items-start justify-between mb-2 gap-2">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider leading-tight">{label}</span>
        <div className={classNames('flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center', bgColor)}>
          <Icon className={classNames('w-3.5 h-3.5', iconColor)} />
        </div>
      </div>
      <p className="text-xl font-bold text-slate-800 tabular-nums leading-none truncate">{value}</p>
      {subtitle && (
        <p className={classNames('text-[11px] font-medium mt-1.5 truncate', subtitleColor ?? 'text-slate-500')}>{subtitle}</p>
      )}
    </Wrapper>
  );
}

export default function Dashboard({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { t } = useLang();
  const { notifications } = useNotifications();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dateRange, setDateRange] = useState<DateRangeKey>('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [dismissedAlertIds, setDismissedAlertIds] = useState<Set<string>>(() => new Set());

  const fetchDashboard = useCallback(async () => {
    const { start, end, prevStart, prevEnd } = getRangeDates(dateRange, customStart, customEnd);

    const [vRes, cRes, eRes, pRes, ppRes, pdRes, adRes, pmRes, amRes, invRes, custRes, empRes, atRes, qRes, payRes] = await Promise.all([
      supabase.from('vehicles').select('*'),
      supabase.from('monthly_contracts').select('*'),
      supabase.from('emi_records').select('*, vehicle:vehicles(id,registration_number,model)'),
      supabase.from('trips').select('*, vehicle:vehicles(id,registration_number,model,type,capacity,hourly_rate,daily_rate,tons), driver:employees(id,name,role,phone,license_number,license_expiry,salary), customer:customers(id,name,address,gstin,phone)').gte('trip_date', start).lte('trip_date', end).eq('is_cancelled', false),
      supabase.from('trips').select('*, vehicle:vehicles(id,registration_number,model,type), driver:employees(id,name,role), customer:customers(id,name)').gte('trip_date', prevStart).lte('trip_date', prevEnd).eq('is_cancelled', false),
      supabase.from('diesel_entries').select('*, vehicle:vehicles(id,registration_number,type)').gte('diesel_date', start).lte('diesel_date', end).eq('is_cancelled', false),
      supabase.from('diesel_entries').select('*, vehicle:vehicles(id,registration_number,type)').eq('is_cancelled', false).order('diesel_date', { ascending: false }).limit(20),
      supabase.from('maintenance').select('*, vehicle:vehicles(id,registration_number,type)').gte('maintenance_date', start).lte('maintenance_date', end).eq('is_cancelled', false).order('maintenance_date', { ascending: false }),
      supabase.from('maintenance').select('*, vehicle:vehicles(id,registration_number,type)').eq('is_cancelled', false).order('maintenance_date', { ascending: false }).limit(10),
      supabase.from('invoices').select('*, customer:customers!invoices_customer_id_fkey(id,name,address,gstin,phone)').in('invoice_type', ['GST', 'Cash']).eq('is_cancelled', false).gte('invoice_date', start).lte('invoice_date', end),
      supabase.from('customers').select('*'),
      supabase.from('employees').select('*').eq('active', true),
      supabase.from('trips').select('*, vehicle:vehicles(id,registration_number,model,type), driver:employees(id,name,role), customer:customers(id,name)').gte('trip_date', start).lte('trip_date', end).eq('is_cancelled', false),
      supabase.from('quotations').select('*').order('created_at', { ascending: false }),
      supabase.from('invoice_payments').select('*, invoice:invoices(id,invoice_number,customer_name,customer_id)').gte('payment_date', start).lte('payment_date', end).order('payment_date', { ascending: false }).limit(20),
    ]);

    setData({
      vehicles: (vRes.data ?? []) as Vehicle[],
      contracts: (cRes.data ?? []) as MonthlyContract[],
      periodTrips: (pRes.data ?? []) as TripWithRelations[],
      prevPeriodTrips: (ppRes.data ?? []) as TripWithRelations[],
      periodDiesel: (pdRes.data ?? []) as DieselWithRelations[],
      allDiesel: (adRes.data ?? []) as DieselWithRelations[],
      periodMaintenance: (pmRes.data ?? []) as MaintenanceWithRelations[],
      allMaintenance: (amRes.data ?? []) as MaintenanceWithRelations[],
      emiRecords: (eRes.data ?? []) as EmiWithRelations[],
      invoices: (invRes.data ?? []) as InvoiceWithRelations[],
      customers: (custRes.data ?? []) as Customer[],
      employees: (empRes.data ?? []) as Employee[],
      allTrips: (atRes.data ?? []) as TripWithRelations[],
      quotations: (qRes.data ?? []) as Quotation[],
      allPayments: (payRes.data ?? []) as (InvoicePayment & { invoice?: { invoice_number: string; customer_name: string | null; customer_id: string | null } })[],
    });
    setLoading(false);
    setRefreshing(false);
  }, [dateRange, customStart, customEnd]);

  useEffect(() => {
    setLoading(true);
    fetchDashboard();
    const channel = supabase
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, fetchDashboard)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'diesel_entries' }, fetchDashboard)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance' }, fetchDashboard)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, fetchDashboard)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'monthly_contracts' }, fetchDashboard)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emi_records' }, fetchDashboard)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, fetchDashboard)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quotations' }, fetchDashboard)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoice_payments' }, fetchDashboard)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchDashboard]);

  const handleRefresh = () => {
    setDismissedAlertIds(new Set());
    setRefreshing(true);
    fetchDashboard();
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

  const handleExport = () => {
    if (!data) return;
    const rows: (string | number)[][] = [['Metric', 'Value']];
    rows.push(['Total Cranes', data.vehicles.length]);
    rows.push(['Available Cranes', data.vehicles.filter(v => v.status === 'Available' && v.active).length]);
    rows.push(['Currently Rented', data.vehicles.filter(v => v.status === 'Working').length]);
    rows.push(['Under Maintenance', data.vehicles.filter(v => v.status === 'Maintenance').length]);
    rows.push(['Period Trips', data.periodTrips.length]);
    rows.push(['Period Revenue', data.periodTrips.reduce((s, tr) => s + Number(tr.total_amount), 0)]);
    rows.push(['Diesel Pending', data.periodDiesel.reduce((s, d) => s + Number(d.pending_amount), 0)]);
    rows.push(['Maintenance Total', data.periodMaintenance.reduce((s, m) => s + Number(m.amount), 0)]);
    rows.push(['Outstanding Payments', data.invoices.filter(inv => Number(inv.balance_amount) > 0).reduce((s, inv) => s + Number(inv.balance_amount), 0)]);
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `dashboard-${todayISO()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // --- COMPUTED VALUES ---
  const computed = useMemo(() => {
    if (!data) return null;

    const today = todayISO();
    const bookedVehicleIds = new Set<string>();
    data.contracts.forEach(c => {
      if (c.status === 'Active' && c.vehicle_id && c.start_date <= today && (!c.end_date || c.end_date >= today)) {
        bookedVehicleIds.add(c.vehicle_id);
      }
    });

    const totalVehicles = data.vehicles.length;
    const activeVehicles = data.vehicles.filter(v => v.active);
    const availableVehicles = activeVehicles.filter(v => v.status === 'Available' && !bookedVehicleIds.has(v.id));
    const workingVehicles = activeVehicles.filter(v => v.status === 'Working' || bookedVehicleIds.has(v.id));
    const maintenanceVehicles = activeVehicles.filter(v => v.status === 'Maintenance');
    const inactiveVehicles = data.vehicles.filter(v => !v.active || v.status === 'Inactive');

    const periodRevenue = data.periodTrips.reduce((s, tr) => s + Number(tr.total_amount), 0);
    const prevPeriodRevenue = data.prevPeriodTrips.reduce((s, tr) => s + Number(tr.total_amount), 0);
    const periodDieselCost = data.periodDiesel.reduce((s, d) => s + Number(d.total_amount), 0);
    const periodMaintenanceCost = data.periodMaintenance.reduce((s, m) => s + Number(m.amount), 0);
    const periodBatha = data.periodTrips.reduce((s, tr) => s + Number(tr.batha), 0);
    const periodExpenses = periodDieselCost + periodBatha + periodMaintenanceCost;
    const periodProfit = periodRevenue - periodExpenses;

    const now = new Date();
    const emiDue = data.emiRecords.filter(e => e.status !== 'Paid' && e.due_date === today).length;
    const emiOverdue = data.emiRecords.filter(e => e.status !== 'Paid' && new Date(e.due_date) < now).length;
    const emiDueToday = emiDue;
    const emiDueSoon = data.emiRecords.filter(e => e.status !== 'Paid' && new Date(e.due_date) <= new Date(now.getTime() + 5 * 86400000) && new Date(e.due_date) > now).length;
    const emiPending = data.emiRecords.filter(e => e.status !== 'Paid').length;

    // Recent EMI payments (latest 5 paid)
    const recentEmiPaid = data.emiRecords
      .filter(e => e.status === 'Paid')
      .sort((a, b) => (b.paid_date ?? b.due_date).localeCompare(a.paid_date ?? a.due_date))
      .slice(0, 5);
    const totalEmiPaidRecently = recentEmiPaid.reduce((s, e) => s + Number(e.emi_amount), 0);

    // Fleet utilization
    const { start, end } = getRangeDates(dateRange, customStart, customEnd);
    const periodDays = Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1);
    const activeFleetDays = activeVehicles.length * periodDays;
    const rentedDays = data.periodTrips.length;
    const fleetUtilization = activeFleetDays > 0 ? Math.round((rentedDays / activeFleetDays) * 100) : 0;

    // Invoice totals — use final_payable_amount when discount is enabled
    const outstandingInvoices = data.invoices.filter(inv => Number(inv.balance_amount) > 0 && inv.payment_status !== 'Paid');
    const outstandingAmount = outstandingInvoices.reduce((s, inv) => s + Number(inv.balance_amount), 0);
    const totalInvoiced = data.invoices.reduce((s, inv) => s + (inv.discount_enabled ? Number(inv.final_payable_amount ?? inv.grand_total) : Number(inv.grand_total)), 0);
    const totalPaid = data.invoices.reduce((s, inv) => s + Number(inv.amount_received), 0);
    const totalPending = data.invoices.reduce((s, inv) => s + Math.max(0, Number(inv.balance_amount)), 0);

    // Invoice status breakdown
    const invoiceBreakdown = {
      draft: data.invoices.filter(inv => inv.invoice_status === 'Draft').length,
      sent: data.invoices.filter(inv => inv.invoice_status === 'Generated' || inv.invoice_status === 'Pending').length,
      partiallyPaid: data.invoices.filter(inv => inv.invoice_status === 'Partially Paid').length,
      paid: data.invoices.filter(inv => inv.invoice_status === 'Paid').length,
      overdue: data.invoices.filter(inv => Number(inv.balance_amount) > 0 && inv.invoice_status !== 'Paid' && new Date(inv.invoice_date) < new Date(now.getTime() - 30 * 86400000)).length,
    };

    // Revenue chart data
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const revenueByMonth = monthNames.map((label, i) => {
      const trips = data.allTrips.filter(tr => new Date(tr.trip_date).getMonth() === i);
      const rev = trips.reduce((s, tr) => s + Number(tr.total_amount), 0);
      const bathaExp = trips.reduce((s, tr) => s + Number(tr.batha), 0);
      return { label, revenue: rev, expenses: bathaExp };
    });

    // Quotation breakdown
    const quotationBreakdown = {
      draft: data.quotations.filter(q => q.status === 'Draft').length,
      sent: data.quotations.filter(q => q.status === 'Sent').length,
      accepted: data.quotations.filter(q => q.status === 'Accepted').length,
      rejected: data.quotations.filter(q => q.status === 'Rejected').length,
      expiringSoon: data.quotations.filter(q => q.valid_until && daysUntil(q.valid_until) >= 0 && daysUntil(q.valid_until) <= 7).length,
      active: data.quotations.filter(q => q.status === 'Draft' || q.status === 'Sent').length,
    };

    // Document expiry counts
    const docExpiry = {
      fitnessExpired: data.vehicles.filter(v => v.fitness_expiry_date && daysUntil(v.fitness_expiry_date) < 0).length,
      fitnessExpiring: data.vehicles.filter(v => v.fitness_expiry_date && daysUntil(v.fitness_expiry_date) >= 0 && daysUntil(v.fitness_expiry_date) <= 30).length,
      licenseExpired: data.employees.filter(e => e.license_expiry && daysUntil(e.license_expiry) < 0).length,
      licenseExpiring: data.employees.filter(e => e.license_expiry && daysUntil(e.license_expiry) >= 0 && daysUntil(e.license_expiry) <= 30).length,
    };

    // Today's trips
    const todayTrips = data.periodTrips.filter(tr => tr.trip_date === today);
    const todayRevenue = todayTrips.reduce((s, tr) => s + Number(tr.total_amount), 0);

    // Active contracts (rentals)
    const activeContracts = data.contracts.filter(c => c.status === 'Active' && c.start_date <= today && (!c.end_date || c.end_date >= today));

    // Rental & job activity
    const rentalActivity = [
      ...activeContracts.map(c => {
        const vehicle = data.vehicles.find(v => v.id === c.vehicle_id);
        const daysToEnd = c.end_date ? daysUntil(c.end_date) : null;
        return {
          id: c.id,
          customer: c.company_name,
          equipment: vehicle ? `${vehicle.registration_number} — ${vehicleTypeLabel(vehicle.type, vehicle.tons ?? vehicle.capacity)}` : 'N/A',
          location: c.address ?? '-',
          start: c.start_date,
          end: c.end_date ?? '-',
          status: daysToEnd !== null && daysToEnd <= 7 ? 'Ending Soon' : 'Active',
          amount: c.final_payable_amount ?? c.total_monthly_amount,
        };
      }),
      ...todayTrips.map(tr => ({
        id: tr.id,
        customer: tr.customer?.name ?? tr.place_of_work,
        equipment: tr.vehicle ? `${tr.vehicle.registration_number} — ${vehicleTypeLabel(tr.vehicle.type, tr.vehicle.tons ?? tr.vehicle.capacity)}` : 'N/A',
        location: tr.place_of_work,
        start: tr.trip_date,
        end: tr.trip_date,
        status: tr.bill_status === 'Paid' ? 'Completed' : 'Active',
        amount: Number(tr.total_amount),
      })),
    ].slice(0, 8);

    // Rental performance
    const totalRentals = data.periodTrips.length;
    const completedRentals = data.periodTrips.filter(tr => tr.bill_status === 'Paid').length;
    const activeRentals = data.periodTrips.filter(tr => tr.bill_status === 'Pending' || tr.bill_status === 'Partially Paid').length;

    // Diesel totals (for selected period)
    const dieselTotal = data.periodDiesel.reduce((s, d) => s + Number(d.total_amount), 0);
    const dieselPaid = data.periodDiesel.reduce((s, d) => s + Number(d.paid_amount), 0);
    const dieselPending = data.periodDiesel.reduce((s, d) => s + Number(d.pending_amount), 0);

    // Recent maintenance (latest 5 in period)
    const recentMaintenance = data.periodMaintenance.slice(0, 5);
    const recentMaintenanceTotal = recentMaintenance.reduce((s, m) => s + Number(m.amount), 0);

    // Recent payments (latest 5)
    const recentPayments = data.allPayments.slice(0, 5);

    // Outstanding invoices (top 8 by balance)
    const outstandingInvoiceList = outstandingInvoices
      .sort((a, b) => Number(b.balance_amount) - Number(a.balance_amount))
      .slice(0, 8);

    return {
      totalVehicles, activeVehicles: activeVehicles.length, availableVehicles: availableVehicles.length,
      workingVehicles: workingVehicles.length, maintenanceVehicles: maintenanceVehicles.length, inactiveVehicles: inactiveVehicles.length,
      periodRevenue, prevPeriodRevenue, periodExpenses, periodProfit,
      periodDieselCost, periodMaintenanceCost, periodBatha,
      emiDue, emiOverdue, emiDueToday, emiDueSoon, emiPending,
      recentEmiPaid, totalEmiPaidRecently,
      fleetUtilization, outstandingAmount, totalInvoiced, totalPaid, totalPending,
      outstandingInvoices, outstandingInvoiceList, revenueByMonth,
      invoiceBreakdown, quotationBreakdown, docExpiry,
      todayTrips, todayRevenue, activeContracts, rentalActivity,
      totalRentals, completedRentals, activeRentals,
      dieselTotal, dieselPaid, dieselPending,
      recentMaintenance, recentMaintenanceTotal,
      recentPayments,
    };
  }, [data, dateRange, customStart, customEnd]);

  if (loading || !data || !computed) return <LoadingSpinner size="lg" />;

  const revChange = pctChange(computed.periodRevenue, computed.prevPeriodRevenue);
  const rangeOptions: { key: DateRangeKey; label: string }[] = [
    { key: 'today', label: t('today') },
    { key: 'week', label: t('thisWeek') },
    { key: 'month', label: t('thisMonth') },
    { key: 'year', label: t('thisYear') },
    { key: 'custom', label: t('customRange') },
  ];

  return (
    <div className="space-y-4 min-w-0">
      {/* Header + Filter Row */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">{t('dashboardTitle')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('dashboardSubtitle')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center rounded-lg border border-slate-200 bg-white overflow-hidden shadow-sm">
            {rangeOptions.map(opt => (
              <button
                key={opt.key}
                onClick={() => { setDateRange(opt.key); setShowCustom(opt.key === 'custom'); }}
                className={classNames(
                  'px-2.5 py-1.5 text-xs font-semibold transition-all whitespace-nowrap',
                  dateRange === opt.key ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {showCustom && (
            <div className="flex items-center gap-1">
              <DatePicker value={customStart} onChange={v => setCustomStart(v)} className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
              <span className="text-slate-400 text-xs">—</span>
              <DatePicker value={customEnd} onChange={v => setCustomEnd(v)} className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
            </div>
          )}
          <button onClick={handleRefresh} className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-colors" title={t('refresh')}>
            <RefreshCw className={classNames('w-4 h-4', refreshing && 'animate-spin')} />
          </button>
          <button onClick={handleExport} className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-colors" title={t('export')}>
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* IMPORTANT ALERTS */}
      {visibleCounts.total > 0 && (
        <div className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 bg-gradient-to-r from-amber-50 via-orange-50 to-yellow-50 border-b border-amber-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <h3 className="text-sm font-bold text-slate-800">{t('importantAlerts')}</h3>
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              {visibleCounts.expired > 0 && <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-bold">{visibleCounts.expired} {t('expired')}</span>}
              {visibleCounts.dueToday > 0 && <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 text-xs font-bold">{visibleCounts.dueToday} {t('dueToday')}</span>}
              {visibleCounts.dueSoon > 0 && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">{visibleCounts.dueSoon} {t('expiringSoon')}</span>}
              <button type="button" onClick={handleDismissAllAlerts} className="flex-shrink-0 p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors" title="Dismiss all alerts" aria-label="Dismiss all alerts">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="divide-y divide-slate-50 max-h-44 overflow-y-auto">
            {visibleNotifications.slice(0, 10).map(n => {
              const isExpired = n.severity === 'expired' || n.severity === 'overdue';
              const isToday = n.severity === 'due-today';
              const icon = n.category === 'eye_test' ? Eye : n.category === 'emi' ? CreditCard : n.category === 'fitness' ? Truck : AlertCircle;
              const Icon = icon;
              return (
                <button key={n.id} type="button" onClick={() => onNavigate(n.navigateTo)} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-slate-50 transition-colors text-left">
                  <div className={classNames('flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center', isExpired ? 'bg-red-50' : isToday ? 'bg-orange-50' : 'bg-amber-50')}>
                    <Icon className={classNames('w-3.5 h-3.5', isExpired ? 'text-red-600' : isToday ? 'text-orange-600' : 'text-amber-600')} />
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

      {/* SECTION 1: BUSINESS FINANCIAL SUMMARY */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <CompactKpi label="Total Billing" value={formatCurrency(computed.totalInvoiced)} icon={FileText} iconColor="text-blue-600" bgColor="bg-blue-50" subtitle="All invoices" onClick={() => onNavigate('/invoices')} />
        <CompactKpi label="Total Received" value={formatCurrency(computed.totalPaid)} icon={IndianRupee} iconColor="text-emerald-600" bgColor="bg-emerald-50" subtitle="Collected" subtitleColor="text-emerald-500" onClick={() => onNavigate('/settlement')} />
        <CompactKpi label="Total Pending" value={formatCurrency(computed.totalPending)} icon={AlertCircle} iconColor="text-red-600" bgColor="bg-red-50" subtitle={`${computed.outstandingInvoices.length} invoices`} subtitleColor="text-red-500" onClick={() => onNavigate('/settlement')} />
        <CompactKpi label="Current Month Revenue" value={formatCurrency(computed.periodRevenue)} icon={TrendingUp} iconColor="text-blue-600" bgColor="bg-blue-50" subtitle={`${formatPct(revChange)} vs last period`} onClick={() => onNavigate('/reports/profit-loss')} />
      </div>

      {/* SECTION 2: PAYMENTS & EXPENSES */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Diesel Payments Pending */}
        <button onClick={() => onNavigate('/diesel')} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-left hover:shadow-lg hover:-translate-y-0.5 transition-all min-w-0 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-red-400 to-orange-400" />
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-50 to-orange-50 flex items-center justify-center flex-shrink-0">
              <Fuel className="w-4 h-4 text-red-600" />
            </div>
            <h3 className="text-sm font-bold text-slate-800">Diesel Payments</h3>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500 font-medium">Total Purchase</span>
              <span className="text-sm font-bold text-slate-700 tabular-nums">{formatCurrency(computed.dieselTotal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500 font-medium">Paid</span>
              <span className="text-sm font-bold text-emerald-700 tabular-nums">{formatCurrency(computed.dieselPaid)}</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded-lg bg-red-50">
              <span className="text-xs font-bold text-red-600 uppercase">Pending</span>
              <span className="text-lg font-bold text-red-700 tabular-nums">{formatCurrency(computed.dieselPending)}</span>
            </div>
          </div>
        </button>

        {/* Recent Maintenance */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden min-w-0">
          <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-amber-50/60 to-transparent">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-50 to-yellow-50 flex items-center justify-center flex-shrink-0">
                <Wrench className="w-4 h-4 text-amber-600" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">Recent Maintenance</h3>
            </div>
            <button onClick={() => onNavigate('/maintenance')} className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 flex-shrink-0">
              View All <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          {computed.recentMaintenance.length === 0 ? (
            <p className="text-xs text-slate-400 italic px-4 py-4 text-center">No maintenance records</p>
          ) : (
            <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto">
              {computed.recentMaintenance.map(m => (
                <div key={m.id} className="flex items-center gap-2 px-3 py-2 min-w-0">
                  <span className="text-sm font-medium text-slate-700 truncate flex-1 min-w-0">{m.vehicle?.registration_number ?? '-'} — {m.maintenance_type}</span>
                  <span className="text-xs text-slate-500 whitespace-nowrap flex-shrink-0">{formatDate(m.maintenance_date)}</span>
                  <span className="text-sm font-bold text-slate-800 tabular-nums whitespace-nowrap flex-shrink-0">{formatCurrency(Number(m.amount))}</span>
                </div>
              ))}
              <div className="flex items-center justify-between px-3 py-2 bg-slate-50">
                <span className="text-xs font-bold text-slate-600 uppercase">Total</span>
                <span className="text-sm font-bold text-amber-700 tabular-nums">{formatCurrency(computed.recentMaintenanceTotal)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Recent EMI Payments */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden min-w-0">
          <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-blue-50/60 to-transparent">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-50 to-cyan-50 flex items-center justify-center flex-shrink-0">
                <CreditCard className="w-4 h-4 text-blue-600" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">Recent EMI Payments</h3>
            </div>
            <button onClick={() => onNavigate('/emi')} className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 flex-shrink-0">
              View All <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          {computed.recentEmiPaid.length === 0 ? (
            <p className="text-xs text-slate-400 italic px-4 py-4 text-center">No EMI payments recorded</p>
          ) : (
            <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto">
              {computed.recentEmiPaid.map(e => (
                <div key={e.id} className="flex items-center gap-2 px-3 py-2 min-w-0">
                  <span className="text-sm font-medium text-slate-700 truncate flex-1 min-w-0">{e.vehicle?.registration_number ?? '-'}</span>
                  <span className="text-xs text-slate-500 whitespace-nowrap flex-shrink-0">{formatDate(e.paid_date ?? e.due_date)}</span>
                  <span className="text-sm font-bold text-emerald-700 tabular-nums whitespace-nowrap flex-shrink-0">{formatCurrency(Number(e.emi_amount))}</span>
                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded flex-shrink-0">PAID</span>
                </div>
              ))}
              <div className="flex items-center justify-between px-3 py-2 bg-slate-50">
                <span className="text-xs font-bold text-slate-600 uppercase">Total Paid</span>
                <span className="text-sm font-bold text-emerald-700 tabular-nums">{formatCurrency(computed.totalEmiPaidRecently)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* SECTION 3: OPERATIONS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Vehicle Status */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-50 to-cyan-50 flex items-center justify-center flex-shrink-0">
                <Truck className="w-4 h-4 text-blue-600" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">Vehicle Status</h3>
            </div>
            <button onClick={() => onNavigate('/vehicles')} className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 flex-shrink-0">
              View All <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="grid grid-cols-5 gap-2 mb-4">
            <div className="text-center p-2 rounded-lg bg-slate-50">
              <p className="text-lg font-bold text-slate-800 tabular-nums">{computed.totalVehicles}</p>
              <p className="text-[9px] font-semibold text-slate-500 uppercase">Total</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-emerald-50">
              <p className="text-lg font-bold text-emerald-700 tabular-nums">{computed.availableVehicles}</p>
              <p className="text-[9px] font-semibold text-emerald-600 uppercase">Avail.</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-blue-50">
              <p className="text-lg font-bold text-blue-700 tabular-nums">{computed.workingVehicles}</p>
              <p className="text-[9px] font-semibold text-blue-600 uppercase">Rented</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-amber-50">
              <p className="text-lg font-bold text-amber-700 tabular-nums">{computed.maintenanceVehicles}</p>
              <p className="text-[9px] font-semibold text-amber-600 uppercase">Maint.</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-slate-100">
              <p className="text-lg font-bold text-slate-600 tabular-nums">{computed.inactiveVehicles}</p>
              <p className="text-[9px] font-semibold text-slate-500 uppercase">Inactive</p>
            </div>
          </div>
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-slate-600">Fleet Utilization</span>
              <span className="text-xs font-bold text-slate-800">{computed.fleetUtilization}%</span>
            </div>
            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={classNames(
                  'h-full rounded-full transition-all',
                  computed.fleetUtilization >= 70 ? 'bg-emerald-500' : computed.fleetUtilization >= 40 ? 'bg-amber-500' : 'bg-red-400',
                )}
                style={{ width: `${Math.min(computed.fleetUtilization, 100)}%` }}
              />
            </div>
          </div>
          {computed.activeContracts.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Active Monthly Contracts</p>
              {computed.activeContracts.slice(0, 3).map(c => {
                const vehicle = data.vehicles.find(v => v.id === c.vehicle_id);
                return (
                  <button key={c.id} onClick={() => onNavigate('/contracts')} className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 transition-colors text-left min-w-0">
                    <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                    <span className="text-sm font-medium text-slate-700 truncate flex-1 min-w-0">{c.company_name}</span>
                    <span className="text-xs text-slate-500 whitespace-nowrap flex-shrink-0">{vehicle?.registration_number ?? '-'}</span>
                    <span className="text-xs font-semibold text-slate-700 whitespace-nowrap flex-shrink-0">{formatCurrency(c.final_payable_amount ?? c.total_monthly_amount)}</span>
                  </button>
                );
              })}
            </div>
          )}
          {computed.activeContracts.length === 0 && (
            <p className="text-xs text-slate-400 italic">No active monthly contracts</p>
          )}
        </div>

        {/* Rental Performance + Revenue Chart */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-50 to-teal-50 flex items-center justify-center flex-shrink-0">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">Rental Performance</h3>
            </div>
            <button onClick={() => onNavigate('/trips')} className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 flex-shrink-0">
              View All <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="p-2.5 rounded-lg bg-blue-50 text-center">
              <p className="text-[10px] font-semibold text-blue-600 uppercase">Total</p>
              <p className="text-lg font-bold text-blue-800 tabular-nums">{computed.totalRentals}</p>
            </div>
            <div className="p-2.5 rounded-lg bg-amber-50 text-center">
              <p className="text-[10px] font-semibold text-amber-600 uppercase">Active</p>
              <p className="text-lg font-bold text-amber-800 tabular-nums">{computed.activeRentals}</p>
            </div>
            <div className="p-2.5 rounded-lg bg-emerald-50 text-center">
              <p className="text-[10px] font-semibold text-emerald-600 uppercase">Completed</p>
              <p className="text-lg font-bold text-emerald-800 tabular-nums">{computed.completedRentals}</p>
            </div>
          </div>
          <div className="overflow-hidden min-w-0">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Rental Over Time</p>
            <RevenueBarChart data={computed.revenueByMonth} />
          </div>
        </div>
      </div>

      {/* Rental & Job Activity Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden min-w-0">
        <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-blue-50/60 to-transparent">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center justify-center flex-shrink-0">
              <Calendar className="w-4 h-4 text-blue-600" />
            </div>
            <h3 className="text-sm font-bold text-slate-800">Current Bookings & Active Rentals</h3>
          </div>
          <button onClick={() => onNavigate('/trips')} className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 flex-shrink-0">
            View All <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        {computed.rentalActivity.length === 0 ? (
          <p className="text-sm text-slate-400 italic px-4 py-6 text-center">No active or upcoming rentals</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-3 py-2 text-[10px] font-bold text-slate-600 uppercase tracking-wider text-left whitespace-nowrap">Customer</th>
                  <th className="px-3 py-2 text-[10px] font-bold text-slate-600 uppercase tracking-wider text-left whitespace-nowrap">Equipment</th>
                  <th className="px-3 py-2 text-[10px] font-bold text-slate-600 uppercase tracking-wider text-left whitespace-nowrap">Location</th>
                  <th className="px-3 py-2 text-[10px] font-bold text-slate-600 uppercase tracking-wider text-left whitespace-nowrap">Start</th>
                  <th className="px-3 py-2 text-[10px] font-bold text-slate-600 uppercase tracking-wider text-left whitespace-nowrap">End</th>
                  <th className="px-3 py-2 text-[10px] font-bold text-slate-600 uppercase tracking-wider text-center whitespace-nowrap">Status</th>
                  <th className="px-3 py-2 text-[10px] font-bold text-slate-600 uppercase tracking-wider text-right whitespace-nowrap">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {computed.rentalActivity.map(r => (
                  <tr key={r.id} onClick={() => onNavigate(r.status === 'Active' && r.end !== r.start ? '/contracts' : '/trips')} className="hover:bg-slate-50 cursor-pointer">
                    <td className="px-3 py-2 text-sm font-medium text-slate-800 whitespace-nowrap">{r.customer}</td>
                    <td className="px-3 py-2 text-sm text-slate-600 whitespace-nowrap">{r.equipment}</td>
                    <td className="px-3 py-2 text-sm text-slate-600 whitespace-nowrap max-w-[120px] truncate">{r.location}</td>
                    <td className="px-3 py-2 text-sm text-slate-600 whitespace-nowrap">{formatDate(r.start)}</td>
                    <td className="px-3 py-2 text-sm text-slate-600 whitespace-nowrap">{r.end === '-' ? '-' : formatDate(r.end)}</td>
                    <td className="px-3 py-2 text-center whitespace-nowrap">
                      <span className={classNames(
                        'inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold',
                        r.status === 'Active' ? 'bg-blue-100 text-blue-700' :
                        r.status === 'Ending Soon' ? 'bg-amber-100 text-amber-700' :
                        r.status === 'Completed' ? 'bg-emerald-100 text-emerald-700' :
                        'bg-slate-100 text-slate-600',
                      )}>{r.status}</span>
                    </td>
                    <td className="px-3 py-2 text-sm font-semibold text-slate-800 text-right tabular-nums whitespace-nowrap">{formatCurrency(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SECTION 4: INVOICES & COLLECTIONS */}
      {/* Total Invoice Pending card */}
      <button onClick={() => onNavigate('/settlement')} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-left hover:shadow-lg hover:-translate-y-0.5 transition-all w-full min-w-0 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-red-400 to-rose-400" />
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-50 to-rose-50 flex items-center justify-center flex-shrink-0">
            <AlertCircle className="w-4 h-4 text-red-600" />
          </div>
          <h3 className="text-sm font-bold text-slate-800">Total Invoice Pending</h3>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="p-2.5 rounded-lg bg-blue-50">
            <p className="text-[10px] font-semibold text-blue-600 uppercase">Total Invoiced</p>
            <p className="text-sm font-bold text-blue-800 tabular-nums truncate">{formatCurrency(computed.totalInvoiced)}</p>
          </div>
          <div className="p-2.5 rounded-lg bg-emerald-50">
            <p className="text-[10px] font-semibold text-emerald-600 uppercase">Received</p>
            <p className="text-sm font-bold text-emerald-800 tabular-nums truncate">{formatCurrency(computed.totalPaid)}</p>
          </div>
          <div className="p-2.5 rounded-lg bg-red-50">
            <p className="text-[10px] font-bold text-red-600 uppercase">Pending</p>
            <p className="text-lg font-bold text-red-700 tabular-nums truncate">{formatCurrency(computed.totalPending)}</p>
          </div>
        </div>
      </button>

      {/* Outstanding Invoices + Recent Payments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Outstanding Invoices */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden min-w-0">
          <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-red-50/60 to-transparent">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-50 to-rose-50 flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-4 h-4 text-red-600" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">Outstanding Invoices</h3>
            </div>
            <button onClick={() => onNavigate('/settlement')} className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 flex-shrink-0">
              View All <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          {computed.outstandingInvoiceList.length === 0 ? (
            <p className="text-xs text-slate-400 italic px-4 py-4 text-center">No outstanding invoices</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-3 py-2 text-[10px] font-bold text-slate-600 uppercase tracking-wider text-left whitespace-nowrap">Customer</th>
                    <th className="px-3 py-2 text-[10px] font-bold text-slate-600 uppercase tracking-wider text-left whitespace-nowrap">Invoice No.</th>
                    <th className="px-3 py-2 text-[10px] font-bold text-slate-600 uppercase tracking-wider text-right whitespace-nowrap">Amount</th>
                    <th className="px-3 py-2 text-[10px] font-bold text-slate-600 uppercase tracking-wider text-right whitespace-nowrap">Paid</th>
                    <th className="px-3 py-2 text-[10px] font-bold text-slate-600 uppercase tracking-wider text-right whitespace-nowrap">Pending</th>
                    <th className="px-3 py-2 text-[10px] font-bold text-slate-600 uppercase tracking-wider text-left whitespace-nowrap">Due Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {computed.outstandingInvoiceList.map(inv => {
                    const payableAmount = inv.discount_enabled ? Number(inv.final_payable_amount ?? inv.grand_total) : Number(inv.grand_total);
                    const paid = Number(inv.amount_received);
                    const pending = Number(inv.balance_amount);
                    const isOverdue = new Date(inv.invoice_date) < new Date(Date.now() - 30 * 86400000);
                    return (
                      <tr key={inv.id} onClick={() => onNavigate('/settlement')} className="hover:bg-slate-50 cursor-pointer">
                        <td className="px-3 py-2 text-sm font-medium text-slate-800 whitespace-nowrap max-w-[100px] truncate">{inv.customer?.name ?? inv.customer_name ?? '-'}</td>
                        <td className="px-3 py-2 text-sm text-slate-600 whitespace-nowrap">{inv.invoice_number}</td>
                        <td className="px-3 py-2 text-sm text-slate-600 text-right tabular-nums whitespace-nowrap">{formatCurrency(payableAmount)}</td>
                        <td className="px-3 py-2 text-sm text-emerald-700 text-right tabular-nums whitespace-nowrap">{formatCurrency(paid)}</td>
                        <td className={classNames('px-3 py-2 text-sm font-bold text-right tabular-nums whitespace-nowrap', isOverdue ? 'text-red-600' : 'text-amber-600')}>{formatCurrency(pending)}</td>
                        <td className="px-3 py-2 text-sm text-slate-600 whitespace-nowrap">{formatDate(inv.invoice_date)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent Payments */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden min-w-0">
          <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-emerald-50/60 to-transparent">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-50 to-teal-50 flex items-center justify-center flex-shrink-0">
                <IndianRupee className="w-4 h-4 text-emerald-600" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">Recent Payments</h3>
            </div>
            <button onClick={() => onNavigate('/settlement')} className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 flex-shrink-0">
              View All <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          {computed.recentPayments.length === 0 ? (
            <p className="text-xs text-slate-400 italic px-4 py-4 text-center">No recent payments recorded</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-3 py-2 text-[10px] font-bold text-slate-600 uppercase tracking-wider text-left whitespace-nowrap">Customer</th>
                    <th className="px-3 py-2 text-[10px] font-bold text-slate-600 uppercase tracking-wider text-left whitespace-nowrap">Invoice No.</th>
                    <th className="px-3 py-2 text-[10px] font-bold text-slate-600 uppercase tracking-wider text-left whitespace-nowrap">Date</th>
                    <th className="px-3 py-2 text-[10px] font-bold text-slate-600 uppercase tracking-wider text-left whitespace-nowrap">Mode</th>
                    <th className="px-3 py-2 text-[10px] font-bold text-slate-600 uppercase tracking-wider text-right whitespace-nowrap">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {computed.recentPayments.map(p => (
                    <tr key={p.id} onClick={() => onNavigate('/settlement')} className="hover:bg-slate-50 cursor-pointer">
                      <td className="px-3 py-2 text-sm font-medium text-slate-800 whitespace-nowrap max-w-[100px] truncate">{p.invoice?.customer_name ?? '-'}</td>
                      <td className="px-3 py-2 text-sm text-slate-600 whitespace-nowrap">{p.invoice?.invoice_number ?? '-'}</td>
                      <td className="px-3 py-2 text-sm text-slate-600 whitespace-nowrap">{formatDate(p.payment_date)}</td>
                      <td className="px-3 py-2 text-sm text-slate-600 whitespace-nowrap">{p.payment_mode ?? '-'}</td>
                      <td className="px-3 py-2 text-sm font-bold text-emerald-700 text-right tabular-nums whitespace-nowrap">{formatCurrency(Number(p.amount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Compliance & Quotations summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Maintenance & Compliance */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center flex-shrink-0">
                <ShieldCheck className="w-4 h-4 text-amber-600" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">Maintenance & Compliance</h3>
            </div>
            <button onClick={() => onNavigate('/maintenance')} className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 flex-shrink-0">
              Details <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-1.5">
            <button onClick={() => onNavigate('/maintenance')} className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 transition-colors text-left">
              <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                <Wrench className="w-3.5 h-3.5 text-amber-600" />
              </div>
              <span className="text-sm text-slate-700 flex-1">Maintenance Due</span>
              <span className="text-sm font-bold text-slate-800 tabular-nums">{computed.maintenanceVehicles}</span>
            </button>
            <button onClick={() => onNavigate('/vehicles')} className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 transition-colors text-left">
              <div className={classNames('w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0', computed.docExpiry.fitnessExpired > 0 ? 'bg-red-50' : 'bg-amber-50')}>
                <ShieldCheck className={classNames('w-3.5 h-3.5', computed.docExpiry.fitnessExpired > 0 ? 'text-red-600' : 'text-amber-600')} />
              </div>
              <span className="text-sm text-slate-700 flex-1">Fitness Expiring / Expired</span>
              <span className={classNames('text-sm font-bold tabular-nums', computed.docExpiry.fitnessExpired > 0 ? 'text-red-600' : 'text-slate-800')}>{computed.docExpiry.fitnessExpiring + computed.docExpiry.fitnessExpired}</span>
            </button>
            <button onClick={() => onNavigate('/employees')} className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 transition-colors text-left">
              <div className={classNames('w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0', computed.docExpiry.licenseExpired > 0 ? 'bg-red-50' : 'bg-amber-50')}>
                <ClipboardCheck className={classNames('w-3.5 h-3.5', computed.docExpiry.licenseExpired > 0 ? 'text-red-600' : 'text-amber-600')} />
              </div>
              <span className="text-sm text-slate-700 flex-1">License Expiring / Expired</span>
              <span className={classNames('text-sm font-bold tabular-nums', computed.docExpiry.licenseExpired > 0 ? 'text-red-600' : 'text-slate-800')}>{computed.docExpiry.licenseExpiring + computed.docExpiry.licenseExpired}</span>
            </button>
            <button onClick={() => onNavigate('/emi')} className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 transition-colors text-left">
              <div className={classNames('w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0', computed.emiOverdue > 0 ? 'bg-red-50' : computed.emiDueSoon > 0 ? 'bg-amber-50' : 'bg-slate-50')}>
                <CreditCard className={classNames('w-3.5 h-3.5', computed.emiOverdue > 0 ? 'text-red-600' : computed.emiDueSoon > 0 ? 'text-amber-600' : 'text-slate-400')} />
              </div>
              <span className="text-sm text-slate-700 flex-1">EMI Due / Overdue</span>
              <span className={classNames('text-sm font-bold tabular-nums', computed.emiOverdue > 0 ? 'text-red-600' : 'text-slate-800')}>{computed.emiDueSoon + computed.emiDueToday + computed.emiOverdue}</span>
            </button>
          </div>
        </div>

        {/* Quotations & Invoices Summary */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center justify-center flex-shrink-0">
                <FileText className="w-4 h-4 text-blue-600" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">Quotations & Invoices</h3>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={() => onNavigate('/quotations')} className="text-xs font-semibold text-blue-600 hover:text-blue-700">Quotations</button>
              <span className="text-slate-300">|</span>
              <button onClick={() => onNavigate('/invoices')} className="text-xs font-semibold text-blue-600 hover:text-blue-700">Invoices</button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="border border-blue-100 rounded-lg p-3 min-w-0 bg-gradient-to-br from-blue-50/30 to-transparent">
              <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wider mb-2">Quotations</p>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between"><span className="text-xs text-slate-600">Draft</span><span className="text-sm font-bold text-slate-700 tabular-nums">{computed.quotationBreakdown.draft}</span></div>
                <div className="flex items-center justify-between"><span className="text-xs text-slate-600">Sent</span><span className="text-sm font-bold text-blue-700 tabular-nums">{computed.quotationBreakdown.sent}</span></div>
                <div className="flex items-center justify-between"><span className="text-xs text-slate-600">Accepted</span><span className="text-sm font-bold text-emerald-700 tabular-nums">{computed.quotationBreakdown.accepted}</span></div>
                <div className="flex items-center justify-between"><span className="text-xs text-slate-600">Rejected</span><span className="text-sm font-bold text-red-700 tabular-nums">{computed.quotationBreakdown.rejected}</span></div>
                {computed.quotationBreakdown.expiringSoon > 0 && (
                  <div className="flex items-center justify-between"><span className="text-xs text-amber-600 font-medium">Expiring</span><span className="text-sm font-bold text-amber-700 tabular-nums">{computed.quotationBreakdown.expiringSoon}</span></div>
                )}
              </div>
            </div>
            <div className="border border-emerald-100 rounded-lg p-3 min-w-0 bg-gradient-to-br from-emerald-50/30 to-transparent">
              <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider mb-2">Invoices</p>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between"><span className="text-xs text-slate-600">Draft</span><span className="text-sm font-bold text-slate-700 tabular-nums">{computed.invoiceBreakdown.draft}</span></div>
                <div className="flex items-center justify-between"><span className="text-xs text-slate-600">Sent</span><span className="text-sm font-bold text-blue-700 tabular-nums">{computed.invoiceBreakdown.sent}</span></div>
                <div className="flex items-center justify-between"><span className="text-xs text-slate-600">Part Paid</span><span className="text-sm font-bold text-amber-700 tabular-nums">{computed.invoiceBreakdown.partiallyPaid}</span></div>
                <div className="flex items-center justify-between"><span className="text-xs text-slate-600">Paid</span><span className="text-sm font-bold text-emerald-700 tabular-nums">{computed.invoiceBreakdown.paid}</span></div>
                {computed.invoiceBreakdown.overdue > 0 && (
                  <div className="flex items-center justify-between"><span className="text-xs text-red-600 font-medium">Overdue</span><span className="text-sm font-bold text-red-700 tabular-nums">{computed.invoiceBreakdown.overdue}</span></div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Today's Activity + Upcoming */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 min-w-0">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-50 to-cyan-50 flex items-center justify-center flex-shrink-0">
              <Activity className="w-4 h-4 text-blue-600" />
            </div>
            <h3 className="text-sm font-bold text-slate-800">Today's Activity</h3>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="p-2.5 rounded-lg bg-blue-50 text-center">
              <p className="text-[10px] font-semibold text-blue-600 uppercase">Today's Jobs</p>
              <p className="text-lg font-bold text-blue-800 tabular-nums">{computed.todayTrips.length}</p>
            </div>
            <div className="p-2.5 rounded-lg bg-emerald-50 text-center">
              <p className="text-[10px] font-semibold text-emerald-600 uppercase">Revenue</p>
              <p className="text-lg font-bold text-emerald-800 tabular-nums">{formatCurrency(computed.todayRevenue)}</p>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 text-center">
              <p className="text-[10px] font-semibold text-slate-500 uppercase">Active Rentals</p>
              <p className="text-lg font-bold text-slate-800 tabular-nums">{computed.activeContracts.length}</p>
            </div>
          </div>
          {computed.todayTrips.length > 0 ? (
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {computed.todayTrips.slice(0, 5).map(tr => (
                <button key={tr.id} onClick={() => onNavigate('/trips')} className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 transition-colors text-left min-w-0">
                  <div className={classNames('w-2 h-2 rounded-full flex-shrink-0', tr.bill_status === 'Paid' ? 'bg-emerald-500' : 'bg-amber-400')} />
                  <span className="text-sm font-medium text-slate-700 truncate flex-1 min-w-0">{tr.customer?.name ?? tr.place_of_work}</span>
                  <span className="text-xs text-slate-500 whitespace-nowrap flex-shrink-0">{tr.vehicle?.registration_number ?? '-'}</span>
                  <span className="text-xs font-semibold text-slate-700 whitespace-nowrap flex-shrink-0">{formatCurrency(Number(tr.total_amount))}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic">No jobs scheduled for today</p>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 min-w-0">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center justify-center flex-shrink-0">
              <CalendarClock className="w-4 h-4 text-blue-600" />
            </div>
            <h3 className="text-sm font-bold text-slate-800">Upcoming — Next 7 Days</h3>
          </div>
          {(() => {
            const upcomingEvents: { label: string; date: string; type: string; navigateTo: string }[] = [];
            data.contracts.forEach(c => {
              if (c.end_date) { const d = daysUntil(c.end_date); if (d >= 0 && d <= 7) upcomingEvents.push({ label: `Rental ending — ${c.company_name}`, date: c.end_date, type: 'rental', navigateTo: '/contracts' }); }
            });
            data.emiRecords.forEach(e => {
              if (e.status !== 'Paid') { const d = daysUntil(e.due_date); if (d >= 0 && d <= 7) upcomingEvents.push({ label: `EMI due — ${e.vehicle?.registration_number ?? 'N/A'}`, date: e.due_date, type: 'emi', navigateTo: '/emi' }); }
            });
            data.vehicles.forEach(v => {
              if (v.fitness_expiry_date) { const d = daysUntil(v.fitness_expiry_date); if (d >= 0 && d <= 7) upcomingEvents.push({ label: `Fitness expiry — ${v.registration_number}`, date: v.fitness_expiry_date, type: 'doc', navigateTo: '/vehicles' }); }
            });
            data.quotations.forEach(q => {
              if (q.valid_until && q.status === 'Sent') { const d = daysUntil(q.valid_until); if (d >= 0 && d <= 7) upcomingEvents.push({ label: `Quotation expiry — ${q.quotation_number}`, date: q.valid_until, type: 'quotation', navigateTo: '/quotations' }); }
            });
            upcomingEvents.sort((a, b) => a.date.localeCompare(b.date));
            if (upcomingEvents.length === 0) return <p className="text-xs text-slate-400 italic">No upcoming events in the next 7 days</p>;
            const iconMap: Record<string, React.ElementType> = { rental: Calendar, emi: CreditCard, doc: ShieldCheck, quotation: FileText };
            return (
              <div className="space-y-1.5 max-h-52 overflow-y-auto">
                {upcomingEvents.slice(0, 8).map((ev, i) => {
                  const EvIcon = iconMap[ev.type] ?? AlertCircle;
                  return (
                    <button key={i} onClick={() => onNavigate(ev.navigateTo)} className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 transition-colors text-left min-w-0">
                      <EvIcon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <span className="text-sm text-slate-700 truncate flex-1 min-w-0">{ev.label}</span>
                      <span className="text-xs font-medium text-slate-500 whitespace-nowrap flex-shrink-0">{formatDate(ev.date)}</span>
                      <span className="text-xs font-semibold text-blue-600 whitespace-nowrap flex-shrink-0">{daysUntil(ev.date)}d</span>
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
