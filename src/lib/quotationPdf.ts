import { PDFDocument, rgb, type PDFFont, type PDFPage, type PDFImage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Quotation, CompanySettings } from '@/types';
import { supabase } from '@/lib/supabase';
import { parseRichText, type RichTextBlock, type StyleRun } from '@/lib/richText';

export type QuotationPdfData = Quotation;
export type QuotationEquipmentPdfData = unknown[];
export type CompanySettingsPdfData = Pick<CompanySettings,
  'company_name' | 'authorized_signatory' | 'signature_path' | 'stamp_path' |
  'address' | 'phone' | 'email' | 'gstin' | 'state' |
  'bank_name' | 'bank_account_name' | 'bank_account_number' | 'bank_ifsc'
>;

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const LEFT = 42;
const RIGHT = A4_WIDTH - 42;
const CONTENT_WIDTH = RIGHT - LEFT;
const BOTTOM = 58;
const FIRST_PAGE_TOP = A4_HEIGHT - 116;
const OTHER_PAGE_TOP = A4_HEIGHT - 52;
const NAVY = rgb(0.04, 0.14, 0.32);
const BLACK = rgb(0.03, 0.03, 0.03);
const BORDER = rgb(0.56, 0.60, 0.66);

type EmbeddedImage = PDFImage;

