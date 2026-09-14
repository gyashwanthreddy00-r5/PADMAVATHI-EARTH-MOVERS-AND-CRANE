import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import { useSettings } from '@/context/SettingsContext';
import { Button, inputClass, LoadingSpinner } from '@/components/ui/common';
import { DatePicker } from '@/components/ui/DatePicker';
import { formatCurrency, formatDate, todayISO } from '@/lib/utils';
import { exportToXlsxWithCompany } from '@/lib/exportXlsx';
import { printReportWithCompany } from '@/lib/printReport';
import { round2 } from '@/lib/gstBillingCalc';
import {
  Truck, Search, X, Printer, FileText, FileSpreadsheet, RefreshCw,
  ListChecks, Clock, Fuel, IndianRupee, ChevronLeft, ChevronRight,
} from 'lucide-react';

type DateFilter = 'All' | 'Today' | 'Yesterday' | 'This Week' | 'This Month' | 'Last Month' | 'Custom';

const PAGE_SIZES = [10, 25, 50, 100];

function dateRangeFor(filter: DateFilter, customFrom: string, customTo: string): { from: string | null; to: string | null } {
  const today = todayISO();
  const now = new Date(today + 'T00:00:00');
  switch (filter) {
    case 'Today': return { from: today, to: today };
    case 'Yesterday': {
      const d = new Date(now); d.setDate(d.getDate() - 1);
      const s = d.toISOString().split('T')[0];
      return { from: s, to: s };
    }
    case 'This Week': {
      const d = new Date(now);
      const day = d.getDay();
      const diffToMonday = day === 0 ? 6 : day - 1;
      d.setDate(d.getDate() - diffToMonday);
      return { from: d.toISOString().split('T')[0], to: today };
    }
    case 'This Month': {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: d.toISOString().split('T')[0], to: today };
    }
    case 'Last Month': {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: from.toISOString().split('T')[0], to: to.toISOString().split('T')[0] };
    }
    case 'Custom': return { from: customFrom || null, to: customTo || null };
    default: return { from: null, to: null };
  }
}

interface TripRaw {
  id: string;
  trip_date: string;
  total_hours: number;
  total_amount: number;
  customer_id: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  vehicle: { registration_number: string } | null;
  driver: { name: string } | null;
  customer: { name: string } | null;
}
interface DieselRaw { vehicle_id: string | null; diesel_date: string; total_amount: number; }

interface GroupRow {
  key: string;
  date: string;
  vehicleId: string;
  vehicleNumber: string;
  drivers: string;
  customers: string;
  trips: number;
  workingHours: number;
  diesel: number;
  revenue: number;
}

