import { useState } from 'react';
import { Button } from '@/components/ui/common';
import { formatCurrency, formatDate, type ExportCompanyInfo } from '@/lib/utils';
import { Eye, FileSpreadsheet, FileDown, Printer, FileText } from 'lucide-react';
import type { SalesGstRow, GstMonthlySummary } from '@/lib/gstReporting';
import { exportSalesGstExcel, exportSalesGstCsv, printSalesGst, downloadInvoiceSummaryPdf } from '@/lib/gstExports';
import { useLang } from '@/context/LangContext';

interface Props {
  rows: SalesGstRow[];
  summary: GstMonthlySummary;
  monthLabel: string;
  company: ExportCompanyInfo;
}

export default function Gstr1({ rows, summary, monthLabel, company }: Props) {
  const { t } = useLang();
  const [preview, setPreview] = useState(false);
  const counted = rows.filter(r => r.isCounted);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <h3 className="text-base font-bold text-slate-800">{t('generateGstr1Data').replace('{month}', monthLabel)}</h3>
        <p className="text-sm text-slate-500 mt-1">
          {counted.length === 1 ? t('gstr1PrepNoteOne') : t('gstr1PrepNoteMany').replace('{count}', String(counted.length))}
          {' '}{t('gstr1ErpNote')}
        </p>
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <Button variant="outline" onClick={() => setPreview(p => !p)}><Eye className="w-4 h-4" />{preview ? t('hidePreviewLabel') : t('previewLabel')}</Button>
          <Button variant="outline" onClick={() => exportSalesGstExcel(rows, monthLabel, company)} disabled={rows.length === 0}><FileSpreadsheet className="w-4 h-4" />{t('export')}</Button>
          <Button variant="outline" onClick={() => exportSalesGstCsv(rows, monthLabel)}><FileDown className="w-4 h-4" />{t('exportCsv')}</Button>
          <Button variant="outline" onClick={() => printSalesGst(rows, monthLabel, company)}><Printer className="w-4 h-4" />{t('print')}</Button>
          <Button onClick={() => downloadInvoiceSummaryPdf(rows, summary, monthLabel, company)}><FileText className="w-4 h-4" />{t('downloadPdfSummary')}</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('taxableValue')}</span>
          <p className="text-lg font-bold text-slate-800 mt-1">{formatCurrency(summary.taxableSales)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('cgstSgst')}</span>
          <p className="text-lg font-bold text-slate-800 mt-1">{formatCurrency(summary.outputCgst + summary.outputSgst)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('igst')}</span>
          <p className="text-lg font-bold text-slate-800 mt-1">{formatCurrency(summary.outputIgst)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('totalInvoices')}</span>
          <p className="text-lg font-bold text-slate-800 mt-1">{counted.length}</p>
        </div>
      </div>

      {preview && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/90">
                  {[t('invoiceNo'), t('date'), t('customerLabel'), t('gstin'), t('taxableValue'), t('cgst'), t('sgst'), t('igst'), t('invoiceValue')].map(h => (
                    <th key={h} className="text-left px-3 py-2.5 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {counted.map(r => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 text-sm font-medium text-blue-700 whitespace-nowrap">{r.invoiceNumber}</td>
                    <td className="px-3 py-2 text-sm text-slate-600 whitespace-nowrap">{formatDate(r.invoiceDate)}</td>
                    <td className="px-3 py-2 text-sm text-slate-700 whitespace-nowrap">{r.customerName ?? '-'}</td>
                    <td className="px-3 py-2 text-sm text-slate-600 whitespace-nowrap">{r.customerGstin ?? '-'}</td>
                    <td className="px-3 py-2 text-sm text-right tabular-nums whitespace-nowrap">{formatCurrency(r.taxableValue)}</td>
                    <td className="px-3 py-2 text-sm text-right tabular-nums whitespace-nowrap">{formatCurrency(r.cgst)}</td>
                    <td className="px-3 py-2 text-sm text-right tabular-nums whitespace-nowrap">{formatCurrency(r.sgst)}</td>
                    <td className="px-3 py-2 text-sm text-right tabular-nums whitespace-nowrap">{formatCurrency(r.igst)}</td>
                    <td className="px-3 py-2 text-sm text-right tabular-nums font-medium whitespace-nowrap">{formatCurrency(r.invoiceValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
