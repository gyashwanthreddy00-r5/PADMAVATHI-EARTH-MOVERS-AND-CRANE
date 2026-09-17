import { formatCurrency } from '@/lib/utils';
import type { GstMonthlySummary } from '@/lib/gstReporting';

interface Props {
  summary: GstMonthlySummary;
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={`flex justify-between py-2 px-1 ${bold ? 'font-bold text-slate-800' : 'text-slate-600'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{formatCurrency(value)}</span>
    </div>
  );
}

export default function MonthlySummary({ summary }: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-2 pb-2 border-b border-slate-100">Output GST</h3>
        <Row label="CGST" value={summary.outputCgst} />
        <Row label="SGST" value={summary.outputSgst} />
        <Row label="IGST" value={summary.outputIgst} />
        <div className="border-t border-slate-200 mt-1"><Row label="Total Output GST" value={summary.totalOutputGst} bold /></div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-2 pb-2 border-b border-slate-100">Input GST / ITC</h3>
        <Row label="CGST" value={summary.inputCgst} />
        <Row label="SGST" value={summary.inputSgst} />
        <Row label="IGST" value={summary.inputIgst} />
        <div className="border-t border-slate-200 mt-1"><Row label="Total Input GST" value={summary.totalInputGst} bold /></div>
      </div>

      <div className="bg-white rounded-xl border border-blue-200 bg-blue-50/40 shadow-sm p-4">
        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-2 pb-2 border-b border-blue-100">Summary</h3>
        <Row label="Output GST" value={summary.totalOutputGst} />
        <Row label="Less: Eligible ITC" value={-summary.totalInputGst} />
        <div className="border-t border-blue-200 mt-1"><Row label="Net GST Payable" value={summary.netGstPayable} bold /></div>
      </div>
    </div>
  );
}