export default function DailyVehicleReport() {
  const { show } = useToast();
  const { settings } = useSettings();

  const [trips, setTrips] = useState<TripRaw[]>([]);
  const [diesel, setDiesel] = useState<DieselRaw[]>([]);
  const [vehicles, setVehicles] = useState<{ id: string; registration_number: string }[]>([]);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [drivers, setDrivers] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const [vehicleId, setVehicleId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('This Month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const { from, to } = useMemo(() => dateRangeFor(dateFilter, customFrom, customTo), [dateFilter, customFrom, customTo]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const rangeFrom = from || '1970-01-01';
    const rangeTo = to || todayISO();
    const [tripRes, dieselRes, vehRes, custRes, empRes] = await Promise.all([
      supabase.from('trips').select('id, trip_date, total_hours, total_amount, customer_id, vehicle_id, driver_id, vehicle:vehicles(registration_number), driver:employees(name), customer:customers(name)').eq('is_cancelled', false).gte('trip_date', rangeFrom).lte('trip_date', rangeTo),
      supabase.from('diesel_entries').select('vehicle_id, diesel_date, total_amount').eq('is_cancelled', false).gte('diesel_date', rangeFrom).lte('diesel_date', rangeTo),
      supabase.from('vehicles').select('id,registration_number').eq('active', true).order('registration_number'),
      supabase.from('customers').select('id,name').eq('active', true).order('name'),
      supabase.from('employees').select('id,name').eq('active', true).in('role', ['Driver', 'Operator']).order('name'),
    ]);
    if (tripRes.error) { show('Unable to load trips: ' + tripRes.error.message, 'error'); setLoading(false); return; }
    setTrips((tripRes.data ?? []) as unknown as TripRaw[]);
    setDiesel((dieselRes.data ?? []) as DieselRaw[]);
    setVehicles((vehRes.data ?? []) as { id: string; registration_number: string }[]);
    setCustomers((custRes.data ?? []) as { id: string; name: string }[]);
    setDrivers((empRes.data ?? []) as { id: string; name: string }[]);
    setLoading(false);
  }, [show, from, to]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Group by (vehicle, date) — a vehicle can have multiple trips (and drivers/
  // customers) in one day, so those names are joined rather than picking just one.
  const groupedRows = useMemo(() => {
    const dieselByVehicleDate = new Map<string, number>();
    for (const d of diesel) {
      if (!d.vehicle_id) continue;
      const key = `${d.vehicle_id}|${d.diesel_date}`;
      dieselByVehicleDate.set(key, round2((dieselByVehicleDate.get(key) ?? 0) + Number(d.total_amount)));
    }

    const groups = new Map<string, GroupRow & { driverSet: Set<string>; customerSet: Set<string> }>();
    for (const t of trips) {
      if (!t.vehicle_id) continue;
      const key = `${t.vehicle_id}|${t.trip_date}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          key, date: t.trip_date, vehicleId: t.vehicle_id, vehicleNumber: t.vehicle?.registration_number ?? '-',
          drivers: '', customers: '', trips: 0, workingHours: 0, diesel: dieselByVehicleDate.get(key) ?? 0, revenue: 0,
          driverSet: new Set<string>(), customerSet: new Set<string>(),
        };
        groups.set(key, g);
      }
      g.trips += 1;
      g.workingHours = round2(g.workingHours + Number(t.total_hours));
      g.revenue = round2(g.revenue + Number(t.total_amount));
      if (t.driver?.name) g.driverSet.add(t.driver.name);
      if (t.customer?.name) g.customerSet.add(t.customer.name);
    }
    return Array.from(groups.values()).map(g => ({
      ...g, drivers: Array.from(g.driverSet).join(', ') || '-', customers: Array.from(g.customerSet).join(', ') || '-',
    })).sort((a, b) => b.date.localeCompare(a.date));
  }, [trips, diesel]);

  const filteredRows = useMemo(() => {
    let result = groupedRows;
    if (vehicleId) result = result.filter(r => r.vehicleId === vehicleId);
    if (customerId) {
      const name = customers.find(c => c.id === customerId)?.name ?? '';
      result = result.filter(r => r.customers.split(', ').includes(name));
    }
    if (driverId) {
      const name = drivers.find(d => d.id === driverId)?.name ?? '';
      result = result.filter(r => r.drivers.split(', ').includes(name));
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter(r => r.vehicleNumber.toLowerCase().includes(q));
    }
    return result;
  }, [groupedRows, vehicleId, customerId, driverId, search, customers, drivers]);

  const summary = useMemo(() => ({
    totalVehicles: new Set(filteredRows.map(r => r.vehicleId)).size,
    totalTrips: filteredRows.reduce((s, r) => s + r.trips, 0),
    totalHours: round2(filteredRows.reduce((s, r) => s + r.workingHours, 0)),
    totalDiesel: round2(filteredRows.reduce((s, r) => s + r.diesel, 0)),
    totalRevenue: round2(filteredRows.reduce((s, r) => s + r.revenue, 0)),
  }), [filteredRows]);

  useEffect(() => { setPage(1); }, [vehicleId, customerId, driverId, search, dateFilter, customFrom, customTo, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const clearFilters = () => {
    setVehicleId(''); setCustomerId(''); setDriverId(''); setSearch(''); setDateFilter('All'); setCustomFrom(''); setCustomTo('');
  };

  const filterStr = [
    vehicleId ? `Vehicle: ${vehicles.find(v => v.id === vehicleId)?.registration_number ?? ''}` : '',
    customerId ? `Customer: ${customers.find(c => c.id === customerId)?.name ?? ''}` : '',
    driverId ? `Driver: ${drivers.find(d => d.id === driverId)?.name ?? ''}` : '',
    search.trim() ? `Search: ${search.trim()}` : '',
  ].filter(Boolean).join(' | ');
  const dateRangeText = `${from || 'All'} - ${to || 'All'}`;

  function buildExportData() {
    const headers = ['SL', 'Date', 'Vehicle No', 'Driver', 'Customer', 'Trips', 'Working Hours', 'Diesel', 'Revenue'];
    const dataRows: (string | number)[][] = filteredRows.map((r, i) => [
      i + 1, formatDate(r.date), r.vehicleNumber, r.drivers, r.customers, r.trips, r.workingHours, r.diesel, r.revenue,
    ]);
    const totalRow = ['', '', '', '', 'Total', summary.totalTrips, summary.totalHours, summary.totalDiesel, summary.totalRevenue];
    return { headers, dataRows, totalRow };
  }

  function companyInfo() {
    return settings
      ? { company_name: settings.company_name, address: settings.address, phone: settings.phone, email: settings.email, gstin: settings.gstin, pan: settings.pan }
      : { company_name: 'Crane ERP' };
  }

  function handlePrint(orientation: 'portrait' | 'landscape' = 'landscape') {
    const { headers, dataRows, totalRow } = buildExportData();
    printReportWithCompany('Daily Vehicle Report', companyInfo(), dateRangeText, new Date().toLocaleString('en-IN'), filterStr, headers, dataRows, totalRow, orientation);
  }

  async function handleExportExcel() {
    const { headers, dataRows, totalRow } = buildExportData();
    await exportToXlsxWithCompany('Daily_Vehicle_Report.xlsx', 'Daily Vehicle Report', companyInfo(), dateRangeText, new Date().toLocaleString('en-IN'), filterStr, headers, dataRows, totalRow);
  }

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Truck className="w-5 h-5 text-blue-600" />Daily Vehicle Report</h2>
          <p className="text-sm text-slate-500">Vehicle-wise daily summary of trips, working hours, diesel and revenue.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => fetchAll()}><RefreshCw className="w-4 h-4" />Refresh</Button>
          <Button variant="outline" onClick={() => handlePrint('portrait')}><Printer className="w-4 h-4" />Print</Button>
          <Button variant="outline" onClick={() => handlePrint('landscape')}><FileText className="w-4 h-4" />Export PDF</Button>
          <Button variant="outline" onClick={handleExportExcel} disabled={filteredRows.length === 0}><FileSpreadsheet className="w-4 h-4" />Export Excel</Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1"><Truck className="w-4 h-4 text-slate-400" /><span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Vehicles</span></div>
          <p className="text-xl font-bold text-slate-800">{summary.totalVehicles}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1"><ListChecks className="w-4 h-4 text-blue-500" /><span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Trips</span></div>
          <p className="text-xl font-bold text-blue-600">{summary.totalTrips}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1"><Clock className="w-4 h-4 text-slate-500" /><span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Working Hours</span></div>
          <p className="text-xl font-bold text-slate-800">{summary.totalHours}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1"><Fuel className="w-4 h-4 text-amber-500" /><span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Diesel</span></div>
          <p className="text-xl font-bold text-amber-600">{formatCurrency(summary.totalDiesel)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1"><IndianRupee className="w-4 h-4 text-emerald-500" /><span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Revenue</span></div>
          <p className="text-xl font-bold text-emerald-600">{formatCurrency(summary.totalRevenue)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <select className={inputClass()} value={vehicleId} onChange={e => setVehicleId(e.target.value)}>
            <option value="">All Vehicles</option>
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.registration_number}</option>)}
          </select>
          <select className={inputClass()} value={customerId} onChange={e => setCustomerId(e.target.value)}>
            <option value="">All Customers</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className={inputClass()} value={driverId} onChange={e => setDriverId(e.target.value)}>
            <option value="">All Drivers</option>
            {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select className={inputClass()} value={dateFilter} onChange={e => setDateFilter(e.target.value as DateFilter)}>
            {(['All', 'Today', 'Yesterday', 'This Week', 'This Month', 'Last Month', 'Custom'] as DateFilter[]).map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input type="text" className={`${inputClass()} pl-9`} placeholder="Search Vehicle Number" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {dateFilter === 'Custom' && (
            <div className="grid grid-cols-2 gap-3">
              <DatePicker value={customFrom} onChange={setCustomFrom} placeholder="From Date" />
              <DatePicker value={customTo} onChange={setCustomTo} placeholder="To Date" />
            </div>
          )}
        </div>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={clearFilters}><X className="w-4 h-4" />Clear Filters</Button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {paginatedRows.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-400">No records found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-slate-100 bg-slate-50/90 backdrop-blur">
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">SL</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Vehicle No</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Driver</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Customer</th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Trips</th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Working Hours</th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Diesel</th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedRows.map((r, idx) => (
                  <tr key={r.key} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-sm text-slate-500 tabular-nums">{(currentPage - 1) * pageSize + idx + 1}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{formatDate(r.date)}</td>
                    <td className="px-4 py-3 text-sm font-medium text-blue-700 whitespace-nowrap">{r.vehicleNumber}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{r.drivers}</td>
                    <td className="px-4 py-3 text-sm text-slate-700 whitespace-nowrap">{r.customers}</td>
                    <td className="px-4 py-3 text-sm text-slate-700 text-right tabular-nums">{r.trips}</td>
                    <td className="px-4 py-3 text-sm text-slate-700 text-right tabular-nums whitespace-nowrap">{r.workingHours}</td>
                    <td className="px-4 py-3 text-sm text-amber-700 text-right tabular-nums whitespace-nowrap">{formatCurrency(r.diesel)}</td>
                    <td className="px-4 py-3 text-sm text-emerald-700 text-right tabular-nums whitespace-nowrap">{formatCurrency(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-semibold border-t-2 border-slate-200">
                  <td className="px-4 py-3 text-sm text-slate-700" colSpan={5}>Total</td>
                  <td className="px-4 py-3 text-sm text-slate-800 text-right tabular-nums">{summary.totalTrips}</td>
                  <td className="px-4 py-3 text-sm text-slate-800 text-right tabular-nums">{summary.totalHours}</td>
                  <td className="px-4 py-3 text-sm text-amber-700 text-right tabular-nums">{formatCurrency(summary.totalDiesel)}</td>
                  <td className="px-4 py-3 text-sm text-emerald-700 text-right tabular-nums">{formatCurrency(summary.totalRevenue)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {filteredRows.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 flex-wrap gap-2">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span>Rows per page:</span>
              <select className="border border-slate-200 rounded-md px-2 py-1 text-sm text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500" value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>
                {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <span className="ml-2">{((currentPage - 1) * pageSize) + 1}–{Math.min(currentPage * pageSize, filteredRows.length)} of {filteredRows.length}</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1} className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-slate-500 px-2">{currentPage} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages} className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