function text(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function money(value: number): string {
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function date(value: string): string {
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function amountInWords(amount: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n: number): string => n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${ones[n % 10]}` : ''}`;
  const three = (n: number): string => `${n >= 100 ? `${ones[Math.floor(n / 100)]} Hundred` : ''}${n % 100 ? `${n >= 100 ? ' ' : ''}${two(n % 100)}` : ''}`;
  let n = Math.round(amount);
  if (!n) return 'Zero Rupees Only';
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${two(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (n) parts.push(three(n));
  return `${parts.join(' ')} Rupees Only`;
}

function terms(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = normalized.includes('\n') ? normalized.split('\n') : normalized.split(/(?=\d+\.\s)/);
  return rows.map(row => row.replace(/^\s*\d+\.\s*/, '').trim()).filter(Boolean);
}

function wrap(font: PDFFont, value: string, size: number, maxWidth: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else current = candidate;
  }
  if (current) lines.push(current);
  return lines;
}

function drawWrapped(page: PDFPage, font: PDFFont, value: string, x: number, y: number, maxWidth: number, size: number, color = BLACK, lineGap = 2): number {
  const lines = wrap(font, value, size, maxWidth);
  lines.forEach((line, index) => page.drawText(line, { x, y: y - index * (size + lineGap), size, font, color }));
  return y - lines.length * (size + lineGap);
}

interface RunLayoutWord {
  text: string;
  run: StyleRun;
  width: number;
}

function runFont(run: StyleRun, regular: PDFFont, bold: PDFFont): PDFFont {
  return run.bold ? bold : regular;
}

function layoutRuns(runs: StyleRun[], regular: PDFFont, bold: PDFFont, size: number, maxWidth: number): RunLayoutWord[][] {
  const words: RunLayoutWord[] = [];
  for (const run of runs) {
    const parts = run.text.split(/(\s+)/);
    for (const part of parts) {
      if (!part) continue;
      const font = runFont(run, regular, bold);
      words.push({ text: part, run, width: font.widthOfTextAtSize(part, size) });
    }
  }
  const lines: RunLayoutWord[][] = [];
  let line: RunLayoutWord[] = [];
  let lineWidth = 0;
  for (const word of words) {
    const isSpace = /^\s+$/.test(word.text);
    const candidateWidth = lineWidth + word.width;
    if (!isSpace && lineWidth > 0 && candidateWidth > maxWidth) {
      lines.push(line);
      line = [];
      lineWidth = 0;
    }
    if (isSpace && line.length === 0) continue;
    line.push(word);
    lineWidth += word.width;
  }
  if (line.length) lines.push(line);
  return lines;
}

function drawStyledRuns(
  page: PDFPage,
  runs: StyleRun[],
  regular: PDFFont,
  bold: PDFFont,
  x: number,
  y: number,
  maxWidth: number,
  size: number,
  color = BLACK,
  lineGap = 2,
): number {
  const lines = layoutRuns(runs, regular, bold, size, maxWidth);
  const lineHeight = size + lineGap;
  lines.forEach((line, lineIndex) => {
    let cx = x;
    for (const word of line) {
      const font = runFont(word.run, regular, bold);
      page.drawText(word.text, { x: cx, y: y - lineIndex * lineHeight, size, font, color });
      cx += word.width;
    }
  });
  return y - lines.length * lineHeight;
}

function styledRunsHeight(runs: StyleRun[], regular: PDFFont, bold: PDFFont, size: number, maxWidth: number, lineGap = 2): number {
  const lines = layoutRuns(runs, regular, bold, size, maxWidth);
  return lines.length * (size + lineGap);
}

async function embedImage(pdf: PDFDocument, path: string | null | undefined): Promise<EmbeddedImage | null> {
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

function drawImageContain(page: PDFPage, image: EmbeddedImage, x: number, y: number, maxWidth: number, maxHeight: number): void {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawImage(image, { x: x + (maxWidth - width) / 2, y: y - height, width, height });
}

interface PdfState {
  page: PDFPage;
  number: number;
  y: number;
}

export async function generateQuotationPdf(
  quotation: QuotationPdfData,
  _equipment: QuotationEquipmentPdfData[],
  settings: CompanySettingsPdfData | null,
  letterheadBytes: Uint8Array,
  regularFontBytes: Uint8Array,
  boldFontBytes: Uint8Array,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(regularFontBytes);
  const bold = await pdf.embedFont(boldFontBytes);
  const template = await PDFDocument.load(letterheadBytes);
  const signature = await embedImage(pdf, settings?.signature_path);
  const stamp = await embedImage(pdf, settings?.stamp_path);
  const pages: PdfState[] = [];
  const copiedPages: PDFPage[] = [];
  for (let index = 0; index < Math.min(3, template.getPageCount()); index++) {
    const [page] = await pdf.copyPages(template, [index]);
    copiedPages.push(page);
  }
  const addPage = (): PdfState => {
    const background = copiedPages[Math.min(pages.length, copiedPages.length - 1)];
    const page = pdf.addPage(background);
    const state = { page, number: pages.length + 1, y: pages.length === 0 ? FIRST_PAGE_TOP : OTHER_PAGE_TOP };
    pages.push(state);
    return state;
  };

  let current = addPage();
  const ensure = (height: number): void => {
    if (current.y - height < BOTTOM && current.number < 3) current = addPage();
  };
  const heading = (value: string): void => {
    ensure(22);
    current.page.drawText(value, { x: LEFT, y: current.y, size: 10, font: bold, color: BLACK });
    current.y -= 16;
  };
  const paragraph = (value: string, size = 9, gap = 5): void => {
    const lines = wrap(regular, value, size, CONTENT_WIDTH);
    ensure(lines.length * (size + 2) + gap);
    current.y = drawWrapped(current.page, regular, value, LEFT, current.y, CONTENT_WIDTH, size) - gap;
  };
  const bullet = (value: string, size = 7, gap = 4): void => {
    const indent = 10;
    const lines = wrap(regular, value, size, CONTENT_WIDTH - indent);
    ensure(lines.length * (size + 2) + gap);
    current.page.drawText('\u2022', { x: LEFT, y: current.y, size, font: regular, color: BLACK });
    current.y = drawWrapped(current.page, regular, value, LEFT + indent, current.y, CONTENT_WIDTH - indent, size) - gap;
  };
  const renderRichBlocks = (html: string, size = 7, gap = 4): void => {
    const isHtml = /<[a-z!]/i.test(html);
    const blocks = isHtml ? parseRichText(html) : html.split('\n').filter(Boolean).map((line): RichTextBlock => {
      const isBullet = /^[•\-*]\s/.test(line.trim()) || /^\d+\.\s/.test(line.trim());
      const cleaned = line.replace(/^[•\-*]\s*/, '').replace(/^\d+\.\s*/, '');
      return { type: isBullet ? 'bullet' : 'paragraph', runs: [{ text: cleaned, bold: false, italic: false, underline: false }] };
    });
    for (const block of blocks) {
      const indent = block.type !== 'paragraph' ? 12 : 0;
      const width = CONTENT_WIDTH - indent;
      const h = styledRunsHeight(block.runs, regular, bold, size, width);
      ensure(h + gap);
      if (block.type === 'bullet') {
        current.page.drawText('\u2022', { x: LEFT, y: current.y, size, font: regular, color: BLACK });
      } else if (block.type === 'numbered') {
        // Numbered handled by content itself
      }
      current.y = drawStyledRuns(current.page, block.runs, regular, bold, LEFT + indent, current.y, width, size) - gap;
    }
  };

  current.page.drawText('QUOTATION', { x: A4_WIDTH / 2 - bold.widthOfTextAtSize('QUOTATION', 18) / 2, y: current.y, size: 18, font: bold, color: NAVY });
  current.y -= 26;
  current.page.drawText(`Quotation No: ${text(quotation.quotation_number) || '-'}`, { x: RIGHT - 170, y: current.y, size: 9, font: regular, color: BLACK });
  current.y -= 12;
  current.page.drawText(`Date: ${date(quotation.quotation_date)}`, { x: RIGHT - 170, y: current.y, size: 9, font: regular, color: BLACK });
  if (quotation.valid_until) { current.y -= 12; current.page.drawText(`Valid Until: ${date(quotation.valid_until)}`, { x: RIGHT - 170, y: current.y, size: 9, font: regular, color: BLACK }); }
  current.y -= 18;
  current.page.drawLine({ start: { x: LEFT, y: current.y }, end: { x: RIGHT, y: current.y }, thickness: 0.5, color: BORDER });
  current.y -= 16;

  heading('To:');
  current.y = drawWrapped(current.page, bold, text(quotation.customer_name) || '-', LEFT, current.y, CONTENT_WIDTH, 10) - 2;
  if (quotation.customer_address) paragraph(text(quotation.customer_address), 9, 2);
  const contact = [quotation.customer_phone && `Phone: ${quotation.customer_phone}`, quotation.customer_gstin && `GSTIN: ${quotation.customer_gstin}`, quotation.customer_email && `Email: ${quotation.customer_email}`].filter(Boolean).join('  |  ');
  if (contact) paragraph(contact, 9, 8);

  // Subject — simple bold line, no box
  if (quotation.subject) {
    ensure(16);
    current.page.drawText(`Sub: ${text(quotation.subject)}`, { x: LEFT, y: current.y, size: 10, font: bold, color: BLACK, maxWidth: CONTENT_WIDTH });
    current.y -= 14;
  }
  if (quotation.reference_no) paragraph(`Reference No: ${text(quotation.reference_no)}`, 9, 2);
  if (quotation.site_location) paragraph(`Work Location: ${text(quotation.site_location)}`, 9, 4);
  paragraph('With reference to the above subject, we hereby quote for the supply of our crane/services as per the charges detailed below.', 9, 10);

  // Build active charges array — filter out inactive/zero items
  const otherCharges = quotation.other_charges_json ?? (quotation.other_charges_description ? [{ description: quotation.other_charges_description, amount: quotation.other_charges_amount ?? 0 }] : []);

  const chargesRows: { desc: string; amt: number }[] = [];
  if (quotation.service_amount_enabled !== false && (quotation.quotation_amount ?? 0) > 0)
    chargesRows.push({ desc: 'Service Amount', amt: quotation.quotation_amount ?? 0 });
  if (quotation.up_transportation_enabled && (quotation.up_transportation_amount ?? 0) > 0)
    chargesRows.push({ desc: text(quotation.up_transportation_description) || 'Up & Down Transportation', amt: quotation.up_transportation_amount });
  otherCharges.forEach(c => { if ((c.amount ?? 0) > 0) chargesRows.push({ desc: text(c.description) || 'Other Charges', amt: c.amount }); });

  const descWidth = CONTENT_WIDTH * 0.70;

  // Only render Charges Details if there are active charges
  if (chargesRows.length > 0) {
    const drawChargesHeader = (): void => {
      current.page.drawText('Description', { x: LEFT, y: current.y, size: 9, font: bold, color: BLACK });
      current.page.drawText('Amount', { x: RIGHT - bold.widthOfTextAtSize('Amount', 9), y: current.y, size: 9, font: bold, color: BLACK });
      current.y -= 5;
      current.page.drawLine({ start: { x: LEFT, y: current.y }, end: { x: RIGHT, y: current.y }, thickness: 0.7, color: NAVY });
      current.y -= 14;
    };
    heading('CHARGES DETAILS');
    ensure(40);
    drawChargesHeader();

    for (const row of chargesRows) {
      if (current.y - 16 < BOTTOM) { current = addPage(); drawChargesHeader(); }
      current.page.drawText(row.desc, { x: LEFT, y: current.y, size: 9, font: regular, color: BLACK, maxWidth: descWidth - 8 });
      current.page.drawText(money(row.amt), { x: RIGHT - regular.widthOfTextAtSize(money(row.amt), 9), y: current.y, size: 9, font: regular, color: BLACK });
      current.y -= 14;
    }
    current.y -= 8;
    ensure(82);

    const showSubtotal = chargesRows.length > 1 || quotation.gst_enabled;
    const totalX = RIGHT - 200;
    const totalRow = (label: string, value: string, strong = false): void => {
      const f = strong ? bold : regular;
      const sz = strong ? 10 : 9;
      current.page.drawText(label, { x: totalX, y: current.y, size: sz, font: f, color: BLACK });
      current.page.drawText(value, { x: RIGHT - f.widthOfTextAtSize(value, sz), y: current.y, size: sz, font: f, color: BLACK });
      current.y -= strong ? 18 : 14;
    };
    if (showSubtotal) totalRow('Subtotal', money(quotation.subtotal));
    if (quotation.gst_enabled) totalRow(`GST (${quotation.gst_percent}%)`, money(quotation.gst_amount));
    // Clean separator line above GRAND TOTAL — spans only the totals column
    current.page.drawLine({ start: { x: totalX, y: current.y + 4 }, end: { x: RIGHT, y: current.y + 4 }, thickness: 0.5, color: NAVY });
    totalRow('GRAND TOTAL', `${money(quotation.grand_total)} RS`, true);
    current.y -= 2;
    paragraph(`Amount in Words: ${amountInWords(quotation.grand_total)}`, 8.5, 10);
  }

  const cleanTerms = quotation.terms_and_conditions;
  const allTerms = terms(cleanTerms);
  if (allTerms.length) {
    heading('TERMS AND CONDITIONS');
    const isHtml = /<[a-z!]/i.test(cleanTerms ?? '');
    if (isHtml) {
      renderRichBlocks(cleanTerms!, 8.5, 3);
    } else {
      allTerms.forEach((term, index) => paragraph(`${index + 1}. ${term}`, 8.5, 3));
    }
  }
  if (quotation.payment_terms) {
    heading('PAYMENT TERMS');
    const isHtml = /<[a-z!]/i.test(quotation.payment_terms);
    if (isHtml) {
      renderRichBlocks(quotation.payment_terms, 8.5, 4);
    } else {
      const paymentLines = text(quotation.payment_terms).split('\n').filter(Boolean);
      paymentLines.forEach(pt => bullet(pt, 8.5, 4));
    }
    current.y -= 4;
  }
  heading('NOTE');
  paragraph('We should receive the work order as per our quotation terms and conditions & payment has to receive on or before 7 days from the date of bill submission.', 9, 10);
  ensure(80);
  heading('COMPANY BILLING DETAILS');
  paragraph(text(settings?.company_name) || 'Padmavathi Earth Movers and Crane Services', 9.5, 2);
  paragraph(text(settings?.address) || 'H-NO 1-5-1118/24, ROAD NO.1 AND 2, PAKALA KUNTA, PANCHASHILA COLONY, OLD ALWAL, HYDERABAD - 500010', 9, 2);
  paragraph(`GSTIN: ${text(settings?.gstin) || '36ALVPA9612Q2ZA'}`, 9, 2);
  paragraph(`State Name: ${text(settings?.state) || 'Telangana'}.`, 9, 8);
  heading('COMPANY BANK DETAILS');
  paragraph(text(settings?.company_name) || 'Padmavathi Earth Movers and Crane Services', 9.5, 2);
  paragraph(`Bank Name: ${text(settings?.bank_name) || 'Axis Bank LTD'}`, 9, 2);
  paragraph(`A/C No: ${text(settings?.bank_account_number) || '914020039371713'}`, 9, 2);
  paragraph(`IFS Code: ${text(settings?.bank_ifsc) || 'UTIB0001378'}`, 9, 8);
  const forLine = `For ${(text(settings?.company_name) || 'PADMAVATHI').toUpperCase()}`;
  const forLineMaxWidth = 170;
  const forLineCount = wrap(bold, forLine, 9, forLineMaxWidth).length;
  ensure(90 + Math.max(0, forLineCount - 1) * 11);
  current.y = drawWrapped(current.page, bold, forLine, RIGHT - 170, current.y, forLineMaxWidth, 9, BLACK, 2);
  current.y -= 2;
  if (stamp) { drawImageContain(current.page, stamp, RIGHT - 170, current.y, 150, 52); current.y -= 58; }
  if (signature) { drawImageContain(current.page, signature, RIGHT - 170, current.y, 150, 42); current.y -= 48; }
  current.page.drawText(text(settings?.authorized_signatory) || 'AUTHORIZED SIGNATORY', { x: RIGHT - 160, y: current.y, size: 8.5, font: regular, color: BLACK });

  if (pages.length > 3) throw new Error('Quotation content exceeds the supported three-page letterhead.');
  return pdf.save();
}

let regularFont: Uint8Array | null = null;
let boldFont: Uint8Array | null = null;

async function loadAssets(): Promise<{ regular: Uint8Array; bold: Uint8Array; template: Uint8Array }> {
  if (!regularFont) regularFont = new Uint8Array(await (await fetch('/fonts/NotoSans-Regular.ttf')).arrayBuffer());
  if (!boldFont) boldFont = new Uint8Array(await (await fetch('/fonts/NotoSans-Bold.ttf')).arrayBuffer());
  const template = new Uint8Array(await (await fetch('/quotation-templates/Padmavathi_3_Page_Letterhead_Darker_Watermark copy.pdf')).arrayBuffer());
  return { regular: regularFont, bold: boldFont, template };
}

export async function generateQuotationPdfFromUrl(
  quotation: QuotationPdfData,
  equipment: QuotationEquipmentPdfData[],
  settings: CompanySettingsPdfData | null,
): Promise<Uint8Array> {
  const assets = await loadAssets();
  return generateQuotationPdf(quotation, equipment, settings, assets.template, assets.regular, assets.bold);
}
