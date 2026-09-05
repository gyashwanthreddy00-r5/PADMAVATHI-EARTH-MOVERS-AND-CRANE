import { PDFDocument, rgb, type PDFFont, type PDFPage, type PDFImage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { InvoiceWithRelations, InvoiceItem, CompanySettings, InvoiceSettings } from '@/types';
import { supabase } from '@/lib/supabase';
import { formatDate } from '@/lib/utils';
import { prepareInvoiceData, type PrintCopyType } from '@/lib/invoiceDocData';

// Draws the Master/Duplicate/Extra Copy invoice as a real PDF using pdf-lib,
// for email attachments. This is the ONLY PDF generator for invoices — it
// reads exactly the same prepared data (prepareInvoiceData) that the print
// template (InvoiceDocument.tsx) renders as HTML, so figures, item rows,
// and totals can never drift between print and email. The pixel-level
// drawing code below is necessarily different from the print CSS (there is
// no way to capture a browser's native print output as PDF bytes), but it
// mirrors the same font sizes, spacing, and layout so the result reads as
// the same document.

const px = (v: number) => v * 0.75; // 96dpi css px -> pt, matching InvoiceDocument.tsx's design
const mm = (v: number) => v * 2.834645669;

const PAGE_W = 595.28, PAGE_H = 841.89;
const MARGIN = mm(10);
const LEFT = MARGIN, RIGHT = PAGE_W - MARGIN, CONTENT_W = RIGHT - LEFT;
const COL_W = CONTENT_W / 2;
const MID_X = LEFT + COL_W;
const BOTTOM = MARGIN;

const BLACK = rgb(0, 0, 0);
const GRAY_BORDER = rgb(0.8, 0.8, 0.8);
const GRAY_BORDER_DARK = rgb(0.6, 0.6, 0.6);
const GRAY_BG = rgb(0.941, 0.941, 0.941);
const GRAY_TEXT = rgb(0.2, 0.2, 0.2);
const FOOTER_GRAY = rgb(0.267, 0.267, 0.267);
const LIGHT_BG = rgb(0.980, 0.980, 0.980);
const RED = rgb(0.863, 0.149, 0.149);
const BLUE = rgb(0.1137, 0.3059, 0.8471); // matches CSS #1d4ed8 exactly

function money(n: number | null | undefined): string {
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
}

function wrap(font: PDFFont, value: string | null | undefined, size: number, maxWidth: number): string[] {
  const words = String(value ?? '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) { lines.push(current); current = word; }
    else current = candidate;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

async function embedImage(pdf: PDFDocument, path: string | null | undefined): Promise<PDFImage | null> {
  if (!path) return null;
  try {
    const value = path.startsWith('http') ? path : (await supabase.storage.from('quotation-assets').createSignedUrl(path, 300)).data?.signedUrl;
    if (!value) return null;
    const response = await fetch(value);
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return response.headers.get('content-type')?.includes('png') || value.toLowerCase().includes('.png')
      ? await pdf.embedPng(bytes)
      : await pdf.embedJpg(bytes);
  } catch {
    return null;
  }
}

interface FontSet {
  regular: PDFFont;
  bold: PDFFont;
  symbolRegular: PDFFont;
  symbolBold: PDFFont;
}

export async function generateInvoicePdf(
  inv: InvoiceWithRelations,
  items: InvoiceItem[],
  settings: CompanySettings | null,
  invoiceSettings: InvoiceSettings | null,
  copyType: PrintCopyType,
  fonts: { regularBytes: Uint8Array; boldBytes: Uint8Array; symbolRegularBytes: Uint8Array; symbolBoldBytes: Uint8Array },
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(fonts.regularBytes);
  const bold = await pdf.embedFont(fonts.boldBytes);
  // NotoSans-Regular/Bold above don't contain the ₹ glyph (subsetted font). This wider
  // subset has it, used only to draw that one glyph — merging the two subsets corrupts
  // shared glyph metrics (verified: word-spacing breaks badly), so keep them separate.
  const symbolRegular = await pdf.embedFont(fonts.symbolRegularBytes);
  const symbolBold = await pdf.embedFont(fonts.symbolBoldBytes);
  const f: FontSet = { regular, bold, symbolRegular, symbolBold };

  const d = prepareInvoiceData(inv, items, settings, invoiceSettings, copyType);

  const logoImg = await embedImage(pdf, d.compLogo);
  const signImg = await embedImage(pdf, d.compSign);

  // Single source of truth for "where are we drawing right now": `page` + `y`.
  // newPage() reassigns both; every helper below reads them fresh on each call,
  // so nothing else needs to be kept in sync across a page break.
  let page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  const newPage = () => { page = pdf.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN; };
  const ensure = (h: number) => { if (y - h < BOTTOM) newPage(); };

  const symbolFor = (font: PDFFont) => (font === f.bold ? f.symbolBold : f.symbolRegular);
  const textWidth = (str: string | null | undefined, font: PDFFont, size: number): number => {
    const s = String(str ?? '');
    if (!s.includes('₹')) return font.widthOfTextAtSize(s, size);
    const symFont = symbolFor(font);
    return s.split('₹').reduce((acc, part, i) => acc + (i > 0 ? symFont.widthOfTextAtSize('₹', size) : 0) + font.widthOfTextAtSize(part, size), 0);
  };
  const text = (str: string | null | undefined, x: number, yy: number, size: number, font: PDFFont = f.regular, color = BLACK) => {
    const s = String(str ?? '');
    if (!s.includes('₹')) { page.drawText(s, { x, y: yy, size, font, color }); return; }
    const symFont = symbolFor(font);
    let cx = x;
    s.split('₹').forEach((part, i) => {
      if (i > 0) { page.drawText('₹', { x: cx, y: yy, size, font: symFont, color }); cx += symFont.widthOfTextAtSize('₹', size); }
      page.drawText(part, { x: cx, y: yy, size, font, color });
      cx += font.widthOfTextAtSize(part, size);
    });
  };
  const rightText = (str: string | null | undefined, rightX: number, yy: number, size: number, font: PDFFont = f.regular, color = BLACK) =>
    text(str, rightX - textWidth(str, font, size), yy, size, font, color);
  const centerText = (str: string | null | undefined, centerX: number, yy: number, size: number, font: PDFFont = f.regular, color = BLACK) =>
    text(str, centerX - textWidth(str, font, size) / 2, yy, size, font, color);
  const hline = (x1: number, yy: number, x2: number, color = BLACK, thickness = 0.75) =>
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness, color });
  const vline = (x: number, y1: number, y2: number, color = GRAY_BORDER, thickness = 0.75) =>
    page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, thickness, color });
  const rect = (x: number, yy: number, w: number, h: number, color = GRAY_BORDER, thickness = 0.75) =>
    page.drawRectangle({ x, y: yy, width: w, height: h, borderColor: color, borderWidth: thickness });
  const rectFill = (x: number, yy: number, w: number, h: number, fill: ReturnType<typeof rgb>) =>
    page.drawRectangle({ x, y: yy, width: w, height: h, color: fill });
  const labelValue = (label: string, value: string | null | undefined, x: number, yy: number, size: number, labelW: number, font: PDFFont = f.regular) => {
    text(label, x, yy, size, f.bold); text(String(value ?? ''), x + labelW, yy, size, font);
  };
  const boldPrefixLine = (label: string, value: string | null | undefined, x: number, yy: number, size: number) => {
    text(label, x, yy, size, f.bold); text(` ${value ?? ''}`, x + f.bold.widthOfTextAtSize(label, size), yy, size, f.regular);
  };
  const drawImageContain = (img: PDFImage, x: number, yTop: number, maxW: number, maxH: number): number => {
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * scale, h = img.height * scale;
    page.drawImage(img, { x, y: yTop - h, width: w, height: h });
    return h;
  };

  // ===================== Header =====================
  const boxW = px(140), boxH = px(22);
  rect(RIGHT - boxW, y - boxH, boxW, boxH, BLACK, 0.9);
  if (d.copyLabel) centerText(d.copyLabel, RIGHT - boxW / 2, y - boxH / 2 - px(4), px(11), f.bold);

  let ly = y;
  if (logoImg) { const h = drawImageContain(logoImg, LEFT, ly, px(110), px(45)); ly -= h + px(3); }
  ly -= px(12);
  text(d.compName.toUpperCase(), LEFT, ly, px(16), f.bold);
  ly -= px(19);
  for (const line of d.compAddr) { text(line, LEFT, ly, px(10), f.regular); ly -= px(14); }
  if (d.compGstin) { boldPrefixLine('GSTIN/UIN:', d.compGstin, LEFT, ly, px(10)); ly -= px(14); }
  if (d.compState) { boldPrefixLine('State Name:', `${d.compState}${d.compStateCode ? `, Code: ${d.compStateCode}` : ''}`, LEFT, ly, px(10)); ly -= px(14); }
  if (d.compEmail) { boldPrefixLine('E-Mail:', d.compEmail, LEFT, ly, px(10)); ly -= px(14); }
  if (d.compPhone) { boldPrefixLine('Phone:', d.compPhone, LEFT, ly, px(10)); ly -= px(14); }
  if (d.compPan) { boldPrefixLine('PAN:', d.compPan, LEFT, ly, px(10)); ly -= px(14); }

  y = Math.min(ly, y - boxH - px(6)) - px(4);
  y -= px(4);
  centerText('T A X   I N V O I C E', LEFT + CONTENT_W / 2, y, px(16), f.bold);
  y -= px(16) + px(8);
  hline(LEFT, y, RIGHT, BLACK, 1);
  y -= px(10);

  // ===================== Meta info (2-col, optional rows) =====================
  const metaLeft: [string, string | null | undefined][] = [
    ['Invoice No.', inv.invoice_number],
    ['Dated', formatDate(inv.invoice_date)],
    ...(inv.terms_of_payment ? [['Mode/Terms of Payment', inv.terms_of_payment] as [string, string]] : []),
    ...(inv.reference_no ? [['Reference No. & Date', inv.reference_no] as [string, string]] : []),
    ...(inv.buyer_order_no ? [["Buyer's Order No.", inv.buyer_order_no] as [string, string]] : []),
    ...(inv.dispatch_doc_no ? [['Dispatch Doc No.', inv.dispatch_doc_no] as [string, string]] : []),
    ...(inv.delivery_note_date ? [['Delivery Note Date', formatDate(inv.delivery_note_date)] as [string, string]] : []),
  ];
  const metaRight: [string, string | null | undefined][] = [
    ...(inv.destination ? [['Destination', inv.destination] as [string, string]] : []),
    ...(inv.motor_vehicle_numbers ? [['Motor Vehicle No.', inv.motor_vehicle_numbers] as [string, string]] : []),
    ...(d.vehicleTypesJoined ? [['Vehicle Type', d.vehicleTypesJoined] as [string, string]] : []),
    ...(inv.delivery_note ? [['Delivery Note', inv.delivery_note] as [string, string]] : []),
    ...(inv.financial_year ? [['Financial Year', inv.financial_year] as [string, string]] : []),
  ];
  const metaRowH = px(17), metaLabelW = px(105);
  const metaTop = y;
  let my = metaTop;
  for (const [label, val] of metaLeft) { labelValue(label, val, LEFT, my, px(10), metaLabelW); my -= metaRowH; }
  const leftBottom = my;
  my = metaTop;
  for (const [label, val] of metaRight) { labelValue(label, val, MID_X + px(6), my, px(10), metaLabelW); my -= metaRowH; }
  const rightBottom = my;
  const metaBottom = Math.min(leftBottom, rightBottom) + metaRowH - px(3);
  vline(MID_X, metaTop + px(11), metaBottom, GRAY_BORDER, 0.75);
  y = metaBottom - px(6);
  hline(LEFT, y, RIGHT, BLACK, 1);
  y -= px(10);

  // ===================== Party boxes =====================
  const partyPad = px(6);
  const drawParty = (title: string, name: string, addrLines: string[], gstin: string, stateStr: string, x: number, w: number): number => {
    let py = y;
    text(title, x + partyPad, py, px(9), f.bold);
    py -= px(3);
    hline(x + partyPad, py, x + w - partyPad, GRAY_BORDER, 0.75);
    py -= px(11);
    text(name, x + partyPad, py, px(11), f.bold);
    py -= px(15);
    for (const l of addrLines) { text(l, x + partyPad, py, px(10), f.regular); py -= px(14); }
    if (gstin && gstin !== '-') { boldPrefixLine('GSTIN/UIN:', gstin, x + partyPad, py, px(10)); py -= px(14); }
    if (stateStr) { boldPrefixLine('State Name:', stateStr, x + partyPad, py, px(10)); py -= px(14); }
    return py;
  };
  const conAddrWrapped = d.conAddr.flatMap(l => wrap(f.regular, l, px(10), COL_W - partyPad * 2 - px(2)));
  const cAddrWrapped = d.cAddr.flatMap(l => wrap(f.regular, l, px(10), COL_W - partyPad * 2 - px(2)));
  const bottomL = drawParty(
    'CONSIGNEE (SHIP TO)', d.conName, conAddrWrapped, d.conGstin,
    d.conState && d.conState !== '-' ? `${d.conState}${d.conStateCode && d.conStateCode !== '-' ? `, Code: ${d.conStateCode}` : ''}` : '',
    LEFT, COL_W,
  );
  const bottomR = drawParty(
    'BUYER (BILL TO)', d.cName, cAddrWrapped, d.cGstin,
    d.cState && d.cState !== '-' ? `${d.cState}${d.cStateCode && d.cStateCode !== '-' ? `, Code: ${d.cStateCode}` : ''}` : '',
    MID_X, COL_W,
  );
  const partyBottom = Math.min(bottomL, bottomR) + px(6);
  vline(MID_X, y + px(3), partyBottom + px(6), GRAY_BORDER, 0.75);
  y = partyBottom;
  hline(LEFT, y, RIGHT, BLACK, 1);
  y -= px(8);

  // ===================== Item table (paginated) =====================
  // Columns match InvoiceDocument.tsx's table.it exactly: Sl No | Description | HSN/SAC | Quantity | Per | Amount
  const colW = { sl: px(32), hsn: px(60), qty: px(48), per: px(40), amt: px(90), desc: 0 };
  colW.desc = CONTENT_W - colW.sl - colW.hsn - colW.qty - colW.per - colW.amt;
  const colX: Record<string, number> = {};
  let cx = LEFT;
  for (const k of ['sl', 'desc', 'hsn', 'qty', 'per', 'amt'] as const) { colX[k] = cx; cx += colW[k]; }
  const theadH = px(22), padX = px(4), padY = px(5);

  const drawItemTableHeader = (): number => {
    const top = y;
    rectFill(LEFT, top - theadH, CONTENT_W, theadH, GRAY_BG);
    const thY = top - theadH / 2 - px(3);
    centerText('SL NO.', colX.sl + colW.sl / 2, thY, px(9), f.bold);
    centerText('DESCRIPTION OF SERVICES', colX.desc + colW.desc / 2, thY, px(9), f.bold);
    centerText('HSN/SAC', colX.hsn + colW.hsn / 2, thY, px(9), f.bold);
    centerText('QUANTITY', colX.qty + colW.qty / 2, thY, px(9), f.bold);
    centerText('PER', colX.per + colW.per / 2, thY, px(9), f.bold);
    centerText('AMOUNT', colX.amt + colW.amt / 2, thY, px(9), f.bold);
    y -= theadH;
    return top;
  };
  const finishTableGrid = (top: number, rowTops: number[]) => {
    rect(LEFT, y, CONTENT_W, top - y, GRAY_BORDER_DARK, 0.9);
    for (const ry of rowTops) hline(LEFT, ry, RIGHT, GRAY_BORDER, 0.75);
    for (const k of ['sl', 'desc', 'hsn', 'qty', 'per'] as const) vline(colX[k] + colW[k], top, y, GRAY_BORDER, 0.75);
    hline(LEFT, top, RIGHT, GRAY_BORDER_DARK, 0.9);
  };

  ensure(theadH + px(35));
  let tableTop = drawItemTableHeader();
  let rowTops = [y];
  for (const row of d.itemRows) {
    const descLines = wrap(f.regular, row.description, px(10), colW.desc - padX * 2);
    const calcLines = row.calcLines.flatMap(l => wrap(f.regular, l, px(9), colW.desc - padX * 2));
    const rowH = padY * 2 + descLines.length * px(15) + (calcLines.length ? calcLines.length * px(13) + px(3) : 0);

    if (y - rowH < BOTTOM) {
      finishTableGrid(tableTop, rowTops);
      newPage();
      ensure(theadH + rowH + px(10));
      tableTop = drawItemTableHeader();
      rowTops = [y];
    }

    const rowTop = y;
    let ty = rowTop - padY - px(9);
    for (const dl of descLines) { text(dl, colX.desc + padX, ty, px(10), f.regular); ty -= px(15); }
    if (calcLines.length) {
      ty -= px(2);
      for (const cl of calcLines) { text(cl, colX.desc + padX, ty, px(9), f.regular, GRAY_TEXT); ty -= px(13); }
    }
    const midY = rowTop - rowH / 2 - px(3);
    centerText(String(row.slNo), colX.sl + colW.sl / 2, midY, px(10), f.regular);
    centerText(row.hsnSac, colX.hsn + colW.hsn / 2, midY, px(10), f.regular);
    centerText(money(row.quantity), colX.qty + colW.qty / 2, midY, px(10), f.regular);
    centerText(row.unit, colX.per + colW.per / 2, midY, px(10), f.regular);
    rightText(money(row.amount), colX.amt + colW.amt - padX, midY, px(10), f.bold);
    y = rowTop - rowH;
    rowTops.push(y);
  }
  finishTableGrid(tableTop, rowTops);
  y -= px(8);

  // ===================== Tax breakdown + Grand total =====================
  const ttColKeys = d.isIgst ? (['hsn', 'taxable', 'r1', 'a1', 'tot'] as const) : (['hsn', 'taxable', 'r1', 'a1', 'r2', 'a2', 'tot'] as const);
  const taxHeaders = d.isIgst
    ? ['HSN/SAC', 'Taxable\nValue', 'IGST\nRate', 'IGST\nAmt', 'Total\nTax']
    : ['HSN/SAC', 'Taxable\nValue', 'CGST\nRate', 'CGST\nAmt', 'SGST\nRate', 'SGST\nAmt', 'Total\nTax'];
  const ttColW: Record<string, number> = { hsn: px(50), taxable: px(58), r1: px(38), a1: px(45), r2: px(38), a2: px(45), tot: px(50) };
  const ttTotalW = ttColKeys.reduce((s, k) => s + ttColW[k], 0);
  ensure(px(60));
  const ttX: Record<string, number> = {};
  let tcx = LEFT;
  for (const k of ttColKeys) { ttX[k] = tcx; tcx += ttColW[k]; }
  const ttHeadH = px(22);
  let tty = y;
  rectFill(LEFT, tty - ttHeadH, ttTotalW, ttHeadH, GRAY_BG);
  rect(LEFT, tty - ttHeadH, ttTotalW, ttHeadH, GRAY_BORDER, 0.75);
  ttColKeys.forEach((k, i) => {
    const lbl = taxHeaders[i].split('\n');
    let hy = tty - px(8);
    for (const l of lbl) { centerText(l, ttX[k] + ttColW[k] / 2, hy, px(7.5), f.bold); hy -= px(9); }
    if (i > 0) vline(ttX[k], tty, tty - ttHeadH, GRAY_BORDER, 0.75);
  });
  tty -= ttHeadH;
  const ttRowH = px(16);
  rect(LEFT, tty - ttRowH, ttTotalW, ttRowH, GRAY_BORDER, 0.75);
  const ttVals = d.isIgst
    ? [d.hsnSacDefault, money(d.taxable), `${inv.igst_percent ?? 0}%`, money(d.igstAmt), money(d.totalTax)]
    : [d.hsnSacDefault, money(d.taxable), `${inv.cgst_percent ?? 0}%`, money(d.cgstAmt), `${inv.sgst_percent ?? 0}%`, money(d.sgstAmt), money(d.totalTax)];
  ttColKeys.forEach((k, i) => {
    centerText(ttVals[i], ttX[k] + ttColW[k] / 2, tty - ttRowH / 2 - px(3), px(9), f.regular);
    if (i > 0) vline(ttX[k], tty, tty - ttRowH, GRAY_BORDER, 0.75);
  });
  tty -= ttRowH;

  tty -= px(6);
  const wordsLines = wrap(f.regular, `INR ${d.words}`, px(10), ttTotalW - px(10));
  const wordsBoxH = px(11) + wordsLines.length * px(12) + px(4);
  rectFill(LEFT, tty - wordsBoxH, ttTotalW, wordsBoxH, LIGHT_BG);
  rect(LEFT, tty - wordsBoxH, ttTotalW, wordsBoxH, GRAY_BORDER, 0.75);
  text('Amount Chargeable (in words):', LEFT + px(5), tty - px(11), px(10), f.bold);
  let wy = tty - px(11) - px(12);
  for (const wl of wordsLines) { text(wl, LEFT + px(5), wy, px(10), f.bold); wy -= px(12); }
  tty -= wordsBoxH;

  if (inv.remarks) {
    tty -= px(8);
    const remW = f.bold.widthOfTextAtSize('Remarks: ', px(10));
    const remLines = wrap(f.regular, inv.remarks, px(10), ttTotalW - remW);
    text('Remarks:', LEFT, tty, px(10), f.bold);
    text(` ${remLines[0] ?? ''}`, LEFT + remW, tty, px(10), f.regular);
    tty -= px(12);
    for (const rl of remLines.slice(1)) { text(rl, LEFT, tty, px(10), f.regular); tty -= px(12); }
  }

  const rColX = MID_X + px(6), rColRight = RIGHT;
  let gy = y - px(11);
  const totalRow = (label: string, amountValue: number, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gap?: number } = {}) => {
    const size = opts.size ?? px(11);
    const font = opts.bold ? f.bold : f.regular;
    const color = opts.color ?? BLACK;
    text(label, rColX, gy, size, font, color);
    rightText(`₹${money(amountValue)}`, rColRight, gy, size, font, color);
    gy -= opts.gap ?? px(17);
  };
  totalRow('Taxable Amount:', d.taxable, { gap: px(16) });
  if (d.cgstAmt > 0) totalRow(`CGST (${inv.cgst_percent}%):`, d.cgstAmt, { gap: px(16) });
  if (d.sgstAmt > 0) totalRow(`SGST (${inv.sgst_percent}%):`, d.sgstAmt, { gap: px(16) });
  if (d.igstAmt > 0) totalRow(`IGST (${inv.igst_percent}%):`, d.igstAmt, { gap: px(16) });
  gy -= px(2);
  hline(rColX, gy + px(11), rColRight, BLACK, 0.9);
  totalRow('GRAND TOTAL:', d.grand, { size: px(13), bold: true, gap: px(19) });
  hline(rColX, gy + px(15), rColRight, BLACK, 0.9);
  if (inv.discount_enabled) {
    gy -= px(2);
    totalRow(`Discount (${inv.discount_percent}%):`, -(Number(inv.discount_amount) || 0), { color: RED, gap: px(16) });
    gy -= px(2);
    hline(rColX, gy + px(11), rColRight, BLACK, 0.9);
    totalRow('NET PAYABLE:', d.finalPayable, { size: px(13), bold: true, color: BLUE, gap: px(19) });
    hline(rColX, gy + px(15), rColRight, BLACK, 0.9);
  }
  gy -= px(4);
  totalRow('Received:', d.received, { bold: true, gap: px(16) });
  totalRow('Balance:', d.balance, { bold: true, gap: px(16) });

  y = Math.min(tty, gy) - px(6);
  hline(LEFT, y, RIGHT, BLACK, 1);
  y -= px(10);

  // ===================== Declaration + Bank details =====================
  ensure(px(90));
  let dy = y;
  text('DECLARATION', LEFT, dy, px(9), f.bold);
  dy -= px(14);
  for (const l of wrap(f.regular, d.declaration, px(10), COL_W - px(6))) { text(l, LEFT, dy, px(10), f.regular); dy -= px(14); }

  let by = y;
  if (d.hasBank) {
    text("COMPANY'S BANK DETAILS", MID_X + px(6), by, px(9), f.bold);
    by -= px(14);
    const bankRows: [string, string][] = [
      ...(d.bankAcctName ? [["A/c Holder's Name:", d.bankAcctName] as [string, string]] : []),
      ...(d.bankName ? [['Bank Name:', d.bankName] as [string, string]] : []),
      ...(d.bankAcctNo ? [['A/c No.:', d.bankAcctNo] as [string, string]] : []),
      ...((d.bankBranch || d.bankIfsc) ? [['Branch & IFSC:', [d.bankBranch, d.bankIfsc].filter(Boolean).join(' - ')] as [string, string]] : []),
    ];
    for (const [label, val] of bankRows) { boldPrefixLine(label, val, MID_X + px(6), by, px(10)); by -= px(14); }
  }
  y = Math.min(dy, by) - px(4);

  // ===================== Signature =====================
  ensure(px(80));
  y -= px(10);
  const signRightX = RIGHT;
  rightText(`for ${d.compName}`, signRightX, y, px(10), f.regular);
  y -= px(14);
  if (signImg) { const h = drawImageContain(signImg, signRightX - px(130), y, px(130), px(45)); y -= h + px(4); }
  else y -= px(36);
  rightText('Authorized Signatory', signRightX, y, px(10), f.bold);
  y -= px(12);
  if (d.compAuth) { rightText(d.compAuth, signRightX, y, px(10), f.regular); y -= px(12); }

  // ===================== Footer =====================
  ensure(px(24));
  y -= px(6);
  hline(LEFT, y, RIGHT, GRAY_BORDER_DARK, 0.75);
  y -= px(10);
  centerText('This is a Computer Generated Invoice', LEFT + CONTENT_W / 2, y, px(8), f.regular, FOOTER_GRAY);

  return pdf.save();
}

