import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useLang } from '@/context/LangContext';
import { useToast } from '@/components/ui/Toast';
import { useSettings } from '@/context/SettingsContext';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Modal, ConfirmDialog, StatusBadge, Button, Field, inputClass, LoadingSpinner } from '@/components/ui/common';
import {
  Plus, Pencil, Trash2, Download, Printer, Copy, Eye, X,
  ArrowUp, ArrowDown, Mail, Send,
} from 'lucide-react';
import type { QuotationFormatSettings } from '@/types';
import { calculateDiscount, validateDiscountPercentage } from '@/lib/discountCalc';
import { formatCurrency, formatDate, todayISO, addDays, amountInWords, classNames, sanitizePhone, phoneValidationError } from '@/lib/utils';
import { exportToExcelWithCompany } from '@/lib/utils';
import { generateQuotationPdfFromUrl } from '@/lib/quotationPdf';
import { RichTextEditor } from '@/components/RichTextEditor';
import { DatePicker } from '@/components/ui/DatePicker';
import type { Quotation, QuotationStatus, QuotationEmailSettings, QuotationEmailHistory } from '@/types';

interface OtherCharge {
  description: string;
  amount: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export default function Quotations() {
  const { t } = useLang();
  const { show } = useToast();
  const { settings } = useSettings();

  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Quotation | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailQuotation, setEmailQuotation] = useState<Quotation | null>(null);
  const [emailSettings, setEmailSettings] = useState<QuotationEmailSettings | null>(null);
  const [emailForm, setEmailForm] = useState({ recipient: '', cc: '', bcc: '', subject: '', body: '' });
  const [emailSending, setEmailSending] = useState(false);
  const [emailHistory, setEmailHistory] = useState<Record<string, QuotationEmailHistory[]>>({});
  const [viewQuotation, setViewQuotation] = useState<Quotation | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [previewObjUrl, setPreviewObjUrl] = useState<string | null>(null);
  const [letterheadUploaded, setLetterheadUploaded] = useState(false);
  const [quoFormatSettings, setQuoFormatSettings] = useState<QuotationFormatSettings | null>(null);

  const [form, setForm] = useState({
    quotation_number: '',
    quotation_date: todayISO(),
    valid_until: '',
    customer_id: '' as string,
    customer_name: '',
    customer_address: '',
    customer_phone: '',
    customer_email: '',
    customer_gstin: '',
    reference_no: '',
    subject: 'Quotation for Crane / JCB Hire',
    site_location: '',
    quotation_amount: 0,
    service_amount_enabled: true,
    up_transportation_enabled: false,
    up_transportation_description: '',
    up_transportation_amount: 0,
    other_charges: [] as OtherCharge[],
    gst_enabled: true,
    gst_percent: 18,
    discount_enabled: false,
    discount_percent: 0,
    terms_and_conditions: '',
    payment_terms: '',
    status: 'Draft' as QuotationStatus,
  });

