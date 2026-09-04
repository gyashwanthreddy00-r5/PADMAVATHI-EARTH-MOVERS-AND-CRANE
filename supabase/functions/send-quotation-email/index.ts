import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { PDFDocument, rgb, type PDFFont, type PDFPage, type PDFImage } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:fontkit@2.0.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function amountInWords(amount: number): string {
  const num = Math.round(amount);
  if (num === 0) return "Zero Rupees Only";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (n: number): string => n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${ones[n % 10]}` : ""}`;
  const three = (n: number): string => `${n >= 100 ? `${ones[Math.floor(n / 100)]} Hundred` : ""}${n % 100 ? `${n >= 100 ? " " : ""}${two(n % 100)}` : ""}`;
  let n = num;
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${two(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (n) parts.push(three(n));
  return `${parts.join(" ")} Rupees Only`;
}

function replaceTemplateVariables(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

const txt = (value: unknown): string => String(value ?? "").replace(/\s+/g, " ").trim();

interface SStyleRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

interface SRichTextBlock {
  type: "paragraph" | "bullet" | "numbered";
  runs: SStyleRun[];
}

function parseRichTextServer(html: string | null | undefined): SRichTextBlock[] {
  if (!html || !html.trim()) return [];
  const blocks: SRichTextBlock[] = [];

  const decodeEntities = (s: string): string =>
    s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/\u00a0/g, " ");

  const stripTags = (s: string): string => decodeEntities(s.replace(/<[^>]*>/g, ""));

  const extractRuns = (segment: string): SStyleRun[] => {
    const runs: SStyleRun[] = [];
    const tagPattern = /<(\/?)(b|strong|i|em|u)([^>]*)>/gi;
    let lastIndex = 0;
    const stack: { bold: boolean; italic: boolean; underline: boolean }[] = [{ bold: false, italic: false, underline: false }];
    let match: RegExpExecArray | null;

    while ((match = tagPattern.exec(segment)) !== null) {
      if (match.index > lastIndex) {
        const text = decodeEntities(segment.slice(lastIndex, match.index));
        if (text) {
          const current = stack[stack.length - 1];
          runs.push({ text, bold: current.bold, italic: current.italic, underline: current.underline });
        }
      }
      const isClosing = match[1] === "/";
      const tag = match[2].toLowerCase();
      if (isClosing && stack.length > 1) {
        stack.pop();
      } else if (!isClosing) {
        const current = stack[stack.length - 1];
        stack.push({
          bold: current.bold || tag === "b" || tag === "strong",
          italic: current.italic || tag === "i" || tag === "em",
          underline: current.underline || tag === "u",
        });
      }
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < segment.length) {
      const text = decodeEntities(segment.slice(lastIndex));
      if (text) {
        const current = stack[stack.length - 1];
        runs.push({ text, bold: current.bold, italic: current.italic, underline: current.underline });
      }
    }
    return runs.length ? runs : [{ text: stripTags(segment), bold: false, italic: false, underline: false }];
  };

  // Tokenize HTML into a flat sequence of [tag, content] tokens.
  // Block-level tags (div, p, li, ul, ol, br) act as block separators.
  // Inline tags (b, strong, i, em, u, span, a) are kept within their block.
  const BLOCK_TAGS = new Set(["div", "p", "li", "ul", "ol", "table", "tr", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6", "br"]);

  interface Token {
    type: "text" | "block-open" | "block-close" | "inline" | "inline-close";
    tag?: string;
    content?: string;
  }

  const tokenize = (htmlStr: string): Token[] => {
    const tokens: Token[] = [];
    const tagRe = /<\/?([a-z][a-z0-9]*)[^>]*>/gi;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(htmlStr)) !== null) {
      if (m.index > last) {
        const text = htmlStr.slice(last, m.index);
        if (text.trim()) tokens.push({ type: "text", content: text });
      }
      const fullTag = m[0];
      const tagName = m[1].toLowerCase();
      const isClosing = fullTag.startsWith("</");
      if (tagName === "br") {
        tokens.push({ type: "block-open", tag: "br" });
        tokens.push({ type: "block-close", tag: "br" });
      } else if (BLOCK_TAGS.has(tagName)) {
        tokens.push({ type: isClosing ? "block-close" : "block-open", tag: tagName });
      } else {
        tokens.push({ type: isClosing ? "inline-close" : "inline", tag: tagName, content: fullTag });
      }
      last = m.index + fullTag.length;
    }
    if (last < htmlStr.length) {
      const text = htmlStr.slice(last);
      if (text.trim()) tokens.push({ type: "text", content: text });
    }
    return tokens;
  };

  // Process tokens into blocks. Inline content accumulates into the current
  // inline buffer. Block-open/close boundaries flush the buffer as a block.
  // List items are tracked via ul/ol/li nesting.
  const listStack: string[] = [];
  let inlineBuffer = "";

  const flushInline = (): void => {
    const trimmed = inlineBuffer.trim();
    if (trimmed) {
      const inList = listStack.length > 0 && listStack[listStack.length - 1] === "li";
      const listType = listStack.find((t) => t === "ul" || t === "ol");
      if (inList && listType) {
        const blockType = listType === "ul" ? "bullet" : "numbered";
        const runs = extractRuns(trimmed);
        const text = runs.map((r) => r.text).join("").trim();
        if (text) blocks.push({ type: blockType, runs });
      } else {
        const runs = extractRuns(trimmed);
        const text = runs.map((r) => r.text).join("").trim();
        if (text) blocks.push({ type: "paragraph", runs });
      }
    }
    inlineBuffer = "";
  };

  const tokens = tokenize(html);

  for (const token of tokens) {
    if (token.type === "text") {
      inlineBuffer += token.content;
    } else if (token.type === "inline" || token.type === "inline-close") {
      // Keep inline tags in the buffer so extractRuns can process them
      if (token.content) inlineBuffer += token.content;
    } else if (token.type === "block-open") {
      if (token.tag === "br") {
        flushInline();
      } else if (token.tag === "ul" || token.tag === "ol") {
        flushInline();
        listStack.push(token.tag);
      } else if (token.tag === "li") {
        flushInline();
        listStack.push("li");
      } else {
        flushInline();
      }
    } else if (token.type === "block-close") {
      if (token.tag === "br") {
        flushInline();
      } else if (token.tag === "ul" || token.tag === "ol") {
        flushInline();
        const idx = listStack.lastIndexOf(token.tag);
        if (idx >= 0) listStack.splice(idx);
      } else if (token.tag === "li") {
        flushInline();
        const idx = listStack.lastIndexOf("li");
        if (idx >= 0) listStack.splice(idx);
      } else {
        flushInline();
      }
    }
  }
  flushInline();

  if (blocks.length === 0) {
    const plain = stripTags(html).split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of plain) {
      const isBullet = /^[\u2022*-]\s/.test(line);
      blocks.push({
        type: isBullet ? "bullet" : "paragraph",
        runs: [{ text: isBullet ? line.replace(/^[\u2022*-]\s*/, "") : line, bold: false, italic: false, underline: false }],
      });
    }
  }

  return blocks;
}

function parseTerms(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const normalized = String(raw).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows = normalized.includes("\n") ? normalized.split("\n") : normalized.split(/(?=\d+\.\s)/);
  return rows.map(row => row.replace(/^\s*\d+\.\s*/, "").trim()).filter(Boolean);
}

// Payment keywords to strip from Terms & Conditions (they belong in Payment section only)
const PAYMENT_KEYWORDS: RegExp[] = [
  /payment\s+(should|shall|terms|due|has\s+not|within|must|is\s+to|be\s+made|be\s+done)/i,
  /payment\s+terms/i,
  /advance\s*[:\(]/i,
  /advance\s+(50%|amount|should|is\s+to|of\s+the)/i,
  /within\s+7\s*days?\s+from\s+the\s+date\s+of\s+bill/i,
  /within\s+7\s*days?\s+from\s+closing/i,
  /18\s*%\s+interest/i,
  /5\s*%\s+(additional|on\s+invoice)/i,
  /additional\s+charges?\s+(will\s+apply|on\s+invoice)/i,
  /invoices?\s+payments?\s+should\s+be\s+done/i,
  /if\s+incase\s+the\s+payment/i,
  /if\s+the\s+client\s+fails\s+to\s+make\s+payment/i,
  /interest\s+at\s+the\s+rate\s+of\s+18/i,
  /late\s+payment/i,
  /GST\s*:\s*EXTRA/i,
  /VALIDITY\s*:/i,
  /JURISDICTION\s*:/i,
  /quotation\s+validity/i,
  /this\s+offer\s+will\s+be\s+kept\s+open/i,
  /disputes?\s+(in\s+connection|shall|be\s+addressed)/i,
  /subject\s+to\s+hyderabad\s+jurisdiction/i,
  /court\s+of\s+competent\s+jurisdiction/i,
  /the\s+client\s+shall\s+pay\s+the\s+fees/i,
  /PEM&CS\s+invoices/i,
];

function isPaymentLine(plainText: string): boolean {
  const trimmed = plainText.trim().replace(/^\s*\d+[.)]?\s*/, "").replace(/^[•\-*]\s*/, "").trim();
  if (!trimmed) return false;
  return PAYMENT_KEYWORDS.some((re) => re.test(trimmed));
}

function sanitizeTermsText(raw: string | null | undefined): string {
  if (!raw) return "";
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").filter(Boolean);
  const kept = lines.filter((line) => !isPaymentLine(line));
  return kept.join("\n");
}

function sanitizeTermsHtml(raw: string | null | undefined): string {
  if (!raw) return "";
  const isHtml = /<[a-z!]/i.test(raw);
  if (!isHtml) return sanitizeTermsText(raw);

  const blockPattern = /<(p|div|li)[^>]*>([\s\S]*?)<\/\1>|<br\s*\/?>/gi;
  const blocks: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = blockPattern.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      const between = raw.slice(lastIndex, match.index).replace(/<\/?(ul|ol)[^>]*>/gi, "").trim();
      if (between) blocks.push(between);
    }
    if (match[0].toLowerCase().startsWith("<br")) {
      // br is a separator
    } else if (match[2]) {
      blocks.push(match[2].trim());
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < raw.length) {
    const remaining = raw.slice(lastIndex).replace(/<\/?(ul|ol)[^>]*>/gi, "").trim();
    if (remaining) blocks.push(remaining);
  }

  if (blocks.length === 0) {
    const cleaned = raw.replace(/<[^>]*>/g, "").trim();
    if (cleaned && !isPaymentLine(cleaned)) return raw;
    return "";
  }

  const keptBlocks = blocks.filter((blockHtml) => {
    const plainText = blockHtml.replace(/<[^>]*>/g, "").trim();
    return plainText && !isPaymentLine(plainText);
  });

  if (keptBlocks.length === 0) return "";
  return keptBlocks.map((b) => `<div>${b}</div>`).join("");
}

