import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { buildXlsxWithCompany, exportToXlsxWithCompany } from '@/lib/exportXlsx';
import { printReportWithCompany } from '@/lib/printReport';
import { formatCurrency, formatDate, type ExportCompanyInfo } from '@/lib/utils';
import type { SalesGstRow, PurchaseGstRow, GstMonthlySummary, GstIssue } from '@/lib/gstReporting';

// Export helpers for the GST module. All of these only read the rows/summary
// already computed by gstReporting.ts and produce a file - none of them
// write anything back to the database.

export interface GstManualAdjustments {
  reverse_charge_amount: number;
  exempt_nil_nongst_amount: number;
  interest_amount: number;
  late_fee_amount: number;
}

const EMPTY_ADJUSTMENTS: GstManualAdjustments = {
  reverse_charge_amount: 0, exempt_nil_nongst_amount: 0, interest_amount: 0, late_fee_amount: 0,
};

function salesHeaders(): string[] {
  return ['Sl No', 'Invoice Number', 'Invoice Date', 'Customer Name', 'Customer GSTIN', 'Place of Supply', 'B2B/B2C', 'Invoice Value', 'Taxable Value', 'GST Rate %', 'CGST', 'SGST', 'IGST', 'Payment Status', 'Received Date', 'Received Amount', 'Balance Amount'];
}
function salesDataRows(rows: SalesGstRow[]): (string | number)[][] {
  return rows.map((r, i) => [
    i + 1, r.invoiceNumber ?? '-', formatDate(r.invoiceDate), r.customerName ?? '-', r.customerGstin ?? '-',
    r.placeOfSupply ?? '-', r.b2b ? 'B2B' : 'B2C', r.invoiceValue, r.taxableValue, r.gstRatePercent, r.cgst, r.sgst, r.igst,
    r.paymentStatus, r.receivedDate, r.receivedAmount, r.balanceAmount,
  ]);
}
function salesTotalRow(rows: SalesGstRow[]): (string | number)[] {
  const counted = rows.filter(r => r.isCounted);
  return ['', '', '', '', '', '', 'Total', sum(counted, 'invoiceValue'), sum(counted, 'taxableValue'), '', sum(counted, 'cgst'), sum(counted, 'sgst'), sum(counted, 'igst'), '', '', sum(counted, 'receivedAmount'), sum(counted, 'balanceAmount')];
}

function purchaseHeaders(): string[] {
  return ['Sl No', 'Vendor Name', 'Vendor GSTIN', 'Bill Number', 'Bill Date', 'Taxable Amount', 'GST Rate %', 'CGST', 'SGST', 'IGST', 'Total Amount', 'ITC Eligible', 'ITC Not Eligible', 'Payment Status', 'Paid Date', 'Paid Amount', 'Balance Amount', 'Payment Mode', 'Reference Number', 'Bank Account'];
}
function purchaseDataRows(rows: PurchaseGstRow[]): (string | number)[][] {
  return rows.map((r, i) => [
    i + 1, r.vendorName, r.vendorGstin ?? '-', r.billNo ?? '-', formatDate(r.billDate), r.taxableAmount, r.gstRatePercent,
    r.cgst, r.sgst, r.igst, r.totalAmount, r.itcEligible ? 'Yes' : '-', r.itcEligible ? '-' : 'Yes',
    r.paymentStatus, r.paidDate, r.paidAmount, r.balanceAmount, r.paymentMode, r.referenceNumber, r.bankAccount,
  ]);
}
function purchaseTotalRow(rows: PurchaseGstRow[]): (string | number)[] {
  return ['', '', '', '', 'Total', sum(rows, 'taxableAmount'), '', sum(rows, 'cgst'), sum(rows, 'sgst'), sum(rows, 'igst'), sum(rows, 'totalAmount'), '', '', '', '', sum(rows, 'paidAmount'), sum(rows, 'balanceAmount'), '', '', ''];
}

