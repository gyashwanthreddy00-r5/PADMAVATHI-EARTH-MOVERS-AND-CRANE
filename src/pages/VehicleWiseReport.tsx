import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useLang } from '@/context/LangContext';
import { useSettings } from '@/context/SettingsContext';
import { useToast } from '@/components/ui/Toast';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Button, Field, inputClass, LoadingSpinner, StatusBadge } from '@/components/ui/common';
import { Download, Printer, CheckSquare, Square } from 'lucide-react';
import { formatCurrency, formatDate, todayISO, vehicleTypeLabel, exportToExcelWithCompany } from '@/lib/utils';
import { getReportLogoUrl } from '@/lib/reportLogo';
import { DatePicker } from '@/components/ui/DatePicker';
import type { Vehicle, MonthlyContract, TripWithRelations, DieselWithRelations, MaintenanceWithRelations, InvoiceWithRelations, EmiWithRelations } from '@/types';

interface VehicleRow {
  id: string;
  vehicle: Vehicle;
  totalTrips: number;
  totalWorkingDays: number;
  totalMonthlyContracts: number;
  totalRevenue: number;
  totalDieselCost: number;
  totalMaintenanceCost: number;
  totalExpenses: number;
  netRevenue: number;
  emiPaid: number;
  currentStatus: string;
}

