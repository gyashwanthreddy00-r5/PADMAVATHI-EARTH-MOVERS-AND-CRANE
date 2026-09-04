import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useLang } from '@/context/LangContext';
import { useSettings } from '@/context/SettingsContext';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Button, Field, inputClass, LoadingSpinner, StatusBadge } from '@/components/ui/common';
import { Download, Printer } from 'lucide-react';
import { formatCurrency, formatDate, formatTime, exportToExcelWithCompany, todayISO, monthName } from '@/lib/utils';
import { getReportLogoUrl } from '@/lib/reportLogo';
import { DatePicker } from '@/components/ui/DatePicker';
import type { TripWithRelations, DieselWithRelations, MaintenanceWithRelations, EmiWithRelations, AttendanceWithEmployee, Employee, Vehicle, InvoiceWithRelations } from '@/types';

type ReportType = 'trips' | 'diesel' | 'attendance' | 'maintenance' | 'emi' | 'salary' | 'daily-vehicle' | 'monthly' | 'profit-loss' | 'cash-bills' | 'customer-billing';

interface ReportProps {
  type: ReportType;
}

function monthStartISO(year: number, month: number): string {
  return new Date(year, month - 1, 1).toISOString().split('T')[0];
}

function monthEndISO(year: number, month: number): string {
  return new Date(year, month, 0).toISOString().split('T')[0];
}

