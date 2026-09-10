import type { InvoiceWithRelations, InvoiceItem, CompanySettings, InvoiceSettings, RateMaster, Vehicle } from '@/types';
import { amountInWords, buildInvoiceLineDescription, formatDuration, formatNumber } from '@/lib/utils';
import { calcSessionMinutes } from '@/lib/rentalCalc';
import { calculateDiscount } from '@/lib/discountCalc';
import { findRateMasterForVehicle } from '@/lib/rateLookup';

type VehicleLite = Pick<Vehicle, 'registration_number' | 'type' | 'capacity'>;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// buildInvoiceLineDescription() joins date | vehicle | duration | sessions with ' | ' -
// e.g. "16 Tons Crane - 08 Sept 2026 | AP28BP1678 | 4 Hr 23 Min". Older invoices (saved
// before invoice_vehicles existed, or via a flow that stores invoice_items directly) have
// this same duration segment baked into the stored description with no separate rate
// snapshot at all. Either way, pull the duration segment (it always looks like "6 Hr 10
// Min" / "8 Hr" / "30 Min") out for the Quantity column and leave everything else -
// date, vehicle number - untouched, regardless of which code path produced the description.
function extractDurationSegment(description: string): { desc: string; durationLabel: string | null } {
  let durationLabel: string | null = null;
  const kept = description.split(' | ').filter(seg => {
    const trimmed = seg.trim();
    if (durationLabel === null && /^\d+\s*(day|days|hr|hrs|hour|hours|min|mins|minutes)\b/i.test(trimmed)) {
      durationLabel = trimmed;
      return false;
    }
    return true;
  });
  return { desc: kept.join(' | '), durationLabel };
}

// Live Rate Master lookup for a Hourly line with no captured first/second-hour snapshot -
// resolved the exact same way as everywhere else in the app (findRateMasterForVehicle),
// never a value derived from the line's own amount. Returns null (not a fabricated
// value) when no applicable Rate Master record can be found.
function liveHourlyRateLabel(
  vehicleType: string | null | undefined,
  vehicleCapacity: string | null | undefined,
  workDate: string,
  rateMasterRows: RateMaster[],
): string | null {
  if (!vehicleType || rateMasterRows.length === 0) return null;
  const rm = findRateMasterForVehicle({ type: vehicleType as Vehicle['type'], capacity: vehicleCapacity ?? null }, rateMasterRows, workDate);
  if (!rm) return null;
  const r1 = Number(rm.first_hour_rate) || 0;
  const r2 = Number(rm.second_hour_rate) || 0;
  if (r1 <= 0 && r2 <= 0) return null;
  return `${formatNumber(r1)} / ${formatNumber(r2)}`;
}

// Single source of truth for Master/Duplicate/Extra Copy invoice content and
// figures. Both the print template (InvoiceDocument.tsx) and the email PDF
// generator (invoicePdf.ts) consume this - neither re-derives quantities,
// amounts, tax totals, or line descriptions on its own, so they can never
// drift apart the way they did before.

export type PrintCopyType = 'master' | 'duplicate' | 'extra' | 'all';

export const COPY_LABELS: Record<string, string> = {
  master: 'ORIGINAL FOR RECIPIENT',
  duplicate: 'DUPLICATE FOR TRANSPORTER',
  extra: 'TRIPLICATE FOR SUPPLIER',
};

export interface PreparedInvoiceItemRow {
  slNo: number;
  description: string;
  calcLines: string[];
  hsnSac: string;
  quantity: number;
  /** Print-ready Quantity column text - e.g. "6 Hr 10 Min" for Hourly rows, "20.00 nos" / "1.00 day" otherwise. */
  quantityLabel: string;
  rate: number;
  /** Print-ready Rate column text - "2,500.00/800.00" (1st Hr / 2nd Hr onwards) for Hourly rows, plain formatted rate otherwise. */
  rateLabel: string;
  unit: string;
  amount: number;
}