function sum<T>(rows: T[], key: keyof T): number {
  return round2(rows.reduce((s, r) => s + (Number(r[key]) || 0), 0));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function summaryHeaders(): string[] { return ['Particulars', 'CGST', 'SGST', 'IGST', 'Total']; }
function summaryDataRows(s: GstMonthlySummary): (string | number)[][] {
  return [
    ['Output GST (Sales)', s.outputCgst, s.outputSgst, s.outputIgst, s.totalOutputGst],
    ['Input GST / ITC (Purchase, eligible only)', s.inputCgst, s.inputSgst, s.inputIgst, s.totalInputGst],
    ['Net GST Payable', '', '', '', round2(s.totalOutputGst - s.totalInputGst)],
  ];
}

function errorHeaders(): string[] { return ['Severity', 'Source', 'Reference', 'Issue']; }
function errorDataRows(issues: GstIssue[]): (string | number)[][] {
  return issues.map(i => [i.severity, i.source, i.reference, i.message]);
}

function gstr3bHeaders(): string[] { return ['Section', 'Field', 'CGST', 'SGST', 'IGST', 'Amount', 'Source']; }
function gstr3bDataRows(s: GstMonthlySummary, adj: GstManualAdjustments): (string | number)[][] {
  return [
    ['Outward Supplies', 'Taxable Value', '', '', '', s.taxableSales, 'ERP'],
    ['Outward Supplies', 'GST', s.outputCgst, s.outputSgst, s.outputIgst, s.totalOutputGst, 'ERP'],
    ['Input Tax Credit', 'Eligible ITC', s.inputCgst, s.inputSgst, s.inputIgst, s.totalInputGst, 'ERP'],
    ['Other Information', 'Reverse Charge', '', '', '', adj.reverse_charge_amount, 'Manually Entered'],
    ['Other Information', 'Exempt / Nil / Non-GST', '', '', '', adj.exempt_nil_nongst_amount, 'Manually Entered'],
    ['Other Information', 'Interest', '', '', '', adj.interest_amount, 'Manually Entered'],
    ['Other Information', 'Late Fee', '', '', '', adj.late_fee_amount, 'Manually Entered'],
  ];
}

// ------------------------------------------------------------
// Individual exports (buttons on each tab)
// ------------------------------------------------------------

export async function exportSalesGstExcel(rows: SalesGstRow[], monthLabel: string, company: ExportCompanyInfo) {
  await exportToXlsxWithCompany(`GSTR-1_Sales_${monthLabel.replace(/\s+/g, '_')}.xlsx`, `Sales GST / GSTR-1 - ${monthLabel}`, company, monthLabel, new Date().toLocaleString('en-IN'), '', salesHeaders(), salesDataRows(rows), salesTotalRow(rows));
}

export function printSalesGst(rows: SalesGstRow[], monthLabel: string, company: ExportCompanyInfo) {
  printReportWithCompany(`Sales GST / GSTR-1 - ${monthLabel}`, company, monthLabel, new Date().toLocaleString('en-IN'), '', salesHeaders(), salesDataRows(rows), salesTotalRow(rows), 'landscape');
}

export function exportSalesGstCsv(rows: SalesGstRow[], monthLabel: string) {
  downloadCsv(`GSTR-1_Sales_${monthLabel.replace(/\s+/g, '_')}.csv`, salesHeaders(), salesDataRows(rows));
}

export async function exportPurchaseGstExcel(rows: PurchaseGstRow[], monthLabel: string, company: ExportCompanyInfo) {
  await exportToXlsxWithCompany(`Purchase_ITC_${monthLabel.replace(/\s+/g, '_')}.xlsx`, `Purchase GST / ITC - ${monthLabel}`, company, monthLabel, new Date().toLocaleString('en-IN'), '', purchaseHeaders(), purchaseDataRows(rows), purchaseTotalRow(rows));
}

export function printPurchaseGst(rows: PurchaseGstRow[], monthLabel: string, company: ExportCompanyInfo) {
  printReportWithCompany(`Purchase GST / ITC - ${monthLabel}`, company, monthLabel, new Date().toLocaleString('en-IN'), '', purchaseHeaders(), purchaseDataRows(rows), purchaseTotalRow(rows), 'landscape');
}

export function exportPurchaseGstCsv(rows: PurchaseGstRow[], monthLabel: string) {
  downloadCsv(`Purchase_ITC_${monthLabel.replace(/\s+/g, '_')}.csv`, purchaseHeaders(), purchaseDataRows(rows));
}

export async function exportGstSummaryExcel(summary: GstMonthlySummary, monthLabel: string, company: ExportCompanyInfo) {
  await exportToXlsxWithCompany(`GST_Summary_${monthLabel.replace(/\s+/g, '_')}.xlsx`, `Monthly GST Summary - ${monthLabel}`, company, monthLabel, new Date().toLocaleString('en-IN'), '', summaryHeaders(), summaryDataRows(summary));
}

export async function exportGstr3bExcel(summary: GstMonthlySummary, adjustments: GstManualAdjustments, monthLabel: string, company: ExportCompanyInfo) {
  await exportToXlsxWithCompany(`GSTR-3B_Summary_${monthLabel.replace(/\s+/g, '_')}.xlsx`, `GSTR-3B Summary - ${monthLabel}`, company, monthLabel, new Date().toLocaleString('en-IN'), '', gstr3bHeaders(), gstr3bDataRows(summary, adjustments));
}

export async function exportGstErrorsExcel(issues: GstIssue[], monthLabel: string, company: ExportCompanyInfo) {
  await exportToXlsxWithCompany(`GST_Errors_${monthLabel.replace(/\s+/g, '_')}.xlsx`, `GST Error Check - ${monthLabel}`, company, monthLabel, new Date().toLocaleString('en-IN'), '', errorHeaders(), errorDataRows(issues));
}

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escapeCell = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers, ...rows].map(r => r.map(escapeCell).join(','));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------
// GSTR-1 preparation PDF summary (also used inside the Agent Pack)
// ------------------------------------------------------------