export default function Reports({ type }: ReportProps) {
  const { t } = useLang();
  const { settings } = useSettings();
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [data, setData] = useState<unknown[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];

  const [filters, setFilters] = useState({
    from: defaultFrom,
    to: todayISO(),
    vehicle_id: '',
    driver_id: '',
    place_of_work: '',
    payment_status: '',
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  });

  const fetchVehiclesAndEmployees = async () => {
    const [vRes, eRes] = await Promise.all([
      supabase.from('vehicles').select('*').order('registration_number'),
      supabase.from('employees').select('*').order('name'),
    ]);
    if (vRes.error) console.error('Vehicles fetch error:', vRes.error);
    if (eRes.error) console.error('Employees fetch error:', eRes.error);
    setVehicles((vRes.data ?? []) as Vehicle[]);
    setEmployees((eRes.data ?? []) as Employee[]);
  };

  useEffect(() => { fetchVehiclesAndEmployees(); }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      switch (type) {
        case 'trips': await fetchTripsReport(); break;
        case 'diesel': await fetchDieselReport(); break;
        case 'attendance': await fetchAttendanceReport(); break;
        case 'maintenance': await fetchMaintenanceReport(); break;
        case 'emi': await fetchEmiReport(); break;
        case 'salary': await fetchSalaryReport(); break;
        case 'daily-vehicle': await fetchDailyVehicleReport(); break;
        case 'monthly': await fetchMonthlyReport(); break;
        case 'profit-loss': await fetchProfitLossReport(); break;
        case 'cash-bills': await fetchInvoiceReport('Cash'); break;
        case 'customer-billing': await fetchCustomerBillingReport(); break;
      }
    } catch (e) {
      console.error(`Report fetch error (${type}):`, e);
      setErrorMsg('Unable to load report data. Please check your connection and try again.');
      setData([]);
    }
    setLoading(false);
  }, [type, filters]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fetchTripsReport = async () => {
    let q = supabase.from('trips').select('*, vehicle:vehicles(id,registration_number,model,type,capacity), driver:employees(id,name,role), customer:customers(id,name), sessions:trip_sessions(*)').eq('is_cancelled', false);
    if (filters.from) q = q.gte('trip_date', filters.from);
    if (filters.to) q = q.lte('trip_date', filters.to);
    if (filters.vehicle_id) q = q.eq('vehicle_id', filters.vehicle_id);
    if (filters.driver_id) q = q.eq('driver_id', filters.driver_id);
    if (filters.payment_status) q = q.eq('bill_status', filters.payment_status);
    const { data: result, error } = await q.order('trip_date', { ascending: false });
    if (error) { console.error('Trips report query error:', error); setErrorMsg('Unable to load Trip report data.'); setData([]); return; }
    let filtered = (result ?? []) as TripWithRelations[];
    if (filters.place_of_work) filtered = filtered.filter(tr => tr.place_of_work?.toLowerCase().includes(filters.place_of_work.toLowerCase()));
    setData(filtered);
  };

  const fetchDieselReport = async () => {
    let q = supabase.from('diesel_entries').select('*, vehicle:vehicles(id,registration_number,type)').eq('is_cancelled', false);
    if (filters.from) q = q.gte('diesel_date', filters.from);
    if (filters.to) q = q.lte('diesel_date', filters.to);
    if (filters.vehicle_id) q = q.eq('vehicle_id', filters.vehicle_id);
    const { data: result, error } = await q.order('diesel_date', { ascending: false });
    if (error) { console.error('Diesel report query error:', error); setErrorMsg('Unable to load Diesel report data.'); setData([]); return; }
    setData((result ?? []) as DieselWithRelations[]);
  };

  const fetchAttendanceReport = async () => {
    let q = supabase.from('attendance').select('*, employee:employees(id,name,role,salary,advance_salary)').eq('is_cancelled', false);
    if (filters.from) q = q.gte('attendance_date', filters.from);
    if (filters.to) q = q.lte('attendance_date', filters.to);
    const { data: result, error } = await q.order('attendance_date', { ascending: false });
    if (error) { console.error('Attendance report query error:', error); setErrorMsg('Unable to load Attendance report data.'); setData([]); return; }
    setData((result ?? []) as AttendanceWithEmployee[]);
  };

  const fetchMaintenanceReport = async () => {
    let q = supabase.from('maintenance').select('*, vehicle:vehicles(id,registration_number,type)').eq('is_cancelled', false);
    if (filters.from) q = q.gte('maintenance_date', filters.from);
    if (filters.to) q = q.lte('maintenance_date', filters.to);
    if (filters.vehicle_id) q = q.eq('vehicle_id', filters.vehicle_id);
    const { data: result, error } = await q.order('maintenance_date', { ascending: false });
    if (error) { console.error('Maintenance report query error:', error); setErrorMsg('Unable to load Maintenance report data.'); setData([]); return; }
    setData((result ?? []) as MaintenanceWithRelations[]);
  };

  const fetchEmiReport = async () => {
    let q = supabase.from('emi_records').select('*, vehicle:vehicles(id,registration_number,model)');
    if (filters.from) q = q.gte('due_date', filters.from);
    if (filters.to) q = q.lte('due_date', filters.to);
    const { data: result, error } = await q.order('due_date', { ascending: true });
    if (error) { console.error('EMI report query error:', error); setErrorMsg('Unable to load EMI report data.'); setData([]); return; }
    setData((result ?? []) as EmiWithRelations[]);
  };

  const fetchSalaryReport = async () => {
    const mStart = monthStartISO(filters.year, filters.month);
    const mEnd = monthEndISO(filters.year, filters.month);
    const [eRes, aRes] = await Promise.all([
      supabase.from('employees').select('*').eq('active', true).order('name'),
      supabase.from('attendance').select('*, employee:employees(id,name,role,salary,advance_salary)').eq('is_cancelled', false).gte('attendance_date', mStart).lte('attendance_date', mEnd),
    ]);
    if (eRes.error) { console.error('Salary report employees error:', eRes.error); setErrorMsg('Unable to load employee data.'); setData([]); return; }
    if (aRes.error) { console.error('Salary report attendance error:', aRes.error); setErrorMsg('Unable to load attendance data.'); setData([]); return; }
    const emps = (eRes.data ?? []) as Employee[];
    const att = (aRes.data ?? []) as AttendanceWithEmployee[];
    const salaryData = emps.map(emp => {
      const empAtt = att.filter(a => a.employee_id === emp.id);
      const present = empAtt.filter(a => a.status === 'Present').length;
      const absent = empAtt.filter(a => a.status === 'Absent').length;
      const holiday = empAtt.filter(a => a.status === 'Holiday').length;
      const totalDays = present + absent + holiday;
      const perDay = totalDays > 0 ? Number(emp.salary) / totalDays : 0;
      const payable = Math.round(present * perDay * 100) / 100;
      const advance = Number(emp.advance_salary) || 0;
      const balance = payable - advance;
      return { employee: emp, present, absent, holiday, payable, advance, balance, salary: Number(emp.salary) };
    });
    setData(salaryData);
  };

  const fetchDailyVehicleReport = async () => {
    const date = filters.from;
    const [tRes, dRes, mRes] = await Promise.all([
      supabase.from('trips').select('*, vehicle:vehicles(id,registration_number,type), driver:employees(id,name,role)').eq('trip_date', date).eq('is_cancelled', false),
      supabase.from('diesel_entries').select('*, vehicle:vehicles(id)').eq('diesel_date', date).eq('is_cancelled', false),
      supabase.from('maintenance').select('*, vehicle:vehicles(id)').eq('maintenance_date', date).eq('is_cancelled', false),
    ]);
    if (tRes.error) { console.error('Daily vehicle trips error:', tRes.error); setErrorMsg('Unable to load daily vehicle report.'); setData([]); return; }
    const trips = (tRes.data ?? []) as TripWithRelations[];
    const diesel = (dRes.data ?? []) as DieselWithRelations[];
    const maint = (mRes.data ?? []) as MaintenanceWithRelations[];
    const rows = trips.map(tr => {
      const dAmount = diesel.filter(d => d.vehicle_id === tr.vehicle_id).reduce((s, d) => s + Number(d.total_amount), 0);
      const dLiters = diesel.filter(d => d.vehicle_id === tr.vehicle_id).reduce((s, d) => s + Number(d.quantity_liters), 0);
      const mAmount = maint.filter(m => m.vehicle_id === tr.vehicle_id).reduce((s, m) => s + Number(m.amount), 0);
      const totalCost = dAmount + mAmount + Number(tr.batha);
      const net = Number(tr.total_amount) - totalCost;
      return { trip: tr, dAmount, dLiters, mAmount, net };
    });
    setData(rows);
  };

  const fetchMonthlyReport = async () => {
    const mStart = monthStartISO(filters.year, filters.month);
    const mEnd = monthEndISO(filters.year, filters.month);
    const [tRes, dRes, mRes, eRes, emiRes] = await Promise.all([
      supabase.from('trips').select('*, vehicle:vehicles(id,registration_number,type), driver:employees(id,name,role)').eq('is_cancelled', false).gte('trip_date', mStart).lte('trip_date', mEnd),
      supabase.from('diesel_entries').select('*').eq('is_cancelled', false).gte('diesel_date', mStart).lte('diesel_date', mEnd),
      supabase.from('maintenance').select('*').eq('is_cancelled', false).gte('maintenance_date', mStart).lte('maintenance_date', mEnd),
      supabase.from('employees').select('salary').eq('active', true),
      supabase.from('emi_records').select('*').gte('due_date', mStart).lte('due_date', mEnd),
    ]);
    if (tRes.error) { console.error('Monthly report trips error:', tRes.error); setErrorMsg('Unable to load monthly report.'); setData([]); return; }
    const trips = (tRes.data ?? []) as TripWithRelations[];
    const diesel = (dRes.data ?? []) as DieselWithRelations[];
    const maint = (mRes.data ?? []) as MaintenanceWithRelations[];
    const emps = (eRes.data ?? []) as Employee[];
    const emis = (emiRes.data ?? []) as EmiWithRelations[];

    const totalRevenue = trips.reduce((s, tr) => s + Number(tr.total_amount), 0);
    const tripRevenue = trips.reduce((s, tr) => s + Number(tr.rental_amount), 0);
    const totalHours = trips.reduce((s, tr) => s + Number(tr.total_hours), 0);
    const dieselCost = diesel.reduce((s, d) => s + Number(d.total_amount), 0);
    const dieselLiters = diesel.reduce((s, d) => s + Number(d.quantity_liters), 0);
    const maintCost = maint.reduce((s, m) => s + Number(m.amount), 0);
    const maintCount = maint.length;
    const totalSalary = emps.reduce((s, e) => s + Number(e.salary), 0);
    const emiCost = emis.filter(e => e.status === 'Paid').reduce((s, e) => s + Number(e.emi_amount), 0);
    const cashCollection = trips.filter(tr => tr.payment_mode === 'Cash' && tr.bill_status === 'Paid').reduce((s, tr) => s + Number(tr.total_amount), 0);
    const onlineCollection = trips.filter(tr => (tr.payment_mode === 'UPI' || tr.payment_mode === 'Bank Transfer' || tr.payment_mode === 'Cheque') && tr.bill_status === 'Paid').reduce((s, tr) => s + Number(tr.total_amount), 0);
    const pendingAmount = trips.filter(tr => tr.bill_status === 'Pending').reduce((s, tr) => s + Number(tr.total_amount), 0);
    const grossIncome = totalRevenue;
    const totalExpenses = dieselCost + totalSalary + maintCost + emiCost;
    const netProfit = totalRevenue - totalExpenses;

    setData([{
      totalTrips: trips.length, totalHours, tripRevenue, totalRevenue,
      dieselCost, dieselLiters, maintCost, maintCount, totalSalary, emiCost, totalExpenses,
      cashCollection, onlineCollection, pendingAmount, netProfit, grossIncome,
    }]);
  };

  const fetchProfitLossReport = async () => {
    const [tRes, dRes, mRes, eRes, emiRes] = await Promise.all([
      supabase.from('trips').select('*, vehicle:vehicles(id,registration_number,type)').eq('is_cancelled', false).gte('trip_date', filters.from).lte('trip_date', filters.to),
      supabase.from('diesel_entries').select('*').eq('is_cancelled', false).gte('diesel_date', filters.from).lte('diesel_date', filters.to),
      supabase.from('maintenance').select('*').eq('is_cancelled', false).gte('maintenance_date', filters.from).lte('maintenance_date', filters.to),
      supabase.from('employees').select('salary').eq('active', true),
      supabase.from('emi_records').select('*').gte('due_date', filters.from).lte('due_date', filters.to),
    ]);
    if (tRes.error) { console.error('P&L report trips error:', tRes.error); setErrorMsg('Unable to load profit & loss report.'); setData([]); return; }
    const trips = (tRes.data ?? []) as TripWithRelations[];
    const diesel = (dRes.data ?? []) as DieselWithRelations[];
    const maint = (mRes.data ?? []) as MaintenanceWithRelations[];
    const emps = (eRes.data ?? []) as Employee[];
    const emis = (emiRes.data ?? []) as EmiWithRelations[];

    const revenue = trips.reduce((s, tr) => s + Number(tr.total_amount), 0);
    const dieselCost = diesel.reduce((s, d) => s + Number(d.total_amount), 0);
    const maintCost = maint.reduce((s, m) => s + Number(m.amount), 0);
    const salary = emps.reduce((s, e) => s + Number(e.salary), 0);
    const emiCost = emis.filter(e => e.status === 'Paid').reduce((s, e) => s + Number(e.emi_amount), 0);
    const totalExpenses = dieselCost + salary + maintCost + emiCost;
    const netProfit = revenue - totalExpenses;

    setData([{ revenue, dieselCost, salary, maintCost, emiCost, totalExpenses, netProfit }]);
  };

  const fetchInvoiceReport = async (invType: 'Cash') => {
    let q = supabase.from('invoices').select('*, customer:customers(id,name,address,gstin), trip:trips(id,trip_number,place_of_work), vehicle:vehicles(id,registration_number,type)').eq('invoice_type', invType).eq('is_cancelled', false);
    if (filters.from) q = q.gte('invoice_date', filters.from);
    if (filters.to) q = q.lte('invoice_date', filters.to);
    if (filters.payment_status) q = q.eq('payment_status', filters.payment_status);
    const { data: result, error } = await q.order('invoice_date', { ascending: false });
    if (error) { console.error(`${invType} invoice report error:`, error); setErrorMsg(`Unable to load ${invType} bill report data.`); setData([]); return; }
    setData((result ?? []) as InvoiceWithRelations[]);
  };

  const reportTitles: Record<ReportType, string> = {
    trips: t('tripReport'), diesel: t('dieselReport'), attendance: t('attendanceReport'),
    maintenance: t('maintenanceReport'), emi: t('emiReport'), salary: t('salaryStatement'),
    'daily-vehicle': t('dailyVehicleReport'), monthly: t('monthlyReport'),
    'profit-loss': t('profitLoss'), 'cash-bills': t('cashBillReport'),
    'customer-billing': t('customerBillingReport'),
  };

  const fetchCustomerBillingReport = async () => {
    let q = supabase.from('invoices').select('id, invoice_number, invoice_date, invoice_type, customer_id, customer_name, customer:customers(id,name,phone,gstin), grand_total, discount_enabled, discount_percent, discount_amount, final_payable_amount, amount_received, balance_amount, payment_status, is_cancelled').eq('is_cancelled', false).in('invoice_type', ['GST', 'Cash', 'MONTHLY_CONTRACT']);
    if (filters.from) q = q.gte('invoice_date', filters.from);
    if (filters.to) q = q.lte('invoice_date', filters.to);
    if (filters.payment_status) q = q.eq('payment_status', filters.payment_status);
    const { data: result, error } = await q.order('invoice_date', { ascending: false });
    if (error) { console.error('Customer billing report error:', error); setErrorMsg('Unable to load customer billing report data.'); setData([]); return; }
    const invs = (result ?? []) as InvoiceWithRelations[];
    const byCustomer = new Map<string, { customer_id: string; customer_name: string; company_name: string | null; phone: string | null; gstin: string | null; invoice_count: number; total_billed: number; total_received: number; balance: number; invoices: InvoiceWithRelations[] }>();
    for (const inv of invs) {
      const cid = inv.customer_id ?? inv.customer?.id ?? inv.customer_name ?? 'unknown';
      const cname = inv.customer_name ?? inv.customer?.name ?? 'Walk-in';
      const existing = byCustomer.get(cid) ?? { customer_id: cid, customer_name: cname, company_name: inv.customer?.name ?? null, phone: inv.customer?.phone ?? null, gstin: inv.customer?.gstin ?? null, invoice_count: 0, total_billed: 0, total_received: 0, balance: 0, invoices: [] };
      existing.invoice_count++;
      const payable = inv.discount_enabled ? Number(inv.final_payable_amount ?? inv.grand_total) : Number(inv.grand_total);
      existing.total_billed += payable;
      existing.total_received += Number(inv.amount_received);
      existing.balance += Math.max(0, payable - Number(inv.amount_received));
      existing.invoices.push(inv);
      byCustomer.set(cid, existing);
    }
    setData(Array.from(byCustomer.values()).sort((a, b) => b.total_billed - a.total_billed));
  };

  const handleExport = () => {
    const dateRange = `${formatDate(filters.from)} - ${formatDate(filters.to)}`;
    const generatedDate = new Date().toLocaleString('en-IN');
    let filterStr = '';
    if (filters.vehicle_id) filterStr += `Vehicle: ${vehicles.find(v => v.id === filters.vehicle_id)?.registration_number ?? ''} `;
    if (filters.driver_id) filterStr += `Driver: ${employees.find(e => e.id === filters.driver_id)?.name ?? ''} `;
    if (filters.payment_status) filterStr += `Status: ${filters.payment_status} `;

    const companyInfo = settings ? { company_name: settings.company_name, address: settings.address, phone: settings.phone, email: settings.email, gstin: settings.gstin } : { company_name: 'Crane ERP' };

    switch (type) {
      case 'trips': {
        const tripsData = data as TripWithRelations[];
        exportToExcelWithCompany(`Trip_Report_${filters.from}_${filters.to}.csv`, 'Trip Entries Report', companyInfo, dateRange, generatedDate, filterStr,
          [t('tripNumber'), t('date'), t('vehicleNumber'), t('driver'), t('customer'), t('placeOfWork'), t('totalHours'), t('sessions'), t('rentalAmount'), t('batha'), t('totalAmount'), t('billStatus')],
          tripsData.map(tr => {
            const ss = (tr as TripWithRelations & { sessions?: unknown[] }).sessions;
            return [tr.trip_number, formatDate(tr.trip_date), tr.vehicle?.registration_number ?? '-', tr.driver?.name ?? '-', tr.customer?.name ?? '-', tr.place_of_work, tr.total_hours, ss && ss.length > 0 ? ss.length : 1, tr.rental_amount, tr.batha, tr.total_amount, tr.bill_status];
          }),
          [t('total'), '', '', '', '', '', tripsData.reduce((s, tr) => s + tr.total_hours, 0), '', tripsData.reduce((s, tr) => s + Number(tr.rental_amount), 0), tripsData.reduce((s, tr) => s + Number(tr.batha), 0), tripsData.reduce((s, tr) => s + Number(tr.total_amount), 0), ''],
        );
        break;
      }
      case 'diesel': {
        const dieselData = data as DieselWithRelations[];
        exportToExcelWithCompany(`Diesel_Report_${filters.from}_${filters.to}.csv`, 'Diesel Report', companyInfo, dateRange, generatedDate, filterStr,
          [t('date'), t('vehicleNumber'), t('pumpName'), t('quantityLiters'), t('ratePerLiter'), t('totalDieselAmount'), t('paidAmount'), t('pendingAmount'), t('paymentStatus')],
          dieselData.map(d => [formatDate(d.diesel_date), d.vehicle?.registration_number ?? '-', d.pump_name ?? '-', d.quantity_liters, d.rate_per_liter, d.total_amount, d.paid_amount, d.pending_amount, d.payment_status]),
          [t('total'), '', '', dieselData.reduce((s, d) => s + Number(d.quantity_liters), 0), '', dieselData.reduce((s, d) => s + Number(d.total_amount), 0), dieselData.reduce((s, d) => s + Number(d.paid_amount), 0), dieselData.reduce((s, d) => s + Number(d.pending_amount), 0), ''],
        );
        break;
      }
      case 'maintenance': {
        const maintData = data as MaintenanceWithRelations[];
        exportToExcelWithCompany(`Maintenance_Report_${filters.from}_${filters.to}.csv`, 'Maintenance Report', companyInfo, dateRange, generatedDate, filterStr,
          [t('date'), t('vehicleNumber'), t('maintenanceType'), t('remark'), t('totalAmount'), t('paidAmount'), t('balance')],
          maintData.map(m => [formatDate(m.maintenance_date), m.vehicle?.registration_number ?? '-', m.maintenance_type, m.remark ?? m.description ?? '-', m.amount, m.paid_amount, m.balance]),
          [t('total'), '', '', '', maintData.reduce((s, m) => s + Number(m.amount), 0), maintData.reduce((s, m) => s + Number(m.paid_amount), 0), maintData.reduce((s, m) => s + Number(m.balance), 0)],
        );
        break;
      }
      case 'emi': {
        const emiData = data as EmiWithRelations[];
        exportToExcelWithCompany('EMI_Report.csv', 'EMI Report', companyInfo, dateRange, generatedDate, '',
          [t('vehicleNumber'), t('emiAmount'), t('dueDate'), t('endDate'), 'Days Remaining/Overdue', t('status'), t('paidDate'), t('paymentMode')],
          emiData.map(e => {
            const today = new Date(); today.setHours(0,0,0,0);
            const due = new Date(e.due_date + 'T00:00:00');
            const d = Math.round((due.getTime() - today.getTime()) / 86400000);
            const dayLabel = e.status === 'Paid' ? '-' : d < 0 ? `${Math.abs(d)} days overdue` : d === 0 ? 'Due today' : `${d} days remaining`;
            return [e.vehicle?.registration_number ?? '-', e.emi_amount, formatDate(e.due_date), formatDate(e.end_date), dayLabel, e.status, formatDate(e.paid_date), e.payment_mode ?? '-'];
          }),
          [t('total'), emiData.reduce((s, e) => s + Number(e.emi_amount), 0), '', '', '', '', '', ''],
        );
        break;
      }
      case 'attendance': {
        const attData = data as AttendanceWithEmployee[];
        exportToExcelWithCompany(`Attendance_Report_${filters.from}_${filters.to}.csv`, 'Attendance Report', companyInfo, dateRange, generatedDate, '',
          [t('date'), t('name'), t('role'), t('status')],
          attData.map(a => [formatDate(a.attendance_date), a.employee?.name ?? '-', a.employee?.role ?? '-', a.status]),
          [t('total'), '', '', ''],
        );
        break;
      }
      case 'salary': {
        const salData = data as { employee: Employee; present: number; absent: number; holiday: number; payable: number; advance: number; balance: number; salary: number }[];
        exportToExcelWithCompany(`Salary_Statement_${monthName(filters.month - 1)}_${filters.year}.csv`, 'Salary Statement', companyInfo, `${monthName(filters.month - 1)} ${filters.year}`, generatedDate, '',
          [t('name'), t('role'), t('salary'), t('presentDays'), t('absentDays'), t('holidayDays'), t('advanceSalary'), t('salaryPayable'), t('balance')],
          salData.map(s => [s.employee.name, s.employee.role, s.salary, s.present, s.absent, s.holiday, s.advance, s.payable, s.balance]),
          [t('total'), '', salData.reduce((s, d) => s + d.salary, 0), salData.reduce((s, d) => s + d.present, 0), salData.reduce((s, d) => s + d.absent, 0), salData.reduce((s, d) => s + d.holiday, 0), salData.reduce((s, d) => s + d.advance, 0), salData.reduce((s, d) => s + d.payable, 0), salData.reduce((s, d) => s + d.balance, 0)],
        );
        break;
      }
      case 'daily-vehicle': {
        const dvData = data as { trip: TripWithRelations; dAmount: number; dLiters: number; mAmount: number; net: number }[];
        exportToExcelWithCompany(`Daily_Vehicle_Report_${filters.from}.csv`, 'Daily Vehicle Report', companyInfo, formatDate(filters.from), generatedDate, filterStr,
          [t('date'), t('vehicleNumber'), t('driver'), t('placeOfWork'), t('inTime'), t('outTime'), t('totalHours'), t('rentalAmount'), t('batha'), t('totalAmount'), t('dieselLiters'), t('dieselAmount'), t('maintenance'), t('totalCost'), t('netAmount'), t('billStatus')],
          dvData.map(r => [formatDate(r.trip.trip_date), r.trip.vehicle?.registration_number ?? '-', r.trip.driver?.name ?? '-', r.trip.place_of_work, formatTime(r.trip.in_time), formatTime(r.trip.out_time), r.trip.total_hours, r.trip.rental_amount, r.trip.batha, r.trip.total_amount, r.dLiters, r.dAmount, r.mAmount, r.dAmount + r.mAmount + r.trip.batha, r.net, r.trip.bill_status]),
          [t('total'), '', '', '', '', '', dvData.reduce((s, r) => s + r.trip.total_hours, 0), dvData.reduce((s, r) => s + Number(r.trip.rental_amount), 0), dvData.reduce((s, r) => s + Number(r.trip.batha), 0), dvData.reduce((s, r) => s + Number(r.trip.total_amount), 0), dvData.reduce((s, r) => s + r.dLiters, 0), dvData.reduce((s, r) => s + r.dAmount, 0), dvData.reduce((s, r) => s + r.mAmount, 0), dvData.reduce((s, r) => s + r.dAmount + r.mAmount + r.trip.batha, 0), dvData.reduce((s, r) => s + r.net, 0), ''],
        );
        break;
      }
      case 'monthly':
      case 'profit-loss': {
        const r = (data as Record<string, number>[])[0] ?? {};
        exportToExcelWithCompany(`${type === 'monthly' ? 'Monthly' : 'Profit_Loss'}_Report.csv`, reportTitles[type], companyInfo, `${monthName(filters.month - 1)} ${filters.year}`, new Date().toLocaleString('en-IN'), '',
          ['Metric', 'Amount'],
          [
            [t('grossMonthlyIncome'), r.grossIncome ?? r.totalRevenue ?? r.revenue ?? 0],
            [t('maintenanceExpenses'), r.maintCost ?? 0],
            [t('netIncomeAfterMaintenance'), (r.grossIncome ?? r.totalRevenue ?? r.revenue ?? 0) - (r.maintCost ?? 0)],
            ['', ''],
            [t('totalRevenue'), r.revenue ?? r.totalRevenue ?? 0],
            [t('diesel'), r.dieselCost ?? 0],
            [t('salary'), r.salary ?? r.totalSalary ?? 0],
            [t('maintenanceCost'), r.maintCost ?? 0],
            [t('emi'), r.emiCost ?? 0],
            [t('totalExpenses'), r.totalExpenses ?? 0],
            [r.netProfit >= 0 ? t('netProfit') : t('netLoss'), Math.abs(r.netProfit ?? 0)],
          ],
        );
        break;
      }
      case 'cash-bills': {
        const invData = data as InvoiceWithRelations[];
        exportToExcelWithCompany('Cash_Bill_Report.csv', reportTitles[type], companyInfo, dateRange, generatedDate, filterStr,
          [t('invoiceNumber'), t('date'), t('customer'), t('vehicleNumber'), t('taxableAmount'), t('totalGst'), t('grandTotal'), t('paymentStatus')],
          invData.map(i => [i.invoice_number, formatDate(i.invoice_date), i.customer_name ?? i.customer?.name ?? '-', i.vehicle_number ?? '-', i.taxable_amount, i.total_gst, i.grand_total, i.payment_status]),
          [t('total'), '', '', '', invData.reduce((s, i) => s + Number(i.taxable_amount), 0), invData.reduce((s, i) => s + Number(i.total_gst), 0), invData.reduce((s, i) => s + Number(i.grand_total), 0), ''],
        );
        break;
      }
      case 'customer-billing': {
        const cbData = data as { customer_name: string; company_name: string | null; phone: string | null; gstin: string | null; invoice_count: number; total_billed: number; total_received: number; balance: number }[];
        exportToExcelWithCompany('Customer_Billing_Report.csv', reportTitles[type], companyInfo, dateRange, generatedDate, filterStr,
          [t('customer'), t('phone'), 'GSTIN', t('invoiceNumber'), t('grandTotal'), t('paid'), t('balance')],
          cbData.map(c => [c.customer_name, c.phone ?? '-', c.gstin ?? '-', c.invoice_count, c.total_billed, c.total_received, c.balance]),
          [t('total'), '', '', cbData.reduce((s, c) => s + c.invoice_count, 0), cbData.reduce((s, c) => s + c.total_billed, 0), cbData.reduce((s, c) => s + c.total_received, 0), cbData.reduce((s, c) => s + c.balance, 0)],
        );
        break;
      }
    }
  };

  const showMonthYear = type === 'salary' || type === 'monthly';
  const showDateRange = type !== 'emi' && !showMonthYear;
  const showDailyDate = type === 'daily-vehicle';
  const showEmiDateRange = type === 'emi';

  const setQuickRange = (range: 'today' | 'week' | 'month' | 'all') => {
    const today = todayISO();
    if (range === 'today') {
      setFilters(f => ({ ...f, from: today, to: today }));
    } else if (range === 'week') {
      const d = new Date();
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
      setFilters(f => ({ ...f, from: monday.toISOString().split('T')[0], to: today }));
    } else if (range === 'month') {
      const d = new Date();
      setFilters(f => ({ ...f, from: new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0], to: today }));
    } else if (range === 'all') {
      setFilters(f => ({ ...f, from: '2020-01-01', to: today }));
    }
  };

  if (loading) return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex flex-wrap gap-3 items-end">
          {showDateRange || showEmiDateRange ? (
            <>
              <Field label={t('from')}><DatePicker value={filters.from} onChange={v => setFilters(f => ({ ...f, from: v }))} /></Field>
              <Field label={t('to')}><DatePicker value={filters.to} onChange={v => setFilters(f => ({ ...f, to: v }))} /></Field>
            </>
          ) : null}
        </div>
      </div>
      <LoadingSpinner />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="print-logo hidden print:flex items-center gap-3 mb-4">
        <img src={getReportLogoUrl()} alt="logo" className="w-12 h-9 object-contain" />
        <h2 className="text-lg font-bold text-slate-800">{reportTitles[type]}</h2>
      </div>
      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 print:hidden">
        <div className="flex flex-wrap gap-3 items-end">
          {(showDateRange || showEmiDateRange) && (
            <>
              <Field label={t('from')}>
                <DatePicker value={filters.from} onChange={v => setFilters(f => ({ ...f, from: v }))} />
              </Field>
              <Field label={t('to')}>
                <DatePicker value={filters.to} onChange={v => setFilters(f => ({ ...f, to: v }))} />
              </Field>
              <div className="flex gap-1">
                <Button variant="outline" onClick={() => setQuickRange('today')}>Today</Button>
                <Button variant="outline" onClick={() => setQuickRange('week')}>This Week</Button>
                <Button variant="outline" onClick={() => setQuickRange('month')}>This Month</Button>
                <Button variant="outline" onClick={() => setQuickRange('all')}>All Dates</Button>
              </div>
            </>
          )}
          {showDailyDate && (
            <Field label={t('date')}>
              <DatePicker value={filters.from} onChange={v => setFilters(f => ({ ...f, from: v, to: v }))} />
            </Field>
          )}
          {showMonthYear && (
            <>
              <Field label={t('month')}>
                <select className={inputClass()} value={filters.month} onChange={e => setFilters(f => ({ ...f, month: Number(e.target.value) }))}>
                  {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{monthName(i)}</option>)}
                </select>
              </Field>
              <Field label={t('year')}>
                <input type="number" className={inputClass()} value={filters.year} onChange={e => setFilters(f => ({ ...f, year: Number(e.target.value) }))} />
              </Field>
            </>
          )}
          {(type === 'trips' || type === 'daily-vehicle' || type === 'diesel' || type === 'maintenance') && (
            <Field label={t('vehicleNumber')}>
              <select className={inputClass()} value={filters.vehicle_id} onChange={e => setFilters(f => ({ ...f, vehicle_id: e.target.value }))}>
                <option value="">{t('all')}</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.registration_number}</option>)}
              </select>
            </Field>
          )}
          {(type === 'trips' || type === 'daily-vehicle') && (
            <>
              <Field label={t('driver')}>
                <select className={inputClass()} value={filters.driver_id} onChange={e => setFilters(f => ({ ...f, driver_id: e.target.value }))}>
                  <option value="">{t('all')}</option>
                  {employees.filter(e => e.role === 'Driver' || e.role === 'Operator').map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </Field>
              <Field label={t('placeOfWork')}>
                <input className={inputClass()} value={filters.place_of_work} onChange={e => setFilters(f => ({ ...f, place_of_work: e.target.value }))} />
              </Field>
            </>
          )}
          {(type === 'trips' || type === 'cash-bills' || type === 'customer-billing') && (
            <Field label={t('paymentStatus')}>
              <select className={inputClass()} value={filters.payment_status} onChange={e => setFilters(f => ({ ...f, payment_status: e.target.value }))}>
                <option value="">{t('all')}</option>
                <option value="Paid">{t('paid')}</option>
                <option value="Pending">{t('pending')}</option>
              </select>
            </Field>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleExport} disabled={data.length === 0}><Download className="w-4 h-4" />{t('export')}</Button>
            <Button variant="outline" onClick={() => window.print()}><Printer className="w-4 h-4" />{t('print')}</Button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-800">{reportTitles[type]}</h3>
        <span className="text-sm text-slate-500">{data.length} records</span>
      </div>

      {/* Error State */}
      {errorMsg && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-red-700 font-medium text-sm">{errorMsg}</p>
          <Button variant="outline" className="mt-3" onClick={() => fetchData()}>Retry</Button>
        </div>
      )}

      {/* Report Data */}
      {!errorMsg && <ReportData type={type} data={data} t={t} filters={filters} />}
    </div>
  );
}

