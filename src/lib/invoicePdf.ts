import { PDFDocument, rgb, type PDFFont, type PDFPage, type PDFImage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { InvoiceWithRelations, InvoiceItem, CompanySettings, InvoiceSettings } from '@/types';
import { supabase } from '@/lib/supabase';
import { formatDate, addDays, amountInWords } from '@/lib/utils';
import { prepareInvoiceData, type PrintCopyType } from '@/lib/invoiceDocData';

// Draws the Master/Duplicate/Extra Copy invoice as a real PDF using pdf-lib, for email
// attachments. This is the ONLY PDF generation path for invoices - it reads exactly the
// same prepared data (prepareInvoiceData) that the print template (InvoiceDocument.tsx)
// renders as HTML, so figures, item rows, and totals can never drift between print and
// email. The pixel-level drawing code below is necessarily different from the print CSS
// (there is no way to capture a browser's native print output as PDF bytes without a
// server-side headless browser), but it is hand-matched field-for-field, border-for-
// border against InvoiceDocument.tsx's rendered output.

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
const RED = rgb(0.863, 0.149, 0.149);

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
  // subset has it, used only to draw that one glyph - merging the two subsets corrupts
  // shared glyph metrics (verified: word-spacing breaks badly), so keep them separate.
  const symbolRegular = await pdf.embedFont(fonts.symbolRegularBytes);
  const symbolBold = await pdf.embedFont(fonts.symbolBoldBytes);
  const f: FontSet = { regular, bold, symbolRegular, symbolBold };

  const d = prepareInvoiceData(inv, items, settings, invoiceSettings, copyType);

  const logoImg = await embedImage(pdf, d.compLogo);

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
  // Title row first (matches InvoiceDocument.tsx: "Tax Invoice" centered + copy label at
  // right, both above the bordered box below - not inside/overlapping it).
  y -= px(2);
  centerText('Tax Invoice', LEFT + CONTENT_W / 2, y - px(12), px(15), f.bold);
  if (d.copyLabel) rightText(`(${d.copyLabel})`, RIGHT, y - px(10), px(10), f.bold);
  y -= px(15) + px(8);

  // One bordered box, 53% left (company info, then Consignee, then Buyer - each block
  // divided by a full-width rule) / 47% right (meta grid) - matching InvoiceDocument.tsx's
  // hdr-flex exactly, instead of stacking these as separate full-width sections.
  const HDR_LEFT_W = CONTENT_W * 0.53;
  const HDR_RIGHT_W = CONTENT_W - HDR_LEFT_W;
  const HDR_MID_X = LEFT + HDR_LEFT_W;
  const hdrPad = px(6);
  const hdrTop = y;

  // -- left column: company info --
  let ly = hdrTop;
  if (logoImg) { const h = drawImageContain(logoImg, LEFT + hdrPad, ly - px(4), px(100), px(40)); ly -= h + px(3); }
  ly -= px(16);
  const compNameLines = wrap(f.bold, d.compName.toUpperCase(), px(15), HDR_LEFT_W - hdrPad * 2);
  for (const l of compNameLines) { text(l, LEFT + hdrPad, ly, px(15), f.bold); ly -= px(17); }
  ly -= px(1);
  for (const line of d.compAddr) {
    for (const l of wrap(f.regular, line, px(10), HDR_LEFT_W - hdrPad * 2)) { text(l, LEFT + hdrPad, ly, px(10), f.regular); ly -= px(13); }
  }
  if (d.compGstin) { boldPrefixLine('GSTIN/UIN:', d.compGstin, LEFT + hdrPad, ly, px(10)); ly -= px(13); }
  if (d.compState) { boldPrefixLine('State Name:', `${d.compState}${d.compStateCode ? `, Code: ${d.compStateCode}` : ''}`, LEFT + hdrPad, ly, px(10)); ly -= px(13); }
  if (d.compEmail) { boldPrefixLine('E-Mail:', d.compEmail, LEFT + hdrPad, ly, px(10)); ly -= px(13); }
  if (d.compPhone) { boldPrefixLine('Phone:', d.compPhone, LEFT + hdrPad, ly, px(10)); ly -= px(13); }
  if (d.compPan) { boldPrefixLine('PAN:', d.compPan, LEFT + hdrPad, ly, px(10)); ly -= px(13); }
  ly -= px(3);
  hline(LEFT, ly, HDR_MID_X, BLACK, 0.75);
  ly -= px(10);

  // -- left column: Consignee (Ship to), then Buyer (Bill to) --
  const conAddrWrapped = d.conAddr.flatMap(l => wrap(f.regular, l, px(10), HDR_LEFT_W - hdrPad * 2 - px(2)));
  const cAddrWrapped = d.cAddr.flatMap(l => wrap(f.regular, l, px(10), HDR_LEFT_W - hdrPad * 2 - px(2)));
  const drawPartyBlock = (title: string, name: string, addrLines: string[], gstin: string, stateStr: string, topY: number): number => {
    let py = topY;
    text(title, LEFT + hdrPad, py, px(9), f.bold);
    py -= px(13);
    text(name, LEFT + hdrPad, py, px(11), f.bold);
    py -= px(14);
    for (const l of addrLines) { text(l, LEFT + hdrPad, py, px(10), f.regular); py -= px(13); }
    if (gstin && gstin !== '-') { boldPrefixLine('GSTIN/UIN:', gstin, LEFT + hdrPad, py, px(10)); py -= px(13); }
    if (stateStr) { boldPrefixLine('State Name:', stateStr, LEFT + hdrPad, py, px(10)); py -= px(13); }
    return py;
  };
  ly = drawPartyBlock(
    'Consignee (Ship to)', d.conName, conAddrWrapped, d.conGstin,
    d.conState && d.conState !== '-' ? `${d.conState}${d.conStateCode && d.conStateCode !== '-' ? `, Code: ${d.conStateCode}` : ''}` : '',
    ly,
  );
  ly -= px(3);
  hline(LEFT, ly, HDR_MID_X, BLACK, 0.75);
  ly -= px(10);
  ly = drawPartyBlock(
    'Buyer (Bill to)', d.cName, cAddrWrapped, d.cGstin,
    d.cState && d.cState !== '-' ? `${d.cState}${d.cStateCode && d.cStateCode !== '-' ? `, Code: ${d.cStateCode}` : ''}` : '',
    ly,
  );
  const leftBottom = ly;

  // -- right column: meta grid (2-col, label-above-value, matches print) --
  // Same field grouping and label-above-value stacking as InvoiceDocument.tsx's dg-row/
  // dg-cell markup - kept in sync by hand since pdf-lib can't share that HTML/CSS.
  const refNo = inv.reference_no || inv.invoice_number;
  const refDate = inv.reference_date || inv.invoice_date;
  const referenceNoAndDate = refNo ? `${refNo} dt. ${formatDate(refDate)}` : null;
  const modeTermsOfPayment = inv.terms_of_payment || invoiceSettings?.default_payment_terms || null;
  const termDays = inv.terms_of_delivery_days || 28;
  const deliveryDueDate = inv.invoice_date ? formatDate(addDays(inv.invoice_date, termDays)) : null;
  const termsOfDelivery = deliveryDueDate ? `${termDays} Days (Due by ${deliveryDueDate})` : `${termDays} Days`;

  type MetaRow = [string, string | null | undefined, string, string | null | undefined] | [string, string | null | undefined];
  const metaRows: MetaRow[] = [
    ['Invoice No.', inv.invoice_number, 'Dated', formatDate(inv.invoice_date)],
    ['Delivery Note', inv.delivery_note, 'Mode/Terms of Payment', modeTermsOfPayment],
    ['Reference No. & Date', referenceNoAndDate, 'Other References', null],
    ["Buyer's Order No.", inv.buyer_order_no, 'Dated', inv.buyer_order_date ? formatDate(inv.buyer_order_date) : null],
    ['Dispatch Doc No.', inv.dispatch_doc_no, 'Delivery Note Date', inv.delivery_note_date ? formatDate(inv.delivery_note_date) : null],
    ['Dispatched through', inv.dispatched_through, 'Destination', inv.destination],
    ['Bill of Lading/LR-RR No.', inv.bill_of_lading_no, 'Motor Vehicle No.', inv.motor_vehicle_numbers || d.vehicleNumbersJoined],
    ['Terms of Delivery', termsOfDelivery],
  ];

  const metaPadX = px(4);
  const metaColW = HDR_RIGHT_W / 2;
  const metaRightMid = HDR_MID_X + metaColW;
  const drawMetaCell = (label: string, val: string | null | undefined, x: number, topY: number, w: number): number => {
    let cy = topY - px(4) - px(7);
    text(label, x + metaPadX, cy, px(8), f.regular, GRAY_TEXT);
    cy -= px(11);
    for (const vl of wrap(f.bold, val || ' ', px(10), w - metaPadX * 2)) { text(vl, x + metaPadX, cy, px(10), f.bold); cy -= px(12); }
    return cy - px(3);
  };

  let metaY = hdrTop;
  for (let i = 0; i < metaRows.length; i++) {
    const row = metaRows[i];
    const rowTop = metaY;
    const isPair = row.length === 4;
    const bottom1 = drawMetaCell(row[0], row[1], HDR_MID_X, rowTop, isPair ? metaColW : HDR_RIGHT_W);
    const bottom2 = isPair ? drawMetaCell(row[2] as string, row[3], metaRightMid, rowTop, metaColW) : bottom1;
    metaY = Math.min(bottom1, bottom2);
    if (isPair) vline(metaRightMid, rowTop, metaY, GRAY_BORDER, 0.75);
    if (i < metaRows.length - 1) hline(HDR_MID_X, metaY, RIGHT, GRAY_BORDER, 0.75);
  }

  // Whichever column is taller decides the box's bottom edge - matches hdr-right's last
  // row stretching to fill any leftover height when hdr-left is shorter (or vice versa),
  // so the vertical divider always reaches the box's own bottom border.
  const hdrBottom = Math.min(leftBottom, metaY) - px(4);
  vline(HDR_MID_X, hdrTop, hdrBottom, BLACK, 0.75);
  rect(LEFT, hdrBottom, CONTENT_W, hdrTop - hdrBottom, BLACK, 0.9);
  y = hdrBottom - px(8);

  // ===================== Item table (paginated) =====================
  // Columns match InvoiceDocument.tsx's table.it exactly: Sl No | Description | HSN/SAC |
  // Quantity | Rate | per | Amount. CGST/SGST/Discount/Total are rows inside this same
  // grid (matching the print template), not a separate totals block off to the side.
  const colW = { sl: px(24), hsn: px(50), qty: px(55), rate: px(55), per: px(28), amt: px(75), desc: 0 };
  colW.desc = CONTENT_W - colW.sl - colW.hsn - colW.qty - colW.rate - colW.per - colW.amt;
  const colOrder = ['sl', 'desc', 'hsn', 'qty', 'rate', 'per', 'amt'] as const;
  const colX: Record<string, number> = {};
  let cx = LEFT;
  for (const k of colOrder) { colX[k] = cx; cx += colW[k]; }
  const theadH = px(22), padX = px(4), padY = px(5);

  const drawItemTableHeader = (): number => {
    const top = y;
    rectFill(LEFT, top - theadH, CONTENT_W, theadH, GRAY_BG);
    const thY = top - theadH / 2 - px(3);
    centerText('Sl No.', colX.sl + colW.sl / 2, thY, px(9), f.bold);
    centerText('Description of Services', colX.desc + colW.desc / 2, thY, px(9), f.bold);
    centerText('HSN/SAC', colX.hsn + colW.hsn / 2, thY, px(9), f.bold);
    centerText('Quantity', colX.qty + colW.qty / 2, thY, px(9), f.bold);
    centerText('Rate', colX.rate + colW.rate / 2, thY, px(9), f.bold);
    centerText('per', colX.per + colW.per / 2, thY, px(9), f.bold);
    centerText('Amount', colX.amt + colW.amt / 2, thY, px(9), f.bold);
    y -= theadH;
    return top;
  };
  // Only vertical column separators inside the item table - no horizontal line between
  // item rows, the spacer, or CGST/SGST (matching InvoiceDocument.tsx's table.it td
  // border-top/border-bottom: none exactly - only the header and Total row draw their
  // own rules). rowTops is accepted only so callers don't need reshaping; unused here.
  const finishTableGrid = (top: number, _rowTops: number[]) => {
    rect(LEFT, y, CONTENT_W, top - y, GRAY_BORDER_DARK, 0.75);
    for (const k of ['sl', 'desc', 'hsn', 'qty', 'rate', 'per'] as const) vline(colX[k] + colW[k], top, y, GRAY_BORDER, 0.75);
    hline(LEFT, top, RIGHT, GRAY_BORDER_DARK, 0.75);
  };

  // Reference point for the dynamic spacer below - "where the table started, and on
  // which page" - so the spacer can target "fill up to here, but leave room for
  // everything drawn after the table" using this page's real remaining budget rather
  // than a borrowed constant.
  const pageStartY = y;
  const startPage = page;
  ensure(theadH + px(35));
  let tableTop = drawItemTableHeader();
  let rowTops = [y];
  for (const row of d.itemRows) {
    // Description of Services shows only the plain description - never the hour-by-hour
    // rate/amount breakdown (row.calcLines) - matching InvoiceDocument.tsx's item table
    // exactly (that data stays available for callers that want it elsewhere, e.g. the
    // app's own invoice edit view, but never prints here).
    const descLines = wrap(f.regular, row.description, px(10), colW.desc - padX * 2);
    const rowH = padY * 2 + descLines.length * px(15);

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
    const midY = rowTop - rowH / 2 - px(3);
    centerText(String(row.slNo), colX.sl + colW.sl / 2, midY, px(10), f.regular);
    centerText(row.hsnSac, colX.hsn + colW.hsn / 2, midY, px(10), f.regular);
    centerText(row.quantityLabel, colX.qty + colW.qty / 2, midY, px(10), f.regular);
    centerText(row.rateLabel, colX.rate + colW.rate / 2, midY, px(9), f.regular);
    centerText(row.unit, colX.per + colW.per / 2, midY, px(10), f.regular);
    rightText(money(row.amount), colX.amt + colW.amt - padX, midY, px(10), f.bold);
    y = rowTop - rowH;
    rowTops.push(y);
  }

  // CGST/SGST/IGST rows - label confined to the Description column (empty Sl/HSN/Quantity
  // cells either side of it), rate% + "%" + amount in their own columns, exactly like
  // InvoiceDocument.tsx's item table rows (not a separate summary block).
  const taxLineH = px(15);
  const drawTaxRow = (label: string, ratePercent: number, amount: number, color = BLACK) => {
    if (y - taxLineH < BOTTOM) { finishTableGrid(tableTop, rowTops); newPage(); ensure(theadH + taxLineH + px(10)); tableTop = drawItemTableHeader(); rowTops = [y]; }
    const midY = y - taxLineH / 2 - px(3);
    rightText(label, colX.hsn - padX, midY, px(9), f.regular, color);
    text(label, colX.desc + colW.desc - textWidth(label, f.regular, px(9)) - padX, midY, px(9), f.regular, color);
    centerText(String(ratePercent), colX.rate + colW.rate / 2, midY, px(9), f.regular, color);
    centerText('%', colX.per + colW.per / 2, midY, px(9), f.regular, color);
    rightText(money(amount), colX.amt + colW.amt - padX, midY, px(9), f.regular, color);
    y -= taxLineH;
    rowTops.push(y);
  };
  if (d.isIgst) {
    if (d.igstAmt > 0) drawTaxRow(`IGST ${inv.igst_percent}%`, inv.igst_percent ?? 0, d.igstAmt);
  } else {
    if (d.cgstAmt > 0) drawTaxRow(`CGST ${inv.cgst_percent}%`, inv.cgst_percent ?? 0, d.cgstAmt);
    if (d.sgstAmt > 0) drawTaxRow(`SGST ${inv.sgst_percent}%`, inv.sgst_percent ?? 0, d.sgstAmt);
  }
  if (inv.discount_enabled) {
    if (y - taxLineH < BOTTOM) { finishTableGrid(tableTop, rowTops); newPage(); ensure(theadH + taxLineH + px(10)); tableTop = drawItemTableHeader(); rowTops = [y]; }
    const midY = y - taxLineH / 2 - px(3);
    const discLabel = `Discount (${inv.discount_percent}%)`;
    rightText(discLabel, colX.amt - padX, midY, px(9), f.regular, RED);
    rightText(`-${money(Number(inv.discount_amount) || 0)}`, colX.amt + colW.amt - padX, midY, px(9), f.regular, RED);
    y -= taxLineH;
    rowTops.push(y);
  }

  // Blank spacer - gives the table the same generous, form-like blank space before
  // Total that InvoiceDocument.tsx's item table has, but sized from this page's own
  // real remaining budget rather than a constant borrowed from the HTML/CSS layout
  // (which uses different spacing metrics and would otherwise strand the GST summary/
  // declaration/bank block alone on a near-empty next page). TRAILING_RESERVE_PT is a
  // measured approximation of everything drawn after the table (GST summary, amount-
  // in-words, remarks, declaration/bank, footer) - `ensure()` calls further down still
  // force a real page break if actual content ever exceeds this estimate, so an
  // imprecise reserve only affects how generous the spacer looks, never correctness.
  const TRAILING_RESERVE_PT = 170;
  const spacerH = (page === startPage)
    ? Math.max(0, (pageStartY - BOTTOM - TRAILING_RESERVE_PT) - (pageStartY - y))
    : 0;
  if (spacerH > 0) {
    if (y - spacerH < BOTTOM) { finishTableGrid(tableTop, rowTops); newPage(); ensure(theadH + spacerH + px(40)); tableTop = drawItemTableHeader(); rowTops = [y]; }
    y -= spacerH;
    rowTops.push(y);
  }

  // Total row - only Description ("Total") and Amount are filled in, matching the print
  // template (no quantity total, no rate/per) - top+bottom rule the same weight as every
  // other border in the document.
  const totalRowH = px(20);
  if (y - totalRowH < BOTTOM) { finishTableGrid(tableTop, rowTops); newPage(); ensure(theadH + totalRowH + px(10)); tableTop = drawItemTableHeader(); rowTops = [y]; }
  hline(LEFT, y, RIGHT, BLACK, 0.75);
  const totalMidY = y - totalRowH / 2 - px(3);
  text('Total', colX.desc + padX, totalMidY, px(10), f.bold);
  rightText(`₹${money(d.finalPayable)}`, colX.amt + colW.amt - padX, totalMidY, px(10), f.bold);
  y -= totalRowH;
  hline(LEFT, y, RIGHT, BLACK, 0.75);
  rowTops = rowTops.filter(ry => ry !== y);
  finishTableGrid(tableTop, rowTops);
  y -= px(8);

  // ===================== Amount Chargeable (in words) + E.&O.E =====================
  // Matches InvoiceDocument.tsx's order exactly: Amount Chargeable comes before the
  // HSN-wise GST summary table, not after it.
  ensure(px(30));
  const wordsLines = wrap(f.regular, `INR ${d.words}`, px(10), CONTENT_W * 0.7 - px(6));
  text('Amount Chargeable (in words):', LEFT, y, px(10), f.bold);
  let wy = y - px(12);
  for (const wl of wordsLines) { text(wl, LEFT, wy, px(10), f.bold); wy -= px(12); }
  rightText('E.&O.E', RIGHT, y, px(9), f.regular);
  y = wy - px(4);

  // ===================== Tax breakdown (HSN-wise GST summary) =====================
  // Two-row header - HSN/SAC, Taxable Value and Total Tax Amount span both header rows;
  // CGST/SGST (or IGST) span two columns in row 1 with Rate/Amount as row 2 - matching
  // InvoiceDocument.tsx's <th rowspan="2">/<th colspan="2"> table exactly, not a single
  // flattened header row.
  // Full CONTENT_W, same as InvoiceDocument.tsx's table.gst-sum { width: 100% } - not a
  // fixed narrower width that leaves empty space to the right of the table.
  const ttColKeys = d.isIgst ? (['hsn', 'taxable', 'r1', 'a1', 'tot'] as const) : (['hsn', 'taxable', 'r1', 'a1', 'r2', 'a2', 'tot'] as const);
  const ttColRaw: Record<string, number> = { hsn: 50, taxable: 58, r1: 38, a1: 45, r2: 38, a2: 45, tot: 50 };
  const ttRawTotal = ttColKeys.reduce((s, k) => s + ttColRaw[k], 0);
  const ttColW: Record<string, number> = {};
  for (const k of ttColKeys) ttColW[k] = (ttColRaw[k] / ttRawTotal) * CONTENT_W;
  const ttTotalW = CONTENT_W;
  ensure(px(60));
  const ttX: Record<string, number> = {};
  let tcx = LEFT;
  for (const k of ttColKeys) { ttX[k] = tcx; tcx += ttColW[k]; }
  const ttHeadH = px(22);
  const ttHeadH1 = ttHeadH / 2;
  let tty = y;
  rectFill(LEFT, tty - ttHeadH, ttTotalW, ttHeadH, GRAY_BG);
  rect(LEFT, tty - ttHeadH, ttTotalW, ttHeadH, GRAY_BORDER, 0.75);

  const rowspanLabels: Record<string, string[]> = { hsn: ['HSN/SAC'], taxable: ['Taxable', 'Value'], tot: ['Total', 'Tax Amount'] };
  for (const k of ['hsn', 'taxable', 'tot'] as const) {
    if (!ttColKeys.includes(k)) continue;
    const lbl = rowspanLabels[k];
    if (lbl.length === 1) {
      centerText(lbl[0], ttX[k] + ttColW[k] / 2, tty - ttHeadH / 2 - px(3), px(7.5), f.bold);
    } else {
      let hy = tty - px(8);
      for (const l of lbl) { centerText(l, ttX[k] + ttColW[k] / 2, hy, px(7.5), f.bold); hy -= px(9); }
    }
  }

  const ttGroups: [string, string, string][] = d.isIgst ? [['r1', 'a1', 'IGST']] : [['r1', 'a1', 'CGST'], ['r2', 'a2', 'SGST/UTGST']];
  for (const [r, a, label] of ttGroups) {
    const groupW = ttColW[r] + ttColW[a];
    centerText(label, ttX[r] + groupW / 2, tty - ttHeadH1 / 2 - px(3), px(7.5), f.bold);
    centerText('Rate', ttX[r] + ttColW[r] / 2, tty - ttHeadH1 - ttHeadH1 / 2 - px(3), px(7.5), f.bold);
    centerText('Amount', ttX[a] + ttColW[a] / 2, tty - ttHeadH1 - ttHeadH1 / 2 - px(3), px(7.5), f.bold);
    hline(ttX[r], tty - ttHeadH1, ttX[a] + ttColW[a], GRAY_BORDER, 0.75);
    vline(ttX[a], tty - ttHeadH1, tty - ttHeadH, GRAY_BORDER, 0.75);
  }

  const ttInternalBoundary = new Set(ttGroups.map(([r, a]) => `${r}|${a}`));
  {
    let prevKey: string | null = null;
    for (const k of ttColKeys) {
      if (prevKey && !ttInternalBoundary.has(`${prevKey}|${k}`)) vline(ttX[k], tty, tty - ttHeadH, GRAY_BORDER, 0.75);
      prevKey = k;
    }
  }
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

  // Bold "Total" row - matches InvoiceDocument.tsx's gstSummaryHtml exactly (Rate columns
  // left blank, Taxable Value/Amount/Total Tax columns repeat the same figures since
  // there's only ever one HSN/SAC row today).
  rect(LEFT, tty - ttRowH, ttTotalW, ttRowH, GRAY_BORDER, 0.75);
  const ttTotalVals: Record<string, string> = d.isIgst
    ? { hsn: 'Total', taxable: money(d.taxable), a1: money(d.igstAmt), tot: money(d.totalTax) }
    : { hsn: 'Total', taxable: money(d.taxable), a1: money(d.cgstAmt), a2: money(d.sgstAmt), tot: money(d.totalTax) };
  ttColKeys.forEach((k, i) => {
    if (ttTotalVals[k]) centerText(ttTotalVals[k], ttX[k] + ttColW[k] / 2, tty - ttRowH / 2 - px(3), px(9), f.bold);
    if (i > 0) vline(ttX[k], tty, tty - ttRowH, GRAY_BORDER, 0.75);
  });
  tty -= ttRowH;

  tty -= px(10);
  text('Tax Amount (in words):', LEFT, tty, px(10), f.bold);
  const taxWordsLabelW = f.bold.widthOfTextAtSize('Tax Amount (in words): ', px(10));
  text(`INR ${amountInWords(d.totalTax)}`, LEFT + taxWordsLabelW, tty, px(10), f.regular);
  tty -= px(12);

  if (inv.remarks) {
    tty -= px(6);
    const remW = f.bold.widthOfTextAtSize('Remarks: ', px(10));
    const remLines = wrap(f.regular, inv.remarks, px(10), ttTotalW - remW);
    text('Remarks:', LEFT, tty, px(10), f.bold);
    text(` ${remLines[0] ?? ''}`, LEFT + remW, tty, px(10), f.regular);
    tty -= px(12);
    for (const rl of remLines.slice(1)) { text(rl, LEFT, tty, px(10), f.regular); tty -= px(12); }
  }

  y = tty - px(4);

  // ===================== Declaration + Bank details =====================
  ensure(px(75));
  let dy = y;
  text('DECLARATION', LEFT, dy, px(9), f.bold);
  dy -= px(12);
  for (const l of wrap(f.regular, d.declaration, px(10), COL_W - px(6))) { text(l, LEFT, dy, px(10), f.regular); dy -= px(12); }

  let by = y;
  if (d.hasBank) {
    text("COMPANY'S BANK DETAILS", MID_X + px(6), by, px(9), f.bold);
    by -= px(12);
    const bankRows: [string, string][] = [
      ...(d.bankAcctName ? [["A/c Holder's Name:", d.bankAcctName] as [string, string]] : []),
      ...(d.bankName ? [['Bank Name:', d.bankName] as [string, string]] : []),
      ...(d.bankAcctNo ? [['A/c No.:', d.bankAcctNo] as [string, string]] : []),
      ...((d.bankBranch || d.bankIfsc) ? [['Branch & IFS Code:', [d.bankBranch, d.bankIfsc].filter(Boolean).join(' - ')] as [string, string]] : []),
    ];
    for (const [label, val] of bankRows) { boldPrefixLine(label, val, MID_X + px(6), by, px(10)); by -= px(12); }
  }
  y = Math.min(dy, by) - px(3);

  // ===================== Footer =====================
  ensure(px(20));
  y -= px(4);
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