export interface PreparedInvoiceData {
  compName: string;
  compAddr: string[];
  compGstin: string;
  compState: string;
  compStateCode: string;
  compEmail: string;
  compPhone: string;
  compPan: string;
  compLogo: string;
  compSign: string;
  compAuth: string;
  bankName: string;
  bankAcctName: string;
  bankAcctNo: string;
  bankBranch: string;
  bankIfsc: string;
  hasBank: boolean;
  cName: string;
  cAddr: string[];
  cGstin: string;
  cState: string;
  cStateCode: string;
  conName: string;
  conAddr: string[];
  conGstin: string;
  conState: string;
  conStateCode: string;
  taxable: number;
  cgstAmt: number;
  sgstAmt: number;
  igstAmt: number;
  totalTax: number;
  grand: number;
  received: number;
  finalPayable: number;
  balance: number;
  isIgst: boolean;
  declaration: string;
  words: string;
  copyLabel: string;
  hsnSacDefault: string;
  vehicleTypesJoined: string;
  vehicleNumbersJoined: string;
  itemRows: PreparedInvoiceItemRow[];
}

export function prepareInvoiceData(
  inv: InvoiceWithRelations,
  items: InvoiceItem[],
  settings: CompanySettings | null,
  invoiceSettings: InvoiceSettings | null,
  copyType: string = 'master',
  // Live Rate Master fallback for Hourly lines that never captured a first/second-hour
  // rate snapshot (older invoices saved before invoice_vehicles existed, or items with
  // no linked vehicle/trip) - resolved the same way the rest of the app resolves rates,
  // via findRateMasterForVehicle. Both optional: callers that don't pass them simply get
  // the single derived-rate fallback for such lines, same as before.
  rateMasterRows: RateMaster[] = [],
  vehiclesList: VehicleLite[] = [],
): PreparedInvoiceData {
  const compName = settings?.company_name ?? '';
  const compAddr = (settings?.address ?? '').split('\n').filter(Boolean);
  const compGstin = settings?.gstin ?? '';
  const compState = settings?.state ?? '';
  const compStateCode = settings?.state_code ?? '';
  const compEmail = settings?.email ?? '';
  const compPhone = settings?.phone ?? '';
  const compPan = settings?.pan ?? '';
  const compLogo = settings?.logo_url ?? '';
  const compSign = settings?.signature_path ?? '';
  const compAuth = settings?.authorized_signatory ?? '';
  const bankName = settings?.bank_name ?? '';
  const bankAcctName = settings?.bank_account_name ?? '';
  const bankAcctNo = settings?.bank_account_number ?? '';
  const bankBranch = settings?.bank_branch ?? '';
  const bankIfsc = settings?.bank_ifsc ?? '';
  const hasBank = !!(bankName || bankAcctName || bankAcctNo || bankIfsc);

  const cName = inv.customer_name ?? inv.customer?.name ?? '-';
  const cAddr = (inv.customer_address ?? inv.customer?.address ?? '').split('\n').filter(Boolean);
  const cGstin = inv.customer_gstin ?? inv.customer?.gstin ?? '-';
  const cState = inv.customer?.state ?? '-';
  const cStateCode = inv.customer?.state_code ?? '-';

  const conName = inv.consignee_name ?? cName;
  const conAddrRaw = inv.consignee_address ?? inv.customer?.address ?? '';
  const conAddr = conAddrRaw.split('\n').filter(Boolean);
  const conGstin = inv.consignee_gstin ?? cGstin;
  const conState = inv.consignee_state ?? cState;
  const conStateCode = inv.consignee_state_code ?? cStateCode;

  let taxable = Number(inv.taxable_amount);
  let cgstAmt = Number(inv.cgst_amount);
  let sgstAmt = Number(inv.sgst_amount);
  let igstAmt = Number(inv.igst_amount);
  let totalTax = cgstAmt + sgstAmt + igstAmt;
  let grand = Number(inv.grand_total);
  const received = Number(inv.amount_received);
  let finalPayable = inv.discount_enabled ? Number(inv.final_payable_amount ?? grand) : grand;
  let balance = Math.max(0, finalPayable - received);
  const isIgst = igstAmt > 0;

  const declaration = inv.declaration ||
    invoiceSettings?.declaration ||
    'We declare that this invoice shows the actual price of the services described and that all particulars are true and correct.';

  let words = inv.amount_in_words ?? amountInWords(inv.discount_enabled ? finalPayable : grand);

  const copyLabel = COPY_LABELS[copyType] ?? '';
  const hsnSacDefault = invoiceSettings?.hsn_sac ?? '997319';
  const vehicleTypesJoined = (inv.invoiceVehicles ?? []).map(v => v.vehicle_type).filter(Boolean).join(', ');
  // Deduplicated vehicle numbers straight from this invoice's actual billing entries -
  // the authoritative source for "Motor Vehicle No." on print, since inv.motor_vehicle_numbers
  // is a snapshot taken once and can drift if vehicles/sessions are added or edited afterward.
  const vehicleNumbersJoined = Array.from(new Set((inv.invoiceVehicles ?? []).map(v => v.vehicle_number).filter(Boolean))).join(', ');

  // Build line items dynamically from all items (rental, batha, transportation).
  // Match rental items to invoiceVehicles to compute correct quantity for Daily rate type.
  const invVehicles = inv.invoiceVehicles ?? [];
  let vehicleIdx = 0;
  let rentalDelta = 0;
  const itemRows: PreparedInvoiceItemRow[] = [];
  items.forEach((it, idx) => {
    const descUpper = (it.description ?? '').toUpperCase();
    const isBatha = descUpper.includes('BATHA');
    const isTransport = descUpper.includes('TRANSPORT');
    const isRental = !isBatha && !isTransport;

    let desc = it.description ?? '';
    let calcDetails = it.calculation_details ?? '';
    let quantity = Number(it.quantity) || 1;
    let unit = it.unit ?? 'nos';
    let amount = Number(it.amount) || 0;
    let itemHourlyRateLabel: string | null = null;

    if (isRental) {
      const iv = invVehicles[vehicleIdx];
      vehicleIdx++;
      if (iv) {
        const rateType = iv.rate_type ?? '';
        const dailyRate = Number(iv.daily_rate_snapshot) || 0;
        const rentalAmount = Number(iv.rental_amount) || 0;
        const sessionCount = (iv.sessions ?? []).length;

        // Derive work date from the first session's in_time, else fall back to trip/invoice date
        const sessions = (iv.sessions ?? []);
        const firstSessionDate = sessions.length > 0 && sessions[0].in_time
          ? sessions[0].in_time
          : (it.trip?.trip_date ?? inv.trip_date ?? inv.invoice_date);

        const tr = {
          rate_type: rateType as 'Hourly' | 'Daily' | 'Weekly' | 'Monthly',
          total_hours: Number(iv.total_hours) || 0,
          rental_amount: rentalAmount,
          trip_date: it.trip?.trip_date ?? inv.trip_date ?? inv.invoice_date ?? '',
          work_date: firstSessionDate,
          place_of_work: iv.place_of_work ?? '',
          capacity_tons: iv.capacity_tons,
          first_hour_rate: iv.first_hour_rate,
          second_hour_rate: iv.second_hour_rate,
          weekly_rate_snapshot: iv.weekly_rate_snapshot,
          daily_rate_snapshot: iv.daily_rate_snapshot,
          monthly_rate_snapshot: iv.monthly_rate_snapshot,
          vehicle: { registration_number: iv.vehicle_number, type: iv.vehicle_type, capacity: iv.capacity },
          // The saved duration_minutes on a session can be 0 even when real in/out times (or
          // meter readings) were recorded - derive the real duration from those when that
          // happens, so each session still gets its own accurate breakdown line.
          sessions: sessions.length > 0
            ? sessions.map(s => {
                const minutes = s.duration_minutes > 0 ? s.duration_minutes : calcSessionMinutes({
                  in_time: s.in_time,
                  out_time: s.out_time,
                  opening_hour_meter: s.opening_hour_meter,
                  closing_hour_meter: s.closing_hour_meter,
                });
                return {
                  session_number: s.session_number,
                  duration_hours: round2(minutes / 60),
                  duration_minutes: minutes,
                  in_time: s.in_time,
                  rate_type: s.rate_type,
                };
              })
            : null,
        };
        const rebuilt = buildInvoiceLineDescription(tr);
        desc = rebuilt.description;
        calcDetails = rebuilt.calculation_details;

        // Only treat the line as a flat "per day" quantity when there's a single day-rate
        // session to describe. A vehicle with multiple sessions is shown with a full
        // per-session breakdown instead (see buildInvoiceLineDescription), so it keeps the
        // default quantity/unit rather than being mislabeled as "N day".
        if (rateType === 'Daily' && sessionCount <= 1) {
          if (dailyRate > 0) {
            quantity = Math.round((rentalAmount / dailyRate) * 100) / 100;
          }
          unit = 'day';
        }

        // Hourly rows print the actual duration ("6 Hr 10 Min") in Quantity - never a
        // meaningless "1.00 nos" - and the configured 1st/2nd-hour rate pair in Rate,
        // instead of a single derived (amount ÷ quantity) figure.
        if (rateType === 'Hourly') {
          const totalHrs = Number(iv.total_hours) || 0;
          if (totalHrs > 0) quantity = totalHrs;
          unit = 'hr';
          const r1 = Number(iv.first_hour_rate) || 0;
          const r2 = Number(iv.second_hour_rate) || 0;
          if (r1 > 0 || r2 > 0) {
            itemHourlyRateLabel = `${formatNumber(r1)} / ${formatNumber(r2)}`;
          } else {
            itemHourlyRateLabel = liveHourlyRateLabel(iv.vehicle_type, iv.capacity_tons ?? iv.capacity, firstSessionDate || inv.invoice_date, rateMasterRows);
          }
        }

        // iv.rental_amount is always the authoritative total for this vehicle - it's the
        // sum of every session's amount, computed at bill-creation time (see calcRental in
        // rentalCalc.ts). Trust it as-is rather than re-deriving/adding an hourly estimate on
        // top of it, which double-counted vehicles that mix an Hourly session with a Daily/
        // Weekly/Monthly one (e.g. 1 hourly session + 1 full-day session).
        if (rentalAmount > 0) {
          amount = rentalAmount;
        }
      } else if (it.trip) {
        const rebuilt = buildInvoiceLineDescription(it.trip);
        desc = rebuilt.description;
        calcDetails = rebuilt.calculation_details;
        if (it.trip.rate_type === 'Hourly') {
          const totalHrs = Number(it.trip.total_hours) || 0;
          if (totalHrs > 0) quantity = totalHrs;
          unit = 'hr';
          const r1 = Number(it.trip.first_hour_rate) || 0;
          const r2 = Number(it.trip.second_hour_rate) || 0;
          if (r1 > 0 || r2 > 0) {
            itemHourlyRateLabel = `${formatNumber(r1)} / ${formatNumber(r2)}`;
          } else {
            const tripDate = it.trip.trip_date ?? inv.invoice_date;
            itemHourlyRateLabel = liveHourlyRateLabel(it.trip.vehicle?.type, it.trip.vehicle?.capacity, tripDate, rateMasterRows);
          }
        }
      } else {
        // Fully legacy row - invoice_items saved directly with no invoice_vehicles or
        // trip link at all (predates both relationships). The vehicle registration number
        // is still embedded in the stored description text (buildInvoiceLineDescription's
        // ' | '-joined format) - use it to identify the vehicle, then live-lookup its
        // applicable Rate Master record, so even these old rows show a real 1st/2nd-hour
        // rate instead of a meaningless derived (amount ÷ 1) figure.
        const segments = desc.split(' | ').map(s => s.trim());
        const looksHourly = segments.some(seg => /^\d+\s*(hr|hrs|hour|hours|min|mins|minutes)\b/i.test(seg));
        if (looksHourly && vehiclesList.length > 0 && rateMasterRows.length > 0) {
          const matchedVehicle = vehiclesList.find(v => segments.includes(v.registration_number));
          if (matchedVehicle) {
            itemHourlyRateLabel = liveHourlyRateLabel(matchedVehicle.type, matchedVehicle.capacity, inv.invoice_date, rateMasterRows);
          }
        }
      }
    }

    // Hide Operator Batha line when amount is 0
    if (isBatha && (Number(it.amount) || 0) === 0) return;

    const calcLines = calcDetails
      ? calcDetails.split('\n').filter(Boolean).map(l => l.replace(/Rental Amount =/g, 'Full Day Amt ='))
      : [];
    rentalDelta += amount - (Number(it.amount) || 0);

    // Applied unconditionally - covers rows rebuilt above (iv / it.trip) AND older rows
    // whose description was stored as-is with the duration baked directly into the text
    // (invoice_vehicles didn't exist yet, or the item was never linked to a vehicle/trip).
    // Either way, Description of Services never shows "4 Hr 23 Min" - it always moves to
    // Quantity instead.
    const { desc: cleanedDesc, durationLabel } = extractDurationSegment(desc);
    desc = cleanedDesc;
    if (durationLabel) {
      // Whether or not a rate (snapshot or live-looked-up) was found, a line whose
      // description carried a duration is an hourly line - Quantity/Per reflect that
      // regardless. Rate falls back to the single derived (amount ÷ quantity) figure
      // only when no applicable Rate Master record could be resolved at all.
      unit = 'hr';
    }

    const rate = quantity > 0 ? round2(amount / quantity) : amount;
    itemRows.push({
      slNo: idx + 1,
      description: desc,
      calcLines,
      hsnSac: it.hsn_sac ?? hsnSacDefault,
      quantity,
      // durationLabel (parsed straight from the stored description) is always the most
      // reliable text - prefer it over reconstructing from `quantity`, which for a fully
      // legacy row is just the raw stored value (often 1), not real hours.
      quantityLabel: durationLabel ?? (itemHourlyRateLabel ? formatDuration(quantity) : `${formatNumber(quantity)} ${unit}`),
      rate,
      rateLabel: itemHourlyRateLabel ?? formatNumber(rate),
      unit,
      amount,
    });
  });

  // Recalculate totals with corrected line amounts
  if (Math.abs(rentalDelta) > 0.01) {
    taxable = Math.round((taxable + rentalDelta) * 100) / 100;
    cgstAmt = Math.round(taxable * Number(inv.cgst_percent) / 100 * 100) / 100;
    sgstAmt = Math.round(taxable * Number(inv.sgst_percent) / 100 * 100) / 100;
    igstAmt = Math.round(taxable * Number(inv.igst_percent) / 100 * 100) / 100;
    totalTax = cgstAmt + sgstAmt + igstAmt;
    grand = Math.round((taxable + totalTax) * 100) / 100;
    if (inv.discount_enabled) {
      const disc = calculateDiscount({ grandTotal: grand, discountEnabled: true, discountPercentage: inv.discount_percent });
      finalPayable = disc.finalPayableAmount;
    } else {
      finalPayable = grand;
    }
    balance = Math.max(0, finalPayable - received);
    words = amountInWords(inv.discount_enabled ? finalPayable : grand);
  }

  return {
    compName, compAddr, compGstin, compState, compStateCode, compEmail, compPhone, compPan, compLogo, compSign, compAuth,
    bankName, bankAcctName, bankAcctNo, bankBranch, bankIfsc, hasBank,
    cName, cAddr, cGstin, cState, cStateCode,
    conName, conAddr, conGstin, conState, conStateCode,
    taxable, cgstAmt, sgstAmt, igstAmt, totalTax, grand, received, finalPayable, balance, isIgst,
    declaration, words, copyLabel, hsnSacDefault, vehicleTypesJoined, vehicleNumbersJoined,
    itemRows,
  };
}