function sanitizeTerms(raw: string | null | undefined): string {
  if (!raw) return "";
  const isHtml = /<[a-z!]/i.test(raw);
  return isHtml ? sanitizeTermsHtml(raw) : sanitizeTermsText(raw);
}

interface RunLayoutWord {
  text: string;
  run: SStyleRun;
  width: number;
}

function runFont(run: SStyleRun, regular: PDFFont, bold: PDFFont): PDFFont {
  return run.bold ? bold : regular;
}

function layoutRuns(runs: SStyleRun[], regular: PDFFont, bold: PDFFont, size: number, maxWidth: number): RunLayoutWord[][] {
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
  runs: SStyleRun[],
  regular: PDFFont,
  bold: PDFFont,
  x: number,
  y: number,
  maxWidth: number,
  size: number,
  color: ReturnType<typeof rgb> = rgb(0.03, 0.03, 0.03),
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

function styledRunsHeight(runs: SStyleRun[], regular: PDFFont, bold: PDFFont, size: number, maxWidth: number, lineGap = 2): number {
  const lines = layoutRuns(runs, regular, bold, size, maxWidth);
  return lines.length * (size + lineGap);
}

function wrap(font: PDFFont, value: string, size: number, maxWidth: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) { lines.push(current); current = word; }
    else current = candidate;
  }
  if (current) lines.push(current);
  return lines;
}

