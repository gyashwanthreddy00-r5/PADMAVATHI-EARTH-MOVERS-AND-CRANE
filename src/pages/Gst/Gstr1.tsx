import { useState } from 'react';
import { Button } from '@/components/ui/common';
import { formatCurrency, formatDate, type ExportCompanyInfo } from '@/lib/utils';
import { Eye, FileSpreadsheet, FileDown, Printer, FileText } from 'lucide-react';
import type { SalesGstRow, GstMonthlySummary } from '@/lib/gstReporting';
import { exportSalesGstExcel, exportSalesGstCsv, printSalesGst, downloadInvoiceSummaryPdf } from '@/lib/gstExports';

interface Props {
  rows: SalesGstRow[];
  summary: GstMonthlySummary;
  monthLabel: string;
  company: ExportCompanyInfo;
}

export default function Gstr1({ rows, summary, monthLabel, company }: Props) {
  const [preview, setPreview] = useState(false);
  const counted = rows.filter(r => r.isCounted);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <h3 className="text-base font-bold text-slate-800">Generate GSTR-1 Data - {monthLabel}</h3>
        <p className="text-sm text-slate-500 mt-1">
          A preparation export for your GST agent, built from the {counted.length} GST sales invoice{counted.length === 1 ? '' : 's'}
          {' '}already recorded in GST Billing this month. The ERP does not file GSTR-1 - your GST agent takes this data and completes filing.
        </p>
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <Button variant="outline" onClick={() => setPreview(p => !p)}><Eye className="w-4 h-4" />{preview ? 'Hide Preview' : 'Preview'}</Button>
          <Button variant="outline" onClick={() => exportSalesGstExcel(rows, monthLabel, company)} disabled={rows.length === 0}><FileSpreadsheet className="w-4 h-4" />Export Excel</Button>
          <Button variant="outline" onClick={() => exportSalesGstCsv(rows, monthLabel)}><FileDown className="w-4 h-4" />Export CSV</Button>
          <Button variant="outline" onClick={() => printSalesGst(rows, monthLabel, company)}><Printer className="w-4 h-4" />Print</Button>
          <Button onClick={() => downloadInvoiceSummaryPdf(rows, summary, monthLabel, company)}><FileText className="w-4 h-4" />Download PDF Summary</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Taxable Value</span>
          <p className="text-lg font-bold text-slate-800 mt-1">{formatCurrency(summary.taxableSales)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">CGST + SGST</span>
          <p className="text-lg font-bold text-slate-800 mt-1">{formatCurrency(summary.outputCgst + summary.outputSgst)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">IGST</span>
          <p className="text-lg font-bold text-slate-800 mt-1">{formatCurrency(summary.outputIgst)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Invoices</span>
          <p className="text-lg font-bold text-slate-800 mt-1">{counted.length}</p>
        </div>
      </div>

      {preview && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/90">
                  {['Invoice No', 'Date', 'Customer', 'GSTIN', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Invoice Value'].map(h => (
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