// jsPDF's built-in fonts (Helvetica) have no glyph for '₹' (Rupee sign) - it
// silently renders as a broken/missing character. All amounts drawn natively via
// jsPDF (this file only - HTML-based exports like printReport.ts are unaffected)
// use a plain "Rs." prefix instead, with proper Indian comma grouping and fixed
// 2-decimal precision (also fixes raw floating-point values like 44197.46000000001
// showing up verbatim when a number was previously passed through String()).
function pdfCurrency(n: number): string {
  return 'Rs. ' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Sales row shape (see salesHeaders/salesDataRows/salesTotalRow above): amount
// columns that need pdfCurrency formatting for the PDF specifically. Excel/CSV/Print
// exports keep raw numbers or their own formatting and are untouched by this.
const SALES_AMOUNT_COLUMNS = new Set([7, 8, 10, 11, 12, 15, 16]);

function formatSalesRowForPdf(row: (string | number)[]): string[] {
  return row.map((v, i) => (SALES_AMOUNT_COLUMNS.has(i) && v !== '' ? pdfCurrency(Number(v)) : String(v)));
}

// autoTable's `columnStyles` only reliably right-aligns body/foot cells - header
// cells need the halign set directly on each head cell object, otherwise the
// header text stays left-aligned while the values below it sit at the right
// edge of the same (wide) column, reading as misaligned.
function rightAlignedHeadRow(headers: string[], rightAlignedIndexes: Set<number>): ({ content: string; styles: { halign: 'right' } } | string)[] {
  return headers.map((h, i) => (rightAlignedIndexes.has(i) ? { content: h, styles: { halign: 'right' as const } } : h));
}

function buildInvoiceSummaryPdf(rows: SalesGstRow[], summary: GstMonthlySummary, monthLabel: string, company: ExportCompanyInfo): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setFontSize(14);
  doc.text(company.company_name, 14, 15);
  doc.setFontSize(9);
  doc.text([company.address ?? '', company.gstin ? `GSTIN: ${company.gstin}` : ''].filter(Boolean).join('  |  '), 14, 21);
  doc.setFontSize(12);
  doc.text(`GST Invoice Summary - ${monthLabel}`, 14, 29);

  const amountColumnStyles = Object.fromEntries([...SALES_AMOUNT_COLUMNS].map(i => [i, { halign: 'right' as const }]));

  autoTable(doc, {
    startY: 34,
    head: [rightAlignedHeadRow(salesHeaders(), SALES_AMOUNT_COLUMNS)],
    body: salesDataRows(rows).map(formatSalesRowForPdf),
    foot: [formatSalesRowForPdf(salesTotalRow(rows))],
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [217, 234, 247], textColor: [20, 20, 20] },
    footStyles: { fillColor: [226, 240, 217], textColor: [20, 20, 20], fontStyle: 'bold' },
    columnStyles: amountColumnStyles,
  });

  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  doc.setFontSize(10);
  doc.text('Monthly GST Summary', 14, finalY);
  autoTable(doc, {
    startY: finalY + 3,
    head: [rightAlignedHeadRow(['Particulars', 'CGST', 'SGST', 'IGST', 'Total'], new Set([1, 2, 3, 4]))],
    body: summaryDataRows(summary).map(r => r.map(v => typeof v === 'number' ? pdfCurrency(v) : String(v))),
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: [217, 234, 247], textColor: [20, 20, 20] },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
  });

  return doc;
}

