import { useMemo, useState } from 'react';
import { Button, inputClass, StatusBadge } from '@/components/ui/common';
import { formatCurrency, formatDate, type ExportCompanyInfo } from '@/lib/utils';
import { Search, X, Printer, FileSpreadsheet, FileDown } from 'lucide-react';
import type { PurchaseGstRow } from '@/lib/gstReporting';
import { exportPurchaseGstExcel, exportPurchaseGstCsv, printPurchaseGst } from '@/lib/gstExports';

interface Props {
  rows: PurchaseGstRow[];
  monthLabel: string;
  company: ExportCompanyInfo;
}

type ItcFilter = 'All' | 'Eligible' | 'Not Eligible';
type PurchasePaymentStatusFilter = 'All' | PurchaseGstRow['paymentStatus'];

const PAYMENT_STATUS_VARIANT: Record<PurchaseGstRow['paymentStatus'], 'green' | 'red' | 'amber'> = {
  Paid: 'green', Pending: 'red', 'Partially Paid': 'amber',
};

export default function PurchaseGst({ rows, monthLabel, company }: Props) {
  const [vendor, setVendor] = useState('');
  const [billSearch, setBillSearch] = useState('');
  const [itcFilter, setItcFilter] = useState<ItcFilter>('All');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<PurchasePaymentStatusFilter>('All');

  const filtered = useMemo(() => {
    let r = rows;
    if (vendor.trim()) { const q = vendor.trim().toLowerCase(); r = r.filter(x => x.vendorName.toLowerCase().includes(q)); }
    if (billSearch.trim()) { const q = billSearch.trim().toLowerCase(); r = r.filter(x => (x.billNo ?? '').toLowerCase().includes(q)); }
    if (itcFilter !== 'All') r = r.filter(x => (x.itcEligible ? 'Eligible' : 'Not Eligible') === itcFilter);
    if (paymentStatusFilter !== 'All') r = r.filter(x => x.paymentStatus === paymentStatusFilter);
    return r;
  }, [rows, vendor, billSearch, itcFilter, paymentStatusFilter]);

  const totals = {
    taxable: filtered.reduce((s, r) => s + r.taxableAmount, 0),
    cgst: filtered.reduce((s, r) => s + r.cgst, 0),
    sgst: filtered.reduce((s, r) => s + r.sgst, 0),
    igst: filtered.reduce((s, r) => s + r.igst, 0),
    total: filtered.reduce((s, r) => s + r.totalAmount, 0),
    paid: filtered.reduce((s, r) => s + r.paidAmount, 0),
    balance: filtered.reduce((s, r) => s + r.balanceAmount, 0),
  };

  const clearFilters = () => { setVendor(''); setBillSearch(''); setItcFilter('All'); setPaymentStatusFilter('All'); };
  const hasUnspecifiedSplit = filtered.some(r => r.splitBasis === 'unspecified');

  return (
    <div className="space-y-4">
      {hasUnspecifiedSplit && (
        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Some rows below have an "UNSPECIFIED" GSTIN split - their CGST/SGST/IGST columns show 0 because the split can't be determined, but their full GST amount is still included in Net GST Payable on the Monthly Summary/Dashboard. See Error Check for the affected bills.
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => printPurchaseGst(filtered, monthLabel, company)}><Printer className="w-4 h-4" />Print</Button>
        <Button variant="outline" size="sm" onClick={() => exportPurchaseGstCsv(filtered, monthLabel)}><FileDown className="w-4 h-4" />Export CSV</Button>
        <Button variant="outline" size="sm" onClick={() => exportPurchaseGstExcel(filtered, monthLabel, company)} disabled={filtered.length === 0}><FileSpreadsheet className="w-4 h-4" />Export Excel</Button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input className={`${inputClass()} pl-9`} placeholder="Vendor" value={vendor} onChange={e => setVendor(e.target.value)} />
          </div>
          <input className={inputClass()} placeholder="Bill Number" value={billSearch} onChange={e => setBillSearch(e.target.value)} />
          <select className={inputClass()} value={itcFilter} onChange={e => setItcFilter(e.target.value as ItcFilter)}>
            <option value="All">ITC Eligible - All</option>
            <option value="Eligible">Eligible</option>
            <option value="Not Eligible">Not Eligible</option>
          </select>
          <select className={inputClass()} value={paymentStatusFilter} onChange={e => setPaymentStatusFilter(e.target.value as PurchasePaymentStatusFilter)}>
            <option value="All">Payment Status - All</option>
            <option value="Paid">Paid</option>
            <option value="Partially Paid">Partially Paid</option>
            <option value="Pending">Pending</option>
          </select>
          <div className="flex justify-end"><Button variant="secondary" size="sm" onClick={clearFilters}><X className="w-4 h-4" />Clear Filters</Button></div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-400">No purchases found for {monthLabel}.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/90">
                  {['Sl No', 'Vendor Name', 'Vendor GSTIN', 'Purchase Bill No', 'Bill Date', 'Taxable Amount', 'GST Rate', 'CGST', 'SGST', 'IGST', 'Total Amount', 'ITC Eligible', 'Payment Status', 'Paid Date', 'Paid Amount', 'Balance Amount', 'Payment Mode', 'Reference Number', 'Bank Account'].map(h => (
                    <th key={h} className="text-left px-3 py-2.5 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r, idx) => (
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-2.5 text-sm text-slate-500 tabular-nums">{idx + 1}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-700 whitespace-nowrap">{r.vendorName}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-600 whitespace-nowrap">
                      {r.vendorGstin ?? '-'}
                      {r.splitBasis === 'unspecified' && <span className="ml-1.5 text-[10px] font-semibold text-amber-600 align-middle">UNSPECIFIED</span>}
                    </td>
                    <td className="px-3 py-2.5 text-sm font-medium text-blue-700 whitespace-nowrap">{r.billNo ?? '-'}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-600 whitespace-nowrap">{formatDate(r.billDate)}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-800 text-right tabular-nums whitespace-nowrap">{formatCurrency(r.taxableAmount)}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-600 text-right tabular-nums whitespace-nowrap">{r.gstRatePercent}%</td>
                    <td className="px-3 py-2.5 text-sm text-slate-600 text-right tabular-nums whitespace-nowrap">{formatCurrency(r.cgst)}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-600 text-right tabular-nums whitespace-nowrap">{formatCurrency(r.sgst)}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-600 text-right tabular-nums whitespace-nowrap">{formatCurrency(r.igst)}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-800 text-right tabular-nums whitespace-nowrap">{formatCurrency(r.totalAmount)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <StatusBadge status={r.itcEligible ? 'Eligible' : 'Not Eligible'} variant={r.itcEligible ? 'green' : 'red'} />
                      {r.itcOverridden && <span className="ml-1.5 text-[10px] text-slate-400">(manual)</span>}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap"><StatusBadge status={r.paymentStatus} variant={PAYMENT_STATUS_VARIANT[r.paymentStatus]} /></td>
                    <td className="px-3 py-2.5 text-sm text-slate-600 whitespace-nowrap">{r.paidDate}</td>
                    <td className="px-3 py-2.5 text-sm text-emerald-700 text-right tabular-nums whitespace-nowrap">{formatCurrency(r.paidAmount)}</td>
                    <td className={`px-3 py-2.5 text-sm text-right tabular-nums whitespace-nowrap font-medium ${r.balanceAmount > 0 ? 'text-red-600' : 'text-slate-500'}`}>{formatCurrency(r.balanceAmount)}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-600 whitespace-nowrap">{r.paymentMode}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-600 whitespace-nowrap">{r.referenceNumber}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-600 whitespace-nowrap">{r.bankAccount}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-semibold border-t-2 border-slate-200">
                  <td className="px-3 py-2.5 text-sm text-slate-700" colSpan={5}>Total</td>
                  <td className="px-3 py-2.5 text-sm text-slate-800 text-right tabular-nums">{formatCurrency(totals.taxable)}</td>
                  <td></td>
                  <td className="px-3 py-2.5 text-sm text-slate-800 text-right tabular-nums">{formatCurrency(totals.cgst)}</td>
                  <td className="px-3 py-2.5 text-sm text-slate-800 text-right tabular-nums">{formatCurrency(totals.sgst)}</td>
                  <td className="px-3 py-2.5 text-sm text-slate-800 text-right tabular-nums">{formatCurrency(totals.igst)}</td>
                  <td className="px-3 py-2.5 text-sm text-slate-800 text-right tabular-nums">{formatCurrency(totals.total)}</td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td className="px-3 py-2.5 text-sm text-emerald-700 text-right tabular-nums">{formatCurrency(totals.paid)}</td>
                  <td className="px-3 py-2.5 text-sm text-red-600 text-right tabular-nums">{formatCurrency(totals.balance)}</td>
                  <td></td>
                  <td></td>
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