let fontBytesCache: { regularBytes: Uint8Array; boldBytes: Uint8Array; symbolRegularBytes: Uint8Array; symbolBoldBytes: Uint8Array } | null = null;

async function loadFontBytes() {
  if (!fontBytesCache) {
    const [regularBytes, boldBytes, symbolRegularBytes, symbolBoldBytes] = await Promise.all([
      fetch('/fonts/NotoSans-Regular.ttf').then(r => r.arrayBuffer()).then(b => new Uint8Array(b)),
      fetch('/fonts/NotoSans-Bold.ttf').then(r => r.arrayBuffer()).then(b => new Uint8Array(b)),
      fetch('/fonts/NotoSansSymbols-Regular.ttf').then(r => r.arrayBuffer()).then(b => new Uint8Array(b)),
      fetch('/fonts/NotoSansSymbols-Bold.ttf').then(r => r.arrayBuffer()).then(b => new Uint8Array(b)),
    ]);
    fontBytesCache = { regularBytes, boldBytes, symbolRegularBytes, symbolBoldBytes };
  }
  return fontBytesCache;
}

export async function generateInvoicePdfFromData(
  inv: InvoiceWithRelations,
  items: InvoiceItem[],
  settings: CompanySettings | null,
  invoiceSettings: InvoiceSettings | null,
  copyType: PrintCopyType = 'master',
): Promise<Uint8Array> {
  const fonts = await loadFontBytes();
  return generateInvoicePdf(inv, items, settings, invoiceSettings, copyType, fonts);
}
