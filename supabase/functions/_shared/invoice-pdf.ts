import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "npm:pdf-lib@1.17.1";

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export function formatDate(d: string): string {
  const dt = new Date(d);
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function sanitizePdfText(text: string): string {
  return text
    .replaceAll("→", "->")
    .replaceAll("←", "<-")
    .replaceAll("⇒", "=>")
    .replaceAll("₹", "Rs.")
    .replaceAll("—", "-")
    .replaceAll("–", "-")
    .replaceAll("•", "*")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x00-\x7F]/g, "?");
}

export function amountInWords(amount: number): string {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const twoDigit = (n: number): string => (n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : ""));
  const threeDigit = (n: number): string => {
    const h = Math.floor(n / 100);
    const r = n % 100;
    let s = "";
    if (h) s += ones[h] + " Hundred";
    if (r) s += (h ? " " : "") + twoDigit(r);
    return s;
  };
  const inWords = (n: number): string => {
    if (n === 0) return "Zero";
    const lakh = Math.floor(n / 100000);
    const thousand = Math.floor((n % 100000) / 1000);
    const hundred = n % 1000;
    let s = "";
    if (lakh) s += twoDigit(lakh) + " Lakh";
    if (thousand) s += (lakh ? " " : "") + twoDigit(thousand) + " Thousand";
    if (hundred) s += (lakh || thousand ? " " : "") + threeDigit(hundred);
    return s;
  };
  let words = inWords(rupees) + " Rupees";
  if (paise > 0) words += " and " + inWords(paise) + " Paise";
  return words + " Only";
}

