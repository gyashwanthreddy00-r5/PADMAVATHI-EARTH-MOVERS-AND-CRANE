import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useLang } from '@/context/LangContext';
import { useToast } from '@/components/ui/Toast';
import { useSettings } from '@/context/SettingsContext';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Modal, ConfirmDialog, Button, Field, inputClass, LoadingSpinner } from '@/components/ui/common';
import { Plus, Printer, Eye, Trash2, Download, IndianRupee, CreditCard } from 'lucide-react';
import { formatCurrency, formatDate, formatDuration, todayISO, sanitizePhone, phoneValidationError, buildInvoiceLineDescription } from '@/lib/utils';
import { calcSessionMinutes } from '@/lib/rentalCalc';
import { getReportLogoUrl } from '@/lib/reportLogo';
import { calculateDiscount, validateDiscountPercentage } from '@/lib/discountCalc';
import { exportToExcelProfessional } from '@/lib/excelExport';
import { TripEntryForm, type MultiVehicleTripFormData, type VehicleEntryData } from '@/components/TripEntryForm';
import { DatePicker } from '@/components/ui/DatePicker';
import type { InvoiceWithRelations, InvoicePayment, PaymentMode } from '@/types';

type CashPayStatus = 'Unpaid' | 'Partial' | 'Paid';

// A session's saved duration_minutes can be 0 even when real in/out times (or meter
// readings) were recorded — derive the real duration from those for display when that
// happens, so each session still shows its own accurate hours/amount.
function deriveSessionMinutes(s: { duration_minutes: number; in_time: string | null; out_time: string | null; opening_hour_meter: number | null; closing_hour_meter: number | null }): number {
  if (s.duration_minutes > 0) return s.duration_minutes;
  return calcSessionMinutes({
    in_time: s.in_time,
    out_time: s.out_time,
    opening_hour_meter: s.opening_hour_meter,
    closing_hour_meter: s.closing_hour_meter,
  });
}

function calcBalance(total: number, paid: number): number {
  return Math.max(Math.round((total - paid) * 100) / 100, 0);
}

function calcPayStatus(paid: number, total: number): CashPayStatus {
  if (paid <= 0) return 'Unpaid';
  if (paid >= total) return 'Paid';
  return 'Partial';
}

const PAYMENT_SELECT = 'invoice_payments(*)';
const INVOICE_VEHICLES_SELECT = 'invoiceVehicles:invoice_vehicles(*, vehicle:vehicles!invoice_vehicles_vehicle_id_fkey(id,registration_number,type,capacity), driver:employees!invoice_vehicles_driver_id_fkey(id,name,role), sessions:invoice_vehicle_sessions(*))';
const FULL_SELECT = `*, customer:customers!invoices_customer_id_fkey(id,name), ${PAYMENT_SELECT}, ${INVOICE_VEHICLES_SELECT}`;