  const fetchQuotations = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('quotations')
      .select('*')
      .order('created_at', { ascending: false });
    const qs = (data ?? []) as Quotation[];
    setQuotations(qs);
    setLoading(false);
    const { data: histData } = await supabase
      .from('quotation_email_history')
      .select('quotation_id, status, sent_at')
      .in('quotation_id', qs.map(q => q.id));
    const histMap: Record<string, QuotationEmailHistory[]> = {};
    for (const h of (histData ?? []) as QuotationEmailHistory[]) {
      if (!histMap[h.quotation_id]) histMap[h.quotation_id] = [];
      histMap[h.quotation_id].push(h);
    }
    setEmailHistory(histMap);
  }, []);

  useEffect(() => {
    fetchQuotations();
  }, [fetchQuotations]);

  useEffect(() => {
    supabase.from('quotation_format_settings').select('*').limit(1).maybeSingle().then(({ data }) => {
      setQuoFormatSettings(data as QuotationFormatSettings | null);
    });
  }, []);

  useEffect(() => {
    supabase.from('quotation_email_settings').select('*').limit(1).maybeSingle().then(({ data }) => {
      setEmailSettings(data as QuotationEmailSettings | null);
    });
  }, []);

  useEffect(() => {
    if (letterheadUploaded) return;
    (async () => {
      try {
        const res = await fetch('/quotation-templates/Padmavathi_3_Page_Letterhead_Darker_Watermark copy.pdf');
        if (!res.ok) return;
        const bytes = new Uint8Array(await res.arrayBuffer());
        await supabase.storage.from('quotation-assets').upload('company/letterhead.pdf', bytes, { upsert: true, contentType: 'application/pdf' });
        setLetterheadUploaded(true);
      } catch { /* non-critical */ }
    })();
  }, [letterheadUploaded]);

  const otherChargesTotal = useMemo(() => {
    return form.other_charges.reduce((sum, oc) => sum + (Number(oc.amount) || 0), 0);
  }, [form.other_charges]);

  const subtotal = useMemo(() => {
    const svc = form.service_amount_enabled ? (Number(form.quotation_amount) || 0) : 0;
    const up = form.up_transportation_enabled ? (Number(form.up_transportation_amount) || 0) : 0;
    return round2(svc + up + otherChargesTotal);
  }, [form.quotation_amount, form.service_amount_enabled, form.up_transportation_enabled, form.up_transportation_amount,
      otherChargesTotal]);

  const gstAmount = useMemo(() => {
    if (!form.gst_enabled) return 0;
    return round2(subtotal * (Number(form.gst_percent) || 0) / 100);
  }, [subtotal, form.gst_enabled, form.gst_percent]);

  const grandTotal = useMemo(() => round2(subtotal + gstAmount), [subtotal, gstAmount]);

  const discount = useMemo(() => calculateDiscount({
    grandTotal,
    discountEnabled: form.discount_enabled,
    discountPercentage: form.discount_percent,
  }), [grandTotal, form.discount_enabled, form.discount_percent]);

  const addOtherCharge = () => setForm(f => ({ ...f, other_charges: [...f.other_charges, { description: '', amount: 0 }] }));
  const updateOtherCharge = (index: number, patch: Partial<OtherCharge>) =>
    setForm(f => ({ ...f, other_charges: f.other_charges.map((oc, i) => i === index ? { ...oc, ...patch } : oc) }));
  const removeOtherCharge = (index: number) =>
    setForm(f => ({ ...f, other_charges: f.other_charges.filter((_, i) => i !== index) }));

  const openAdd = async () => {
    setEditing(null);
    setModalOpen(true);
    let quoNum = '';
    try {
      const { data } = await supabase.rpc('peek_next_quotation_number', { p_quote_date: todayISO() });
      quoNum = (data as string) ?? '';
    } catch { quoNum = ''; }
    setForm({
      quotation_number: quoNum,
      quotation_date: todayISO(),
      valid_until: '',
      customer_id: '',
      customer_name: '',
      customer_address: '',
      customer_phone: '',
      customer_email: '',
      customer_gstin: '',
      reference_no: '',
      subject: 'Quotation for Crane / JCB Hire',
      site_location: '',
      quotation_amount: 0,
      service_amount_enabled: true,
      up_transportation_enabled: false,
      up_transportation_description: '',
      up_transportation_amount: 0,
      other_charges: [],
      gst_enabled: true,
      gst_percent: Number(settings?.gst_enabled ? (Number(settings.cgst_percent) + Number(settings.sgst_percent)) : 18) || 18,
      discount_enabled: false,
      discount_percent: 0,
      terms_and_conditions: quoFormatSettings?.terms_and_conditions ?? '',
      payment_terms: quoFormatSettings?.default_payment_terms ?? '',
      valid_until: addDays(todayISO(), quoFormatSettings?.default_validity_days ?? 30),
      status: 'Draft',
    });
  };

  const openEdit = async (q: Quotation) => {
    setEditing(q);
    setModalOpen(true);
    const otherChargesJson: OtherCharge[] = q.other_charges_json ?? (q.other_charges_description ? [{ description: q.other_charges_description, amount: q.other_charges_amount ?? 0 }] : []);
    setForm({
      quotation_number: q.quotation_number,
      quotation_date: q.quotation_date,
      valid_until: q.valid_until ?? '',
      customer_id: q.customer_id ?? '',
      customer_name: q.customer_name ?? '',
      customer_address: q.customer_address ?? '',
      customer_phone: q.customer_phone ?? '',
      customer_email: q.customer_email ?? '',
      customer_gstin: q.customer_gstin ?? '',
      reference_no: q.reference_no ?? '',
      subject: q.subject ?? q.reference_subject ?? '',
      site_location: q.site_location ?? '',
      quotation_amount: q.quotation_amount ?? 0,
      service_amount_enabled: q.service_amount_enabled ?? true,
      up_transportation_enabled: q.up_transportation_enabled,
      up_transportation_description: q.up_transportation_description ?? '',
      up_transportation_amount: q.up_transportation_amount,
      other_charges: otherChargesJson,
      gst_enabled: q.gst_enabled,
      gst_percent: q.gst_percent,
      discount_enabled: q.discount_enabled ?? false,
      discount_percent: q.discount_percent ?? 0,
      terms_and_conditions: q.terms_and_conditions ?? '',
      payment_terms: q.payment_terms ?? '',
      status: q.status,
    });
  };

  const openView = async (q: Quotation) => {
    setViewQuotation(q);
    setViewLoading(true);
    setViewError(null);
    if (previewObjUrl) { URL.revokeObjectURL(previewObjUrl); setPreviewObjUrl(null); }
    try {
      const bytes = await generateQuotationPdfFromUrl(q, [], settings ?? null);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      setPreviewObjUrl(url);
    } catch (err) {
      setViewError('Unable to load quotation. ' + (err instanceof Error ? err.message : ''));
    } finally {
      setViewLoading(false);
    }
  };

  const save = async () => {
    if (!form.customer_name) { show(t('required'), 'error'); return; }
    const phoneErr = phoneValidationError(form.customer_phone, false);
    if (phoneErr) { show(phoneErr, 'error'); return; }
    if (form.discount_enabled) {
      const pctErr = validateDiscountPercentage(form.discount_percent);
      if (pctErr) { show(pctErr, 'error'); return; }
      if (!form.discount_percent || form.discount_percent <= 0) {
        show('Discount is ON but percentage is empty. Please enter a discount percentage or turn discount OFF.', 'error'); return;
      }
    }
    setSaving(true);

    const svc = form.service_amount_enabled ? (Number(form.quotation_amount) || 0) : 0;
    const up = form.up_transportation_enabled ? (Number(form.up_transportation_amount) || 0) : 0;
    const other = otherChargesTotal;
    const sub = round2(svc + up + other);
    const gst = form.gst_enabled ? round2(sub * (Number(form.gst_percent) || 0) / 100) : 0;
    const grand = round2(sub + gst);
    const disc = calculateDiscount({ grandTotal: grand, discountEnabled: form.discount_enabled, discountPercentage: form.discount_percent });

    const quotationData = {
      quotation_number: form.quotation_number,
      quotation_date: form.quotation_date,
      valid_until: form.valid_until || null,
      customer_id: form.customer_id || null,
      customer_name: form.customer_name,
      customer_address: form.customer_address || null,
      customer_phone: form.customer_phone || null,
      customer_email: form.customer_email || null,
      customer_gstin: form.customer_gstin || null,
      reference_no: form.reference_no || null,
      subject: form.subject || null,
      reference_subject: form.subject || null,
      site_location: form.site_location || null,
      other_charges_json: form.other_charges.length > 0 ? JSON.stringify(form.other_charges) : null,
      other_charges_description: form.other_charges.length > 0 ? form.other_charges.map(oc => oc.description).join('; ') : null,
      other_charges_amount: other,
      quotation_amount: Number(form.quotation_amount) || 0,
      service_amount_enabled: form.service_amount_enabled,
      subtotal: sub,
      up_transportation_enabled: form.up_transportation_enabled,
      up_transportation_description: form.up_transportation_description || null,
      up_transportation_amount: up,
      gst_enabled: form.gst_enabled,
      gst_percent: Number(form.gst_percent) || 0,
      gst_amount: gst,
      grand_total: grand,
      discount_enabled: form.discount_enabled,
      discount_percent: form.discount_enabled ? Number(form.discount_percent) || 0 : 0,
      discount_amount: disc.discountAmount,
      final_payable_amount: disc.finalPayableAmount,
      terms_and_conditions: form.terms_and_conditions,
      payment_terms: form.payment_terms,
      status: form.status,
    };

    try {
      if (editing) {
        const { error } = await supabase.from('quotations').update(quotationData).eq('id', editing.id);
        if (error) throw error;
        show(t('quotationSaved'), 'success');
      } else {
        let finalQuoNum = form.quotation_number;
        if (!finalQuoNum) {
          const { data: genNum, error: genErr } = await supabase.rpc('next_quotation_number', { p_quote_date: form.quotation_date });
          if (genErr) throw genErr;
          finalQuoNum = genNum as string;
        }
        const { error } = await supabase
          .from('quotations')
          .insert({ ...quotationData, quotation_number: finalQuoNum })
          .select()
          .single();
        if (error) throw error;
        show(t('quotationSaved'), 'success');
      }
      setModalOpen(false);
      fetchQuotations();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      show(`${t('saveError')} ${msg}`, 'error');
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('quotations').delete().eq('id', deleteId);
    if (error) show(t('deleteError'), 'error');
    else { show(t('quotationDeleted'), 'success'); fetchQuotations(); }
    setDeleteId(null);
  };

  const handleDuplicate = async (q: Quotation) => {
    const key = `copy-${q.id}`;
    if (actionLoading[key]) return;
    setActionLoading(prev => ({ ...prev, [key]: true }));
    try {
      const { data: newNum } = await supabase.rpc('next_quotation_number', { p_quote_date: todayISO() });

      const { data: inserted, error } = await supabase
        .from('quotations')
        .insert({
          quotation_number: newNum as string,
          quotation_date: todayISO(),
          valid_until: null,
          customer_id: q.customer_id,
          customer_name: q.customer_name,
          customer_address: q.customer_address,
          customer_phone: q.customer_phone,
          customer_email: q.customer_email,
          customer_gstin: q.customer_gstin,
          reference_no: q.reference_no,
          subject: q.subject,
          reference_subject: q.subject ?? q.reference_subject,
          site_location: q.site_location,
          other_charges_json: q.other_charges_json,
          other_charges_description: q.other_charges_description,
          other_charges_amount: q.other_charges_amount,
          quotation_amount: q.quotation_amount ?? 0,
          subtotal: q.subtotal,
          up_transportation_enabled: q.up_transportation_enabled,
          up_transportation_description: q.up_transportation_description,
          up_transportation_amount: q.up_transportation_amount,
          gst_enabled: q.gst_enabled,
          gst_percent: q.gst_percent,
          gst_amount: q.gst_amount,
          grand_total: q.grand_total,
          discount_enabled: q.discount_enabled ?? false,
          discount_percent: q.discount_enabled ? q.discount_percent ?? 0 : 0,
          discount_amount: q.discount_amount ?? 0,
          final_payable_amount: q.final_payable_amount ?? q.grand_total,
          terms_and_conditions: q.terms_and_conditions,
          payment_terms: q.payment_terms,
          status: 'Draft',
        })
        .select()
        .single();
      if (error) throw error;

      show(t('quotationSaved'), 'success');
      fetchQuotations();
      openEdit(inserted);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      show(`${t('saveError')} ${msg}`, 'error');
    }
    setActionLoading(prev => ({ ...prev, [key]: false }));
  };

  const handleExport = () => {
    const headers = ['S.No', 'Quotation No.', 'Date', 'Customer', 'Service Amount', 'Grand Total', 'Discount %', 'Net Payable', 'Valid Until', 'Status'];
    const dataRows = quotations.map((q, i) => [
      i + 1, q.quotation_number, formatDate(q.quotation_date),
      q.customer_name ?? '-',
      formatCurrency(q.quotation_amount ?? 0),
      formatCurrency(q.grand_total),
      q.discount_enabled ? `${q.discount_percent}%` : '-',
      formatCurrency(q.discount_enabled ? (q.final_payable_amount ?? q.grand_total) : q.grand_total),
      q.valid_until ? formatDate(q.valid_until) : '-', q.status,
    ]);
    exportToExcelWithCompany('quotations-export.csv', 'Quotations Report',
      settings ? { company_name: settings.company_name, address: settings.address, phone: settings.phone, email: settings.email, gstin: settings.gstin } : { company_name: 'Company' },
      'All Records', new Date().toLocaleString('en-IN'), '', headers, dataRows);
  };

  const printQuotation = async (q: Quotation) => {
    const key = `print-${q.id}`;
    if (actionLoading[key]) return;
    setActionLoading(prev => ({ ...prev, [key]: true }));
    try {
      const bytes = await generateQuotationPdfFromUrl(q, [], settings ?? null);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const printWin = window.open(url, '_blank', 'width=900,height=1100');
      if (!printWin) {
        show('Please allow pop-ups to print the quotation.', 'error');
        URL.revokeObjectURL(url);
        return;
      }
      printWin.addEventListener('load', () => { try { printWin.print(); } catch { /* PDF viewer handles print */ } }, { once: true });
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      show('Unable to prepare quotation for printing. ' + (err instanceof Error ? err.message : ''), 'error');
    } finally {
      setActionLoading(prev => ({ ...prev, [key]: false }));
    }
  };

  const downloadPdf = async (q: Quotation) => {
    const key = `download-${q.id}`;
    if (actionLoading[key]) return;
    setActionLoading(prev => ({ ...prev, [key]: true }));
    try {
      const bytes = await generateQuotationPdfFromUrl(q, [], settings ?? null);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `QUO_${(q.quotation_number ?? 'quotation').replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      show('Unable to download quotation PDF. ' + (err instanceof Error ? err.message : ''), 'error');
    } finally {
      setActionLoading(prev => ({ ...prev, [key]: false }));
    }
  };

  const openEmailModal = async (q: Quotation) => {
    if (!q.customer_email) {
      show('Customer email address is not available.', 'error');
      return;
    }
    setEmailQuotation(q);
    const emailSet = emailSettings;
    const companyName = settings?.company_name ?? '';
    const vars: Record<string, string> = {
      quotation_number: q.quotation_number,
      customer_name: q.customer_name ?? '',
      customer_email: q.customer_email ?? '',
      quotation_date: q.quotation_date ? formatDate(q.quotation_date) : '',
      valid_until: q.valid_until ? formatDate(q.valid_until) : '',
      grand_total: formatCurrency(q.discount_enabled ? (q.final_payable_amount ?? q.grand_total) : q.grand_total),
      company_name: companyName,
      company_email: '',
      company_phone: '',
    };
    const subject = emailSet?.email_subject
      ? Object.entries(vars).reduce((s, [k, v]) => s.split(`{{${k}}}`).join(v), emailSet.email_subject)
      : `Quotation ${q.quotation_number} – ${q.customer_name ?? ''}`;
    const body = emailSet?.email_body
      ? Object.entries(vars).reduce((s, [k, v]) => s.split(`{{${k}}}`).join(v), emailSet.email_body)
      : `Dear ${q.customer_name ?? ''},\n\nPlease find attached our quotation ${q.quotation_number}.\n\nRegards,\n${companyName}`;
    setEmailForm({
      recipient: q.customer_email,
      cc: emailSet?.cc_email ?? '',
      bcc: emailSet?.bcc_email ?? '',
      subject,
      body,
    });
    setEmailModalOpen(true);
  };

  const sendEmail = async () => {
    if (!emailQuotation) return;
    if (!emailForm.recipient.trim()) {
      show('Customer email address is not available.', 'error');
      return;
    }
    setEmailSending(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) {
        show('Authentication required to send email.', 'error');
        setEmailSending(false);
        return;
      }
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-quotation-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          quotationId: emailQuotation.id,
          recipientEmail: emailForm.recipient,
          ccEmail: emailForm.cc || undefined,
          bccEmail: emailForm.bcc || undefined,
          emailSubject: emailForm.subject,
          emailBody: emailForm.body,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to send email');
      }
      show('Quotation email sent successfully.', 'success');
      setEmailModalOpen(false);
      fetchQuotations();
      fetchEmailHistory(emailQuotation.id);
    } catch (err) {
      show(err instanceof Error ? err.message : 'Failed to send email', 'error');
    }
    setEmailSending(false);
  };

  const fetchEmailHistory = async (quotationId: string) => {
    const { data } = await supabase
      .from('quotation_email_history')
      .select('*')
      .eq('quotation_id', quotationId)
      .order('sent_at', { ascending: false });
    setEmailHistory(prev => ({ ...prev, [quotationId]: (data ?? []) as QuotationEmailHistory[] }));
  };

  const statusColors: Record<QuotationStatus, 'green' | 'red' | 'blue' | 'amber' | 'gray'> = {
    Draft: 'gray',
    Sent: 'blue',
    Accepted: 'green',
    Rejected: 'red',
    Expired: 'red',
    Converted: 'green',
  };

  const columns: Column<Quotation>[] = [
    { key: 'quotation_number', header: t('quotationNumber'), sortable: true },
    { key: 'quotation_date', header: t('quotationDate'), sortable: true, render: q => formatDate(q.quotation_date) },
    { key: 'customer_name', header: t('customerName'), sortable: true, render: q => q.customer_name ?? '-' },
    { key: 'site_location', header: t('equipmentSummary'), render: q => q.site_location ?? '-' },
    { key: 'grand_total', header: t('grandTotal'), align: 'right', sortable: true, render: q => q.discount_enabled ? (
        <span className="tabular-nums">
          <span className="text-slate-400 line-through mr-1">{formatCurrency(q.grand_total)}</span>
          <span className="font-semibold text-blue-700">{formatCurrency(q.final_payable_amount ?? q.grand_total)}</span>
        </span>
      ) : formatCurrency(q.grand_total) },
    { key: 'valid_until', header: t('validUntil'), render: q => q.valid_until ? formatDate(q.valid_until) : '-' },
    { key: 'status', header: t('status'), render: q => (
      <div className="flex items-center justify-center gap-1">
        <StatusBadge status={q.status} variant={statusColors[q.status]} />
        {emailHistory[q.id]?.some(h => h.status === 'Sent') && (
          <span title={`Emailed on ${formatDate(emailHistory[q.id][0].sent_at)}`} className="inline-flex items-center text-blue-500">
            <Mail className="w-3 h-3" />
          </span>
        )}
      </div>
    ) },
    {
      key: 'actions', header: t('actions'), align: 'center',
      render: q => (
        <div className="flex justify-center gap-1">
          <button onClick={() => openView(q)} disabled={viewQuotation?.id === q.id && viewLoading} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md disabled:opacity-40" title={t('view')}><Eye className="w-4 h-4" /></button>
          <button onClick={() => printQuotation(q)} disabled={!!actionLoading[`print-${q.id}`]} className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md disabled:opacity-40" title={t('printQuotation')}>{actionLoading[`print-${q.id}`] ? <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" /> : <Printer className="w-4 h-4" />}</button>
          <button onClick={() => downloadPdf(q)} disabled={!!actionLoading[`download-${q.id}`]} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md disabled:opacity-40" title={t('downloadPdf')}>{actionLoading[`download-${q.id}`] ? <div className="w-4 h-4 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin" /> : <Download className="w-4 h-4" />}</button>
          <button onClick={() => openEmailModal(q)} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md" title="Email Quotation"><Mail className="w-4 h-4" /></button>
          <button onClick={() => openEdit(q)} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md" title={t('edit')}><Pencil className="w-4 h-4" /></button>
          <button onClick={() => handleDuplicate(q)} disabled={!!actionLoading[`copy-${q.id}`]} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md disabled:opacity-40" title={t('duplicate')}>{actionLoading[`copy-${q.id}`] ? <div className="w-4 h-4 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin" /> : <Copy className="w-4 h-4" />}</button>
          <button onClick={() => setDeleteId(q.id)} className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md" title={t('delete')}><Trash2 className="w-4 h-4" /></button>
        </div>
      ),
    },
  ];

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{quotations.length} {t('quotations')}</p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleExport}><Download className="w-4 h-4" />{t('export')}</Button>
          <Button onClick={openAdd}><Plus className="w-4 h-4" />{t('addQuotation')}</Button>
        </div>
      </div>

      <DataTable columns={columns} data={quotations} searchKeys={['quotation_number', 'customer_name', 'site_location'] as (keyof Quotation)[]} searchPlaceholder={`${t('search')}...`} showSerialNumber />

      {/* Create/Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `${t('edit')} ${t('quotations')}` : `${t('addQuotation')}`}
        size="2xl"
        footer={<>
          <Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button>
          <Button onClick={save} disabled={saving}>{saving ? t('saving') : t('save')}</Button>
        </>}
      >
        <div className="space-y-5">
          {/* Header: Date, Validity, Quotation Number, Status */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <Field label={t('quotationDate')} required>
              <DatePicker value={form.quotation_date} onChange={v => setForm(f => ({ ...f, quotation_date: v }))} />
            </Field>
            <Field label={t('validUntil')}>
              <DatePicker value={form.valid_until} onChange={v => setForm(f => ({ ...f, valid_until: v }))} />
            </Field>
            <Field label={t('quotationNumber')}>
              <input className={inputClass()} value={form.quotation_number} onChange={e => setForm(f => ({ ...f, quotation_number: e.target.value }))} />
            </Field>
            <Field label={t('quotationStatus')}>
              <select className={inputClass()} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as QuotationStatus }))}>
                {(['Draft', 'Sent', 'Accepted', 'Rejected', 'Expired'] as QuotationStatus[]).map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
          </div>

          {/* Customer Details — Manual Entry */}
          <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/50">
            <h4 className="text-sm font-bold text-slate-700 mb-3">Customer Details</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label={t('customerName')} required>
                <input className={inputClass()} value={form.customer_name} onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))} placeholder="Customer / Company Name" />
              </Field>
              <Field label={t('phone')}>
                <input className={inputClass()} type="tel" maxLength={10} value={form.customer_phone} onChange={e => setForm(f => ({ ...f, customer_phone: sanitizePhone(e.target.value) }))} placeholder="10-digit mobile number" />
              </Field>
              <Field label={t('customerAddress')}>
                <textarea className={inputClass()} rows={3} value={form.customer_address} onChange={e => setForm(f => ({ ...f, customer_address: e.target.value }))} placeholder="Site Address" />
              </Field>
              <div className="space-y-4">
                <Field label={t('email2')}>
                  <input className={inputClass()} value={form.customer_email} onChange={e => setForm(f => ({ ...f, customer_email: e.target.value }))} />
                </Field>
                <Field label={t('customerGstin')}>
                  <input className={inputClass()} value={form.customer_gstin} onChange={e => setForm(f => ({ ...f, customer_gstin: e.target.value.toUpperCase() }))} />
                </Field>
              </div>
              <Field label={t('referenceNo')}>
                <input className={inputClass()} value={form.reference_no} onChange={e => setForm(f => ({ ...f, reference_no: e.target.value }))} placeholder="Customer Reference No." />
              </Field>
              <Field label={t('subject')}>
                <input className={inputClass()} value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />
              </Field>
              <Field label={t('siteLocation')}>
                <input className={inputClass()} value={form.site_location} onChange={e => setForm(f => ({ ...f, site_location: e.target.value }))} placeholder="Site / Work Location" />
              </Field>
            </div>
          </div>

          {/* Service Amount — clean toggle + input, no card box */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="svc-enabled" checked={form.service_amount_enabled} onChange={e => setForm(f => ({ ...f, service_amount_enabled: e.target.checked }))} className="w-4 h-4 accent-blue-600" />
              <label htmlFor="svc-enabled" className="text-sm font-semibold text-slate-700">Service Amount</label>
            </div>
            {form.service_amount_enabled && (
              <div className="pl-6">
                <input
                  type="number"
                  min="0"
                  step="any"
                  className={classNames(inputClass(), 'w-48 text-right text-lg font-semibold')}
                  value={form.quotation_amount}
                  onChange={e => setForm(f => ({ ...f, quotation_amount: Number(e.target.value) }))}
                  placeholder="0.00"
                />
              </div>
            )}
          </div>

          {/* Transportation Charges */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="up-trans" checked={form.up_transportation_enabled} onChange={e => setForm(f => ({ ...f, up_transportation_enabled: e.target.checked }))} className="w-4 h-4 accent-blue-600" />
              <label htmlFor="up-trans" className="text-sm font-semibold text-slate-700 flex items-center gap-1"><ArrowUp className="w-3.5 h-3.5 text-blue-600" />Up & Down Transportation</label>
            </div>
            {form.up_transportation_enabled && (
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 pl-6">
                <input className={inputClass()} value={form.up_transportation_description} onChange={e => setForm(f => ({ ...f, up_transportation_description: e.target.value }))} placeholder="Description" />
                <input type="number" className={classNames(inputClass(), 'w-32 text-right')} value={form.up_transportation_amount} onChange={e => setForm(f => ({ ...f, up_transportation_amount: Number(e.target.value) }))} placeholder="Amount" />
              </div>
            )}
          </div>

          {/* Other Charges — Multiple */}
          <div className="border-t border-slate-100 pt-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-slate-700">{t('otherCharges')}</label>
              <Button size="sm" variant="outline" onClick={addOtherCharge}><Plus className="w-3.5 h-3.5" />{t('addOtherCharge')}</Button>
            </div>
            {form.other_charges.map((oc, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 mb-2">
                <input className={inputClass()} value={oc.description} onChange={e => updateOtherCharge(i, { description: e.target.value })} placeholder="Description" />
                <input type="number" className={classNames(inputClass(), 'w-32 text-right')} value={oc.amount} onChange={e => updateOtherCharge(i, { amount: Number(e.target.value) })} placeholder="Amount" />
                <button onClick={() => removeOtherCharge(i)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md"><X className="w-4 h-4" /></button>
              </div>
            ))}
          </div>

          {/* GST & Totals */}
          <div className="bg-slate-50 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="gst-enabled" checked={form.gst_enabled} onChange={e => setForm(f => ({ ...f, gst_enabled: e.target.checked }))} className="w-4 h-4 accent-blue-600" />
              <label htmlFor="gst-enabled" className="text-sm font-semibold text-slate-700">GST Enabled</label>
            </div>
            {form.gst_enabled && (
              <Field label={t('gstPercent')}>
                <input type="number" className={classNames(inputClass(), 'w-24')} value={form.gst_percent} onChange={e => setForm(f => ({ ...f, gst_percent: Number(e.target.value) }))} />
              </Field>
            )}
            <div className="border-t border-slate-200 pt-3 space-y-1.5 text-sm">
              {form.service_amount_enabled && (
                <div className="flex justify-between">
                  <span className="text-slate-600">Service Amount</span>
                  <span className="font-semibold text-slate-800 tabular-nums">{formatCurrency(Number(form.quotation_amount) || 0)}</span>
                </div>
              )}
              {form.up_transportation_enabled && (
                <div className="flex justify-between">
                  <span className="text-slate-600">Up & Down Transportation</span>
                  <span className="font-semibold text-slate-800 tabular-nums">{formatCurrency(form.up_transportation_amount)}</span>
                </div>
              )}
              {otherChargesTotal > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-600">{t('otherCharges')}</span>
                  <span className="font-semibold text-slate-800 tabular-nums">{formatCurrency(otherChargesTotal)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-600">{t('subtotal')}</span>
                <span className="font-semibold text-slate-800 tabular-nums">{formatCurrency(subtotal)}</span>
              </div>
              {form.gst_enabled && (
                <div className="flex justify-between">
                  <span className="text-slate-600">GST ({form.gst_percent}%)</span>
                  <span className="font-semibold text-slate-800 tabular-nums">{formatCurrency(gstAmount)}</span>
                </div>
              )}
              <div className="flex justify-between text-base border-t border-slate-200 pt-2">
                <span className="font-bold text-slate-800">{t('grandTotal')}</span>
                <span className="font-bold text-slate-900 tabular-nums">{formatCurrency(grandTotal)}</span>
              </div>
              <div className="text-xs text-slate-600 italic text-right">{amountInWords(grandTotal)}</div>
            </div>

            {/* Discount */}
            <div className="border-t border-slate-200 pt-3 space-y-2">
              <div className="flex items-center gap-2">
                <input type="checkbox" id="discount-enabled-quo" checked={form.discount_enabled} onChange={e => setForm(f => ({ ...f, discount_enabled: e.target.checked }))} className="w-4 h-4 accent-blue-600" />
                <label htmlFor="discount-enabled-quo" className="text-sm font-semibold text-slate-700">Apply Discount</label>
                {form.discount_enabled && (
                  <div className="flex items-center gap-2 ml-2">
                    <input type="number" min={0} max={100} step="0.5" className={inputClass() + ' w-24'} value={form.discount_percent} onChange={e => setForm(f => ({ ...f, discount_percent: Number(e.target.value) }))} placeholder="e.g. 5" />
                    <span className="text-sm text-slate-500">% off Grand Total</span>
                  </div>
                )}
              </div>
              {form.discount_enabled && (
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between text-red-600">
                    <span className="text-slate-500">Discount ({form.discount_percent}%):</span>
                    <span className="font-medium">-{formatCurrency(discount.discountAmount)}</span>
                  </div>
                  <div className="flex justify-between border-t border-blue-200 mt-1 pt-1 text-blue-700">
                    <span className="font-semibold">Net Payable:</span>
                    <span className="font-bold tabular-nums">{formatCurrency(discount.finalPayableAmount)}</span>
                  </div>
                  <div className="text-xs text-slate-600 italic text-right">{amountInWords(discount.finalPayableAmount)}</div>
                </div>
              )}
            </div>
          </div>

          {/* Payment Terms */}
          <Field label={t('paymentTerms')}>
            <RichTextEditor value={form.payment_terms} onChange={html => setForm(f => ({ ...f, payment_terms: html }))} rows={4} placeholder="Enter payment terms..." />
          </Field>

          {/* Terms & Conditions */}
          <Field label={t('termsAndConditions')}>
            <RichTextEditor value={form.terms_and_conditions} onChange={html => setForm(f => ({ ...f, terms_and_conditions: html }))} rows={8} placeholder="Enter terms and conditions..." />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} title={t('delete')} message={t('confirmDelete')} confirmText={t('delete')} danger />

      {/* Quotation Preview Modal */}
      <Modal
        open={!!viewQuotation || viewLoading}
        onClose={() => { setViewQuotation(null); setViewError(null); setViewLoading(false); if (previewObjUrl) { URL.revokeObjectURL(previewObjUrl); setPreviewObjUrl(null); } }}
        title={viewQuotation ? `Quotation ${viewQuotation.quotation_number ?? ''} — ${viewQuotation.customer_name ?? ''}` : 'Quotation Preview'}
        size="2xl"
        footer={
          viewQuotation && !viewLoading && !viewError ? (
            <>
              <Button variant="secondary" onClick={() => printQuotation(viewQuotation)} disabled={!!actionLoading[`print-${viewQuotation.id}`]}>
                {actionLoading[`print-${viewQuotation.id}`] ? 'Preparing...' : <><Printer className="w-4 h-4" />Print</>}
              </Button>
              <Button variant="secondary" onClick={() => downloadPdf(viewQuotation)} disabled={!!actionLoading[`download-${viewQuotation.id}`]}>
                {actionLoading[`download-${viewQuotation.id}`] ? 'Generating...' : <><Download className="w-4 h-4" />Download</>}
              </Button>
              <Button variant="secondary" onClick={() => openEmailModal(viewQuotation)}><Mail className="w-4 h-4" />Email</Button>
              <Button variant="secondary" onClick={() => { setViewQuotation(null); }}>Close</Button>
            </>
          ) : <Button variant="secondary" onClick={() => { setViewQuotation(null); setViewLoading(false); setViewError(null); }}>Close</Button>
        }
      >
        {viewLoading ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-500">
            <div className="w-10 h-10 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin mb-4" />
            <p className="text-sm font-medium">Loading quotation...</p>
          </div>
        ) : viewError ? (
          <div className="flex flex-col items-center justify-center py-24 text-red-500">
            <p className="text-sm font-medium mb-3">{viewError}</p>
            <Button size="sm" onClick={() => viewQuotation && openView(viewQuotation)}>Try Again</Button>
          </div>
        ) : viewQuotation ? (
          previewObjUrl ? (
            <iframe src={previewObjUrl} className="w-full bg-white rounded-lg" style={{ height: '70vh', border: 'none' }} title="Quotation Preview" />
          ) : (
            <div className="flex flex-col items-center justify-center py-24 text-slate-500">
              <div className="w-10 h-10 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin mb-4" />
              <p className="text-sm font-medium">Generating PDF preview...</p>
            </div>
          )
        ) : null}
      </Modal>

      {/* Email Modal */}
      <Modal
        open={emailModalOpen}
        onClose={() => setEmailModalOpen(false)}
        title="Send Quotation"
        size="lg"
        footer={<>
          <Button variant="secondary" onClick={() => setEmailModalOpen(false)}>Cancel</Button>
          <Button onClick={sendEmail} disabled={emailSending}>
            {emailSending ? <><Send className="w-4 h-4 animate-spin" />Sending...</> : <><Send className="w-4 h-4" />Send Email</>}
          </Button>
        </>}
      >
        {emailQuotation && (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
              <div className="font-semibold">Quotation: {emailQuotation.quotation_number}</div>
              <div>Customer: {emailQuotation.customer_name ?? '-'}</div>
              <div>Total: {formatCurrency(emailQuotation.discount_enabled ? (emailQuotation.final_payable_amount ?? emailQuotation.grand_total) : emailQuotation.grand_total)}</div>
            </div>
            <Field label="Recipient Email" required>
              <input className={inputClass()} value={emailForm.recipient} onChange={e => setEmailForm(f => ({ ...f, recipient: e.target.value }))} placeholder="customer@example.com" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="CC (optional)">
                <input className={inputClass()} value={emailForm.cc} onChange={e => setEmailForm(f => ({ ...f, cc: e.target.value }))} placeholder="cc@example.com" />
              </Field>
              <Field label="BCC (optional)">
                <input className={inputClass()} value={emailForm.bcc} onChange={e => setEmailForm(f => ({ ...f, bcc: e.target.value }))} placeholder="bcc@example.com" />
              </Field>
            </div>
            <Field label="Subject">
              <input className={inputClass()} value={emailForm.subject} onChange={e => setEmailForm(f => ({ ...f, subject: e.target.value }))} />
            </Field>
            <Field label="Message">
              <textarea className={inputClass()} rows={10} value={emailForm.body} onChange={e => setEmailForm(f => ({ ...f, body: e.target.value }))} />
            </Field>
            <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3 flex items-center gap-2">
              <Mail className="w-3.5 h-3.5" />
              The quotation PDF will be automatically generated and attached to this email.
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
