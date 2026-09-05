import type { InvoiceWithRelations, InvoiceItem, InvoiceVehicle, InvoiceVehicleSession } from '@/types';
import { calcSessionAmount } from '@/lib/rentalCalc';
import { formatCurrency, formatDuration, formatDate, formatNumber, buildInvoiceLineDescription } from '@/lib/utils';
import { calculateDiscount } from '@/lib/discountCalc';

export interface SessionCalc {
  session_number: number;
  rate_type: string;
  duration_minutes: number;
  duration_hours: number;
  session_amount: number;
  breakdown: string;
}

export interface VehicleCalc {
  vehicle_number: string | null;
  vehicle_type: string | null;
  capacity: string | null;
  capacity_tons: string | null;
  driver_name: string | null;
  place_of_work: string | null;
  rate_type: string;
  total_hours: number;
  first_hour_rate: number;
  second_hour_rate: number;
  daily_rate_snapshot: number;
  weekly_rate_snapshot: number;
  monthly_rate_snapshot: number;
  rental_amount: number;
  computed_rental: number;
  batha: number;
  vehicle_total: number;
  sessions: SessionCalc[];
  description: string;
  calculation_details: string;
}

export interface InvoiceTotals {
  vehicles: VehicleCalc[];
  items: InvoiceItemCalc[];
  rental_total: number;
  batha_total: number;
  up_transportation: number;
  down_transportation: number;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_tax: number;
  grand_total: number;
  discount_enabled: boolean;
  discount_percent: number;
  discount_amount: number;
  final_payable_amount: number;
  amount_received: number;
  balance: number;
  amount_in_words: string;
}

