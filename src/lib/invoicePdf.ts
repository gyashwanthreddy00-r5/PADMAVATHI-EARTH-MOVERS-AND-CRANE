import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import type { InvoiceWithRelations, InvoiceItem, CompanySettings, InvoiceSettings } from '@/types';
import { invoiceDocHTML, type PrintCopyType } from '@/components/InvoiceDocument';

export type { PrintCopyType };

// Single source of truth for invoice PDFs: this renders the exact same HTML
// invoiceDocHTML() produces for Print/View into an isolated offscreen iframe, then
// rasterizes that real DOM with html2canvas and slices the result into A4 pages with
// jsPDF - directly, not through the html2pdf.js wrapper. html2pdf.js's own bundled
// renderer (its "snapdom" DOM-cloning layer) silently drops all borders/table layout
// from this document - verified by comparing its output against calling html2canvas
// directly on the same HTML, which renders correctly. Driving html2canvas + jsPDF
// ourselves avoids that broken layer entirely. There is no second, independently
// hand-drawn PDF layout to keep in sync - whatever Print/View shows is byte-for-byte
// what gets rasterized here.

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const MARGIN_MM = 10;
const CONTENT_WIDTH_MM = A4_WIDTH_MM - MARGIN_MM * 2;
const CONTENT_HEIGHT_MM = A4_HEIGHT_MM - MARGIN_MM * 2;

// A4 content width (210mm page - 10mm margin each side = 190mm) at 96dpi, matching the
// @page { size: A4; margin: 10mm } rule in InvoiceDocument.tsx's own print CSS - the
// iframe and .inv are both forced to this width so html2canvas captures the same
// proportions a real A4 print would, not whatever width the host page happens to be.
const A4_CONTENT_PX = 718;
const CANVAS_SCALE = 2;

export async function generateInvoicePdfFromData(
  inv: InvoiceWithRelations,
  items: InvoiceItem[],
  settings: CompanySettings | null,
  invoiceSettings: InvoiceSettings | null,
  copyType: PrintCopyType = 'master',
): Promise<Uint8Array> {
  // html2canvas cannot reliably parse a <style> block that contains an @import rule -
  // it silently drops every rule in that block. Strip the @import here and add the
  // same font as a <link> element instead, which html2canvas handles correctly.
  const FONT_IMPORT_RE = /@import\s+url\(['"]?(https:\/\/fonts\.googleapis\.com[^'")]+)['"]?\)\s*;/;
  const rawHtml = invoiceDocHTML(inv, items, settings, invoiceSettings, copyType);
  const fontImportMatch = rawHtml.match(FONT_IMPORT_RE);
  const html = rawHtml.replace(FONT_IMPORT_RE, '');

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-9999px';
  iframe.style.top = '0';
  iframe.style.width = '190mm';
  iframe.style.height = '277mm';
  iframe.style.border = 'none';
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentWindow?.document;
  if (!iframeDoc) {
    if (iframe.parentNode) document.body.removeChild(iframe);
    throw new Error('Unable to create PDF document');
  }

  iframeDoc.open();
  iframeDoc.write(html);
  iframeDoc.close();

  if (fontImportMatch) {
    const fontLink = iframeDoc.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = fontImportMatch[1];
    iframeDoc.head.appendChild(fontLink);
  }

  // Force the same content width the browser's own A4 print would use.
  const widthStyle = iframeDoc.createElement('style');
  widthStyle.textContent = `
    html, body { width: ${A4_CONTENT_PX}px !important; min-width: ${A4_CONTENT_PX}px !important; margin: 0 !important; }
    .inv { width: ${A4_CONTENT_PX}px !important; max-width: ${A4_CONTENT_PX}px !important; margin: 0 !important; }
  `;
  iframeDoc.head.appendChild(widthStyle);

  await new Promise(resolve => { iframe.onload = resolve; });
  await new Promise(resolve => setTimeout(resolve, 400));
  try {
    await (iframe.contentWindow as unknown as { document: Document }).document.fonts.ready;
  } catch { /* Font Loading API unavailable - proceed without waiting */ }
  await new Promise(resolve => setTimeout(resolve, 400));

  try {
    const fullCanvas = await html2canvas(iframeDoc.body, {
      width: A4_CONTENT_PX,
      windowWidth: A4_CONTENT_PX,
      scale: CANVAS_SCALE,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
    });

    // Slice the one tall canvas into A4-page-sized chunks - html2pdf.js did this
    // internally; doing it ourselves is what lets us skip its broken renderer.
    const pxPerMm = fullCanvas.width / CONTENT_WIDTH_MM;
    const pageHeightPx = Math.round(CONTENT_HEIGHT_MM * pxPerMm);
    const totalHeightPx = fullCanvas.height;
    const pageCount = Math.max(1, Math.ceil(totalHeightPx / pageHeightPx));

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

    for (let i = 0; i < pageCount; i++) {
      const sliceY = i * pageHeightPx;
      const sliceHeight = Math.min(pageHeightPx, totalHeightPx - sliceY);
      if (sliceHeight <= 0) break;

      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width = fullCanvas.width;
      sliceCanvas.height = sliceHeight;
      const ctx = sliceCanvas.getContext('2d');
      if (!ctx) continue;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
      ctx.drawImage(fullCanvas, 0, sliceY, fullCanvas.width, sliceHeight, 0, 0, fullCanvas.width, sliceHeight);

      const sliceHeightMm = sliceHeight / pxPerMm;
      const imgData = sliceCanvas.toDataURL('image/png', 1.0);

      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, 'PNG', MARGIN_MM, MARGIN_MM, CONTENT_WIDTH_MM, sliceHeightMm, undefined, 'FAST');
    }

    const arrayBuffer = pdf.output('arraybuffer');
    return new Uint8Array(arrayBuffer);
  } finally {
    if (iframe.parentNode) document.body.removeChild(iframe);
  }
}

export async function generateInvoicePdfBase64(
  inv: InvoiceWithRelations,
  items: InvoiceItem[],
  settings: CompanySettings | null,
  invoiceSettings: InvoiceSettings | null,
  copyType: PrintCopyType = 'master',
): Promise<string> {
  const bytes = await generateInvoicePdfFromData(inv, items, settings, invoiceSettings, copyType);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
