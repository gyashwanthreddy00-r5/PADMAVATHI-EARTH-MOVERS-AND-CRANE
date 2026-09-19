import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { Button, Field, Modal, inputClass, StatusBadge } from '@/components/ui/common';
import { formatCurrency, formatDate, type ExportCompanyInfo } from '@/lib/utils';
import { Search, X, Printer, FileSpreadsheet, FileDown } from 'lucide-react';
import type { PurchaseGstRow } from '@/lib/gstReporting';
import { exportPurchaseGstExcel, exportPurchaseGstCsv, printPurchaseGst } from '@/lib/gstExports';
import { useLang } from '@/context/LangContext';

interface Props {
  rows: PurchaseGstRow[];
  monthLabel: string;
  company: ExportCompanyInfo;
  onRefresh: () => void;
}

type ItcFilter = 'All' | 'Eligible' | 'Not Eligible';
type PurchasePaymentStatusFilter = 'All' | PurchaseGstRow['paymentStatus'];

const PAYMENT_STATUS_VARIANT: Record<PurchaseGstRow['paymentStatus'], 'green' | 'red' | 'amber'> = {
  Paid: 'green', Pending: 'red', 'Partially Paid': 'amber',
};

export default function PurchaseGst({ rows, monthLabel, company, onRefresh }: Props) {
  const { user } = useAuth();
  const { show } = useToast();
  const { t } = useLang();
  const [vendor, setVendor] = useState('');
  const [billSearch, setBillSearch] = useState('');
  const [itcFilter, setItcFilter] = useState<ItcFilter>('All');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<PurchasePaymentStatusFilter>('All');

  const [overrideTarget, setOverrideTarget] = useState<PurchaseGstRow | null>(null);
  const [overrideEligible, setOverrideEligible] = useState(true);
  const [overrideReason, setOverrideReason] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);

  const openOverride = (row: PurchaseGstRow) => {
    setOverrideTarget(row);
    setOverrideEligible(row.itcEligible);
    setOverrideReason(row.itcReason ?? '');
  };

  const saveOverride = async () => {
    if (!overrideTarget) return;
    if (!overrideEligible && !overrideReason.trim()) {
      show(t('reasonRequiredNotEligible'), 'error');
      return;
    }
    setSavingOverride(true);
    const { error } = await supabase.from('gst_purchase_itc').upsert({
      purchase_id: overrideTarget.id,
      itc_eligible: overrideEligible,
      reason: overrideReason.trim() || null,
      set_by: user?.id ?? null,
      set_at: new Date().toISOString(),
    }, { onConflict: 'purchase_id' });
    setSavingOverride(false);
    if (error) { show(`${t('unableToSaveItcOverride')}: ${error.message}`, 'error'); return; }
    show(t('itcOverrideSaved'), 'success');
    setOverrideTarget(null);
    onRefresh();
  };

  const resetOverride = async () => {
    if (!overrideTarget) return;
    setSavingOverride(true);
    const { error } = await supabase.from('gst_purchase_itc').delete().eq('purchase_id', overrideTarget.id);
    setSavingOverride(false);
    if (error) { show(`${t('unableToResetItcOverride')}: ${error.message}`, 'error'); return; }
    show(t('itcResetToAutomatic'), 'success');
    setOverrideTarget(null);
    onRefresh();
  };

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
          {t('unspecifiedSplitNote')}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => printPurchaseGst(filtered, monthLabel, company)}><Printer className="w-4 h-4" />{t('print')}</Button>
        <Button variant="outline" size="sm" onClick={() => exportPurchaseGstCsv(filtered, monthLabel)}><FileDown className="w-4 h-4" />{t('exportCsv')}</Button>
        <Button variant="outline" size="sm" onClick={() => exportPurchaseGstExcel(filtered, monthLabel, company)} disabled={filtered.length === 0}><FileSpreadsheet className="w-4 h-4" />{t('export')}</Button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input className={`${inputClass()} pl-9`} placeholder={t('vendorLabel')} value={vendor} onChange={e => setVendor(e.target.value)} />
          </div>
          <input className={inputClass()} placeholder={t('billNumber')} value={billSearch} onChange={e => setBillSearch(e.target.value)} />
          <select className={inputClass()} value={itcFilter} onChange={e => setItcFilter(e.target.value as ItcFilter)}>
            <option value="All">{t('itcEligibleLabel')} - {t('all')}</option>
            <option value="Eligible">{t('eligible')}</option>
            <option value="Not Eligible">{t('notEligible')}</option>
          </select>
          <select className={inputClass()} value={paymentStatusFilter} onChange={e => setPaymentStatusFilter(e.target.value as PurchasePaymentStatusFilter)}>
            <option value="All">{t('paymentStatus')} - {t('all')}</option>
            <option value="Paid">{t('paid')}</option>
            <option value="Partially Paid">{t('partiallyPaid')}</option>
            <option value="Pending">{t('pending')}</option>
          </select>
          <div className="flex justify-end"><Button variant="secondary" size="sm" onClick={clearFilters}><X className="w-4 h-4" />{t('clearFilters')}</Button></div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-400">{t('noPurchasesFound').replace('{month}', monthLabel)}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/90">
                  {[t('slNo'), t('vendorName'), t('vendorGstin'), t('purchaseBillNo'), t('billDate'), t('taxableAmount'), t('gstRate'), t('cgst'), t('sgst'), t('igst'), t('totalAmount'), t('itcEligibleLabel'), t('paymentStatus'), t('paidDate'), t('paidAmount'), t('balanceAmount'), t('paymentMode'), t('referenceNumber'), t('bankAccount')].map(h => (
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
                      {r.splitBasis === 'unspecified' && <span className="ml-1.5 text-[10px] font-semibold text-amber-600 align-middle">{t('unspecifiedLabel')}</span>}
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
                      <button onClick={() => openOverride(r)} className="hover:opacity-75 transition-opacity" title={t('clickToOverrideItc')}>
                        <StatusBadge status={r.itcEligible ? 'Eligible' : 'Not Eligible'} variant={r.itcEligible ? 'green' : 'red'} />
                      </button>
                      {r.itcOverridden && <span className="ml-1.5 text-[10px] text-slate-400">{t('manualLabel')}</span>}
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
                  <td className="px-3 py-2.5 text-sm text-slate-700" colSpan={5}>{t('total')}</td>
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

      <Modal
        open={!!overrideTarget}
        onClose={() => setOverrideTarget(null)}
        title={t('overrideItcEligibility')}
        closeOnBackdropClick={false}
        footer={
          <div className="flex justify-between w-full">
            {overrideTarget?.itcOverridden ? (
              <Button variant="outline" onClick={resetOverride} disabled={savingOverride}>{t('resetToAutomatic')}</Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setOverrideTarget(null)}>{t('cancel')}</Button>
              <Button onClick={saveOverride} disabled={savingOverride}>{savingOverride ? t('saving') : t('save')}</Button>
            </div>
          </div>
        }
      >
        {overrideTarget && (
          <div className="space-y-4">
            <div className="p-3 bg-slate-50 rounded-lg text-sm">
              <p className="font-medium text-slate-800">{overrideTarget.vendorName}</p>
              <p className="text-slate-500">{overrideTarget.billNo ?? t('noBillNo')} - {formatDate(overrideTarget.billDate)} - {t('gstAmount')}: {formatCurrency(overrideTarget.gstAmount)}</p>
              <p className="text-xs text-slate-400 mt-1">{t('automaticDefaultEligible')}{overrideTarget.itcOverridden ? t('currentlyOverriddenBelow') : '.'}</p>
            </div>
            <Field label={t('itcEligibility')}>
              <select className={inputClass()} value={overrideEligible ? 'Eligible' : 'Not Eligible'} onChange={e => setOverrideEligible(e.target.value === 'Eligible')}>
                <option value="Eligible">{t('eligible')}</option>
                <option value="Not Eligible">{t('notEligible')}</option>
              </select>
            </Field>
            <Field label={t('reasonLabel')} required={!overrideEligible} hint={!overrideEligible ? t('reasonRequiredHint') : t('optionalLabel')}>
              <input
                className={inputClass()}
                value={overrideReason}
                onChange={e => setOverrideReason(e.target.value)}
                placeholder="e.g. Blocked credit under Sec 17(5), employee benefit, personal use..."
              />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