export function downloadInvoiceSummaryPdf(rows: SalesGstRow[], summary: GstMonthlySummary, monthLabel: string, company: ExportCompanyInfo) {
  const doc = buildInvoiceSummaryPdf(rows, summary, monthLabel, company);
  doc.save(`Invoice_Summary_${monthLabel.replace(/\s+/g, '_')}.pdf`);
}

// ------------------------------------------------------------
// GST Agent Pack - single ZIP with all 6 files, month clearly labeled
// ------------------------------------------------------------

export async function downloadGstAgentPack(
  salesRows: SalesGstRow[],
  purchaseRows: PurchaseGstRow[],
  summary: GstMonthlySummary,
  issues: GstIssue[],
  adjustments: GstManualAdjustments,
  monthLabel: string,
  company: ExportCompanyInfo,
) {
  const zip = new JSZip();
  const folder = zip.folder(`${monthLabel.replace(/\s+/g, '_')}_GST_Agent_Pack`)!;

  const salesWb = buildXlsxWithCompany(`Sales GST / GSTR-1 - ${monthLabel}`, company, monthLabel, new Date().toLocaleString('en-IN'), '', salesHeaders(), salesDataRows(salesRows), salesTotalRow(salesRows));
  folder.file('GSTR-1_Sales.xlsx', await salesWb.xlsx.writeBuffer());

  const purchaseWb = buildXlsxWithCompany(`Purchase GST / ITC - ${monthLabel}`, company, monthLabel, new Date().toLocaleString('en-IN'), '', purchaseHeaders(), purchaseDataRows(purchaseRows), purchaseTotalRow(purchaseRows));
  folder.file('Purchase_ITC.xlsx', await purchaseWb.xlsx.writeBuffer());

  const summaryWb = buildXlsxWithCompany(`Monthly GST Summary - ${monthLabel}`, company, monthLabel, new Date().toLocaleString('en-IN'), '', summaryHeaders(), summaryDataRows(summary));
  folder.file('GST_Summary.xlsx', await summaryWb.xlsx.writeBuffer());

  const gstr3bWb = buildXlsxWithCompany(`GSTR-3B Summary - ${monthLabel}`, company, monthLabel, new Date().toLocaleString('en-IN'), '', gstr3bHeaders(), gstr3bDataRows(summary, adjustments ?? EMPTY_ADJUSTMENTS));
  folder.file('GSTR-3B_Summary.xlsx', await gstr3bWb.xlsx.writeBuffer());

  const errorsWb = buildXlsxWithCompany(`GST Error Check - ${monthLabel}`, company, monthLabel, new Date().toLocaleString('en-IN'), '', errorHeaders(), errorDataRows(issues));
  folder.file('GST_Errors.xlsx', await errorsWb.xlsx.writeBuffer());

  const pdf = buildInvoiceSummaryPdf(salesRows, summary, monthLabel, company);
  folder.file('Invoice_Summary.pdf', pdf.output('arraybuffer'));

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${monthLabel.replace(/\s+/g, '_')}_GST_Agent_Pack.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