export function formatDuration(hours: number): string {
  if (!hours || hours <= 0) return "0 Min";
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h} Hr`);
  if (m > 0) parts.push(`${m} Min`);
  return parts.length > 0 ? parts.join(" ") : "0 Min";
}

function calcSessionAmount(totalMinutes: number, r1: number, r2: number, dailyRate: number): number {
  if (totalMinutes <= 0) return 0;
  if (dailyRate > 0 && totalMinutes >= 8 * 60) return dailyRate;
  if (totalMinutes <= 60) return r1;
  const extraMinutes = totalMinutes - 60;
  return Math.round((r1 + extraMinutes * r2 / 60) * 100) / 100;
}

export function buildInvoiceLineDescription(trip: Record<string, unknown> | null): { description: string; calculation_details: string } {
  if (!trip) return { description: "", calculation_details: "" };
  const vehicle = trip.vehicle as Record<string, unknown> | null;
  const vehicleStr = vehicle ? `${vehicle.registration_number} (${vehicle.type}${vehicle.capacity ? " - " + vehicle.capacity : ""})` : "";
  const rateType = (trip.rate_type as string) ?? "";

  let typeLabel = "Vehicle";
  const vType = vehicle?.type as string | null;
  if (vType === "JCB") {
    typeLabel = "JCB";
  } else if (vType === "Crane") {
    const tonsNum = trip.capacity_tons ? String(trip.capacity_tons).replace(/[^0-9.]/g, "") : "";
    typeLabel = tonsNum ? `${tonsNum} Tons Crane` : "Crane";
  } else if (vType) {
    typeLabel = vType;
  }
  const dateStr = (trip.work_date || trip.trip_date) ? formatDate((trip.work_date || trip.trip_date) as string) : "";
  const hrs = Number(trip.total_hours ?? 0);
  const hoursStr = hrs > 0 ? formatDuration(hrs) : "";
  const metaParts = [dateStr, vehicleStr, hoursStr].filter(Boolean);
  const description = `${typeLabel}${metaParts.length > 0 ? " \u2014 " + metaParts.join(" | ") : ""}`;

  const rentalAmount = Number(trip.rental_amount ?? 0);
  const r1 = Number(trip.first_hour_rate ?? 0);
  const r2 = Number(trip.second_hour_rate ?? 0);
  const dailyRate = Number(trip.daily_rate_snapshot ?? 0);

  let calcParts: string[] = [];
  if (rateType === "Hourly" || rateType === "Couple Hours" || rateType === "Weekly") {
    if (r1 <= 0 && r2 <= 0 && rentalAmount > 0) {
      calcParts.push(`Rental Amount = Rs. ${formatNumber(rentalAmount)}`);
    } else {
      const totalMinutes = Math.round(hrs * 60);
      const amount = calcSessionAmount(totalMinutes, r1, r2, dailyRate);
      if (dailyRate > 0 && totalMinutes >= 8 * 60) {
        calcParts.push(`Full Day Rate = Rs. ${formatNumber(dailyRate)}`);
      } else {
        const fullHours = Math.floor(totalMinutes / 60);
        const remainingMinutes = totalMinutes % 60;
        const extraHours = fullHours > 1 ? fullHours - 1 : 0;
        const minutesAmount = remainingMinutes > 0 ? Math.round(remainingMinutes * r2 / 60 * 100) / 100 : 0;
        const subParts: string[] = [`1st Hr Rs. ${formatNumber(r1)}`];
        if (extraHours > 0) {
          subParts.push(`${extraHours} Hr Rs. ${formatNumber(r2)}`);
        }
        if (remainingMinutes > 0) {
          subParts.push(`${remainingMinutes} Min Rs. ${formatNumber(minutesAmount)}`);
        }
        subParts.push(`= Rs. ${formatNumber(amount)}`);
        calcParts.push(subParts.join(" + "));
      }
      calcParts.push(`Rental Amount = Rs. ${formatNumber(rentalAmount)}`);
    }
  } else if (rateType === "Daily") {
    calcParts.push(`Rental Amount = Rs. ${formatNumber(rentalAmount)}`);
  } else if (rateType === "Monthly") {
    const monthlyRate = Number(trip.monthly_rate_snapshot ?? 0);
    calcParts.push(`Monthly Rate = 1 x Rs. ${formatNumber(monthlyRate)} = Rs. ${formatNumber(monthlyRate)}`);
  } else if (rateType === "Weekly" && trip.weekly_rate_snapshot) {
    const coupleRate = Number(trip.weekly_rate_snapshot);
    calcParts.push(`Weekly Rate = Rs. ${formatNumber(coupleRate)} = Rs. ${formatNumber(rentalAmount)}`);
  }
  return { description, calculation_details: calcParts.join("\n") };
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

// ============ PDF LAYOUT CONSTANTS ============
const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 28;
const LEFT = MARGIN;
const RIGHT = A4_W - MARGIN;
const CW = RIGHT - LEFT;
const BLACK = rgb(0, 0, 0);
const GRAY = rgb(0.4, 0.4, 0.4);
const LIGHT_GRAY = rgb(0.92, 0.92, 0.92);
const BORDER = rgb(0.6, 0.6, 0.6);
const WHITE = rgb(1, 1, 1);

interface InvoiceItemRow {
  description: string;
  calcDetails: string;
  hsn_sac: string;
  quantity: number;
  rate: number;
  unit: string;
  amount: number;
}

export async function generateInvoicePdfBytes(
  inv: Record<string, unknown>,
  items: Record<string, unknown>[],
  settings: Record<string, unknown> | null,
  invoiceSettings: Record<string, unknown> | null,
  receivedAmount: number,
  balanceAmount: number,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica) as PDFFont;
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold) as PDFFont;

  // ---- Extract data ----
  const compName = (settings?.company_name as string) ?? "";
  const compAddrLines = ((settings?.address as string) ?? "").split("\n").filter(Boolean);
  const compGstin = (settings?.gstin as string) ?? "";
  const compState = (settings?.state as string) ?? "";
  const compStateCode = (settings?.state_code as string) ?? "";
  const compEmail = (settings?.email as string) ?? "";
  const compPhone = (settings?.phone as string) ?? "";
  const compPan = (settings?.pan as string) ?? "";

  const customer = inv.customer as Record<string, unknown> | null;
  const cName = (inv.customer_name as string) ?? (customer?.name as string) ?? "-";
  const cAddrLines = ((inv.customer_address as string) ?? (customer?.address as string) ?? "").split("\n").filter(Boolean);
  const cGstin = (inv.customer_gstin as string) ?? (customer?.gstin as string) ?? "-";

  const conName = (inv.consignee_name as string) ?? cName;
  const conAddrLines = ((inv.consignee_address as string) ?? (customer?.address as string) ?? "").split("\n").filter(Boolean);
  const conGstin = (inv.consignee_gstin as string) ?? cGstin;

  const taxable = Number(inv.taxable_amount);
  const cgstAmt = Number(inv.cgst_amount);
  const sgstAmt = Number(inv.sgst_amount);
  const igstAmt = Number(inv.igst_amount);
  const totalTax = cgstAmt + sgstAmt + igstAmt;
  const grand = Number(inv.grand_total);
  const isIgst = igstAmt > 0;
  const hsnSac = (invoiceSettings?.hsn_sac as string) ?? "997319";
  const declaration = (inv.declaration as string) ||
    (invoiceSettings?.declaration as string) ||
    "We declare that this invoice shows the actual price of the services described and that all particulars are true and correct.";
  const words = (inv.amount_in_words as string) ?? amountInWords(grand);

  const bankName = (settings?.bank_name as string) ?? "";
  const bankAcctName = (settings?.bank_account_name as string) ?? "";
  const bankAcctNo = (settings?.bank_account_number as string) ?? "";
  const bankBranch = (settings?.bank_branch as string) ?? "";
  const bankIfsc = (settings?.bank_ifsc as string) ?? "";
  const compAuth = (settings?.authorized_signatory as string) ?? "";

  // ---- Build item rows ----
  const itemRows: InvoiceItemRow[] = items
    .filter((it) => {
      // Hide Operator Batha line when amount is 0
      const desc = ((it.description as string) ?? "").toUpperCase();
      if (desc.includes("BATHA") && (Number(it.amount) || 0) === 0) return false;
      return true;
    })
    .map((it) => {
      const trip = it.trip as Record<string, unknown> | null;
      let displayDesc = it.description as string;
      let displayCalc = it.calculation_details as string | null;
      let quantity = Number(it.quantity);
      let rate = Number(it.rate);
      let unit = (it.unit as string) ?? "Nos";
      if (trip) {
        const rebuilt = buildInvoiceLineDescription(trip);
        displayDesc = rebuilt.description;
        displayCalc = rebuilt.calculation_details;
        // For Daily rate: compute quantity from rental_amount / daily_rate_snapshot
        const rateType = (trip.rate_type as string) ?? "";
        if (rateType === "Daily") {
          const dailyRate = Number(trip.daily_rate_snapshot ?? 0);
          const rentalAmount = Number(trip.rental_amount ?? 0);
          if (dailyRate > 0 && rentalAmount > 0) {
            quantity = Math.round((rentalAmount / dailyRate) * 100) / 100;
            rate = dailyRate;
            unit = "day";
          }
        }
      }
      return {
        description: displayDesc,
        calcDetails: displayCalc ?? "",
        hsn_sac: (it.hsn_sac as string) ?? hsnSac,
        quantity,
        rate,
        unit,
        amount: Number(it.amount),
      };
    });

  // ---- Layout helpers ----
  let page = pdf.addPage([A4_W, A4_H]);
  let y = A4_H - MARGIN;

  const ensureSpace = (h: number): void => {
    if (y - h < MARGIN + 40) {
      page.drawLine({ start: { x: LEFT, y: MARGIN + 25 }, end: { x: RIGHT, y: MARGIN + 25 }, thickness: 0.5, color: BORDER });
      page.drawText("This is a Computer Generated Invoice", { x: CW / 2 - 90, y: MARGIN + 8, size: 7, font: regular, color: GRAY });
      page = pdf.addPage([A4_W, A4_H]);
      y = A4_H - MARGIN;
    }
  };

  const drawText = (text: string, x: number, size: number, font: PDFFont, color: ReturnType<typeof rgb> = BLACK): void => {
    page.drawText(sanitizePdfText(text), { x, y, size, font, color });
  };

  const drawRight = (text: string, xRight: number, size: number, font: PDFFont, color: ReturnType<typeof rgb> = BLACK): void => {
    const safeText = sanitizePdfText(text);
    const w = font.widthOfTextAtSize(safeText, size);
    page.drawText(safeText, { x: xRight - w, y, size, font, color });
  };

  const drawCenter = (text: string, xCenter: number, size: number, font: PDFFont, color: ReturnType<typeof rgb> = BLACK): void => {
    const safeText = sanitizePdfText(text);
    const w = font.widthOfTextAtSize(safeText, size);
    page.drawText(safeText, { x: xCenter - w / 2, y, size, font, color });
  };

  // ============ HEADER ============
  // Company info (left)
  let hy = y;
  drawText(compName, LEFT, 14, bold);
  hy -= 14;
  for (const line of compAddrLines) {
    drawText(line, LEFT, 9, regular, GRAY);
    hy -= 11;
  }
  if (compGstin) { drawText(`GSTIN/UIN: ${compGstin}`, LEFT, 9, regular); hy -= 11; }
  if (compState) { drawText(`State Name: ${compState}${compStateCode ? `, Code: ${compStateCode}` : ""}`, LEFT, 9, regular); hy -= 11; }
  if (compEmail) { drawText(`E-Mail: ${compEmail}`, LEFT, 9, regular); hy -= 11; }
  if (compPhone) { drawText(`Phone: ${compPhone}`, LEFT, 9, regular); hy -= 11; }
  if (compPan) { drawText(`PAN: ${compPan}`, LEFT, 9, regular); hy -= 11; }

  // TAX INVOICE box (right)
  const boxW = 130;
  const boxH = 24;
  const boxX = RIGHT - boxW;
  const boxY = y - boxH + 16;
  page.drawRectangle({ x: boxX, y: boxY, width: boxW, height: boxH, borderColor: BLACK, borderWidth: 1.5, color: WHITE });
  drawCenter("TAX INVOICE", boxX + boxW / 2, 12, bold);

  y = Math.min(hy, boxY) - 8;
  page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 1.5, color: BLACK });
  y -= 6;

  // ============ META (Invoice No, Date, Ref | Vehicle, FY) ============
  const metaLeftW = CW / 2 - 4;
  const metaRightX = LEFT + CW / 2 + 4;
  const metaPairs: [string, string | null | undefined][] = [
    ["Invoice No.", inv.invoice_number as string],
    ["Dated", formatDate(inv.invoice_date as string)],
    ["Reference No.", inv.reference_no as string],
  ];
  const metaPairs2: [string, string | null | undefined][] = [
    ["Motor Vehicle No.", inv.motor_vehicle_numbers as string],
    ["Financial Year", inv.financial_year as string],
  ];
  let metaY = y;
  for (const [label, val] of metaPairs) {
    if (val) {
      drawText(label, LEFT, 9, bold, rgb(0.28, 0.31, 0.36));
      drawText(val, LEFT + 95, 9, regular);
      metaY -= 12;
    }
  }
  let metaY2 = y;
  for (const [label, val] of metaPairs2) {
    if (val) {
      drawText(label, metaRightX, 9, bold, rgb(0.28, 0.31, 0.36));
      drawText(val, metaRightX + 95, 9, regular);
      metaY2 -= 12;
    }
  }
  y = Math.min(metaY, metaY2) - 4;
  page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 0.5, color: BORDER });
  y -= 6;

  // ============ PARTIES (Consignee | Buyer) ============
  const partyW = CW / 2 - 0.25;
  const partyMidX = LEFT + partyW;
  let pY = y;

  drawText("CONSIGNEE (SHIP TO)", LEFT, 8, bold);
  drawText("BUYER (BILL TO)", partyMidX + 4, 8, bold);
  pY -= 12;
  page.drawLine({ start: { x: LEFT, y: pY }, end: { x: LEFT + partyW, y: pY }, thickness: 0.3, color: BORDER });
  page.drawLine({ start: { x: partyMidX, y: pY }, end: { x: RIGHT, y: pY }, thickness: 0.3, color: BORDER });
  pY -= 12;

  drawText(conName, LEFT, 10, bold);
  drawText(cName, partyMidX + 4, 10, bold);
  pY -= 12;

  const maxAddrLines = Math.max(conAddrLines.length, cAddrLines.length);
  for (let i = 0; i < maxAddrLines; i++) {
    if (conAddrLines[i]) drawText(conAddrLines[i], LEFT, 8, regular, GRAY);
    if (cAddrLines[i]) drawText(cAddrLines[i], partyMidX + 4, 8, regular, GRAY);
    pY -= 10;
  }
  if (conGstin && conGstin !== "-") { drawText(`GSTIN/UIN: ${conGstin}`, LEFT, 8, regular); pY -= 10; }
  if (cGstin && cGstin !== "-") { drawText(`GSTIN/UIN: ${cGstin}`, partyMidX + 4, 8, regular); pY -= 10; }

  y = pY - 2;
  page.drawLine({ start: { x: partyMidX, y: y + 4 }, end: { x: partyMidX, y: y + 60 }, thickness: 0.5, color: BORDER });
  page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 0.5, color: BORDER });
  y -= 4;

  // ============ ITEMS TABLE ============
  // Column positions: Sl(28) | Desc(flex) | HSN(60) | Qty(48) | Per(40) | Amount(90)
  const cSl = LEFT;
  const cDesc = LEFT + 28;
  const cHsn = LEFT + 28 + 220;
  const cQty = cHsn + 60;
  const cPer = cQty + 48;
  const cAmt = cPer + 40;
  const descW = cHsn - cDesc - 4;

  // Header row
  const hdrH = 16;
  page.drawRectangle({ x: LEFT, y: y - hdrH, width: CW, height: hdrH, color: BLACK });
  drawCenter("Sl No.", cSl + 14, 7, bold, WHITE);
  drawCenter("Description of Services", cDesc + descW / 2, 7, bold, WHITE);
  drawCenter("HSN/SAC", cHsn + 30, 7, bold, WHITE);
  drawCenter("Qty", cQty + 24, 7, bold, WHITE);
  drawCenter("Per", cPer + 20, 7, bold, WHITE);
  drawCenter("Amount", cAmt + 45, 7, bold, WHITE);
  y -= hdrH;

  // Item rows
  for (let i = 0; i < itemRows.length; i++) {
    const it = itemRows[i];
    const descLines = wrapText(regular, it.description, 8, descW - 6);
    const calcLines = it.calcDetails ? it.calcDetails.split("\n").filter(Boolean).map((l) => l.replace(/Rental Amount =/g, "Full Day Amt =")) : [];
    const allLines = descLines.length + calcLines.length;
    const rowH = Math.max(14, allLines * 10 + 4);

    ensureSpace(rowH + 4);
    page.drawRectangle({ x: LEFT, y: y - rowH, width: CW, height: rowH, color: i % 2 === 0 ? WHITE : LIGHT_GRAY, borderColor: BORDER, borderWidth: 0.3 });

    drawCenter(String(i + 1), cSl + 14, 8, regular);
    let lineY = y - 10;
    for (const dl of descLines) {
      page.drawText(sanitizePdfText(dl), { x: cDesc + 2, y: lineY, size: 8, font: regular, color: BLACK });
      lineY -= 10;
    }
    for (const cl of calcLines) {
      page.drawText(sanitizePdfText(cl), { x: cDesc + 2, y: lineY, size: 7, font: regular, color: GRAY });
      lineY -= 9;
    }
    drawCenter(it.hsn_sac, cHsn + 30, 8, regular);
    drawCenter(formatNumber(it.quantity), cQty + 24, 8, regular);
    drawCenter(it.unit, cPer + 20, 8, regular);
    drawRight(formatNumber(it.amount), cAmt + 88, 8, regular);

    y -= rowH;
  }
  // Table bottom border
  page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 0.5, color: BORDER });
  y -= 6;

  // ============ TAX AREA (left: tax table + words | right: totals) ============
  const taxLeftW = CW / 2 - 4;
  const taxRightX = LEFT + CW / 2 + 4;

  // --- Left: Tax summary table ---
  let tY = y;
  const taxHdrH = 12;
  page.drawRectangle({ x: LEFT, y: tY - taxHdrH, width: taxLeftW, height: taxHdrH, color: LIGHT_GRAY, borderColor: BORDER, borderWidth: 0.3 });
  drawCenter("HSN/SAC", LEFT + 30, 7, bold);
  drawCenter("Taxable Value", LEFT + 80, 7, bold);
  if (isIgst) {
    drawCenter("IGST Rate", LEFT + 120, 7, bold);
    drawCenter("IGST Amt", LEFT + 160, 7, bold);
  } else {
    drawCenter("CGST Rate", LEFT + 115, 7, bold);
    drawCenter("CGST Amt", LEFT + 150, 7, bold);
    drawCenter("SGST Rate", LEFT + 180, 7, bold);
    drawCenter("SGST Amt", LEFT + 215, 7, bold);
  }
  drawCenter("Total Tax", LEFT + 260, 7, bold);
  tY -= taxHdrH;

  drawCenter(hsnSac, LEFT + 30, 8, regular);
  drawCenter(formatNumber(taxable), LEFT + 80, 8, regular);
  if (isIgst) {
    drawCenter(`${inv.igst_percent}%`, LEFT + 120, 8, regular);
    drawCenter(formatNumber(igstAmt), LEFT + 160, 8, regular);
  } else {
    drawCenter(`${inv.cgst_percent}%`, LEFT + 115, 8, regular);
    drawCenter(formatNumber(cgstAmt), LEFT + 150, 8, regular);
    drawCenter(`${inv.sgst_percent}%`, LEFT + 180, 8, regular);
    drawCenter(formatNumber(sgstAmt), LEFT + 215, 8, regular);
  }
  drawCenter(formatNumber(totalTax), LEFT + 260, 8, regular);
  tY -= 14;
  page.drawRectangle({ x: LEFT, y: tY, width: taxLeftW, height: 14, borderColor: BORDER, borderWidth: 0.3 });

  // Amount in words
  tY -= 6;
  page.drawRectangle({ x: LEFT, y: tY - 22, width: taxLeftW, height: 22, borderColor: BORDER, borderWidth: 0.3, color: LIGHT_GRAY });
  page.drawText("Amount Chargeable (in words):", { x: LEFT + 4, y: tY - 8, size: 8, font: bold });
  page.drawText(sanitizePdfText(`INR ${words}`), { x: LEFT + 4, y: tY - 18, size: 8, font: regular, color: GRAY });
  tY -= 28;

  // --- Right: Totals ---
  let rY = y;
  const labelX = taxRightX;
  const valX = RIGHT;
  const drawTotalRow = (label: string, val: string, isGrand = false): void => {
    if (isGrand) {
      page.drawLine({ start: { x: labelX, y: rY }, end: { x: valX, y: rY }, thickness: 1, color: BLACK });
      rY -= 2;
    }
    page.drawText(sanitizePdfText(label), { x: labelX, y: rY - 10, size: isGrand ? 11 : 9, font: isGrand ? bold : regular });
    drawRight(val, valX, isGrand ? 11 : 9, isGrand ? bold : regular);
    rY -= isGrand ? 16 : 13;
    if (isGrand) {
      page.drawLine({ start: { x: labelX, y: rY + 4 }, end: { x: valX, y: rY + 4 }, thickness: 1, color: BLACK });
    }
  };

  drawTotalRow("Taxable Amount:", formatNumber(taxable));
  if (cgstAmt > 0) drawTotalRow(`CGST (${inv.cgst_percent}%):`, formatNumber(cgstAmt));
  if (sgstAmt > 0) drawTotalRow(`SGST (${inv.sgst_percent}%):`, formatNumber(sgstAmt));
  if (igstAmt > 0) drawTotalRow(`IGST (${inv.igst_percent}%):`, formatNumber(igstAmt));
  drawTotalRow("Grand Total:", `Rs. ${formatNumber(grand)}`, true);
  page.drawText(sanitizePdfText(`Received: Rs. ${formatNumber(receivedAmount)}`), { x: labelX, y: rY, size: 9, font: regular, color: rgb(0.1, 0.6, 0.2) });
  rY -= 12;
  page.drawText(sanitizePdfText(`Balance: Rs. ${formatNumber(balanceAmount)}`), { x: labelX, y: rY, size: 9, font: bold, color: rgb(0.8, 0.15, 0.15) });
  rY -= 12;

  y = Math.min(tY, rY) - 8;
  page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 0.5, color: BORDER });
  y -= 8;

  // ============ BOTTOM (Declaration | Bank Details) ============
  const botLeftW = CW / 2 - 4;
  const botRightX = LEFT + CW / 2 + 4;
  const hasBank = bankName || bankAcctName || bankAcctNo || bankIfsc;

  drawText("DECLARATION", LEFT, 8, bold);
  drawText("COMPANY'S BANK DETAILS", botRightX, 8, bold);
  y -= 12;

  const declLines = wrapText(regular, declaration, 8, botLeftW - 4);
  for (const dl of declLines) {
    ensureSpace(12);
    page.drawText(sanitizePdfText(dl), { x: LEFT, y: y, size: 8, font: regular, color: GRAY });
    y -= 10;
  }

  // Reset y for bank details column (parallel to declaration start)
  let bankY = y + declLines.length * 10 + 4;
  if (hasBank) {
    if (bankAcctName) { page.drawText(sanitizePdfText(`A/c Holder: ${bankAcctName}`), { x: botRightX, y: bankY, size: 8, font: regular }); bankY -= 10; }
    if (bankName) { page.drawText(sanitizePdfText(`Bank: ${bankName}`), { x: botRightX, y: bankY, size: 8, font: regular }); bankY -= 10; }
    if (bankAcctNo) { page.drawText(sanitizePdfText(`A/c No.: ${bankAcctNo}`), { x: botRightX, y: bankY, size: 8, font: regular }); bankY -= 10; }
    if (bankBranch || bankIfsc) { page.drawText(sanitizePdfText(`Branch & IFSC: ${[bankBranch, bankIfsc].filter(Boolean).join(" - ")}`), { x: botRightX, y: bankY, size: 8, font: regular }); bankY -= 10; }
  }

  y -= 20;

  // ============ SIGNATURE ============
  ensureSpace(40);
  drawRight(`for ${compName}`, RIGHT, 10, regular);
  y -= 30;
  drawRight("Authorized Signatory", RIGHT, 9, bold);
  if (compAuth) { y -= 12; drawRight(compAuth, RIGHT, 8, regular, GRAY); }

  y -= 20;

  // ============ FOOTER ============
  page.drawLine({ start: { x: LEFT, y: MARGIN + 25 }, end: { x: RIGHT, y: MARGIN + 25 }, thickness: 0.5, color: BORDER });
  page.drawText("This is a Computer Generated Invoice", { x: CW / 2 - 90, y: MARGIN + 8, size: 7, font: regular, color: GRAY });

  return pdf.save();
}

function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const safeText = sanitizePdfText(text);
  if (!safeText) return [];
  const words = safeText.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}