function drawWrapped(page: PDFPage, font: PDFFont, value: string, x: number, y: number, maxWidth: number, size: number, color: ReturnType<typeof rgb> = rgb(0.03, 0.03, 0.03), lineGap = 2): number {
  const lines = wrap(font, value, size, maxWidth);
  lines.forEach((line, index) => page.drawText(line, { x, y: y - index * (size + lineGap), size, font, color }));
  return y - lines.length * (size + lineGap);
}

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
const WHITE = rgb(1, 1, 1);

let cachedRegularFont: Uint8Array | null = null;
let cachedBoldFont: Uint8Array | null = null;

async function loadFonts(): Promise<{ regular: Uint8Array; bold: Uint8Array }> {
  if (!cachedRegularFont) {
    const res = await fetch("https://cdn.jsdelivr.net/npm/@fontsource/noto-sans@5.0.12/files/noto-sans-latin-400-normal.woff");
    if (!res.ok) throw new Error("Could not load Noto Sans Regular font");
    cachedRegularFont = woffToTtf(new Uint8Array(await res.arrayBuffer()));
  }
  if (!cachedBoldFont) {
    const res = await fetch("https://cdn.jsdelivr.net/npm/@fontsource/noto-sans@5.0.12/files/noto-sans-latin-700-normal.woff");
    if (!res.ok) throw new Error("Could not load Noto Sans Bold font");
    cachedBoldFont = woffToTtf(new Uint8Array(await res.arrayBuffer()));
  }
  return { regular: cachedRegularFont, bold: cachedBoldFont };
}

