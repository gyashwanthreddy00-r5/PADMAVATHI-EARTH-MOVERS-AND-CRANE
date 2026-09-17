import { useMemo, useState } from 'react';
import { Button, inputClass, StatusBadge } from '@/components/ui/common';
import { formatCurrency, formatDate, type ExportCompanyInfo } from '@/lib/utils';
import { Search, X, Printer, FileSpreadsheet, FileDown } from 'lucide-react';
import type { SalesGstRow } from '@/lib/gstReporting';
import { exportSalesGstExcel, exportSalesGstCsv, printSalesGst } from '@/lib/gstExports';

interface Props {
  rows: SalesGstRow[];
  monthLabel: string;
  company: ExportCompanyInfo;
}

type GstTypeFilter = 'All' | 'cgst_sgst' | 'igst' | 'no_tax';
type B2Filter = 'All' | 'B2B' | 'B2C';

const STATUS_VARIANT: Record<string, 'green' | 'red' | 'blue' | 'amber' | 'gray'> = {
  Paid: 'green', Pending: 'red', 'Partially Paid': 'amber', Generated: 'blue', Draft: 'gray', Cancelled: 'gray',
};

export default function SalesGst({ rows, monthLabel, company }: Props) {
  const [customer, setCustomer] = useState('');
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [gstinSearch, setGstinSearch] = useState('');
  const [gstType, setGstType] = useState<GstTypeFilter>('All');
  const [b2Filter, setB2Filter] = useState<B2Filter>('All');

  const filtered = useMemo(() => {
    let r = rows;
    if (customer.trim()) { const q = customer.trim().toLowerCase(); r = r.filter(x => (x.customerName ?? '').toLowerCase().includes(q)); }
    if (invoiceSearch.trim()) { const q = invoiceSearch.trim().toLowerCase(); r = r.filter(x => (x.invoiceNumber ?? '').toLowerCase().includes(q)); }
    if (gstinSearch.trim()) { const q = gstinSearch.trim().toLowerCase(); r = r.filter(x => (x.customerGstin ?? '').toLowerCase().includes(q)); }
    if (gstType !== 'All') r = r.filter(x => x.taxType === gstType);
    if (b2Filter !== 'All') r = r.filter(x => (x.b2b ? 'B2B' : 'B2C') === b2Filter);
    return r;
  }, [rows, customer, invoiceSearch, gstinSearch, gstType, b2Filter]);

  const counted = filtered.filter(r => r.isCounted);
  const totals = {
    invoiceValue: counted.reduce((s, r) => s + r.invoiceValue, 0),
    taxableValue: counted.reduce((s, r) => s + r.taxableValue, 0),
    cgst: counted.reduce((s, r) => s + r.cgst, 0),
    sgst: counted.reduce((s, r) => s + r.sgst, 0),
    igst: counted.reduce((s, r) => s + r.igst, 0),
  };

  const clearFilters = () => { setCustomer(''); setInvoiceSearch(''); setGstinSearch(''); setGstType('All'); setB2Filter('All'); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => printSalesGst(filtered, monthLabel, company)}><Printer className="w-4 h-4" />Print</Button>
        <Button variant="outline" size="sm" onClick={() => exportSalesGstCsv(filtered, monthLabel)}><FileDown className="w-4 h-4" />Export CSV</Button>
        <Button variant="outline" size="sm" onClick={() => exportSalesGstExcel(filtered, monthLabel, company)} disabled={filtered.length === 0}><FileSpreadsheet className="w-4 h-4" />Export Excel</Button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input className={`${inputClass()} pl-9`} placeholder="Customer" value={customer} onChange={e => setCustomer(e.target.value)} />
          </div>
          <input className={inputClass()} placeholder="Invoice Number" value={invoiceSearch} onChange={e => setInvoiceSearch(e.target.value)} />
          <input className={inputClass()} placeholder="GSTIN" value={gstinSearch} onChange={e => setGstinSearch(e.target.value)} />
          <select className={inputClass()} value={b2Filter} onChange={e => setB2Filter(e.target.value as B2Filter)}>
            <option value="All">B2B / B2C - All</option>
            <option value="B2B">B2B</option>
            <option value="B2C">B2C</option>
          </select>
          <select className={inputClass()} value={gstType} onChange={e => setGstType(e.target.value as GstTypeFilter)}>
            <option value="All">GST Type - All</option>
            <option value="cgst_sgst">CGST + SGST</option>
            <option value="igst">IGST</option>
            <option value="no_tax">No Tax</option>
          </select>
        </div>
        <div className="flex justify-end"><Button variant="secondary" size="sm" onClick={clearFilters}><X className="w-4 h-4" />Clear Filters</Button></div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-400">No GST sales invoices found for {monthLabel}.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/90">
                  {['Sl No', 'Invoice Number', 'Invoice Date', 'Customer Name', 'Customer GSTIN', 'Place of Supply', 'Invoice Value', 'Taxable Value', 'GST Rate', 'CGST', 'SGST', 'IGST', 'Status'].map(h => (
                    <th key={h} className="text-left px-3 py-2.5 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r, idx) => (
                  <tr key={r.id} className={`hover:bg-slate-50 transition-colors ${!r.isCounted ? 'opacity-50' : ''}`}>
                    <td className="px-3 py-2.5 text-sm text-slate-500 tabular-nums">{idx + 1}</td>
                    <td className="px-3 py-2.5 text-sm font-medium text-blue-700 whitespace-nowrap">{r.invoiceNumber ?? '-'}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-600 whitespace-nowrap">{formatDate(r.invoiceDate)}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-700 whitespace-nowrap">{r.customerName ?? '-'}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-600 whitespace-nowrap">{r.customerGstin ?? '-'}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-600 whitespace-nowrap">{r.placeOfSupply ?? '-'}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-800 text-right tabular-nums whitespace-nowrap">{formatCurrency(r.invoiceValue)}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-800 text-right tabular-nums whitespace-nowrap">{formatCurrency(r.taxableValue)}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-600 text-right tabular-nums whitespace-nowrap">{r.gstRatePercent}%</td>
                    <td className="px-3 py-2.5 text-sm text-slate-600 text-right tabular-nums whitespace-nowrap">{formatCurrency(r.cgst)}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-600 text-right tabular-nums whitespace-nowrap">{formatCurrency(r.sgst)}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-600 text-right tabular-nums whitespace-nowrap">{formatCurrency(r.igst)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap"><StatusBadge status={r.status} variant={STATUS_VARIANT[r.status]} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-semibold border-t-2 border-slate-200">
                  <td className="px-3 py-2.5 text-sm text-slate-700" colSpan={6}>Total (excludes cancelled / unnumbered)</td>
                  <td className="px-3 py-2.5 text-sm text-slate-800 text-right tabular-nums">{formatCurrency(totals.invoiceValue)}</td>
                  <td className="px-3 py-2.5 text-sm text-slate-800 text-right tabular-nums">{formatCurrency(totals.taxableValue)}</td>
                  <td></td>
                  <td className="px-3 py-2.5 text-sm text-slate-800 text-right tabular-nums">{formatCurrency(totals.cgst)}</td>
                  <td className="px-3 py-2.5 text-sm text-slate-800 text-right tabular-nums">{formatCurrency(totals.sgst)}</td>
                  <td className="px-3 py-2.5 text-sm text-slate-800 text-right tabular-nums">{formatCurrency(totals.igst)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
