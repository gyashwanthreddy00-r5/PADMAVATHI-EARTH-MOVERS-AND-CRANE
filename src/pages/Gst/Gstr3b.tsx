import { useEffect, useState } from 'react';
import { Button, Field, inputClass } from '@/components/ui/common';
import { formatCurrency, type ExportCompanyInfo } from '@/lib/utils';
import { FileSpreadsheet, Save } from 'lucide-react';
import type { GstMonthlySummary } from '@/lib/gstReporting';
import { exportGstr3bExcel, type GstManualAdjustments } from '@/lib/gstExports';

interface Props {
  summary: GstMonthlySummary;
  adjustments: GstManualAdjustments;
  onSave: (next: GstManualAdjustments) => Promise<void>;
  saving: boolean;
  monthLabel: string;
  company: ExportCompanyInfo;
}

function Row({ label, cgst, sgst, igst, total }: { label: string; cgst?: number; sgst?: number; igst?: number; total: number }) {
  return (
    <tr className="border-b border-slate-100">
      <td className="px-3 py-2 text-sm text-slate-700">{label}</td>
      <td className="px-3 py-2 text-sm text-right tabular-nums">{cgst != null ? formatCurrency(cgst) : '-'}</td>
      <td className="px-3 py-2 text-sm text-right tabular-nums">{sgst != null ? formatCurrency(sgst) : '-'}</td>
      <td className="px-3 py-2 text-sm text-right tabular-nums">{igst != null ? formatCurrency(igst) : '-'}</td>
      <td className="px-3 py-2 text-sm text-right tabular-nums font-semibold">{formatCurrency(total)}</td>
    </tr>
  );
}

export default function Gstr3b({ summary, adjustments, onSave, saving, monthLabel, company }: Props) {
  const [form, setForm] = useState<GstManualAdjustments>(adjustments);
  useEffect(() => { setForm(adjustments); }, [adjustments]);

  const dirty = JSON.stringify(form) !== JSON.stringify(adjustments);
  const setField = (key: keyof GstManualAdjustments, value: string) => setForm(f => ({ ...f, [key]: Number(value) || 0 }));

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => exportGstr3bExcel(summary, adjustments, monthLabel, company)}><FileSpreadsheet className="w-4 h-4" />Export Excel</Button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <h3 className="px-4 pt-4 text-sm font-bold text-slate-700 uppercase tracking-wider">Outward Supplies</h3>
        <table className="w-full mt-2">
          <thead><tr className="bg-slate-50/90"><th className="text-left px-3 py-2 text-xs font-bold text-slate-500 uppercase">Field</th><th className="text-right px-3 py-2 text-xs font-bold text-slate-500 uppercase">CGST</th><th className="text-right px-3 py-2 text-xs font-bold text-slate-500 uppercase">SGST</th><th className="text-right px-3 py-2 text-xs font-bold text-slate-500 uppercase">IGST</th><th className="text-right px-3 py-2 text-xs font-bold text-slate-500 uppercase">Amount</th></tr></thead>
          <tbody>
            <Row label="Taxable Value" total={summary.taxableSales} />
            <Row label="GST" cgst={summary.outputCgst} sgst={summary.outputSgst} igst={summary.outputIgst} total={summary.totalOutputGst} />
          </tbody>
        </table>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <h3 className="px-4 pt-4 text-sm font-bold text-slate-700 uppercase tracking-wider">Input Tax Credit</h3>
        <table className="w-full mt-2">
          <thead><tr className="bg-slate-50/90"><th className="text-left px-3 py-2 text-xs font-bold text-slate-500 uppercase">Field</th><th className="text-right px-3 py-2 text-xs font-bold text-slate-500 uppercase">CGST</th><th className="text-right px-3 py-2 text-xs font-bold text-slate-500 uppercase">SGST</th><th className="text-right px-3 py-2 text-xs font-bold text-slate-500 uppercase">IGST</th><th className="text-right px-3 py-2 text-xs font-bold text-slate-500 uppercase">Amount</th></tr></thead>
          <tbody>
            <Row label="Eligible ITC" cgst={summary.inputCgst} sgst={summary.inputSgst} igst={summary.inputIgst} total={summary.totalInputGst} />
          </tbody>
        </table>
      </div>

      <div className="bg-amber-50/50 rounded-xl border border-amber-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Other Information</h3>
            <p className="text-xs text-amber-700 mt-0.5">Manually Entered - the ERP has no source data for these fields. Enter values only if applicable.</p>
          </div>
          <Button size="sm" onClick={() => onSave(form)} disabled={!dirty || saving}><Save className="w-3.5 h-3.5" />{saving ? 'Saving...' : 'Save'}</Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="Reverse Charge" hint="Manually Entered">
            <input type="number" step="0.01" className={inputClass()} value={form.reverse_charge_amount} onChange={e => setField('reverse_charge_amount', e.target.value)} />
          </Field>
          <Field label="Exempt / Nil / Non-GST" hint="Manually Entered">
            <input type="number" step="0.01" className={inputClass()} value={form.exempt_nil_nongst_amount} onChange={e => setField('exempt_nil_nongst_amount', e.target.value)} />
          </Field>
          <Field label="Interest" hint="Manually Entered">
            <input type="number" step="0.01" className={inputClass()} value={form.interest_amount} onChange={e => setField('interest_amount', e.target.value)} />
          </Field>
          <Field label="Late Fee" hint="Manually Entered">
            <input type="number" step="0.01" className={inputClass()} value={form.late_fee_amount} onChange={e => setField('late_fee_amount', e.target.value)} />
          </Field>
        </div>
      </div>
    </div>
  );
}