function woffToTtf(woff: Uint8Array): Uint8Array {
  const view = new DataView(woff.buffer);
  const flavour = view.getUint32(4);
  const numTables = view.getUint16(12);
  const tableDir: { tag: string; offset: number; compLength: number; origLength: number; origChecksum: number }[] = [];
  for (let i = 0; i < numTables; i++) {
    const off = 44 + i * 20;
    tableDir.push({ tag: new TextDecoder().decode(woff.subarray(off, off + 4)), offset: view.getUint32(off + 4), compLength: view.getUint32(off + 8), origLength: view.getUint32(off + 12), origChecksum: view.getUint32(off + 16) });
  }
  const headerSize = 12 + numTables * 16;
  let dataOffset = headerSize;
  const tables: { tag: string; data: Uint8Array; newOffset: number; origChecksum: number; origLength: number }[] = [];
  for (const entry of tableDir) {
    const compData = woff.subarray(entry.offset, entry.offset + entry.compLength);
    let tableData: Uint8Array;
    if (entry.compLength < entry.origLength) { tableData = decompressZlib(compData, entry.origLength); }
    else { tableData = compData; }
    tables.push({ tag: entry.tag, data: tableData, newOffset: dataOffset, origChecksum: entry.origChecksum, origLength: entry.origLength });
    dataOffset += entry.origLength;
    while (dataOffset % 4 !== 0) dataOffset++;
  }
  const ttf = new Uint8Array(dataOffset);
  const ttfView = new DataView(ttf.buffer);
  ttfView.setUint32(0, flavour);
  ttfView.setUint16(4, numTables);
  const searchRange = Math.pow(2, Math.floor(Math.log2(numTables))) * 16;
  const entrySelector = Math.floor(Math.log2(numTables));
  const rangeShift = numTables * 16 - searchRange;
  ttfView.setUint16(6, searchRange);
  ttfView.setUint16(8, entrySelector);
  ttfView.setUint16(10, rangeShift);
  for (let i = 0; i < tables.length; i++) {
    const off = 12 + i * 16;
    ttf.set(new TextEncoder().encode(tables[i].tag), off);
    ttfView.setUint32(off + 4, tables[i].origChecksum);
    ttfView.setUint32(off + 8, tables[i].newOffset);
    ttfView.setUint32(off + 12, tables[i].origLength);
  }
  for (const t of tables) { ttf.set(t.data, t.newOffset); }
  return ttf;
}

function decompressZlib(data: Uint8Array, _expectedLength: number): Uint8Array {
  const ds = new DecompressionStream("deflate");
  const writer = ds.writable.getWriter();
  writer.write(data);
  writer.close();
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLen = 0;
  // deno-lint-ignore no-explicit-any
  return Promise.resolve().then(async () => {
    let result: any;
    while (!(result = await reader.read()).done) {
      chunks.push(new Uint8Array(result.value));
      totalLen += result.value.length;
    }
    const out = new Uint8Array(totalLen);
    let pos = 0;
    for (const c of chunks) { out.set(c, pos); pos += c.length; }
    return out;
  }) as unknown as Uint8Array;
}

async function fetchStorageImage(adminClient: ReturnType<typeof createClient>, path: string | null | undefined): Promise<PDFImage | null> {
  if (!path) return null;
  try {
    const { data } = await adminClient.storage.from("quotation-assets").createSignedUrl(path, 300);
    if (!data?.signedUrl) return null;
    const res = await fetch(data.signedUrl);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return path.toLowerCase().includes(".png") ? await (await PDFDocument.create()).embedPng(bytes).catch(() => null) : null;
  } catch {
    return null;
  }
}

async function embedImageFromBytes(pdf: PDFDocument, adminClient: ReturnType<typeof createClient>, path: string | null | undefined): Promise<PDFImage | null> {
  if (!path) return null;
  try {
    const { data } = await adminClient.storage.from("quotation-assets").createSignedUrl(path, 300);
    if (!data?.signedUrl) return null;
    const res = await fetch(data.signedUrl);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("png") || path.toLowerCase().includes(".png")) return await pdf.embedPng(bytes);
    return await pdf.embedJpg(bytes);
  } catch {
    return null;
  }
}