export interface InvoiceItemCalc {
  sl_no: number;
  description: string;
  hsn_sac: string;
  quantity: number;
  rate: number;
  unit: string;
  amount: number;
  batha: number;
  calculation_details: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function calcSessionMinutes(s: InvoiceVehicleSession): number {
  if (s.duration_minutes && s.duration_minutes > 0) return s.duration_minutes;
  if (s.in_time && s.out_time) {
    const i = new Date(s.in_time).getTime();
    const o = new Date(s.out_time).getTime();
    if (!isNaN(i) && !isNaN(o) && o >= i) return Math.round((o - i) / 60000);
  }
  if (s.opening_hour_meter != null && s.closing_hour_meter != null) {
    if (s.closing_hour_meter >= s.opening_hour_meter) {
      return Math.round((s.closing_hour_meter - s.opening_hour_meter) * 60);
    }
  }
  return 0;
}

function buildHourlyBreakdown(minutes: number, r1: number, r2: number, dailyRate: number, amount: number): string {
  if (minutes <= 0) return '0';
  if (dailyRate > 0 && minutes >= 8 * 60) {
    return `Full Day Amt = ${formatCurrency(dailyRate)}`;
  }
  const fullHours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (fullHours < 1) {
    const fracAmount = round2((minutes / 60) * r1);
    return `${minutes} Min ${formatCurrency(fracAmount)} = ${formatCurrency(amount)}`;
  }
  const parts: string[] = [`1st Hr ${formatCurrency(r1)}`];
  if (fullHours > 1) {
    parts.push(`${fullHours - 1} Hr ${formatCurrency(round2((fullHours - 1) * r2))}`);
  }
  if (remainingMinutes > 0) {
    parts.push(`${remainingMinutes} Min ${formatCurrency(round2(remainingMinutes * r2 / 60))}`);
  }
  parts.push(`= ${formatCurrency(amount)}`);
  return parts.join(' + ');
}

function computeVehicle(iv: InvoiceVehicle & { sessions?: InvoiceVehicleSession[] | null }): VehicleCalc {
  const sessions = iv.sessions ?? [];
  const r1 = Number(iv.first_hour_rate) || 0;
  const r2 = Number(iv.second_hour_rate) || 0;
  const dRate = Number(iv.daily_rate_snapshot) || 0;
  const wRate = Number(iv.weekly_rate_snapshot) || 0;
  const mRate = Number(iv.monthly_rate_snapshot) || 0;
  const baseRental = Number(iv.rental_amount) || 0;
  const batha = Number(iv.batha) || 0;
  const rateType = iv.rate_type ?? 'Hourly';

  const sessionCalcs: SessionCalc[] = sessions.map((s, idx) => {
    const minutes = calcSessionMinutes(s);
    const hasNoTimeData = !s.in_time && !s.out_time
      && s.opening_hour_meter == null && s.closing_hour_meter == null;
    const sRateType = (hasNoTimeData && s.rate_type === 'Hourly')
      ? rateType
      : (s.rate_type ?? rateType);
    let sAmount = 0;
    let breakdown = '';

    if (sRateType === 'Daily') {
      sAmount = dRate;
      breakdown = `Full Day Amt = ${formatCurrency(dRate)}`;
    } else if (sRateType === 'Monthly') {
      sAmount = mRate;
      breakdown = `Monthly Rate = ${formatCurrency(mRate)}`;
    } else if (sRateType === 'Weekly') {
      sAmount = wRate;
      breakdown = `Weekly Rate = ${formatCurrency(wRate)}`;
    } else {
      sAmount = calcSessionAmount(minutes, r1, r2, dRate);
      breakdown = buildHourlyBreakdown(minutes, r1, r2, dRate, sAmount);
    }

    return {
      session_number: s.session_number || idx + 1,
      rate_type: sRateType,
      duration_minutes: minutes,
      duration_hours: round2(minutes / 60),
      session_amount: round2(sAmount),
      breakdown,
    };
  });

  // computed_rental = sum of all session amounts (or baseRental if no sessions)
  const computedRental = sessionCalcs.length > 0
    ? round2(sessionCalcs.reduce((sum, s) => sum + s.session_amount, 0))
    : baseRental;

  const vehicleTotal = round2(computedRental + batha);

  // Build description
  const vType = iv.vehicle_type;
  const capacity = iv.capacity_tons || iv.capacity;
  let typeLabel = 'Vehicle';
  if (vType === 'JCB') typeLabel = 'JCB';
  else if (vType === 'Crane') {
    const tonsNum = capacity ? String(capacity).replace(/[^0-9.]/g, '') : '';
    typeLabel = tonsNum ? `${tonsNum} Tons Crane` : 'Crane';
  } else if (vType) typeLabel = vType;

  const firstSessionDate = sessions.length > 0 && sessions[0].in_time
    ? sessions[0].in_time
    : null;
  const dateStr = formatDate(firstSessionDate ?? null);
  const vehicleStr = iv.vehicle_number ?? '';
  const hoursStr = Number(iv.total_hours) > 0 ? formatDuration(Number(iv.total_hours)) : '';
  const sessionCount = sessions.length > 1 ? `${sessions.length} Sessions` : '';
  const metaStr = [dateStr, vehicleStr, hoursStr, sessionCount].filter(Boolean).join(' | ');
  const description = `${typeLabel}${metaStr ? ' — ' + metaStr : ''}`;

  // Build calculation details
  const calcParts: string[] = [];
  if (sessionCalcs.length > 0) {
    sessionCalcs.forEach(s => {
      if (s.duration_minutes > 0 || s.rate_type === 'Daily' || s.rate_type === 'Monthly' || s.rate_type === 'Weekly') {
        calcParts.push(s.breakdown);
      }
    });
  } else {
    // No sessions stored — compute from total_hours
    if (rateType === 'Daily') {
      calcParts.push(`Full Day Amt = ${formatCurrency(dRate || baseRental)}`);
    } else if (rateType === 'Monthly') {
      calcParts.push(`Monthly Rate = ${formatCurrency(mRate || baseRental)}`);
    } else if (rateType === 'Weekly') {
      calcParts.push(`Weekly Rate = ${formatCurrency(wRate || baseRental)}`);
    } else {
      const totalMinutes = Math.round(Number(iv.total_hours) * 60);
      const amount = calcSessionAmount(totalMinutes, r1, r2, dRate);
      calcParts.push(buildHourlyBreakdown(totalMinutes, r1, r2, dRate, amount));
    }
  }
  calcParts.push(`Rental Amount = ${formatCurrency(computedRental)}`);
  const calculation_details = calcParts.join('\n');

  return {
    vehicle_number: iv.vehicle_number,
    vehicle_type: iv.vehicle_type,
    capacity: iv.capacity,
    capacity_tons: iv.capacity_tons,
    driver_name: iv.driver_name,
    place_of_work: iv.place_of_work,
    rate_type: rateType,
    total_hours: Number(iv.total_hours) || 0,
    first_hour_rate: r1,
    second_hour_rate: r2,
    daily_rate_snapshot: dRate,
    weekly_rate_snapshot: wRate,
    monthly_rate_snapshot: mRate,
    rental_amount: baseRental,
    computed_rental: computedRental,
    batha,
    vehicle_total: vehicleTotal,
    sessions: sessionCalcs,
    description,
    calculation_details,
  };
}

export function computeInvoiceTotals(inv: InvoiceWithRelations): InvoiceTotals {
  const invVehicles = inv.invoiceVehicles ?? [];

  const vehicleCalcs = invVehicles.map(iv => computeVehicle(iv));

  const rentalTotal = round2(vehicleCalcs.reduce((s, v) => s + v.computed_rental, 0));
  const bathaTotal = round2(vehicleCalcs.reduce((s, v) => s + v.batha, 0));
  const upTransport = inv.up_transportation_enabled ? Number(inv.up_transportation_amount) || 0 : 0;
  const downTransport = inv.down_transportation_enabled ? Number(inv.down_transportation_amount) || 0 : 0;

  const taxable = round2(rentalTotal + bathaTotal + upTransport + downTransport);

  const cgstAmt = round2(taxable * Number(inv.cgst_percent) / 100);
  const sgstAmt = round2(taxable * Number(inv.sgst_percent) / 100);
  const igstAmt = round2(taxable * Number(inv.igst_percent) / 100);
  const totalTax = round2(cgstAmt + sgstAmt + igstAmt);
  const grand = round2(taxable + totalTax);

  const discountEnabled = inv.discount_enabled;
  const discountPercent = Number(inv.discount_percent) || 0;
  const disc = calculateDiscount({ grandTotal: grand, discountEnabled, discountPercentage: discountPercent });
  const finalPayable = disc.finalPayableAmount;
  const discountAmount = disc.discountAmount;

  const received = Number(inv.amount_received) || 0;
  const balance = Math.max(0, round2(finalPayable - received));

  // Build items list
  const items: InvoiceItemCalc[] = [];
  const hsn = inv.items?.[0]?.hsn_sac ?? '997319';
  let slNo = 1;

  vehicleCalcs.forEach(v => {
    let unit = 'nos';
    if (v.rate_type === 'Daily') unit = 'day';
    else if (v.rate_type === 'Monthly') unit = 'month';
    else if (v.rate_type === 'Weekly') unit = 'week';
    items.push({
      sl_no: slNo++,
      description: v.description,
      hsn_sac: hsn,
      quantity: 1,
      rate: v.computed_rental,
      unit,
      amount: v.computed_rental,
      batha: v.batha,
      calculation_details: v.calculation_details,
    });
  });

  if (bathaTotal > 0) {
    items.push({
      sl_no: slNo++,
      description: 'OPERATOR BATHA',
      hsn_sac: hsn,
      quantity: 1,
      rate: bathaTotal,
      unit: 'nos',
      amount: bathaTotal,
      batha: bathaTotal,
      calculation_details: `Operator Batha: ${formatCurrency(bathaTotal)}`,
    });
  }
  if (upTransport > 0) {
    items.push({
      sl_no: slNo++,
      description: 'UP TRANSPORTATION CHARGES',
      hsn_sac: hsn,
      quantity: 1,
      rate: upTransport,
      unit: 'nos',
      amount: upTransport,
      batha: 0,
      calculation_details: `UP Transportation: ${formatCurrency(upTransport)}`,
    });
  }
  if (downTransport > 0) {
    items.push({
      sl_no: slNo++,
      description: 'DOWN TRANSPORTATION CHARGES',
      hsn_sac: hsn,
      quantity: 1,
      rate: downTransport,
      unit: 'nos',
      amount: downTransport,
      batha: 0,
      calculation_details: `DOWN Transportation: ${formatCurrency(downTransport)}`,
    });
  }

  return {
    vehicles: vehicleCalcs,
    items,
    rental_total: rentalTotal,
    batha_total: bathaTotal,
    up_transportation: upTransport,
    down_transportation: downTransport,
    taxable_amount: taxable,
    cgst_amount: cgstAmt,
    sgst_amount: sgstAmt,
    igst_amount: igstAmt,
    total_tax: totalTax,
    grand_total: grand,
    discount_enabled: discountEnabled,
    discount_percent: discountPercent,
    discount_amount: discountAmount,
    final_payable_amount: finalPayable,
    amount_received: received,
    balance,
    amount_in_words: '',
  };
}