function ReportData({ type, data, t, filters }: { type: ReportType; data: unknown[]; t: (k: string) => string; filters: { from: string; to: string; month: number; year: number } }) {
  if (data.length === 0) {
    const rangeText = type === 'salary' || type === 'monthly'
      ? `${monthName(filters.month - 1)} ${filters.year}`
      : `${formatDate(filters.from)} - ${formatDate(filters.to)}`;
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
        <p className="text-slate-400 text-sm">No records found for the selected filters.</p>
        <p className="text-slate-400 text-xs mt-1">Date range: {rangeText}</p>
      </div>
    );
  }

  switch (type) {
    case 'trips': {
      const trips = data as TripWithRelations[];
      const totalRental = trips.reduce((s, tr) => s + Number(tr.rental_amount), 0);
      const totalBatha = trips.reduce((s, tr) => s + Number(tr.batha), 0);
      const totalAmount = trips.reduce((s, tr) => s + Number(tr.total_amount), 0);
      const totalHours = trips.reduce((s, tr) => s + Number(tr.total_hours), 0);
      const totalPaid = trips.filter(tr => tr.bill_status === 'Paid').reduce((s, tr) => s + Number(tr.total_amount), 0);
      const totalPending = totalAmount - totalPaid;
      const columns: Column<TripWithRelations>[] = [
        { key: 'trip_number', header: t('tripNumber'), sortable: true },
        { key: 'trip_date', header: t('date'), sortable: true, render: tr => formatDate(tr.trip_date) },
        { key: 'vehicle', header: t('vehicleNumber'), render: tr => tr.vehicle?.registration_number ?? '-' },
        { key: 'driver', header: t('driver'), render: tr => tr.driver?.name ?? '-' },
        { key: 'customer', header: t('customer'), render: tr => tr.customer?.name ?? '-' },
        { key: 'place_of_work', header: t('placeOfWork') },
        { key: 'total_hours', header: t('totalHours'), align: 'right', sortable: true, render: tr => `${tr.total_hours}h` },
        { key: 'sessions', header: t('sessions'), align: 'center', render: tr => {
          const ss = (tr as TripWithRelations & { sessions?: { session_number: number }[] }).sessions;
          if (!ss || ss.length === 0) return '1';
          return ss.length;
        } },
        { key: 'rental_amount', header: t('rentalAmount'), align: 'right', render: tr => formatCurrency(tr.rental_amount), sortable: true },
        { key: 'batha', header: t('batha'), align: 'right', render: tr => formatCurrency(tr.batha) },
        { key: 'total_amount', header: t('totalAmount'), align: 'right', render: tr => formatCurrency(tr.total_amount), sortable: true },
        { key: 'bill_status', header: t('billStatus'), render: tr => <StatusBadge status={tr.bill_status} /> },
      ];
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            <div className="bg-white rounded-lg border border-slate-200 p-3"><div className="text-xs text-slate-500">Total Trips</div><div className="text-lg font-bold text-slate-800">{trips.length}</div></div>
            <div className="bg-white rounded-lg border border-slate-200 p-3"><div className="text-xs text-slate-500">Total Hours</div><div className="text-lg font-bold text-slate-800">{totalHours}h</div></div>
            <div className="bg-white rounded-lg border border-slate-200 p-3"><div className="text-xs text-slate-500">Rental Amount</div><div className="text-lg font-bold text-slate-800">{formatCurrency(totalRental)}</div></div>
            <div className="bg-white rounded-lg border border-slate-200 p-3"><div className="text-xs text-slate-500">Batha</div><div className="text-lg font-bold text-slate-800">{formatCurrency(totalBatha)}</div></div>
            <div className="bg-white rounded-lg border border-emerald-200 p-3"><div className="text-xs text-slate-500">Paid</div><div className="text-lg font-bold text-emerald-600">{formatCurrency(totalPaid)}</div></div>
            <div className="bg-white rounded-lg border border-red-200 p-3"><div className="text-xs text-slate-500">Pending</div><div className="text-lg font-bold text-red-600">{formatCurrency(totalPending)}</div></div>
          </div>
          <DataTable columns={columns} data={trips} pageSize={50} showSerialNumber />
        </div>
      );
    }
    case 'diesel': {
      const diesel = data as DieselWithRelations[];
      const totalLiters = diesel.reduce((s, d) => s + Number(d.quantity_liters), 0);
      const totalAmount = diesel.reduce((s, d) => s + Number(d.total_amount), 0);
      const totalPaid = diesel.reduce((s, d) => s + Number(d.paid_amount), 0);
      const totalPending = diesel.reduce((s, d) => s + Number(d.pending_amount), 0);
      const columns: Column<DieselWithRelations>[] = [
        { key: 'diesel_date', header: t('date'), sortable: true, render: d => formatDate(d.diesel_date) },
        { key: 'vehicle', header: t('vehicleNumber'), render: d => d.vehicle?.registration_number ?? '-' },
        { key: 'pump_name', header: t('pumpName'), render: d => d.pump_name ?? '-' },
        { key: 'quantity_liters', header: t('quantityLiters'), align: 'right', sortable: true, render: d => `${d.quantity_liters} L` },
        { key: 'rate_per_liter', header: t('ratePerLiter'), align: 'right', render: d => formatCurrency(d.rate_per_liter) },
        { key: 'total_amount', header: t('totalDieselAmount'), align: 'right', render: d => formatCurrency(d.total_amount), sortable: true },
        { key: 'paid_amount', header: t('paidAmount'), align: 'right', render: d => formatCurrency(d.paid_amount) },
        { key: 'pending_amount', header: t('pendingAmount'), align: 'right', render: d => formatCurrency(d.pending_amount) },
        { key: 'payment_status', header: t('paymentStatus'), render: d => <StatusBadge status={d.payment_status} /> },
      ];
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white rounded-lg border border-slate-200 p-3"><div className="text-xs text-slate-500">Total Litres</div><div className="text-lg font-bold text-slate-800">{totalLiters} L</div></div>
            <div className="bg-white rounded-lg border border-slate-200 p-3"><div className="text-xs text-slate-500">Total Amount</div><div className="text-lg font-bold text-slate-800">{formatCurrency(totalAmount)}</div></div>
            <div className="bg-white rounded-lg border border-emerald-200 p-3"><div className="text-xs text-slate-500">Paid</div><div className="text-lg font-bold text-emerald-600">{formatCurrency(totalPaid)}</div></div>
            <div className="bg-white rounded-lg border border-red-200 p-3"><div className="text-xs text-slate-500">Pending</div><div className="text-lg font-bold text-red-600">{formatCurrency(totalPending)}</div></div>
          </div>
          <DataTable columns={columns} data={diesel} pageSize={50} showSerialNumber />
        </div>
      );
    }
    case 'attendance': {
      const att = data as AttendanceWithEmployee[];
      const present = att.filter(a => a.status === 'Present').length;
      const absent = att.filter(a => a.status === 'Absent').length;
      const holiday = att.filter(a => a.status === 'Holiday').length;
      const columns: Column<AttendanceWithEmployee>[] = [
        { key: 'attendance_date', header: t('date'), sortable: true, render: a => formatDate(a.attendance_date) },
        { key: 'employee', header: t('name'), render: a => a.employee?.name ?? '-' },
        { key: 'role', header: t('role'), render: a => a.employee?.role ?? '-' },
        { key: 'status', header: t('status'), render: a => <StatusBadge status={a.status} /> },
      ];
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white rounded-lg border border-slate-200 p-3"><div className="text-xs text-slate-500">Total Records</div><div className="text-lg font-bold text-slate-800">{att.length}</div></div>
            <div className="bg-white rounded-lg border border-emerald-200 p-3"><div className="text-xs text-slate-500">Present</div><div className="text-lg font-bold text-emerald-600">{present}</div></div>
            <div className="bg-white rounded-lg border border-red-200 p-3"><div className="text-xs text-slate-500">Absent</div><div className="text-lg font-bold text-red-600">{absent}</div></div>
            <div className="bg-white rounded-lg border border-blue-200 p-3"><div className="text-xs text-slate-500">Holiday</div><div className="text-lg font-bold text-blue-600">{holiday}</div></div>
          </div>
          <DataTable columns={columns} data={att} pageSize={50} showSerialNumber />
        </div>
      );
    }
    case 'maintenance': {
      const maint = data as MaintenanceWithRelations[];
      const totalAmount = maint.reduce((s, m) => s + Number(m.amount), 0);
      const totalPaid = maint.reduce((s, m) => s + Number(m.paid_amount), 0);
      const totalBalance = maint.reduce((s, m) => s + Number(m.balance), 0);
      const columns: Column<MaintenanceWithRelations>[] = [
        { key: 'maintenance_date', header: t('date'), sortable: true, render: m => formatDate(m.maintenance_date) },
        { key: 'vehicle', header: t('vehicleNumber'), render: m => m.vehicle?.registration_number ?? '-' },
        { key: 'maintenance_type', header: t('maintenanceType'), render: m => <StatusBadge status={m.maintenance_type} variant="blue" /> },
        { key: 'remark', header: t('remark'), render: m => <span className="truncate max-w-[200px] inline-block">{m.remark ?? m.description ?? '-'}</span> },
        { key: 'amount', header: t('totalAmount'), align: 'right', sortable: true, render: m => <span className="font-medium text-slate-800">{formatCurrency(m.amount)}</span> },
        { key: 'paid_amount', header: t('paidAmount'), align: 'right', render: m => <span className="font-medium text-emerald-600">{formatCurrency(m.paid_amount)}</span> },
        { key: 'balance', header: t('balance'), align: 'right', render: m => <span className={Number(m.balance) > 0 ? 'font-medium text-red-600' : 'font-medium text-emerald-600'}>{formatCurrency(m.balance)}</span> },
      ];
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white rounded-lg border border-slate-200 p-3"><div className="text-xs text-slate-500">Total Records</div><div className="text-lg font-bold text-slate-800">{maint.length}</div></div>
            <div className="bg-white rounded-lg border border-slate-200 p-3"><div className="text-xs text-slate-500">{t('totalAmount')}</div><div className="text-lg font-bold text-slate-800">{formatCurrency(totalAmount)}</div></div>
            <div className="bg-white rounded-lg border border-emerald-200 p-3"><div className="text-xs text-emerald-600">{t('paidAmount')}</div><div className="text-lg font-bold text-emerald-700">{formatCurrency(totalPaid)}</div></div>
            <div className="bg-white rounded-lg border border-red-200 p-3"><div className="text-xs text-red-600">{t('balance')}</div><div className="text-lg font-bold text-red-700">{formatCurrency(totalBalance)}</div></div>
          </div>
          <DataTable columns={columns} data={maint} pageSize={50} showSerialNumber />
        </div>
      );
    }
    case 'emi': {
      const emis = data as EmiWithRelations[];
      const totalAmount = emis.reduce((s, e) => s + Number(e.emi_amount), 0);
      const totalPaid = emis.filter(e => e.status === 'Paid').reduce((s, e) => s + Number(e.emi_amount), 0);
      const totalPending = totalAmount - totalPaid;
      const overdueCount = emis.filter(e => e.status !== 'Paid' && new Date(e.due_date) < new Date()).length;
      const dueTodayCount = emis.filter(e => e.status !== 'Paid' && e.due_date === todayISO()).length;
      const dueSoonCount = emis.filter(e => { if (e.status === 'Paid') return false; const d = new Date(e.due_date); const now = new Date(); return d > now && d <= new Date(now.getTime() + 5 * 86400000); }).length;
      const columns: Column<EmiWithRelations>[] = [
        { key: 'vehicle', header: t('vehicleNumber'), render: e => e.vehicle?.registration_number ?? '-' },
        { key: 'emi_amount', header: t('emiAmount'), align: 'right', sortable: true, render: e => formatCurrency(e.emi_amount) },
        { key: 'due_date', header: t('dueDate'), sortable: true, render: e => formatDate(e.due_date) },
        { key: 'end_date', header: t('endDate'), render: e => formatDate(e.end_date) },
        { key: 'days', header: 'Days Remaining/Overdue', align: 'center', render: e => {
          if (e.status === 'Paid') return <span className="text-slate-400 text-sm">-</span>;
          const today = new Date(); today.setHours(0,0,0,0);
          const due = new Date(e.due_date + 'T00:00:00');
          const d = Math.round((due.getTime() - today.getTime()) / 86400000);
          if (d < 0) return <span className="text-red-600 font-semibold text-sm">{Math.abs(d)} days overdue</span>;
          if (d === 0) return <span className="text-orange-600 font-bold text-sm">Due today</span>;
          return <span className="text-amber-600 font-medium text-sm">{d} days remaining</span>;
        }},
        { key: 'status', header: t('status'), render: e => <StatusBadge status={e.status} /> },
        { key: 'paid_date', header: t('paidDate'), render: e => formatDate(e.paid_date) },
        { key: 'payment_mode', header: t('paymentMode'), render: e => e.payment_mode ?? '-' },
      ];
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-white rounded-lg border border-slate-200 p-3"><div className="text-xs text-slate-500">Total EMI</div><div className="text-lg font-bold text-slate-800">{formatCurrency(totalAmount)}</div></div>
            <div className="bg-white rounded-lg border border-emerald-200 p-3"><div className="text-xs text-emerald-600">Paid</div><div className="text-lg font-bold text-emerald-600">{formatCurrency(totalPaid)}</div></div>
            <div className="bg-white rounded-lg border border-red-200 p-3"><div className="text-xs text-red-600">Pending</div><div className="text-lg font-bold text-red-600">{formatCurrency(totalPending)}</div></div>
            <div className="bg-white rounded-lg border border-red-200 p-3"><div className="text-xs text-red-600">Overdue Count</div><div className="text-lg font-bold text-red-600">{overdueCount}</div></div>
            <div className="bg-white rounded-lg border border-amber-200 p-3"><div className="text-xs text-amber-600">Due Soon (5d)</div><div className="text-lg font-bold text-amber-600">{dueSoonCount}</div></div>
            <div className="bg-white rounded-lg border border-orange-200 p-3"><div className="text-xs text-orange-600">Due Today</div><div className="text-lg font-bold text-orange-600">{dueTodayCount}</div></div>
          </div>
          <DataTable columns={columns} data={emis} pageSize={50} showSerialNumber />
        </div>
      );
    }
    case 'salary': {
      const sal = data as { employee: Employee; present: number; absent: number; holiday: number; payable: number; advance: number; balance: number; salary: number }[];
      const totalSalary = sal.reduce((s, d) => s + d.salary, 0);
      const totalPayable = sal.reduce((s, d) => s + d.payable, 0);
      const totalAdvance = sal.reduce((s, d) => s + d.advance, 0);
      const totalBalance = sal.reduce((s, d) => s + d.balance, 0);
      const columns: Column<typeof sal[number]>[] = [
        { key: 'name', header: t('name'), render: s => s.employee.name },
        { key: 'role', header: t('role'), render: s => s.employee.role },
        { key: 'salary', header: t('salary'), align: 'right', render: s => formatCurrency(s.salary) },
        { key: 'present', header: t('presentDays'), align: 'right', render: s => s.present },
        { key: 'absent', header: t('absentDays'), align: 'right', render: s => s.absent },
        { key: 'holiday', header: t('holidayDays'), align: 'right', render: s => s.holiday },
        { key: 'advance', header: t('advanceSalary'), align: 'right', render: s => formatCurrency(s.advance) },
        { key: 'payable', header: t('salaryPayable'), align: 'right', render: s => formatCurrency(s.payable) },
        { key: 'balance', header: t('balance'), align: 'right', render: s => <span className={s.balance >= 0 ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>{formatCurrency(s.balance)}</span> },
      ];
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white rounded-lg border border-slate-200 p-3"><div className="text-xs text-slate-500">Total Salary</div><div className="text-lg font-bold text-slate-800">{formatCurrency(totalSalary)}</div></div>
            <div className="bg-white rounded-lg border border-slate-200 p-3"><div className="text-xs text-slate-500">Total Payable</div><div className="text-lg font-bold text-slate-800">{formatCurrency(totalPayable)}</div></div>
            <div className="bg-white rounded-lg border border-slate-200 p-3"><div className="text-xs text-slate-500">Total Advance</div><div className="text-lg font-bold text-slate-800">{formatCurrency(totalAdvance)}</div></div>
            <div className="bg-white rounded-lg border border-slate-200 p-3"><div className="text-xs text-slate-500">Total Balance</div><div className={`text-lg font-bold ${totalBalance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatCurrency(totalBalance)}</div></div>
          </div>
          <DataTable columns={columns} data={sal} pageSize={50} showSerialNumber />
        </div>
      );
    }
    case 'daily-vehicle': {
      const dv = data as { trip: TripWithRelations; dAmount: number; dLiters: number; mAmount: number; net: number }[];
      const columns: Column<typeof dv[number]>[] = [
        { key: 'date', header: t('date'), render: r => formatDate(r.trip.trip_date) },
        { key: 'vehicle', header: t('vehicleNumber'), render: r => r.trip.vehicle?.registration_number ?? '-' },
        { key: 'driver', header: t('driver'), render: r => r.trip.driver?.name ?? '-' },
        { key: 'place', header: t('placeOfWork'), render: r => r.trip.place_of_work },
        { key: 'in_time', header: t('inTime'), render: r => formatTime(r.trip.in_time) },
        { key: 'out_time', header: t('outTime'), render: r => formatTime(r.trip.out_time) },
        { key: 'hours', header: t('totalHours'), align: 'right', render: r => `${r.trip.total_hours}h` },
        { key: 'rental', header: t('rentalAmount'), align: 'right', render: r => formatCurrency(r.trip.rental_amount) },
        { key: 'batha', header: t('batha'), align: 'right', render: r => formatCurrency(r.trip.batha) },
        { key: 'total_bill', header: t('totalAmount'), align: 'right', render: r => formatCurrency(r.trip.total_amount) },
        { key: 'diesel_liters', header: t('dieselLiters'), align: 'right', render: r => `${r.dLiters} L` },
        { key: 'diesel_amount', header: t('dieselAmount'), align: 'right', render: r => formatCurrency(r.dAmount) },
        { key: 'maintenance', header: t('maintenance'), align: 'right', render: r => formatCurrency(r.mAmount) },
        { key: 'total_cost', header: t('totalCost'), align: 'right', render: r => formatCurrency(r.dAmount + r.mAmount + r.trip.batha) },
        { key: 'net', header: t('netAmount'), align: 'right', render: r => <span className={r.net >= 0 ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>{formatCurrency(r.net)}</span> },
        { key: 'bill_status', header: t('billStatus'), render: r => <StatusBadge status={r.trip.bill_status} /> },
      ];
      return <DataTable columns={columns} data={dv} pageSize={50} showSerialNumber />;
    }
    case 'monthly':
    case 'profit-loss': {
      const r = (data as Record<string, number>[])[0] ?? {};
      return (
        <div className="space-y-4">
          {type === 'monthly' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-white rounded-lg border border-blue-200 p-4 shadow-sm">
                <p className="text-xs text-blue-600 font-medium">{t('grossMonthlyIncome')}</p>
                <p className="text-xl font-bold text-blue-700 mt-1">{formatCurrency(r.grossIncome ?? r.totalRevenue ?? r.revenue ?? 0)}</p>
              </div>
              <div className="bg-white rounded-lg border border-amber-200 p-4 shadow-sm">
                <p className="text-xs text-amber-600 font-medium">{t('maintenanceExpenses')}</p>
                <p className="text-xl font-bold text-amber-700 mt-1">{formatCurrency(r.maintCost ?? 0)}</p>
                <p className="text-xs text-slate-400 mt-0.5">{r.maintCount ?? 0} {t('maintenanceEntries')}</p>
              </div>
              <div className="bg-white rounded-lg border border-emerald-200 p-4 shadow-sm">
                <p className="text-xs text-emerald-600 font-medium">{t('netMonthlyIncome')}</p>
                <p className={`text-xl font-bold mt-1 ${((r.grossIncome ?? r.totalRevenue ?? 0) - (r.maintCost ?? 0)) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {formatCurrency((r.grossIncome ?? r.totalRevenue ?? r.revenue ?? 0) - (r.maintCost ?? 0))}
                </p>
              </div>
            </div>
          )}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-2">
              <div className="p-6 border-b md:border-b-0 md:border-r border-slate-100">
                <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">{t('totalRevenue')}</h4>
                <div className="space-y-3">
                  <div className="flex justify-between"><span className="text-sm text-slate-600">{t('tripRevenue')}</span><span className="text-sm font-semibold">{formatCurrency(r.tripRevenue ?? r.revenue ?? 0)}</span></div>
                  <div className="flex justify-between border-t pt-3"><span className="text-sm font-bold text-slate-700">{t('totalRevenue')}</span><span className="text-sm font-bold text-emerald-600">{formatCurrency(r.totalRevenue ?? r.revenue ?? 0)}</span></div>
                </div>
              </div>
              <div className="p-6">
                <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">{t('costs')}</h4>
                <div className="space-y-3">
                  <div className="flex justify-between"><span className="text-sm text-slate-600">{t('diesel')}</span><span className="text-sm">{formatCurrency(r.dieselCost ?? 0)}</span></div>
                  <div className="flex justify-between"><span className="text-sm text-slate-600">{t('salary')}</span><span className="text-sm">{formatCurrency(r.salary ?? r.totalSalary ?? 0)}</span></div>
                  <div className="flex justify-between"><span className="text-sm text-slate-600">{t('maintenanceCost')}</span><span className="text-sm">{formatCurrency(r.maintCost ?? 0)}</span></div>
                  <div className="flex justify-between"><span className="text-sm text-slate-600">{t('emi')}</span><span className="text-sm">{formatCurrency(r.emiCost ?? 0)}</span></div>
                  <div className="flex justify-between border-t pt-3"><span className="text-sm font-bold text-slate-700">{t('totalExpenses')}</span><span className="text-sm font-bold text-red-600">{formatCurrency(r.totalExpenses ?? 0)}</span></div>
                </div>
              </div>
            </div>
            <div className="p-6 bg-slate-50 border-t border-slate-100">
              <div className="flex justify-between items-center">
                <span className="text-base font-bold text-slate-700">{(r.netProfit ?? 0) >= 0 ? t('netProfit') : t('netLoss')}</span>
                <span className={`text-2xl font-bold ${(r.netProfit ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatCurrency(Math.abs(r.netProfit ?? 0))}</span>
              </div>
            </div>
            {type === 'monthly' && (
              <div className="p-6 border-t border-slate-100">
                <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">{t('collection')}</h4>
                <div className="grid grid-cols-3 gap-4">
                  <div><span className="text-xs text-slate-500">{t('todayCashCollection')}</span><div className="text-sm font-semibold">{formatCurrency(r.cashCollection ?? 0)}</div></div>
                  <div><span className="text-xs text-slate-500">{t('todayOnlineCollection')}</span><div className="text-sm font-semibold">{formatCurrency(r.onlineCollection ?? 0)}</div></div>
                  <div><span className="text-xs text-slate-500">{t('pendingCustomerAmount')}</span><div className="text-sm font-semibold text-red-600">{formatCurrency(r.pendingAmount ?? 0)}</div></div>
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }
    case 'cash-bills': {
      const invs = data as InvoiceWithRelations[];
      const totalTaxable = invs.reduce((s, i) => s + Number(i.taxable_amount), 0);
      const totalGst = invs.reduce((s, i) => s + Number(i.total_gst), 0);
      const totalGrand = invs.reduce((s, i) => s + Number(i.grand_total), 0);
      const totalPaid = invs.reduce((s, i) => s + Number(i.amount_received ?? 0), 0);
      const totalPending = totalGrand - totalPaid;
      const columns: Column<InvoiceWithRelations>[] = [
        { key: 'invoice_number', header: t('invoiceNumber'), sortable: true },
        { key: 'invoice_date', header: t('date'), sortable: true, render: i => formatDate(i.invoice_date) },
        { key: 'customer_name', header: t('customer'), render: i => i.customer_name ?? i.customer?.name ?? '-' },
        { key: 'vehicle_number', header: t('vehicleNumber'), render: i => i.vehicle_number ?? '-' },
        { key: 'taxable_amount', header: t('taxableAmount'), align: 'right', render: i => formatCurrency(i.taxable_amount), sortable: true },
        { key: 'total_gst', header: t('totalGst'), align: 'right', render: i => formatCurrency(i.total_gst) },
        { key: 'grand_total', header: t('grandTotal'), align: 'right', render: i => formatCurrency(i.grand_total), sortable: true },
        { key: 'payment_status', header: t('paymentStatus'), render: i => <StatusBadge status={i.payment_status} /> },
      ];
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">{t('invoiceNumber')}</div>
              <div className="text-2xl font-bold text-slate-800">{invs.length}</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">{t('taxableAmount')}</div>
              <div className="text-2xl font-bold text-slate-800">{formatCurrency(totalTaxable)}</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">{t('totalGst')}</div>
              <div className="text-2xl font-bold text-slate-800">{formatCurrency(totalGst)}</div>
            </div>
            <div className="bg-white rounded-xl border border-emerald-200 shadow-sm p-4">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">{t('paid')}</div>
              <div className="text-2xl font-bold text-emerald-600">{formatCurrency(totalPaid)}</div>
            </div>
            <div className="bg-white rounded-xl border border-red-200 shadow-sm p-4">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">{t('pending')}</div>
              <div className="text-2xl font-bold text-red-600">{formatCurrency(totalPending)}</div>
            </div>
          </div>
          <DataTable columns={columns} data={invs} pageSize={50} showSerialNumber />
        </div>
      );
    }
    case 'customer-billing': {
      const cbData = data as { customer_id: string; customer_name: string; company_name: string | null; phone: string | null; gstin: string | null; invoice_count: number; total_billed: number; total_received: number; balance: number; invoices: InvoiceWithRelations[] }[];
      const grandBilled = cbData.reduce((s, c) => s + c.total_billed, 0);
      const grandReceived = cbData.reduce((s, c) => s + c.total_received, 0);
      const grandBalance = cbData.reduce((s, c) => s + c.balance, 0);
      const collectionRate = grandBilled > 0 ? Math.round((grandReceived / grandBilled) * 100) : 0;
      const columns: Column<typeof cbData[number]>[] = [
        { key: 'customer_name', header: t('customer'), sortable: true, render: c => (
          <div className="flex flex-col">
            <span className="font-medium text-slate-800">{c.customer_name}</span>
            {c.phone && <span className="text-xs text-slate-400">{c.phone}</span>}
          </div>
        ) },
        { key: 'gstin', header: 'GSTIN', render: c => c.gstin ? <span className="text-xs text-slate-500 font-mono">{c.gstin}</span> : '-' },
        { key: 'invoice_count', header: t('invoiceNumber'), align: 'right', sortable: true, render: c => <span className="font-medium text-slate-600">{c.invoice_count}</span> },
        { key: 'total_billed', header: t('grandTotal'), align: 'right', sortable: true, render: c => <span className="font-semibold text-slate-800">{formatCurrency(c.total_billed)}</span> },
        { key: 'total_received', header: t('paid'), align: 'right', render: c => <span className="font-medium text-emerald-600">{formatCurrency(c.total_received)}</span> },
        { key: 'balance', header: t('balance'), align: 'right', sortable: true, render: c => (
          <span className={c.balance > 0 ? 'font-semibold text-red-600' : 'font-medium text-emerald-600'}>{formatCurrency(c.balance)}</span>
        ) },
      ];
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">{t('customers')}</div>
              <div className="text-2xl font-bold text-slate-800">{cbData.length}</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">{t('grandTotal')}</div>
              <div className="text-2xl font-bold text-slate-800">{formatCurrency(grandBilled)}</div>
            </div>
            <div className="bg-white rounded-xl border border-emerald-200 shadow-sm p-4">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">{t('paid')}</div>
              <div className="text-2xl font-bold text-emerald-600">{formatCurrency(grandReceived)}</div>
            </div>
            <div className="bg-white rounded-xl border border-red-200 shadow-sm p-4">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">{t('balance')}</div>
              <div className="text-2xl font-bold text-red-600">{formatCurrency(grandBalance)}</div>
            </div>
            <div className="bg-white rounded-xl border border-blue-200 shadow-sm p-4">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">{t('collectionRate')}</div>
              <div className="text-2xl font-bold text-blue-600">{collectionRate}%</div>
            </div>
          </div>
          <DataTable columns={columns} data={cbData} pageSize={50} showSerialNumber />
        </div>
      );
    }
    default:
      return null;
  }
}