function drawImageContain(page: PDFPage, image: PDFImage, x: number, y: number, maxWidth: number, maxHeight: number): void {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawImage(image, { x: x + (maxWidth - width) / 2, y: y - height, width, height });
}

async function generateQuotationPdf(
  quotation: Record<string, unknown>,
  _equipment: Record<string, unknown>[],
  settings: Record<string, unknown> | null,
  letterheadBytes: Uint8Array,
  regularFontBytes: Uint8Array,
  boldFontBytes: Uint8Array,
  adminClient: ReturnType<typeof createClient>,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(regularFontBytes) as PDFFont;
  const bold = await pdf.embedFont(boldFontBytes) as PDFFont;
  const template = await PDFDocument.load(letterheadBytes);
  const signature = await embedImageFromBytes(pdf, adminClient, settings?.signature_path as string | null | undefined);
  const stamp = await embedImageFromBytes(pdf, adminClient, settings?.stamp_path as string | null | undefined);

  const copiedPages: PDFPage[] = [];
  for (let i = 0; i < Math.min(3, template.getPageCount()); i++) {
    const [page] = await pdf.copyPages(template, [i]);
    copiedPages.push(page);
  }

  interface PageState { page: PDFPage; number: number; y: number; }
  const pageStates: PageState[] = [];
  const addPage = (): PageState => {
    const bg = copiedPages[Math.min(pageStates.length, copiedPages.length - 1)];
    const page = pdf.addPage(bg);
    const state: PageState = { page, number: pageStates.length + 1, y: pageStates.length === 0 ? FIRST_PAGE_TOP : OTHER_PAGE_TOP };
    pageStates.push(state);
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
    current.page.drawText("\u2022", { x: LEFT, y: current.y, size, font: regular, color: BLACK });
    current.y = drawWrapped(current.page, regular, value, LEFT + indent, current.y, CONTENT_WIDTH - indent, size) - gap;
  };
  const renderRichBlocks = (html: string, size = 7, gap = 4): void => {
    const isHtml = /<[a-z!]/i.test(html);
    const blocks: SRichTextBlock[] = isHtml
      ? parseRichTextServer(html)
      : html.split("\n").filter(Boolean).map((line): SRichTextBlock => {
          const isBullet = /^[\u2022\-*]\s/.test(line.trim()) || /^\d+\.\s/.test(line.trim());
          const cleaned = line.replace(/^[\u2022\-*]\s*/, "").replace(/^\d+\.\s*/, "");
          return { type: isBullet ? "bullet" : "paragraph", runs: [{ text: cleaned, bold: false, italic: false, underline: false }] };
        });
    for (const block of blocks) {
      const indent = block.type !== "paragraph" ? 12 : 0;
      const width = CONTENT_WIDTH - indent;
      const h = styledRunsHeight(block.runs, regular, bold, size, width);
      ensure(h + gap);
      if (block.type === "bullet") {
        current.page.drawText("\u2022", { x: LEFT, y: current.y, size, font: regular, color: BLACK });
      }
      current.y = drawStyledRuns(current.page, block.runs, regular, bold, LEFT + indent, current.y, width, size) - gap;
    }
  };

  current.page.drawText("QUOTATION", { x: A4_WIDTH / 2 - bold.widthOfTextAtSize("QUOTATION", 18) / 2, y: current.y, size: 18, font: bold, color: NAVY });
  current.y -= 26;
  current.page.drawText(`Quotation No: ${txt(quotation.quotation_number) || "-"}`, { x: RIGHT - 170, y: current.y, size: 9, font: regular, color: BLACK });
  current.y -= 12;
  current.page.drawText(`Date: ${formatDate(String(quotation.quotation_date))}`, { x: RIGHT - 170, y: current.y, size: 9, font: regular, color: BLACK });
  if (quotation.valid_until) {
    current.y -= 12;
    current.page.drawText(`Valid Until: ${formatDate(String(quotation.valid_until))}`, { x: RIGHT - 170, y: current.y, size: 9, font: regular, color: BLACK });
  }
  current.y -= 18;
  current.page.drawLine({ start: { x: LEFT, y: current.y }, end: { x: RIGHT, y: current.y }, thickness: 0.5, color: BORDER });
  current.y -= 16;

  heading("To:");
  current.y = drawWrapped(current.page, bold, txt(quotation.customer_name) || "-", LEFT, current.y, CONTENT_WIDTH, 10) - 2;
  if (quotation.customer_address) paragraph(txt(quotation.customer_address), 9, 2);
  const contact = [quotation.customer_phone && `Phone: ${quotation.customer_phone}`, quotation.customer_gstin && `GSTIN: ${quotation.customer_gstin}`, quotation.customer_email && `Email: ${quotation.customer_email}`].filter(Boolean).join("  |  ");
  if (contact) paragraph(contact, 9, 8);

  if (quotation.subject) {
    ensure(16);
    current.page.drawText(`Sub: ${txt(quotation.subject)}`, { x: LEFT, y: current.y, size: 10, font: bold, color: BLACK, maxWidth: CONTENT_WIDTH });
    current.y -= 14;
  }
  if (quotation.reference_no) paragraph(`Reference No: ${txt(quotation.reference_no)}`, 9, 2);
  if (quotation.site_location) paragraph(`Work Location: ${txt(quotation.site_location)}`, 9, 4);
  paragraph("With reference to the above subject, we hereby quote for the supply of our crane/services as per the charges detailed below.", 9, 10);

  // Build active charges array — filter out inactive/zero items
  const otherChargesJson = quotation.other_charges_json as { description: string; amount: number }[] | null;
  const otherChargesDesc = quotation.other_charges_description as string | null;
  const otherChargesAmt = Number(quotation.other_charges_amount ?? 0);
  const otherCharges = otherChargesJson ?? (otherChargesDesc ? [{ description: otherChargesDesc, amount: otherChargesAmt }] : []);

  const chargesRows: { desc: string; amt: number }[] = [];
  if (quotation.service_amount_enabled !== false && Number(quotation.quotation_amount ?? 0) > 0)
    chargesRows.push({ desc: "Service Amount", amt: Number(quotation.quotation_amount ?? 0) });
  if (quotation.up_transportation_enabled && Number(quotation.up_transportation_amount ?? 0) > 0)
    chargesRows.push({ desc: txt(quotation.up_transportation_description) || "Up & Down Transportation", amt: Number(quotation.up_transportation_amount) });
  otherCharges.forEach(c => { if ((c.amount ?? 0) > 0) chargesRows.push({ desc: txt(c.description) || "Other Charges", amt: c.amount }); });

  const descWidth = CONTENT_WIDTH * 0.70;

  // Only render Charges Details if there are active charges
  if (chargesRows.length > 0) {
    const drawChargesHeader = (): void => {
      current.page.drawText("Description", { x: LEFT, y: current.y, size: 9, font: bold, color: BLACK });
      current.page.drawText("Amount", { x: RIGHT - bold.widthOfTextAtSize("Amount", 9), y: current.y, size: 9, font: bold, color: BLACK });
      current.y -= 5;
      current.page.drawLine({ start: { x: LEFT, y: current.y }, end: { x: RIGHT, y: current.y }, thickness: 0.7, color: NAVY });
      current.y -= 14;
    };
    heading("CHARGES DETAILS");
    ensure(40);
    drawChargesHeader();

    for (const row of chargesRows) {
      if (current.y - 16 < BOTTOM) { current = addPage(); drawChargesHeader(); }
      current.page.drawText(row.desc, { x: LEFT, y: current.y, size: 9, font: regular, color: BLACK, maxWidth: descWidth - 8 });
      current.page.drawText(formatCurrency(row.amt), { x: RIGHT - regular.widthOfTextAtSize(formatCurrency(row.amt), 9), y: current.y, size: 9, font: regular, color: BLACK });
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
    if (showSubtotal) totalRow("Subtotal", formatCurrency(Number(quotation.subtotal ?? 0)));
    if (quotation.gst_enabled) totalRow(`GST (${quotation.gst_percent}%)`, formatCurrency(Number(quotation.gst_amount ?? 0)));
    // Clean separator line above GRAND TOTAL — spans only the totals column
    current.page.drawLine({ start: { x: totalX, y: current.y + 4 }, end: { x: RIGHT, y: current.y + 4 }, thickness: 0.5, color: NAVY });
    totalRow("GRAND TOTAL", `${formatCurrency(Number(quotation.grand_total ?? 0))} RS`, true);
    current.y -= 2;
    paragraph(`Amount in Words: ${amountInWords(Number(quotation.grand_total ?? 0))}`, 8.5, 10);
  }

  const termsHtml = (quotation.terms_and_conditions as string | null | undefined) ?? '';
  if (termsHtml && termsHtml.trim()) {
    heading("TERMS AND CONDITIONS");
    const isHtml = /<[a-z!]/i.test(termsHtml);
    if (isHtml) {
      renderRichBlocks(termsHtml, 8.5, 3);
    } else {
      const allTerms = parseTerms(termsHtml);
      allTerms.forEach((term, index) => paragraph(`${index + 1}. ${term}`, 8.5, 3));
    }
  }
  if (quotation.payment_terms) {
    heading("PAYMENT TERMS");
    const isHtml = /<[a-z!]/i.test(quotation.payment_terms as string);
    if (isHtml) {
      renderRichBlocks(quotation.payment_terms as string, 8.5, 4);
    } else {
      const paymentLines = txt(quotation.payment_terms).split("\n").filter(Boolean);
      paymentLines.forEach(pt => bullet(pt, 8.5, 4));
    }
    current.y -= 4;
  }
  heading("NOTE");
  paragraph("We should receive the work order as per our quotation terms and conditions & payment has to receive on or before 7 days from the date of bill submission.", 9, 10);

  ensure(80);
  heading("COMPANY BILLING DETAILS");
  paragraph(txt(settings?.company_name) || "Padmavathi Earth Movers and Crane Services", 9.5, 2);
  paragraph(txt(settings?.address) || "H-NO 1-5-1118/24, ROAD NO.1 AND 2, PAKALA KUNTA, PANCHASHILA COLONY, OLD ALWAL, HYDERABAD - 500010", 9, 2);
  paragraph(`GSTIN: ${txt(settings?.gstin) || "36ALVPA9612Q2ZA"}`, 9, 2);
  paragraph(`State Name: ${txt(settings?.state) || "Telangana"}.`, 9, 8);

  heading("COMPANY BANK DETAILS");
  paragraph(txt(settings?.company_name) || "Padmavathi Earth Movers and Crane Services", 9.5, 2);
  paragraph(`Bank Name: ${txt(settings?.bank_name) || "Axis Bank LTD"}`, 9, 2);
  paragraph(`A/C No: ${txt(settings?.bank_account_number) || "914020039371713"}`, 9, 2);
  paragraph(`IFS Code: ${txt(settings?.bank_ifsc) || "UTIB0001378"}`, 9, 8);

  ensure(90);
  const companyName = txt(settings?.company_name) || "PADMAVATHI";
  current.page.drawText(`For ${companyName.toUpperCase()}`, { x: RIGHT - 170, y: current.y, size: 9, font: bold, color: BLACK });
  current.y -= 10;
  if (stamp) { drawImageContain(current.page, stamp, RIGHT - 170, current.y, 150, 52); current.y -= 58; }
  if (signature) { drawImageContain(current.page, signature, RIGHT - 170, current.y, 150, 42); current.y -= 48; }
  current.page.drawText(txt(settings?.authorized_signatory) || "AUTHORIZED SIGNATORY", { x: RIGHT - 160, y: current.y, size: 8.5, font: regular, color: BLACK });

  if (pageStates.length > 3) throw new Error("Quotation content exceeds the supported three-page letterhead.");
  return pdf.save();
}

async function loadLetterhead(adminClient: ReturnType<typeof createClient>): Promise<Uint8Array> {
  const { data, error } = await adminClient.storage.from("quotation-assets").createSignedUrl("company/letterhead.pdf", 300);
  if (error || !data?.signedUrl) throw new Error("Letterhead PDF not found in storage. Please upload it from the Quotations page.");
  const res = await fetch(data.signedUrl);
  if (!res.ok) throw new Error("Could not download letterhead PDF from storage.");
  return new Uint8Array(await res.arrayBuffer());
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      return new Response(
        JSON.stringify({ error: "Email service is not configured: RESEND_API_KEY is unavailable. Please configure email settings." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") as string;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: "Server configuration error: unable to access database." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: authentication required to send emails." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: callerUser, error: callerError } = await adminClient.auth.getUser(token);
    if (callerError || !callerUser.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: invalid or expired session." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const { quotationId, recipientEmail, ccEmail, bccEmail, emailSubject, emailBody } = body as {
      quotationId: string;
      recipientEmail: string;
      ccEmail?: string;
      bccEmail?: string;
      emailSubject: string;
      emailBody: string;
    };

    if (!quotationId) {
      return new Response(
        JSON.stringify({ error: "Quotation ID is required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: quotation, error: qError } = await adminClient
      .from("quotations")
      .select("*")
      .eq("id", quotationId)
      .maybeSingle();

    if (qError || !quotation) {
      return new Response(
        JSON.stringify({ error: "Quotation not found." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: equipment } = await adminClient
      .from("quotation_equipment")
      .select("*")
      .eq("quotation_id", quotationId)
      .order("sort_order");

    const { data: settings } = await adminClient
      .from("company_settings")
      .select("*")
      .limit(1)
      .maybeSingle();

    const customerEmail = recipientEmail || quotation.customer_email;
    const customerName = quotation.customer_name ?? "Customer";

    if (!customerEmail) {
      return new Response(
        JSON.stringify({ error: "Customer email address is not available. Please add an email address to this customer before sending." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let fonts: { regular: Uint8Array; bold: Uint8Array };
    try {
      fonts = await loadFonts();
    } catch {
      return new Response(
        JSON.stringify({ error: "Could not load fonts for PDF generation." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let letterheadBytes: Uint8Array;
    try {
      letterheadBytes = await loadLetterhead(adminClient);
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err instanceof Error ? err.message : "Could not load letterhead template." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const pdfBytes = await generateQuotationPdf(quotation, equipment ?? [], settings, letterheadBytes, fonts.regular, fonts.bold, adminClient);
    const pdfBase64 = toBase64(pdfBytes);

    const companyName = settings?.company_name ?? "Company";
    const companyEmail = settings?.email ?? "";
    const companyPhone = settings?.phone ?? "";

    const templateVars: Record<string, string> = {
      quotation_number: quotation.quotation_number ?? "",
      customer_name: customerName,
      customer_email: customerEmail,
      quotation_date: quotation.quotation_date ? formatDate(quotation.quotation_date) : "",
      valid_until: quotation.valid_until ? formatDate(quotation.valid_until) : "",
      grand_total: formatCurrency(Number(quotation.grand_total ?? 0)),
      company_name: companyName,
      company_email: companyEmail,
      company_phone: companyPhone,
    };

    const finalSubject = replaceTemplateVariables(emailSubject, templateVars);
    const finalBody = replaceTemplateVariables(emailBody, templateVars);

    const htmlBody = finalBody.replace(/\n/g, "<br/>");

    const senderEmail = Deno.env.get("RESEND_FROM_EMAIL") ?? "onboarding@resend.dev";

    const resendBody: Record<string, unknown> = {
      from: `${companyName} <${senderEmail}>`,
      to: customerEmail,
      subject: finalSubject,
      html: `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #333; max-width: 600px; margin: 0 auto;">${htmlBody}</div>`,
      attachments: [
        {
          filename: `QUO_${quotation.quotation_number}.pdf`,
          content: pdfBase64,
        },
      ],
    };

    if (ccEmail) resendBody.cc = ccEmail;
    if (bccEmail) resendBody.bcc = bccEmail;

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(resendBody),
    });

    const resendResult = await resendResponse.json().catch(() => ({}));

    if (!resendResponse.ok) {
      const rawMsg = (resendResult as { message?: string; error?: string })?.message ??
                     (resendResult as { message?: string; error?: string })?.error ??
                     `Resend API returned status ${resendResponse.status}`;
      const normalized = rawMsg.toLowerCase();
      const errMsg = normalized.includes("testing emails") || normalized.includes("verify a domain") || normalized.includes("testing mode")
        ? "Email delivery is still in testing mode. A sending domain must be verified before quotations can be sent to customers."
        : rawMsg;

      await adminClient.from("quotation_email_history").insert({
        quotation_id: quotationId,
        quotation_number: quotation.quotation_number,
        customer_name: customerName,
        recipient_email: customerEmail,
        subject: finalSubject,
        status: "Failed",
        attachment_name: `QUO_${quotation.quotation_number}.pdf`,
        error_message: errMsg,
        sent_by: callerUser.user.id,
      });

      return new Response(
        JSON.stringify({ error: errMsg }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    await adminClient.from("quotation_email_history").insert({
      quotation_id: quotationId,
      quotation_number: quotation.quotation_number,
      customer_name: customerName,
      recipient_email: customerEmail,
      subject: finalSubject,
      status: "Sent",
      attachment_name: `QUO_${quotation.quotation_number}.pdf`,
      sent_by: callerUser.user.id,
    });

    await adminClient.from("quotations").update({ status: "Sent" }).eq("id", quotationId);

    return new Response(
      JSON.stringify({
        success: true,
        sentTo: customerEmail,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