export default function VehicleWiseReport() {
  const { t } = useLang();
  const { settings } = useSettings();
  const { show } = useToast();
  const [loading, setLoading] = useState(true);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [trips, setTrips] = useState<TripWithRelations[]>([]);
  const [diesel, setDiesel] = useState<DieselWithRelations[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceWithRelations[]>([]);
  const [contracts, setContracts] = useState<MonthlyContract[]>([]);
  const [invoices, setInvoices] = useState<InvoiceWithRelations[]>([]);
  const [emiRecords, setEmiRecords] = useState<EmiWithRelations[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];

  const [filters, setFilters] = useState({
    from: defaultFrom,
    to: todayISO(),
    vehicle_id: '',
    vehicle_type: '',
    customer: '',
    booking_type: '',
    status: '',
  });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [vRes, tRes, dRes, mRes, cRes, iRes, emiRes] = await Promise.all([
      supabase.from('vehicles').select('*').order('registration_number'),
      supabase.from('trips').select('*, vehicle:vehicles(id,registration_number,model,type,capacity), driver:employees(id,name,role), customer:customers(id,name)').eq('is_cancelled', false).gte('trip_date', filters.from).lte('trip_date', filters.to),
      supabase.from('diesel_entries').select('*, vehicle:vehicles(id,registration_number,type)').eq('is_cancelled', false).gte('diesel_date', filters.from).lte('diesel_date', filters.to),
      supabase.from('maintenance').select('*, vehicle:vehicles(id,registration_number,type)').eq('is_cancelled', false).gte('maintenance_date', filters.from).lte('maintenance_date', filters.to),
      supabase.from('monthly_contracts').select('*'),
      supabase.from('invoices').select('*, customer:customers(id,name)').gte('invoice_date', filters.from).lte('invoice_date', filters.to),
      supabase.from('emi_records').select('*, vehicle:vehicles(id,registration_number)').gte('due_date', filters.from).lte('due_date', filters.to),
    ]);
    setVehicles((vRes.data ?? []) as Vehicle[]);
    setTrips((tRes.data ?? []) as TripWithRelations[]);
    setDiesel((dRes.data ?? []) as DieselWithRelations[]);
    setMaintenance((mRes.data ?? []) as MaintenanceWithRelations[]);
    setContracts((cRes.data ?? []) as MonthlyContract[]);
    setInvoices((iRes.data ?? []) as InvoiceWithRelations[]);
    setEmiRecords((emiRes.data ?? []) as EmiWithRelations[]);
    setLoading(false);
  }, [filters.from, filters.to]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const today = todayISO();

  const reportRows: VehicleRow[] = useMemo(() => {
    return vehicles
      .filter(v => !filters.vehicle_type || v.type === filters.vehicle_type)
      .filter(v => !filters.vehicle_id || v.id === filters.vehicle_id)
      .map(v => {
        const vTrips = trips.filter(tr => tr.vehicle_id === v.id);
        const vDiesel = diesel.filter(d => d.vehicle_id === v.id);
        const vMaint = maintenance.filter(m => m.vehicle_id === v.id);
        const vContracts = contracts.filter(c => c.vehicle_id === v.id);
        const vEmiPaid = emiRecords.filter(e => e.vehicle_id === v.id && e.status === 'Paid');
        const emiPaid = vEmiPaid.reduce((s, e) => s + Number(e.emi_amount), 0);

        let totalRevenue = vTrips.reduce((s, tr) => s + Number(tr.total_amount), 0);
        const totalWorkingDays = new Set(vTrips.map(tr => tr.trip_date)).size;
        const totalDieselCost = vDiesel.reduce((s, d) => s + Number(d.total_amount), 0);
        const totalMaintenanceCost = vMaint.reduce((s, m) => s + Number(m.amount), 0);
        const totalExpenses = totalDieselCost + totalMaintenanceCost;

        let totalMonthlyContracts = vContracts.length;
        if (filters.booking_type === 'Trip') totalMonthlyContracts = 0;
        if (filters.booking_type === 'Monthly Contract') {
          return {
            id: v.id, vehicle: v, totalTrips: 0, totalWorkingDays: 0, totalMonthlyContracts,
            totalRevenue: 0, totalDieselCost: 0, totalMaintenanceCost: 0, totalExpenses: 0, netRevenue: 0, emiPaid,
            currentStatus: vContracts.some(c => c.status === 'Active' && c.start_date <= today && (!c.end_date || c.end_date >= today)) ? 'Under Monthly Contract' : v.status,
          };
        }

        // Add monthly contract revenue from invoices
        const contractInvoices = invoices.filter(inv => inv.vehicle_id === v.id && inv.rate_type === 'Monthly');
        const contractRevenue = contractInvoices.reduce((s, inv) => s + (inv.discount_enabled ? Number(inv.final_payable_amount ?? inv.grand_total) : Number(inv.grand_total)), 0);
        totalRevenue += contractRevenue;

        if (filters.booking_type === 'Monthly Contract') totalRevenue = contractRevenue;

        const netRevenue = totalRevenue - totalExpenses;

        const activeContract = vContracts.find(c => c.status === 'Active' && c.start_date <= today && (!c.end_date || c.end_date >= today));
        const currentStatus = activeContract ? 'Under Monthly Contract' : v.status;

        return {
          id: v.id,
          vehicle: v,
          totalTrips: vTrips.length,
          totalWorkingDays,
          totalMonthlyContracts,
          totalRevenue,
          totalDieselCost,
          totalMaintenanceCost,
          totalExpenses,
          netRevenue,
          emiPaid,
          currentStatus,
        };
      })
      .filter(row => !filters.status || row.currentStatus === filters.status)
      .filter(row => {
        if (!filters.customer) return true;
        const vTrips = trips.filter(tr => tr.vehicle_id === row.id && tr.customer?.name?.toLowerCase().includes(filters.customer.toLowerCase()));
        const vContractInv = invoices.filter(inv => inv.vehicle_id === row.id && (inv.customer_name ?? inv.customer?.name ?? '').toLowerCase().includes(filters.customer.toLowerCase()));
        return vTrips.length > 0 || vContractInv.length > 0;
      });
  }, [vehicles, trips, diesel, maintenance, contracts, invoices, emiRecords, filters, today]);

  const totals = useMemo(() => ({
    trips: reportRows.reduce((s, r) => s + r.totalTrips, 0),
    revenue: reportRows.reduce((s, r) => s + r.totalRevenue, 0),
    diesel: reportRows.reduce((s, r) => s + r.totalDieselCost, 0),
    maintenance: reportRows.reduce((s, r) => s + r.totalMaintenanceCost, 0),
    expenses: reportRows.reduce((s, r) => s + r.totalExpenses, 0),
    net: reportRows.reduce((s, r) => s + r.netRevenue, 0),
  }), [reportRows]);

  const columns: Column<VehicleRow>[] = [
    { key: 'vehicle', header: t('vehicleNumber'), sortable: true, render: r => r.vehicle.registration_number },
    { key: 'type', header: t('type'), render: r => vehicleTypeLabel(r.vehicle.type, r.vehicle.tons ?? r.vehicle.capacity) },
    { key: 'totalTrips', header: 'Total Trips', align: 'right', sortable: true, render: r => r.totalTrips },
    { key: 'totalWorkingDays', header: 'Working Days', align: 'right', render: r => r.totalWorkingDays },
    { key: 'totalMonthlyContracts', header: 'Monthly Contracts', align: 'right', render: r => r.totalMonthlyContracts },
    { key: 'totalRevenue', header: t('totalRevenue'), align: 'right', sortable: true, render: r => formatCurrency(r.totalRevenue) },
    { key: 'totalDieselCost', header: t('diesel'), align: 'right', render: r => formatCurrency(r.totalDieselCost) },
    { key: 'totalMaintenanceCost', header: t('maintenanceCost'), align: 'right', render: r => formatCurrency(r.totalMaintenanceCost) },
    { key: 'totalExpenses', header: t('totalExpenses'), align: 'right', render: r => formatCurrency(r.totalExpenses) },
    { key: 'emiPaid', header: 'EMI Paid', align: 'right', render: r => formatCurrency(r.emiPaid) },
    { key: 'netRevenue', header: 'Net Revenue', align: 'right', sortable: true, render: r => <span className={r.netRevenue >= 0 ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>{formatCurrency(r.netRevenue)}</span> },
    { key: 'currentStatus', header: t('status'), align: 'center', render: r => <StatusBadge status={r.currentStatus} /> },
  ];

  const handleExport = () => {
    if (selectedIds.size === 0) { show('Please select at least one record to export.', 'error'); return; }
    const selected = reportRows.filter(r => selectedIds.has(r.id));
    const dateRange = `${formatDate(filters.from)} - ${formatDate(filters.to)}`;
    const companyInfo = settings ? { company_name: settings.company_name, address: settings.address, phone: settings.phone, email: settings.email, gstin: settings.gstin, pan: settings.pan } : { company_name: 'PADMAVATHI EARTH MOVERS AND CRANE SERVICES' };
    exportToExcelWithCompany(
      `Vehicle_Wise_Report_${filters.from}_${filters.to}.csv`, 'Vehicle-Wise Report', companyInfo, dateRange,
      new Date().toLocaleString('en-IN'), '',
      ['Vehicle Number', 'Type', 'Total Trips', 'Working Days', 'Monthly Contracts', 'Total Revenue', 'Diesel Cost', 'Maintenance Cost', 'Total Expenses', 'EMI Paid', 'Net Revenue', 'Status'],
      selected.map(r => [r.vehicle.registration_number, vehicleTypeLabel(r.vehicle.type, r.vehicle.tons ?? r.vehicle.capacity), r.totalTrips, r.totalWorkingDays, r.totalMonthlyContracts, r.totalRevenue, r.totalDieselCost, r.totalMaintenanceCost, r.totalExpenses, r.emiPaid, r.netRevenue, r.currentStatus]),
      ['TOTAL', '', selected.reduce((s, r) => s + r.totalTrips, 0), '', '', selected.reduce((s, r) => s + r.totalRevenue, 0), selected.reduce((s, r) => s + r.totalDieselCost, 0), selected.reduce((s, r) => s + r.totalMaintenanceCost, 0), selected.reduce((s, r) => s + r.totalExpenses, 0), selected.reduce((s, r) => s + r.emiPaid, 0), selected.reduce((s, r) => s + r.netRevenue, 0), ''],
    );
  };

  const handlePrint = () => {
    const win = window.open('', '_blank');
    if (!win) { show('Please allow popups to print', 'error'); return; }
    const html = `<!DOCTYPE html><html><head><title>Vehicle-Wise Report</title>
    <style>body{font-family:Arial,sans-serif;margin:20px}h1{text-align:center;color:#1e3a5f}h2{text-align:center;font-size:14px;color:#475569}
    table{width:100%;border-collapse:collapse;margin-top:10px}th{background:#1e3a5f;color:#fff;padding:8px;font-size:11px}
    td{padding:6px 8px;font-size:10px;border:1px solid #e2e8f0;text-align:left}
    .right{text-align:right}.center{text-align:center}.pos{color:#059669;font-weight:bold}.neg{color:#dc2626;font-weight:bold}
    .logo-block{display:flex;align-items:center;gap:12px;margin-bottom:8px}.logo-block img{width:48px;height:36px;object-fit:contain}
    </style></head><body>
    <div class="logo-block"><img src="${getReportLogoUrl()}" alt="logo"/><div><h1 style="margin:0">${settings?.company_name ?? 'PADMAVATHI EARTH MOVERS AND CRANE SERVICES'}</h1></div></div>
    <h2>Vehicle-Wise Report (${formatDate(filters.from)} — ${formatDate(filters.to)})</h2>
    <table><thead><tr>
    <th>Vehicle</th><th>Type</th><th>Trips</th><th>Days</th><th>Contracts</th><th>Revenue</th><th>Diesel</th><th>Maint.</th><th>Expenses</th><th>EMI Paid</th><th>Net</th><th>Status</th>
    </tr></thead><tbody>
    ${reportRows.map(r => `<tr>
    <td>${r.vehicle.registration_number}</td><td>${vehicleTypeLabel(r.vehicle.type, r.vehicle.tons ?? r.vehicle.capacity)}</td>
    <td class="center">${r.totalTrips}</td><td class="center">${r.totalWorkingDays}</td><td class="center">${r.totalMonthlyContracts}</td>
    <td class="right">${formatCurrency(r.totalRevenue)}</td><td class="right">${formatCurrency(r.totalDieselCost)}</td>
    <td class="right">${formatCurrency(r.totalMaintenanceCost)}</td><td class="right">${formatCurrency(r.totalExpenses)}</td>
    <td class="right">${formatCurrency(r.emiPaid)}</td>
    <td class="right ${r.netRevenue >= 0 ? 'pos' : 'neg'}">${formatCurrency(r.netRevenue)}</td><td class="center">${r.currentStatus}</td>
    </tr>`).join('')}
    </tbody><tfoot><tr style="background:#1e3a5f;color:#fff;font-weight:bold">
    <td colspan="2">TOTAL</td><td class="center">${totals.trips}</td><td></td><td></td>
    <td class="right">${formatCurrency(totals.revenue)}</td><td class="right">${formatCurrency(totals.diesel)}</td>
    <td class="right">${formatCurrency(totals.maintenance)}</td><td class="right">${formatCurrency(totals.expenses)}</td>
    <td class="right">${formatCurrency(reportRows.reduce((s, r) => s + r.emiPaid, 0))}</td>
    <td class="right">${formatCurrency(totals.net)}</td><td></td>
    </tr></tfoot></table>
    <script>window.onload=()=>window.print()</script>
    </body></html>`;
    win.document.write(html);
    win.document.close();
  };

  const selectAll = () => setSelectedIds(new Set(reportRows.map(r => r.id)));
  const deselectAll = () => setSelectedIds(new Set());

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Field label={t('from')}>
            <DatePicker value={filters.from} onChange={v => setFilters(f => ({ ...f, from: v }))} />
          </Field>
          <Field label={t('to')}>
            <DatePicker value={filters.to} onChange={v => setFilters(f => ({ ...f, to: v }))} />
          </Field>
          <Field label={t('vehicleNumber')}>
            <select className={inputClass()} value={filters.vehicle_id} onChange={e => setFilters(f => ({ ...f, vehicle_id: e.target.value }))}>
              <option value="">{t('all')}</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.registration_number}</option>)}
            </select>
          </Field>
          <Field label={t('vehicleType')}>
            <select className={inputClass()} value={filters.vehicle_type} onChange={e => setFilters(f => ({ ...f, vehicle_type: e.target.value }))}>
              <option value="">{t('all')}</option>
              <option value="Crane">Crane</option>
              <option value="JCB">JCB</option>
            </select>
          </Field>
          <Field label={t('customer')}>
            <input className={inputClass()} value={filters.customer} onChange={e => setFilters(f => ({ ...f, customer: e.target.value }))} placeholder="Search customer..." />
          </Field>
          <Field label="Booking Type">
            <select className={inputClass()} value={filters.booking_type} onChange={e => setFilters(f => ({ ...f, booking_type: e.target.value }))}>
              <option value="">{t('all')}</option>
              <option value="Trip">Trip</option>
              <option value="Monthly Contract">Monthly Contract</option>
            </select>
          </Field>
          <Field label={t('status')}>
            <select className={inputClass()} value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
              <option value="">{t('all')}</option>
              <option value="Available">Available</option>
              <option value="Working">Working</option>
              <option value="Maintenance">Maintenance</option>
              <option value="Under Monthly Contract">Under Monthly Contract</option>
              <option value="Inactive">Inactive</option>
            </select>
          </Field>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-sm">
          <p className="text-xs text-slate-500">Total Vehicles</p>
          <p className="text-lg font-bold text-slate-800">{reportRows.length}</p>
        </div>
        <div className="bg-white rounded-lg border border-emerald-200 p-3 shadow-sm">
          <p className="text-xs text-emerald-600">Total Revenue</p>
          <p className="text-lg font-bold text-emerald-700">{formatCurrency(totals.revenue)}</p>
        </div>
        <div className="bg-white rounded-lg border border-red-200 p-3 shadow-sm">
          <p className="text-xs text-red-600">Total Diesel</p>
          <p className="text-lg font-bold text-red-700">{formatCurrency(totals.diesel)}</p>
        </div>
        <div className="bg-white rounded-lg border border-amber-200 p-3 shadow-sm">
          <p className="text-xs text-amber-600">Maintenance</p>
          <p className="text-lg font-bold text-amber-700">{formatCurrency(totals.maintenance)}</p>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-sm">
          <p className="text-xs text-slate-500">Total Expenses</p>
          <p className="text-lg font-bold text-slate-800">{formatCurrency(totals.expenses)}</p>
        </div>
        <div className="bg-white rounded-lg border border-blue-200 p-3 shadow-sm">
          <p className="text-xs text-blue-600">Net Revenue</p>
          <p className={`text-lg font-bold ${totals.net >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatCurrency(totals.net)}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={selectAll} disabled={reportRows.length === 0}>
            <CheckSquare className="w-4 h-4" />Select All
          </Button>
          <Button variant="outline" size="sm" onClick={deselectAll} disabled={selectedIds.size === 0}>
            <Square className="w-4 h-4" />Deselect All
          </Button>
          {selectedIds.size > 0 && <span className="text-sm text-blue-700 font-medium py-1.5">{selectedIds.size} selected</span>}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handlePrint}><Printer className="w-4 h-4" />{t('print')}</Button>
          <Button variant="secondary" onClick={handleExport}><Download className="w-4 h-4" />{t('export')}</Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={reportRows}
        searchKeys={[]}
        selectable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        getRowId={r => r.id}
        pageSize={25}
        showSerialNumber
      />
    </div>
  );
}