function statusBadgeVariant(status: CashPayStatus): { label: string; className: string } {
  switch (status) {
    case 'Paid': return { label: 'Paid', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
    case 'Partial': return { label: 'Partial', className: 'bg-amber-100 text-amber-700 border-amber-200' };
    default: return { label: 'Unpaid', className: 'bg-red-100 text-red-700 border-red-200' };
  }
}

export default function CashBills() {
  const { t } = useLang();
  const { show } = useToast();
  const { settings } = useSettings();
  const [invoices, setInvoices] = useState<InvoiceWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [viewInvoice, setViewInvoice] = useState<InvoiceWithRelations | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteInvoice, setDeleteInvoice] = useState<InvoiceWithRelations | null>(null);
  const [savedInvoice, setSavedInvoice] = useState<InvoiceWithRelations | null>(null);
  const [paymentModal, setPaymentModal] = useState<InvoiceWithRelations | null>(null);
  const [paymentForm, setPaymentForm] = useState({ amount: 0, payment_date: todayISO(), payment_mode: 'Cash' as PaymentMode, reference: '', remarks: '' });
  const [savingPayment, setSavingPayment] = useState(false);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [discountEnabled, setDiscountEnabled] = useState(false);
  const [discountPercent, setDiscountPercent] = useState(0);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('invoices')
        .select(FULL_SELECT)
        .eq('invoice_type', 'Cash')
        .eq('is_cancelled', false)
        .order('invoice_date', { ascending: false });
      if (error) {
        console.error('Cash Bills fetch error:', error);
        show('Unable to load Cash Bills. Please refresh.', 'error');
      } else {
        setInvoices((data ?? []) as InvoiceWithRelations[]);
      }
    } catch (e) {
      console.error('Cash Bills fetchAll error:', e);
      show('Unable to load data. Please check your connection.', 'error');
    }
    setLoading(false);
  }, [show]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const openAdd = () => {
    setCustomerName('');
    setCustomerPhone('');
    setDiscountEnabled(false);
    setDiscountPercent(0);
    setModalOpen(true);
  };

  const save = async (data: MultiVehicleTripFormData) => {
    if (!customerName.trim()) {
      show('Customer name is required', 'error');
      return;
    }
    const phoneErr = phoneValidationError(customerPhone, false);
    if (phoneErr) { show(phoneErr, 'error'); return; }
    if (data.vehicles.length === 0) {
      show('At least one vehicle is required.', 'error');
      return;
    }
    if (data.total_amount <= 0) {
      show('Total amount must be greater than zero. Please fill the trip entry form.', 'error');
      return;
    }

    if (discountEnabled) {
      const pctErr = validateDiscountPercentage(discountPercent);
      if (pctErr) { show(pctErr, 'error'); return; }
      if (!discountPercent || discountPercent <= 0) {
        show('Discount is ON but percentage is empty. Please enter a discount percentage or turn discount OFF.', 'error'); return;
      }
    }
    setSaving(true);
    try {
      await createBill(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unable to save. Please try again.';
      console.error('Cash Bill save error:', e);
      show(msg, 'error');
    }
    setSaving(false);
  };

  const createBill = async (data: MultiVehicleTripFormData) => {
    const totalAmt = data.total_amount;
    const { data: invNum, error: rpcError } = await supabase.rpc('next_pcs_invoice_number', { p_invoice_date: data.trip_date });
    if (rpcError || !invNum) throw new Error('Unable to generate bill number');

    const firstVehicle = data.vehicles[0];
    const vehicleNumbers = data.vehicles.map(v => v.vehicle_number).filter(Boolean).join(', ');
    const desc = `${vehicleNumbers} - ${data.place_of_work} - ${data.vehicles.length} vehicle(s)`.trim();

    const disc = calculateDiscount({ grandTotal: totalAmt, discountEnabled, discountPercentage: discountPercent });
    const finalPayable = disc.finalPayableAmount;

    const invoicePayload = {
      invoice_number: invNum,
      invoice_date: data.trip_date,
      invoice_type: 'Cash' as const,
      customer_id: null,
      customer_name: customerName.trim(),
      customer_phone: customerPhone.trim() || null,
      customer_address: null,
      customer_gstin: null,
      customer_email: null,
      trip_id: null,
      trip_date: data.trip_date,
      vehicle_id: firstVehicle?.vehicle_id || null,
      vehicle_number: vehicleNumbers || null,
      driver_name: firstVehicle?.driver_name ?? null,
      place_of_work: data.place_of_work,
      opening_hour_meter: null,
      closing_hour_meter: null,
      total_hours: data.total_hours,
      rate_type: firstVehicle?.rate_type ?? 'Hourly',
      description: desc,
      hours: data.total_hours,
      rate: data.total_rental,
      taxable_amount: totalAmt,
      cgst_percent: 0, sgst_percent: 0, igst_percent: 0,
      cgst_amount: 0, sgst_amount: 0, igst_amount: 0, total_gst: 0,
      grand_total: totalAmt,
      discount_enabled: discountEnabled,
      discount_percent: discountEnabled ? discountPercent : 0,
      discount_amount: disc.discountAmount,
      final_payable_amount: finalPayable,
      batha: data.total_batha,
      up_transportation_enabled: data.up_transportation_enabled,
      up_transportation_amount: data.up_transportation_enabled ? Number(data.up_transportation_amount) || 0 : 0,
      down_transportation_enabled: data.down_transportation_enabled,
      down_transportation_amount: data.down_transportation_enabled ? Number(data.down_transportation_amount) || 0 : 0,
      amount_received: 0,
      balance_amount: finalPayable,
      invoice_status: 'Pending',
      payment_status: 'Pending',
      payment_mode: null,
      payment_reference: null,
      is_cancelled: false,
    };

    const { data: invRow, error: invErr } = await supabase.from('invoices').insert(invoicePayload).select('id').single();
    if (invErr) throw new Error(invErr.message);

    await insertVehicles(invRow.id, data.vehicles);

    show('Cash / UPI bill created successfully.', 'success');
    setModalOpen(false);
    await fetchAll();

    const { data: savedInv } = await supabase.from('invoices').select(FULL_SELECT).eq('id', invRow.id).single();
    if (savedInv) setSavedInvoice(savedInv as InvoiceWithRelations);
  };

  const insertVehicles = async (invoiceId: string, vehicles: VehicleEntryData[]) => {
    for (let i = 0; i < vehicles.length; i++) {
      const ve = vehicles[i];
      const { data: vehRow, error: vehErr } = await supabase.from('invoice_vehicles').insert({
        invoice_id: invoiceId,
        vehicle_id: ve.vehicle_id || null,
        vehicle_number: ve.vehicle_number,
        vehicle_type: ve.vehicle_type,
        capacity: ve.vehicle_capacity,
        driver_id: ve.driver_id || null,
        driver_name: ve.driver_name,
        place_of_work: ve.place_of_work,
        rate_type: ve.rate_type,
        total_hours: ve.total_hours,
        rental_amount: ve.rental_amount,
        batha: ve.batha,
        vehicle_total: ve.total_amount,
        rate_master_id: ve.rate_master_id,
        rate_version: ve.rate_version,
        capacity_tons: ve.capacity_tons,
        first_hour_rate: ve.first_hour_rate,
        second_hour_rate: ve.second_hour_rate,
        third_hour_rate_snapshot: ve.third_hour_rate_snapshot,
        fourth_hour_rate_snapshot: ve.fourth_hour_rate_snapshot,
        fifth_hour_rate_snapshot: ve.fifth_hour_rate_snapshot,
        weekly_rate_snapshot: ve.weekly_rate_snapshot,
        daily_rate_snapshot: ve.daily_rate_snapshot,
        monthly_rate_snapshot: ve.monthly_rate_snapshot,
        batha_snapshot: ve.batha_snapshot,
        sort_order: i,
      }).select('id').single();
      if (vehErr) throw new Error(vehErr.message);

      if (ve.sessions && ve.sessions.length > 0) {
        const sessionRows = ve.sessions.map((s, idx) => ({
          invoice_vehicle_id: vehRow.id,
          session_number: idx + 1,
          in_time: s.in_time ? new Date(s.in_time).toISOString() : null,
          out_time: s.out_time ? new Date(s.out_time).toISOString() : null,
          opening_hour_meter: s.opening_hour_meter ?? null,
          closing_hour_meter: s.closing_hour_meter ?? null,
          remarks: s.remarks ?? null,
          duration_minutes: 0,
          rate_type: s.rate_type ?? ve.rate_type ?? 'Hourly',
        }));
        const { error: sessErr } = await supabase.from('invoice_vehicle_sessions').insert(sessionRows);
        if (sessErr) console.error('Session save error:', sessErr);
      }
    }
  };

  const handleDelete = async () => {
    if (!deleteInvoice) return;
    const inv = deleteInvoice;
    try {
      const vehicleIds = (inv.invoiceVehicles ?? []).map(v => v.id);
      if (vehicleIds.length > 0) {
        await supabase.from('invoice_vehicle_sessions').delete().in('invoice_vehicle_id', vehicleIds);
        await supabase.from('invoice_vehicles').delete().in('id', vehicleIds);
      }
      await supabase.from('invoice_payments').delete().eq('invoice_id', inv.id);
      const { error } = await supabase.from('invoices').delete().eq('id', inv.id);
      if (error) throw error;
      show('Bill deleted successfully.', 'success');
      await fetchAll();
    } catch (e) {
      console.error('Delete error:', e);
      show('Failed to delete bill.', 'error');
    }
    setDeleteInvoice(null);
  };

  const openPayment = (inv: InvoiceWithRelations) => {
    const totalPaid = (inv.payments ?? []).reduce((s, p) => s + Number(p.amount), 0);
    const payable = inv.discount_enabled ? Number(inv.final_payable_amount ?? inv.grand_total) : Number(inv.grand_total);
    const bal = calcBalance(payable, totalPaid);
    setPaymentModal(inv);
    setPaymentForm({ amount: bal, payment_date: todayISO(), payment_mode: 'Cash', reference: '', remarks: '' });
  };

  const recordPayment = async () => {
    if (!paymentModal) return;
    const totalPaid = (paymentModal.payments ?? []).reduce((s, p) => s + Number(p.amount), 0);
    const payable = paymentModal.discount_enabled ? Number(paymentModal.final_payable_amount ?? paymentModal.grand_total) : Number(paymentModal.grand_total);
    const bal = calcBalance(payable, totalPaid);
    if (paymentForm.amount <= 0) {
      show('Payment amount must be greater than 0.', 'error');
      return;
    }
    if (paymentForm.amount > bal) {
      show(`Payment cannot exceed the outstanding balance of ${formatCurrency(bal)}.`, 'error');
      return;
    }
    setSavingPayment(true);
    try {
      const { error: payErr } = await supabase.from('invoice_payments').insert({
        invoice_id: paymentModal.id,
        amount: paymentForm.amount,
        payment_date: paymentForm.payment_date,
        payment_mode: paymentForm.payment_mode,
        reference: paymentForm.reference || null,
        remarks: paymentForm.remarks || null,
      });
      if (payErr) { show('Failed to record payment.', 'error'); return; }

      const newTotalPaid = Math.round((totalPaid + paymentForm.amount) * 100) / 100;
      const newBal = calcBalance(payable, newTotalPaid);
      const payStatus = calcPayStatus(newTotalPaid, payable);
      const { error: invErr } = await supabase.from('invoices').update({
        amount_received: newTotalPaid,
        balance_amount: newBal,
        invoice_status: payStatus === 'Paid' ? 'Paid' : payStatus === 'Partial' ? 'Partially Paid' : 'Pending',
        payment_status: payStatus === 'Paid' ? 'Paid' : payStatus === 'Partial' ? 'Partially Paid' : 'Pending',
        payment_mode: paymentForm.payment_mode,
        payment_reference: paymentForm.reference || null,
      }).eq('id', paymentModal.id);
      if (invErr) console.error('Invoice update error:', invErr);

      show('Payment recorded successfully.', 'success');
      setPaymentModal(null);
      await fetchAll();
    } catch (e) {
      console.error('Payment error:', e);
      show('Failed to record payment.', 'error');
    }
    setSavingPayment(false);
  };

  const getVehicleDisplay = (inv: InvoiceWithRelations): string => {
    if (inv.invoiceVehicles && inv.invoiceVehicles.length > 0) {
      const count = inv.invoiceVehicles.length;
      const parts = inv.invoiceVehicles.map(v => {
        const type = v.vehicle_type ? `${v.vehicle_type} - ` : '';
        return `${type}${v.vehicle_number ?? ''}`;
      }).filter(x => x.replace(/.*-\s*/, '').length > 0);
      return parts.length > 0 ? parts.join(', ') : `${count} Vehicle${count > 1 ? 's' : ''}`;
    }
    return inv.vehicle_number ?? '-';
  };

  const getVehicleTypesDisplay = (inv: InvoiceWithRelations): string => {
    if (inv.invoiceVehicles && inv.invoiceVehicles.length > 0) {
      return inv.invoiceVehicles.map(v => v.vehicle_type ?? '?').join(' + ');
    }
    return '-';
  };

  const getTotalPaid = (inv: InvoiceWithRelations): number => {
    return (inv.payments ?? []).reduce((s, p) => s + Number(p.amount), 0);
  };

  const getPayableAmount = (inv: InvoiceWithRelations): number => {
    return inv.discount_enabled ? Number(inv.final_payable_amount ?? inv.grand_total) : Number(inv.grand_total);
  };

  const getPayStatus = (inv: InvoiceWithRelations): CashPayStatus => {
    return calcPayStatus(getTotalPaid(inv), getPayableAmount(inv));
  };

  const printInIframe = (html: string) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    iframe.style.visibility = 'hidden';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      document.body.removeChild(iframe);
      show('Unable to open print dialog', 'error');
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    iframe.onload = () => {
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          show('Unable to open print dialog', 'error');
        }
        setTimeout(() => {
          if (iframe.parentNode) document.body.removeChild(iframe);
        }, 1000);
      }, 350);
    };
  };

  const printReceipt = (inv: InvoiceWithRelations) => {
    const companyName = settings?.company_name ?? 'PADMAVATHI EARTH MOVERS AND CRANE SERVICES';
    const totalAmt = Number(inv.grand_total) || 0;
    const paidAmt = getTotalPaid(inv);
    const finalPayable = inv.discount_enabled ? Number(inv.final_payable_amount ?? totalAmt) : totalAmt;
    const bal = calcBalance(finalPayable, paidAmt);
    const payStatus = getPayStatus(inv);
    const upTransport = inv.up_transportation_enabled ? Number(inv.up_transportation_amount) || 0 : 0;
    const downTransport = inv.down_transportation_enabled ? Number(inv.down_transportation_amount) || 0 : 0;
    const payments = (inv.payments ?? []) as InvoicePayment[];

    const numericPart = (inv.invoice_number ?? '').replace(/^[^\d]*/, '');
    const receiptNo = (numericPart || '1').padStart(3, '0');

    const vehicles = inv.invoiceVehicles ?? [];

    const vehicleRows = vehicles.map(v => {
      const sessions = (v.sessions ?? []) as InvoiceVehicleSession[];
      const vType = v.vehicle_type ?? '';
      const capacity = v.capacity_tons ?? v.capacity ?? v.vehicle?.capacity ?? '';
      let craneDesc = vType;
      if (vType === 'JCB') {
        craneDesc = 'JCB';
      } else if (vType === 'Crane') {
        const tonsNum = capacity ? String(capacity).replace(/[^0-9.]/g, '') : '';
        craneDesc = tonsNum ? `${tonsNum} Ton Crane` : 'Crane';
      }
      const vNum = v.vehicle_number ?? v.vehicle?.registration_number ?? '';

      // Rate/hourly breakdown description (e.g. "1st Hr ₹X + 2nd Hr Onwards ₹Y × N Hr = Z"),
      // shown as extra detail lines under the description — reuses the same, already-correct
      // breakdown builder used for GST invoices. Purely descriptive text; the Hours/Rate/Amount
      // columns below still come from their own existing values, unchanged.
      const rateDescLines = buildInvoiceLineDescription({
        rate_type: (v.rate_type ?? 'Hourly') as 'Hourly' | 'Daily' | 'Weekly' | 'Monthly',
        total_hours: Number(v.total_hours) || 0,
        rental_amount: Number(v.rental_amount) || 0,
        trip_date: inv.trip_date ?? inv.invoice_date ?? '',
        place_of_work: v.place_of_work ?? '',
        capacity_tons: v.capacity_tons,
        first_hour_rate: v.first_hour_rate,
        second_hour_rate: v.second_hour_rate,
        weekly_rate_snapshot: v.weekly_rate_snapshot,
        daily_rate_snapshot: v.daily_rate_snapshot,
        monthly_rate_snapshot: v.monthly_rate_snapshot,
        sessions: sessions.length > 0
          ? sessions.map(s => {
              const m = deriveSessionMinutes(s);
              return {
                session_number: s.session_number,
                duration_hours: m / 60,
                duration_minutes: m,
                rate_type: s.rate_type,
              };
            })
          : null,
      }).calculation_details.split('\n').filter(Boolean)
        .map(l => `<div style="font-size:9px;color:#555;margin-top:2px">${l}</div>`).join('');

      const hasUsableSessions = sessions.some(s => deriveSessionMinutes(s) > 0 || (!!s.rate_type && s.rate_type !== 'Hourly'));

      if (!hasUsableSessions) {
        const hours = v.total_hours ? formatDuration(Number(v.total_hours)) : '-';
        const rateType = (v.rate_type ?? 'Hourly') as string;
        const isFlat = rateType === 'Daily' || rateType === 'Weekly' || rateType === 'Monthly';
        const rateLabel = isFlat
          ? formatCurrency(Number(v.rental_amount))
          : `${formatCurrency(Number(v.first_hour_rate) || 0)}/Hr`;
        return `<tr><td>${craneDesc}${vNum ? ' (' + vNum + ')' : ''}${rateDescLines}</td><td style="text-align:center">${hours}</td><td style="text-align:right">${formatCurrency(Number(v.rental_amount))}</td></tr>`;
      }

      return sessions.map((s, sIdx) => {
        const sRateType = (s.rate_type ?? v.rate_type ?? 'Hourly') as string;
        const minutes = deriveSessionMinutes(s);
        const hours = minutes > 0 ? formatDuration(minutes / 60) : '-';
        const rental = Number(v.rental_amount) || 0;
        const batha = Number(v.batha) || 0;
        const r1 = Number(v.first_hour_rate) || 0;
        const r2 = Number(v.second_hour_rate) || 0;
        const dailyRate = Number(v.daily_rate_snapshot) || 0;
        const weeklyRate = Number(v.weekly_rate_snapshot) || 0;
        const monthlyRate = Number(v.monthly_rate_snapshot) || 0;

        let durationLabel = hours;
        let rateLabel = '';
        let sessionAmount = 0;

        if (sRateType === 'Daily') {
          const days = minutes > 0 ? Math.max(1, Math.round(minutes / (24 * 60))) : 1;
          durationLabel = `${days} Day${days > 1 ? 's' : ''}`;
          rateLabel = formatCurrency(dailyRate);
          sessionAmount = dailyRate * days;
        } else if (sRateType === 'Weekly') {
          durationLabel = '1 Week';
          rateLabel = formatCurrency(weeklyRate);
          sessionAmount = weeklyRate;
        } else if (sRateType === 'Monthly') {
          durationLabel = '1 Month';
          rateLabel = formatCurrency(monthlyRate);
          sessionAmount = monthlyRate;
        } else {
          // Hourly
          const fullHours = Math.floor(minutes / 60);
          const remMin = minutes % 60;
          if (fullHours >= 1) {
            durationLabel = `${fullHours} Hr${remMin > 0 ? ' ' + remMin + ' Min' : ''}`;
            rateLabel = `${formatCurrency(r1)}/Hr`;
            sessionAmount = r1 + Math.max(0, fullHours - 1) * r2 + (remMin > 0 ? remMin * (r2 / 60) : 0);
          } else if (minutes > 0) {
            durationLabel = `${minutes} Min`;
            rateLabel = `${formatCurrency(r1)}/Hr`;
            sessionAmount = (minutes / 60) * r1;
          } else {
            durationLabel = '-';
            rateLabel = `${formatCurrency(r1)}/Hr`;
            sessionAmount = 0;
          }
        }

        const isLastSession = sIdx === sessions.length - 1;
        return `<tr><td>${craneDesc}${vNum ? ' (' + vNum + ')' : ''}${isLastSession ? rateDescLines : ''}</td><td style="text-align:center">${durationLabel}</td><td style="text-align:right">${formatCurrency(Math.round(sessionAmount * 100) / 100)}</td></tr>`;
      }).join('');
    }).join('');

    const transportRows: string[] = [];
    if (upTransport > 0) transportRows.push(`<tr><td>UP Transportation Charges</td><td style="text-align:center">—</td><td style="text-align:right">${formatCurrency(upTransport)}</td></tr>`);
    if (downTransport > 0) transportRows.push(`<tr><td>Down Transportation Charges</td><td style="text-align:center">—</td><td style="text-align:right">${formatCurrency(downTransport)}</td></tr>`);

    const paymentHistoryRows = payments.length > 0 ? payments.map(p => `<tr><td style="text-align:center">${formatDate(p.payment_date)}</td><td style="text-align:center">${p.payment_mode ?? '-'}</td><td style="text-align:center">${p.reference ?? '-'}</td><td style="text-align:right">${formatCurrency(Number(p.amount))}</td></tr>`).join('') : '';
    const paymentHistorySection = payments.length > 0 ? `
  <h3 style="margin-top:12px;font-size:12px;font-weight:bold;text-transform:uppercase;border-bottom:1px solid #ccc;padding-bottom:4px">Payment History</h3>
  <table style="width:100%;border-collapse:collapse;margin:4px 0;font-size:10px">
    <thead><tr style="background:#f5f5f5"><th style="padding:4px;border:1px solid #d0d0d0">Date</th><th style="padding:4px;border:1px solid #d0d0d0">Mode</th><th style="padding:4px;border:1px solid #d0d0d0">Reference</th><th style="padding:4px;border:1px solid #d0d0d0;text-align:right">Amount</th></tr></thead>
    <tbody>${paymentHistoryRows}</tbody>
    <tfoot><tr style="font-weight:bold;background:#f9f9f9"><td style="padding:4px;border:1px solid #d0d0d0" colspan="3">Total Paid</td><td style="padding:4px;border:1px solid #d0d0d0;text-align:right">${formatCurrency(paidAmt)}</td></tr></tfoot>
  </table>` : '';

    const discountLine = inv.discount_enabled ? `<div class="row" style="color:#dc2626"><span class="lbl">Discount (${inv.discount_percent}%):</span><span>-${formatCurrency(Number(inv.discount_amount) || 0)}</span></div>` : '';

    const statusLabel = payStatus === 'Paid' ? 'PAID' : payStatus === 'Partial' ? 'PARTIAL' : 'UNPAID';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Cash UPI Receipt - ${receiptNo}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, 'Helvetica', sans-serif; color: #1a1a1a; padding: 16px; max-width: 580px; margin: 0 auto; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .company-name { text-align: center; font-size: 15px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.3px; }
  .logo-block { display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 4px; }
  .logo-block img { width: 40px; height: 30px; object-fit: contain; }
  .receipt-title { text-align: center; font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; color: #333; margin-top: 4px; padding-bottom: 8px; border-bottom: 1px solid #ccc; }
  .receipt-meta { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e0e0e0; font-size: 11px; }
  .receipt-meta .label { font-weight: bold; color: #444; }
  .cust-section { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; padding: 8px 0; border-bottom: 1px solid #e0e0e0; font-size: 11px; }
  .cust-section .field { display: flex; gap: 4px; }
  .cust-section .field .lbl { font-weight: bold; color: #444; white-space: nowrap; }
  .cust-section .field .val { color: #1a1a1a; }
  table.txn { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 11px; }
  table.txn th { background: #f5f5f5; padding: 6px 8px; text-align: left; border: 1px solid #d0d0d0; font-weight: bold; font-size: 10px; text-transform: uppercase; color: #333; }
  table.txn th.c { text-align: center; }
  table.txn th.r { text-align: right; }
  table.txn td { padding: 6px 8px; border: 1px solid #d0d0d0; color: #1a1a1a; }
  .totals { margin-top: 8px; }
  .totals .row { display: flex; justify-content: space-between; font-size: 12px; padding: 3px 0; }
  .totals .row .lbl { font-weight: bold; color: #444; }
  .totals .row.grand { font-size: 14px; font-weight: bold; border-top: 1px solid #999; border-bottom: 1px solid #999; padding: 6px 0; margin-top: 4px; }
  .pay-status { margin-top: 6px; padding: 4px 8px; border: 1px solid #d0d0d0; background: #f9f9f9; font-size: 12px; font-weight: bold; text-align: center; text-transform: uppercase; }
  .footer { text-align: center; margin-top: 16px; font-size: 10px; color: #888; border-top: 1px solid #e0e0e0; padding-top: 6px; }
  @media print { body { max-width: none; padding: 6mm; } @page { size: A4; margin: 8mm; } }
</style>
</head>
<body>
  <div class="logo-block"><img src="${getReportLogoUrl()}" alt="logo"/><div class="company-name">${companyName}</div></div>
  <div class="receipt-title">CASH / UPI RECEIPT</div>
  <div class="receipt-meta">
    <span><span class="label">Receipt No:</span> ${inv.invoice_number ?? receiptNo}</span>
    <span><span class="label">Date:</span> ${formatDate(inv.invoice_date)}</span>
  </div>
  <div class="cust-section">
    <div class="field"><span class="lbl">Customer Name:</span><span class="val">${inv.customer_name ?? '-'}</span></div>
    <div class="field"><span class="lbl">Phone:</span><span class="val">${inv.customer_phone ?? '-'}</span></div>
    <div class="field"><span class="lbl">Vehicles:</span><span class="val">${getVehicleDisplay(inv)}</span></div>
    <div class="field"><span class="lbl">Vehicle Type:</span><span class="val">${getVehicleTypesDisplay(inv)}</span></div>
    <div class="field"><span class="lbl">Place of Work:</span><span class="val">${inv.place_of_work ?? '-'}</span></div>
  </div>
  <table class="txn">
    <thead><tr><th>Description</th><th class="c">Hours / Days</th><th class="r">Amount</th></tr></thead>
    <tbody>${vehicleRows || '<tr><td colspan="4">No vehicles</td></tr>'}${transportRows.join('')}</tbody>
  </table>
  <div class="totals">
    <div class="row"><span class="lbl">Total Amount:</span><span>${formatCurrency(totalAmt)}</span></div>
    ${discountLine}
    <div class="row grand"${inv.discount_enabled ? ' style="color:#1d4ed8"' : ''}><span>${inv.discount_enabled ? 'NET PAYABLE' : 'TOTAL'}</span><span>${formatCurrency(finalPayable)}</span></div>
    <div class="row"><span class="lbl">Paid Amount:</span><span>${formatCurrency(paidAmt)}</span></div>
    <div class="row"><span class="lbl">Balance Due:</span><span>${formatCurrency(bal)}</span></div>
  </div>
  <div class="pay-status">Payment Status: ${statusLabel}</div>
  ${paymentHistorySection}
  <div class="footer">Thank you for your business!</div>
</body>
</html>`;
    printInIframe(html);
  };

  const columns: Column<InvoiceWithRelations>[] = [
    { key: 'invoice_date', header: 'Date', sortable: true, render: i => formatDate(i.invoice_date) },
    { key: 'customer_name', header: 'Customer', render: i => i.customer_name ?? '-' },
    { key: 'vehicle_number', header: 'Vehicle(s)', render: i => {
      const count = i.invoiceVehicles?.length ?? 0;
      if (count > 1) return <span className="font-medium text-blue-600">{count} Vehicles</span>;
      return <span>{getVehicleDisplay(i)}</span>;
    }},
    { key: 'description', header: 'Description', render: i => <span className="truncate max-w-[180px] inline-block">{getVehicleTypesDisplay(i)}</span> },
    { key: 'grand_total', header: 'Total Amount', align: 'right', sortable: true, render: i => formatCurrency(i.grand_total) },
    { key: 'discount', header: 'Discount', align: 'right', render: i => i.discount_enabled ? <span className="text-red-600">-{formatCurrency(Number(i.discount_amount) || 0)} ({i.discount_percent}%)</span> : <span className="text-slate-300">-</span> },
    { key: 'amount_received', header: 'Paid', align: 'right', render: i => formatCurrency(getTotalPaid(i)) },
    { key: 'balance_amount', header: 'Balance', align: 'right', render: i => formatCurrency(calcBalance(getPayableAmount(i), getTotalPaid(i))) },
    {
      key: 'payment_status', header: 'Payment Status',
      render: i => {
        const st = getPayStatus(i);
        const v = statusBadgeVariant(st);
        return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${v.className}`}>{v.label}</span>;
      },
    },
    { key: 'payment_mode', header: 'Payment Mode', render: i => {
      const payments = i.payments ?? [];
      if (payments.length === 0) return '-';
      const modes = [...new Set(payments.map(p => p.payment_mode).filter(Boolean))];
      return <span className="text-xs">{modes.join(', ')}</span>;
    }},
    {
      key: 'actions', header: 'Actions', align: 'center',
      render: i => {
        const st = getPayStatus(i);
        return (
          <div className="flex justify-center gap-1">
            <button onClick={() => setViewInvoice(i)} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md" title="View"><Eye className="w-4 h-4" /></button>
            {st === 'Paid' ? (
              <button onClick={() => setViewInvoice(i)} className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-md" title="View Payments"><CreditCard className="w-4 h-4" /></button>
            ) : (
              <button onClick={() => openPayment(i)} className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-md" title="Make Payment"><IndianRupee className="w-4 h-4" /></button>
            )}
            <button onClick={() => printReceipt(i)} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md" title="Print"><Printer className="w-4 h-4" /></button>
            <button onClick={() => setDeleteInvoice(i)} className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md" title="Delete"><Trash2 className="w-4 h-4" /></button>
          </div>
        );
      },
    },
  ];

  const handleExport = () => {
    const headers = ['S.No', 'Bill No', 'Date', 'Customer', 'Phone', 'Vehicles', 'Description', 'Total Amount', 'Discount', 'Net Payable', 'Paid', 'Balance', 'Mode', 'Status'];
    const dataRows = invoices.map((inv, i) => [
      i + 1, inv.invoice_number, formatDate(inv.invoice_date), inv.customer_name ?? '-',
      inv.customer_phone ?? '-', getVehicleDisplay(inv), getVehicleTypesDisplay(inv),
      inv.grand_total, inv.discount_enabled ? Number(inv.discount_amount) : 0, getPayableAmount(inv),
      getTotalPaid(inv), calcBalance(getPayableAmount(inv), getTotalPaid(inv)),
      (inv.payments ?? []).map(p => p.payment_mode).filter(Boolean).join(', ') || '-',
      getPayStatus(inv),
    ]);
    const totalRow = ['', '', '', '', '', '', '', invoices.reduce((s, i) => s + Number(i.grand_total), 0), invoices.reduce((s, i) => s + (i.discount_enabled ? Number(i.discount_amount) : 0), 0), invoices.reduce((s, i) => s + getPayableAmount(i), 0), invoices.reduce((s, i) => s + getTotalPaid(i), 0), invoices.reduce((s, i) => s + calcBalance(getPayableAmount(i), getTotalPaid(i)), 0), '', ''];
    exportToExcelProfessional('cash-upi-export.xls', 'Cash/UPI Bills Report',
      settings ? { company_name: settings.company_name, address: settings.address, phone: settings.phone, email: settings.email, gstin: settings.gstin, pan: settings.pan } : { company_name: 'PADMAVATHI EARTH MOVERS AND CRANE SERVICES' },
      'All Records', headers, dataRows, totalRow, [7, 8, 9]);
  };

  if (loading) return <LoadingSpinner />;

  const totalBilling = invoices.reduce((s, i) => s + getPayableAmount(i), 0);
  const totalReceived = invoices.reduce((s, i) => s + getTotalPaid(i), 0);
  const totalOutstanding = Math.max(0, totalBilling - totalReceived);

  const paymentModalBalance = paymentModal ? calcBalance(getPayableAmount(paymentModal), getTotalPaid(paymentModal)) : 0;
  const paymentModalNewBalance = paymentModal ? Math.max(0, paymentModalBalance - paymentForm.amount) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <p className="text-sm text-slate-500">{invoices.length} Cash/UPI Bills</p>
          {invoices.length > 0 && (
            <div className="flex gap-3 text-sm">
              <span className="text-slate-600">Total Billing: <span className="font-semibold text-slate-800">{formatCurrency(totalBilling)}</span></span>
              <span className="text-emerald-600">Received: <span className="font-semibold">{formatCurrency(totalReceived)}</span></span>
              <span className="text-red-600">Outstanding: <span className="font-semibold">{formatCurrency(totalOutstanding)}</span></span>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleExport}><Download className="w-4 h-4" />{t('export')}</Button>
          <Button onClick={openAdd}><Plus className="w-4 h-4" />New Cash/UPI Bill</Button>
        </div>
      </div>

      <DataTable columns={columns} data={invoices} searchKeys={['invoice_number', 'customer_name', 'customer_phone']} searchPlaceholder={`${t('search')}...`} showSerialNumber />

      <Modal
        open={modalOpen} onClose={() => !saving && setModalOpen(false)}
        title="Add New Cash / UPI Bill"
        size="xl"
        footer={null}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
            <Field label="Customer Name" required>
              <input className={inputClass()} value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Type customer name" />
            </Field>
            <Field label="Customer Phone Number">
              <input className={inputClass()} type="tel" maxLength={10} value={customerPhone} onChange={e => setCustomerPhone(sanitizePhone(e.target.value))} placeholder="10-digit mobile number" />
            </Field>
          </div>

          <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <input type="checkbox" id="discount-enabled-cash" checked={discountEnabled} onChange={e => setDiscountEnabled(e.target.checked)} className="w-4 h-4 accent-blue-600" />
            <label htmlFor="discount-enabled-cash" className="text-sm font-semibold text-slate-700">Apply Discount</label>
            {discountEnabled && (
              <div className="flex items-center gap-2 ml-auto">
                <label className="text-sm text-slate-600">Discount (%):</label>
                <input type="number" min={0} max={100} step="0.5" className={inputClass() + ' w-24'} value={discountPercent} onChange={e => setDiscountPercent(Number(e.target.value))} placeholder="e.g. 5" />
              </div>
            )}
          </div>

          <TripEntryForm
            onSubmit={save}
            onCancel={() => setModalOpen(false)}
            submitLabel="Save Bill"
            submitting={saving}
            hideCustomerSelect
          />
        </div>
      </Modal>

      <Modal
        open={!!savedInvoice}
        onClose={() => setSavedInvoice(null)}
        title="Bill Saved - Print Receipt"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSavedInvoice(null)}>Close</Button>
            {savedInvoice && <Button onClick={() => { printReceipt(savedInvoice); setSavedInvoice(null); }}><Printer className="w-4 h-4" />Print Receipt</Button>}
          </>
        }
      >
        <p className="text-sm text-slate-600">The Cash/UPI bill has been saved successfully. Would you like to print a receipt now?</p>
      </Modal>

      {/* Payment Modal */}
      <Modal
        open={!!paymentModal}
        onClose={() => setPaymentModal(null)}
        title="Record Payment"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPaymentModal(null)}>Cancel</Button>
            <Button onClick={recordPayment} disabled={savingPayment}>{savingPayment ? 'Saving...' : 'Save Payment'}</Button>
          </>
        }
      >
        {paymentModal && (
          <div className="space-y-4">
            <div className="p-3 bg-slate-50 rounded-lg text-sm space-y-1">
              <div className="flex justify-between"><span className="text-slate-500">Customer:</span><span className="font-medium">{paymentModal.customer_name ?? '-'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Bill No:</span><span className="font-medium">{paymentModal.invoice_number}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Total Amount:</span><span className="font-medium">{formatCurrency(Number(paymentModal.grand_total))}</span></div>
              {paymentModal.discount_enabled && <div className="flex justify-between"><span className="text-slate-500">Discount ({paymentModal.discount_percent}%):</span><span className="font-medium text-red-600">-{formatCurrency(Number(paymentModal.discount_amount) || 0)}</span></div>}
              {paymentModal.discount_enabled && <div className="flex justify-between"><span className="text-slate-500">Net Payable:</span><span className="font-medium text-blue-700">{formatCurrency(getPayableAmount(paymentModal))}</span></div>}
              <div className="flex justify-between"><span className="text-slate-500">Already Paid:</span><span className="font-medium text-emerald-600">{formatCurrency(getTotalPaid(paymentModal))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Balance Due:</span><span className="font-medium text-red-600">{formatCurrency(paymentModalBalance)}</span></div>
            </div>

            {(paymentModal.payments ?? []).length > 0 && (
              <details className="text-sm" open>
                <summary className="cursor-pointer font-semibold text-slate-700 mb-1">Payment History ({(paymentModal.payments ?? []).length})</summary>
                <table className="w-full mt-2">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="px-2 py-1 text-xs text-left border border-slate-200">Date</th>
                      <th className="px-2 py-1 text-xs text-left border border-slate-200">Mode</th>
                      <th className="px-2 py-1 text-xs text-left border border-slate-200">Reference</th>
                      <th className="px-2 py-1 text-xs text-right border border-slate-200">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(paymentModal.payments ?? []).map(p => (
                      <tr key={p.id}>
                        <td className="px-2 py-1 text-xs border border-slate-200">{formatDate(p.payment_date)}</td>
                        <td className="px-2 py-1 text-xs border border-slate-200">{p.payment_mode ?? '-'}</td>
                        <td className="px-2 py-1 text-xs border border-slate-200">{p.reference ?? '-'}</td>
                        <td className="px-2 py-1 text-xs text-right border border-slate-200">{formatCurrency(Number(p.amount))}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-100 font-semibold">
                      <td className="px-2 py-1 text-xs border border-slate-200" colSpan={3}>Total Paid</td>
                      <td className="px-2 py-1 text-xs text-right border border-slate-200">{formatCurrency(getTotalPaid(paymentModal))}</td>
                    </tr>
                  </tfoot>
                </table>
              </details>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Payment Amount" required>
                <input type="number" step="0.01" min="0" max={paymentModalBalance} className={inputClass()} value={paymentForm.amount} onChange={e => setPaymentForm(f => ({ ...f, amount: Number(e.target.value) || 0 }))} />
              </Field>
              <Field label="Payment Date" required>
                <DatePicker value={paymentForm.payment_date} onChange={v => setPaymentForm(f => ({ ...f, payment_date: v }))} />
              </Field>
              <Field label="Payment Mode" required>
                <select className={inputClass()} value={paymentForm.payment_mode} onChange={e => setPaymentForm(f => ({ ...f, payment_mode: e.target.value as PaymentMode }))}>
                  <option value="Cash">Cash</option>
                  <option value="UPI">UPI</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Other">Other</option>
                </select>
              </Field>
              <Field label="Reference / Transaction No.">
                <input className={inputClass()} value={paymentForm.reference} onChange={e => setPaymentForm(f => ({ ...f, reference: e.target.value }))} placeholder="UPI Ref / Transaction ID" />
              </Field>
              <Field label="Remarks">
                <input className={inputClass()} value={paymentForm.remarks} onChange={e => setPaymentForm(f => ({ ...f, remarks: e.target.value }))} />
              </Field>
            </div>

            {paymentForm.amount > 0 && (
              <div className="p-3 bg-blue-50 rounded-lg text-sm space-y-1 border border-blue-100">
                <div className="flex justify-between"><span className="text-slate-500">Current Balance:</span><span className="font-medium">{formatCurrency(paymentModalBalance)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">New Balance:</span><span className={paymentModalNewBalance <= 0 ? 'text-emerald-600 font-bold' : 'text-red-600 font-medium'}>{formatCurrency(paymentModalNewBalance)}</span></div>
                {paymentModalNewBalance <= 0 ? (
                  <div className="text-xs text-emerald-600 font-medium pt-1">Bill will be marked as PAID.</div>
                ) : (
                  <div className="text-xs text-amber-600 font-medium pt-1">Bill will remain PARTIAL.</div>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* View Modal */}
      <Modal open={!!viewInvoice} onClose={() => setViewInvoice(null)} title="Cash / UPI Receipt" size="lg">
        {viewInvoice && (() => {
          const upTransport = viewInvoice.up_transportation_enabled ? Number(viewInvoice.up_transportation_amount) || 0 : 0;
          const downTransport = viewInvoice.down_transportation_enabled ? Number(viewInvoice.down_transportation_amount) || 0 : 0;
          const vehicles = viewInvoice.invoiceVehicles ?? [];
          const payments = (viewInvoice.payments ?? []) as InvoicePayment[];
          const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
          const bal = calcBalance(getPayableAmount(viewInvoice), totalPaid);
          const st = getPayStatus(viewInvoice);
          return (
          <div className="space-y-4">
            <div className="text-center pb-3 border-b border-slate-200">
              <h3 className="text-sm font-bold uppercase tracking-wide">{settings?.company_name ?? 'PADMAVATHI EARTH MOVERS AND CRANE SERVICES'}</h3>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mt-1">CASH / UPI RECEIPT</p>
            </div>

            <div className="flex justify-between text-sm border-b border-slate-100 pb-2">
              <span><span className="text-slate-500 font-medium">Bill No:</span> <span className="font-bold text-slate-700">{viewInvoice.invoice_number}</span></span>
              <span><span className="text-slate-500 font-medium">Date:</span> <span className="font-bold text-slate-700">{formatDate(viewInvoice.invoice_date)}</span></span>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm bg-slate-50 p-3 rounded-lg">
              <div><span className="text-slate-500 font-medium">Customer: </span><span className="font-medium text-slate-700">{viewInvoice.customer_name ?? '-'}</span></div>
              <div><span className="text-slate-500 font-medium">Phone: </span><span className="font-medium text-slate-700">{viewInvoice.customer_phone ?? '-'}</span></div>
              <div className="col-span-2"><span className="text-slate-500 font-medium">Vehicles: </span><span className="font-medium text-slate-700">{getVehicleDisplay(viewInvoice)}</span></div>
              <div><span className="text-slate-500 font-medium">Place of Work: </span><span className="font-medium text-slate-700">{viewInvoice.place_of_work ?? '-'}</span></div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-slate-200">
                <thead>
                  <tr className="bg-slate-100 text-xs uppercase text-slate-600">
                    <th className="text-left px-3 py-2 border-b border-slate-200">Description</th>
                    <th className="text-center px-3 py-2 border-b border-slate-200">Hours / Days</th>
                    <th className="text-right px-3 py-2 border-b border-slate-200">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {vehicles.flatMap(v => {
                    const sessions = (v.sessions ?? []) as InvoiceVehicleSession[];
                    const vType = v.vehicle_type ?? '';
                    const capacity = v.capacity_tons ?? v.capacity ?? v.vehicle?.capacity ?? '';
                    let craneDesc = vType;
                    if (vType === 'JCB') craneDesc = 'JCB';
                    else if (vType === 'Crane') {
                      const tonsNum = capacity ? String(capacity).replace(/[^0-9.]/g, '') : '';
                      craneDesc = tonsNum ? `${tonsNum} Ton Crane` : 'Crane';
                    }
                    const vNum = v.vehicle_number ?? v.vehicle?.registration_number ?? '';
                    const label = `${craneDesc}${vNum ? ' (' + vNum + ')' : ''}`;

                    // Rate/hourly breakdown description (e.g. "1st Hr ₹X + 2nd Hr Onwards ₹Y ×
                    // N Hr = Z"), shown as extra muted lines under the description — reuses the
                    // same, already-correct breakdown builder used for GST invoices. Purely
                    // descriptive text; the Hours/Rate/Amount columns below are unchanged.
                    const rateDescLines = buildInvoiceLineDescription({
                      rate_type: (v.rate_type ?? 'Hourly') as 'Hourly' | 'Daily' | 'Weekly' | 'Monthly',
                      total_hours: Number(v.total_hours) || 0,
                      rental_amount: Number(v.rental_amount) || 0,
                      trip_date: viewInvoice.trip_date ?? viewInvoice.invoice_date ?? '',
                      place_of_work: v.place_of_work ?? '',
                      capacity_tons: v.capacity_tons,
                      first_hour_rate: v.first_hour_rate,
                      second_hour_rate: v.second_hour_rate,
                      weekly_rate_snapshot: v.weekly_rate_snapshot,
                      daily_rate_snapshot: v.daily_rate_snapshot,
                      monthly_rate_snapshot: v.monthly_rate_snapshot,
                      sessions: sessions.length > 0
                        ? sessions.map(s => {
                            const m = deriveSessionMinutes(s);
                            return {
                              session_number: s.session_number,
                              duration_hours: m / 60,
                              duration_minutes: m,
                              rate_type: s.rate_type,
                            };
                          })
                        : null,
                    }).calculation_details.split('\n').filter(Boolean);
                    const rateDesc = rateDescLines.length > 0 ? (
                      <div className="mt-1 space-y-0.5">
                        {rateDescLines.map((l, li) => <div key={li} className="text-[10px] text-slate-500">{l}</div>)}
                      </div>
                    ) : null;

                    const hasUsableSessions = sessions.some(s => deriveSessionMinutes(s) > 0 || (!!s.rate_type && s.rate_type !== 'Hourly'));

                    if (!hasUsableSessions) {
                      const hours = v.total_hours ? formatDuration(Number(v.total_hours)) : '-';
                      const rateType = (v.rate_type ?? 'Hourly') as string;
                      const isFlat = rateType === 'Daily' || rateType === 'Weekly' || rateType === 'Monthly';
                      const rateLabel = isFlat ? formatCurrency(Number(v.rental_amount)) : `${formatCurrency(Number(v.first_hour_rate) || 0)}/Hr`;
                      return [(
                        <tr key={v.id}>
                          <td className="px-3 py-2 border-b border-slate-100">{label}{rateDesc}</td>
                          <td className="text-center px-3 py-2 border-b border-slate-100">{hours}</td>
                          <td className="text-right px-3 py-2 border-b border-slate-100">{formatCurrency(Number(v.rental_amount))}</td>
                        </tr>
                      )];
                    }

                    return sessions.map((s, sIdx) => {
                      const sRateType = (s.rate_type ?? v.rate_type ?? 'Hourly') as string;
                      const minutes = deriveSessionMinutes(s);
                      const r1 = Number(v.first_hour_rate) || 0;
                      const r2 = Number(v.second_hour_rate) || 0;
                      const dailyRate = Number(v.daily_rate_snapshot) || 0;
                      const weeklyRate = Number(v.weekly_rate_snapshot) || 0;
                      const monthlyRate = Number(v.monthly_rate_snapshot) || 0;

                      let durationLabel = minutes > 0 ? formatDuration(minutes / 60) : '-';
                      let rateLabel = '';
                      let sessionAmount = 0;

                      if (sRateType === 'Daily') {
                        const days = minutes > 0 ? Math.max(1, Math.round(minutes / (24 * 60))) : 1;
                        durationLabel = `${days} Day${days > 1 ? 's' : ''}`;
                        rateLabel = formatCurrency(dailyRate);
                        sessionAmount = dailyRate * days;
                      } else if (sRateType === 'Weekly') {
                        durationLabel = '1 Week';
                        rateLabel = formatCurrency(weeklyRate);
                        sessionAmount = weeklyRate;
                      } else if (sRateType === 'Monthly') {
                        durationLabel = '1 Month';
                        rateLabel = formatCurrency(monthlyRate);
                        sessionAmount = monthlyRate;
                      } else {
                        const fullHours = Math.floor(minutes / 60);
                        const remMin = minutes % 60;
                        if (fullHours >= 1) {
                          durationLabel = `${fullHours} Hr${remMin > 0 ? ' ' + remMin + ' Min' : ''}`;
                          rateLabel = `${formatCurrency(r1)}/Hr`;
                          sessionAmount = r1 + Math.max(0, fullHours - 1) * r2 + (remMin > 0 ? remMin * (r2 / 60) : 0);
                        } else if (minutes > 0) {
                          durationLabel = `${minutes} Min`;
                          rateLabel = `${formatCurrency(r1)}/Hr`;
                          sessionAmount = (minutes / 60) * r1;
                        } else {
                          durationLabel = '-';
                          rateLabel = `${formatCurrency(r1)}/Hr`;
                        }
                      }

                      const isLastSession = sIdx === sessions.length - 1;
                      return (
                        <tr key={`${v.id}-${sIdx}`}>
                          <td className="px-3 py-2 border-b border-slate-100">{label}{isLastSession ? rateDesc : null}</td>
                          <td className="text-center px-3 py-2 border-b border-slate-100">{durationLabel}</td>
                          <td className="text-right px-3 py-2 border-b border-slate-100">{formatCurrency(Math.round(sessionAmount * 100) / 100)}</td>
                        </tr>
                      );
                    });
                  })}
                  {upTransport > 0 && (
                    <tr><td className="px-3 py-2 border-b border-slate-100">UP Transportation</td><td className="text-center px-3 py-2 border-b border-slate-100">—</td><td className="text-right px-3 py-2 border-b border-slate-100">{formatCurrency(upTransport)}</td></tr>
                  )}
                  {downTransport > 0 && (
                    <tr><td className="px-3 py-2 border-b border-slate-100">Down Transportation</td><td className="text-center px-3 py-2 border-b border-slate-100">—</td><td className="text-right px-3 py-2 border-b border-slate-100">{formatCurrency(downTransport)}</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="font-medium text-slate-600">Total Amount:</span><span className="font-bold">{formatCurrency(Number(viewInvoice.grand_total))}</span></div>
              {viewInvoice.discount_enabled && <div className="flex justify-between"><span className="font-medium text-slate-600">Discount ({viewInvoice.discount_percent}%):</span><span className="font-bold text-red-600">-{formatCurrency(Number(viewInvoice.discount_amount) || 0)}</span></div>}
              {viewInvoice.discount_enabled && <div className="flex justify-between border-t border-slate-200 pt-1"><span className="font-bold text-blue-700">Net Payable:</span><span className="font-bold text-blue-700">{formatCurrency(getPayableAmount(viewInvoice))}</span></div>}
              <div className="flex justify-between"><span className="font-medium text-slate-600">Paid Amount:</span><span className="font-bold text-emerald-600">{formatCurrency(totalPaid)}</span></div>
              <div className="flex justify-between"><span className="font-medium text-slate-600">Balance Due:</span><span className="font-bold text-red-600">{formatCurrency(bal)}</span></div>
              <div className="flex justify-between border-t border-slate-300 pt-2 mt-1"><span className="font-bold text-slate-700">Payment Status</span><span className="font-bold">{statusBadgeVariant(st).label}</span></div>
            </div>

            {payments.length > 0 && (
              <details className="text-sm" open>
                <summary className="cursor-pointer font-semibold text-slate-700 mb-1">Payment History ({payments.length})</summary>
                <table className="w-full mt-2">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="px-2 py-1 text-xs text-left border border-slate-200">Date</th>
                      <th className="px-2 py-1 text-xs text-left border border-slate-200">Mode</th>
                      <th className="px-2 py-1 text-xs text-left border border-slate-200">Reference</th>
                      <th className="px-2 py-1 text-xs text-right border border-slate-200">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map(p => (
                      <tr key={p.id}>
                        <td className="px-2 py-1 text-xs border border-slate-200">{formatDate(p.payment_date)}</td>
                        <td className="px-2 py-1 text-xs border border-slate-200">{p.payment_mode ?? '-'}</td>
                        <td className="px-2 py-1 text-xs border border-slate-200">{p.reference ?? '-'}</td>
                        <td className="px-2 py-1 text-xs text-right border border-slate-200">{formatCurrency(Number(p.amount))}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-100 font-semibold">
                      <td className="px-2 py-1 text-xs border border-slate-200" colSpan={3}>Total Paid</td>
                      <td className="px-2 py-1 text-xs text-right border border-slate-200">{formatCurrency(totalPaid)}</td>
                    </tr>
                  </tfoot>
                </table>
              </details>
            )}

            <div className="flex justify-between items-center">
              {st !== 'Paid' ? (
                <Button onClick={() => { setViewInvoice(null); openPayment(viewInvoice); }}><IndianRupee className="w-4 h-4" />Make Payment</Button>
              ) : (
                <span className="text-xs text-slate-400">Fully paid</span>
              )}
              <Button variant="outline" onClick={() => printReceipt(viewInvoice)}><Printer className="w-4 h-4" />{t('print')}</Button>
            </div>
          </div>
          );
        })()}
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteInvoice}
        onClose={() => setDeleteInvoice(null)}
        onConfirm={handleDelete}
        title="Delete Bill"
        message={deleteInvoice ? (
          <div className="space-y-2">
            <p>Are you sure you want to delete this bill?</p>
            <div className="p-3 bg-slate-50 rounded-lg text-sm space-y-1">
              <div><span className="text-slate-500">Bill No:</span> <span className="font-medium">{deleteInvoice.invoice_number}</span></div>
              <div><span className="text-slate-500">Customer:</span> <span className="font-medium">{deleteInvoice.customer_name ?? '-'}</span></div>
              <div><span className="text-slate-500">Total:</span> <span className="font-medium">{formatCurrency(Number(deleteInvoice.grand_total))}</span></div>
              <div><span className="text-slate-500">Paid:</span> <span className="font-medium text-emerald-600">{formatCurrency(getTotalPaid(deleteInvoice))}</span></div>
              <div><span className="text-slate-500">Balance:</span> <span className="font-medium text-red-600">{formatCurrency(calcBalance(Number(deleteInvoice.grand_total), getTotalPaid(deleteInvoice)))}</span></div>
            </div>
            {(deleteInvoice.payments ?? []).length > 0 && (
              <p className="text-red-600 font-medium text-sm">This bill has {(deleteInvoice.payments ?? []).length} recorded payment(s). Deleting it will also remove its payment history.</p>
            )}
            <p className="text-sm text-slate-600">This action cannot be undone.</p>
          </div>
        ) : 'Are you sure?'}
        confirmText="Delete Permanently"
        danger
      />
    </div>
  );
}
