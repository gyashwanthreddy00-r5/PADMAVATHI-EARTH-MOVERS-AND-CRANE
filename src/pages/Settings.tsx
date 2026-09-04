import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useLang } from '@/context/LangContext';
import { useToast } from '@/components/ui/Toast';
import { useSettings } from '@/context/SettingsContext';
import { Button, Field, inputClass, LoadingSpinner } from '@/components/ui/common';
import { RichTextEditor } from '@/components/RichTextEditor';
import { Save, Building, Fuel, Receipt, Globe, Landmark, FileText, Bell, Mail, FileSignature, Upload, Trash2 } from 'lucide-react';
import { sanitizePhone, phoneValidationError } from '@/lib/utils';
import type { CompanySettings as Settings, InvoiceSettings, ReminderSettings, QuotationEmailSettings, QuotationFormatSettings } from '@/types';

export default function SettingsPage() {
  const { t, lang, setLang } = useLang();
  const { show } = useToast();
  const { settings, loading, refresh } = useSettings();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Settings | null>(settings);
  const [invSettings, setInvSettings] = useState<InvoiceSettings | null>(null);
  const [invSaving, setInvSaving] = useState(false);
  const [reminderSettings, setReminderSettings] = useState<ReminderSettings | null>(null);
  const [reminderSaving, setReminderSaving] = useState(false);
  const [quoEmailSettings, setQuoEmailSettings] = useState<QuotationEmailSettings | null>(null);
  const [quoEmailSaving, setQuoEmailSaving] = useState(false);
  const [quoFormatSettings, setQuoFormatSettings] = useState<QuotationFormatSettings | null>(null);
  const [quoFormatSaving, setQuoFormatSaving] = useState(false);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [stampUrl, setStampUrl] = useState<string | null>(null);
  const [uploadingSignature, setUploadingSignature] = useState(false);
  const [uploadingStamp, setUploadingStamp] = useState(false);
  const signatureInputRef = useRef<HTMLInputElement>(null);
  const stampInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setForm(settings); }, [settings]);

  useEffect(() => {
    supabase.from('invoice_settings').select('*').limit(1).maybeSingle().then(({ data }) => {
      setInvSettings(data as InvoiceSettings | null);
    });
  }, []);

  useEffect(() => {
    supabase.from('reminder_settings').select('*').limit(1).maybeSingle().then(({ data }) => {
      setReminderSettings(data as ReminderSettings | null);
    });
  }, []);

  useEffect(() => {
    supabase.from('quotation_email_settings').select('*').limit(1).maybeSingle().then(({ data }) => {
      setQuoEmailSettings(data as QuotationEmailSettings | null);
    });
  }, []);

  useEffect(() => {
    supabase.from('quotation_format_settings').select('*').limit(1).maybeSingle().then(({ data }) => {
      setQuoFormatSettings(data as QuotationFormatSettings | null);
    });
  }, []);

  useEffect(() => {
    const loadSignedUrls = async () => {
      if (form?.signature_path) {
        const { data } = await supabase.storage.from('quotation-assets').createSignedUrl(form.signature_path, 300);
        setSignatureUrl(data?.signedUrl ?? null);
      } else setSignatureUrl(null);
      if (form?.stamp_path) {
        const { data } = await supabase.storage.from('quotation-assets').createSignedUrl(form.stamp_path, 300);
        setStampUrl(data?.signedUrl ?? null);
      } else setStampUrl(null);
    };
    loadSignedUrls();
  }, [form?.signature_path, form?.stamp_path]);

  if (loading || !form) return <LoadingSpinner />;

  const save = async () => {
    if (!form) return;
    if (!form.company_name?.trim()) { show('Company Name is required.', 'error'); return; }
    const phoneErr = phoneValidationError(form.phone ?? '', false);
    if (phoneErr) { show(phoneErr, 'error'); return; }
    setSaving(true);
    const { error } = await supabase.from('company_settings').update({
      company_name: form.company_name,
      phone: form.phone,
      email: form.email,
      gstin: form.gstin,
      state: form.state,
      state_code: form.state_code,
      pan: form.pan,
      address: form.address,
      logo_url: form.logo_url,
      authorized_signatory: form.authorized_signatory,
      signature_path: form.signature_path,
      stamp_path: form.stamp_path,
      bank_name: form.bank_name,
      bank_account_name: form.bank_account_name,
      bank_account_number: form.bank_account_number,
      bank_branch: form.bank_branch,
      bank_ifsc: form.bank_ifsc,
      diesel_rate: form.diesel_rate,
      invoice_prefix: form.invoice_prefix,
      invoice_start_number: form.invoice_start_number,
      cgst_percent: form.cgst_percent,
      sgst_percent: form.sgst_percent,
      igst_percent: form.igst_percent,
      gst_enabled: form.gst_enabled,
    }).eq('id', form.id);
    if (error) {
      show(`Failed to save: ${error.message}`, 'error');
    } else {
      show('Company settings saved successfully.', 'success');
      await refresh();
    }
    setSaving(false);
  };

  const uploadFile = async (file: File, kind: 'signature' | 'stamp'): Promise<void> => {
    if (kind === 'signature') setUploadingSignature(true);
    else setUploadingStamp(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png';
      const path = `company/${kind}.${ext}`;
      const { error: upErr } = await supabase.storage.from('quotation-assets').upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) { show(`Upload failed: ${upErr.message}`, 'error'); return; }
      setForm(f => f ? { ...f, [kind === 'signature' ? 'signature_path' : 'stamp_path']: path } : f);
      show(`${kind === 'signature' ? 'Signature' : 'Stamp'} uploaded successfully.`, 'success');
    } catch (err) {
      show(`Upload failed: ${err instanceof Error ? err.message : ''}`, 'error');
    } finally {
      if (kind === 'signature') setUploadingSignature(false);
      else setUploadingStamp(false);
    }
  };

  const removeFile = (kind: 'signature' | 'stamp'): void => {
    setForm(f => f ? { ...f, [kind === 'signature' ? 'signature_path' : 'stamp_path']: null } : f);
    if (kind === 'signature' && signatureInputRef.current) signatureInputRef.current.value = '';
    if (kind === 'stamp' && stampInputRef.current) stampInputRef.current.value = '';
  };

  const saveInvSettings = async () => {
    if (!invSettings) return;
    setInvSaving(true);
    const { error } = await supabase.from('invoice_settings').update({
      hsn_sac: invSettings.hsn_sac,
      default_payment_terms: invSettings.default_payment_terms,
      declaration: invSettings.declaration,
      authorized_signatory: invSettings.authorized_signatory,
      terms_of_delivery: invSettings.terms_of_delivery,
      cgst_percent: invSettings.cgst_percent,
      sgst_percent: invSettings.sgst_percent,
      igst_percent: invSettings.igst_percent,
      add_gst_by_default: invSettings.add_gst_by_default,
    }).eq('id', invSettings.id);
    if (error) show(t('saveError'), 'error');
    else show(t('saveSuccess'), 'success');
    setInvSaving(false);
  };

  const saveReminderSettings = async () => {
    if (!reminderSettings) return;
    setReminderSaving(true);
    const { error } = await supabase.from('reminder_settings').update({
      enabled: true,
      day1_enabled: reminderSettings.day1_enabled,
      day10_enabled: reminderSettings.day10_enabled,
      day20_enabled: reminderSettings.day20_enabled,
      day1_subject: reminderSettings.day1_subject,
      day1_body: reminderSettings.day1_body,
      day10_subject: reminderSettings.day10_subject,
      day10_body: reminderSettings.day10_body,
      day20_subject: reminderSettings.day20_subject,
      day20_body: reminderSettings.day20_body,
    }).eq('id', reminderSettings.id);
    if (error) show(`Failed to save: ${error.message}`, 'error');
    else show('Reminder settings saved successfully.', 'success');
    setReminderSaving(false);
  };

  const saveQuoEmailSettings = async () => {
    if (!quoEmailSettings) return;
    setQuoEmailSaving(true);
    const { error } = await supabase.from('quotation_email_settings').update({
      email_subject: quoEmailSettings.email_subject,
      email_body: quoEmailSettings.email_body,
      cc_email: quoEmailSettings.cc_email,
      bcc_email: quoEmailSettings.bcc_email,
      attach_pdf: quoEmailSettings.attach_pdf,
      email_signature: quoEmailSettings.email_signature,
    }).eq('id', quoEmailSettings.id);
    if (error) show(`Failed to save: ${error.message}`, 'error');
    else show('Quotation email settings saved successfully.', 'success');
    setQuoEmailSaving(false);
  };

  const saveQuoFormatSettings = async () => {
    if (!quoFormatSettings) return;
    setQuoFormatSaving(true);
    const { error } = await supabase.from('quotation_format_settings').update({
      quotation_title: quoFormatSettings.quotation_title,
      terms_and_conditions: quoFormatSettings.terms_and_conditions,
      signature_text: quoFormatSettings.signature_text,
      show_gst: quoFormatSettings.show_gst,
      default_payment_terms: quoFormatSettings.default_payment_terms,
      default_validity_days: quoFormatSettings.default_validity_days,
      show_1hr_rate: quoFormatSettings.show_1hr_rate,
      show_2hr_rate: quoFormatSettings.show_2hr_rate,
      show_batha: quoFormatSettings.show_batha,
      show_transport: quoFormatSettings.show_transport,
      date_format: quoFormatSettings.date_format,
    }).eq('id', quoFormatSettings.id);
    if (error) show(`Failed to save: ${error.message}`, 'error');
    else show('Quotation format settings saved successfully.', 'success');
    setQuoFormatSaving(false);
  };

  return (
    <div className="max-w-3xl space-y-6">
      {/* Company Profile */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <Building className="w-5 h-5 text-blue-600" />
          <h3 className="text-base font-semibold text-slate-800">{t('companySettings')}</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t('companyName')} required>
            <input className={inputClass()} value={form.company_name} onChange={e => setForm(f => ({ ...f!, company_name: e.target.value }))} />
          </Field>
          <Field label={t('phone')}>
            <input className={inputClass()} type="tel" maxLength={10} value={form.phone ?? ''} onChange={e => setForm(f => ({ ...f!, phone: sanitizePhone(e.target.value) }))} placeholder="10-digit phone number" />
          </Field>
          <Field label={t('email2')}>
            <input className={inputClass()} value={form.email ?? ''} onChange={e => setForm(f => ({ ...f!, email: e.target.value }))} />
          </Field>
          <Field label={t('gstin')}>
            <input className={inputClass()} value={form.gstin ?? ''} onChange={e => setForm(f => ({ ...f!, gstin: e.target.value.toUpperCase() }))} />
          </Field>
          <Field label="State">
            <input className={inputClass()} value={form.state ?? ''} onChange={e => setForm(f => ({ ...f!, state: e.target.value }))} placeholder="Telangana" />
          </Field>
          <Field label="State Code">
            <input className={inputClass()} value={form.state_code ?? ''} onChange={e => setForm(f => ({ ...f!, state_code: e.target.value }))} placeholder="36" />
          </Field>
          <Field label="PAN (optional)">
            <input className={inputClass()} value={form.pan ?? ''} onChange={e => setForm(f => ({ ...f!, pan: e.target.value.toUpperCase() }))} placeholder="ABCDE1234F" />
          </Field>
          <div className="sm:col-span-2">
            <Field label={t('address')}>
              <textarea className={inputClass()} rows={3} value={form.address ?? ''} onChange={e => setForm(f => ({ ...f!, address: e.target.value }))} />
            </Field>
          </div>
          <Field label={t('logo')}>
            <input className={inputClass()} value={form.logo_url ?? ''} onChange={e => setForm(f => ({ ...f!, logo_url: e.target.value }))} placeholder="https://..." />
          </Field>
          <Field label="Authorized Signatory">
            <input className={inputClass()} value={form.authorized_signatory ?? ''} onChange={e => setForm(f => ({ ...f!, authorized_signatory: e.target.value }))} placeholder="Name of authorized person" />
          </Field>
        </div>
      </div>

      {/* Quotation Signature & Stamp */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <FileSignature className="w-5 h-5 text-blue-600" />
          <h3 className="text-base font-semibold text-slate-800">Quotation Signature &amp; Stamp</h3>
        </div>
        <p className="text-xs text-slate-500 mb-4">Upload your signature and company stamp images. They will appear automatically on the quotation PDF. The letterhead template is built-in and does not need to be configured.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* Signature Upload */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Signature Image</label>
            <div className="border-2 border-dashed border-slate-300 rounded-lg p-4 text-center">
              {signatureUrl ? (
                <div className="space-y-3">
                  <img src={signatureUrl} alt="Signature preview" className="max-h-24 mx-auto object-contain" />
                  <button onClick={() => removeFile('signature')} className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700">
                    <Trash2 className="w-3.5 h-3.5" /> Remove
                  </button>
                </div>
              ) : (
                <div className="py-4">
                  <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-xs text-slate-500 mb-2">Upload signature image (PNG/JPG)</p>
                </div>
              )}
            </div>
            <input
              ref={signatureInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={e => { const file = e.target.files?.[0]; if (file) uploadFile(file, 'signature'); }}
            />
            <Button
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              onClick={() => signatureInputRef.current?.click()}
              disabled={uploadingSignature}
            >
              {uploadingSignature ? <><Save className="w-3.5 h-3.5 animate-spin" />Uploading...</> : <><Upload className="w-3.5 h-3.5" />Upload Signature</>}
            </Button>
          </div>

          {/* Stamp Upload */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Stamp Image</label>
            <div className="border-2 border-dashed border-slate-300 rounded-lg p-4 text-center">
              {stampUrl ? (
                <div className="space-y-3">
                  <img src={stampUrl} alt="Stamp preview" className="max-h-24 mx-auto object-contain" />
                  <button onClick={() => removeFile('stamp')} className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700">
                    <Trash2 className="w-3.5 h-3.5" /> Remove
                  </button>
                </div>
              ) : (
                <div className="py-4">
                  <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-xs text-slate-500 mb-2">Upload stamp image (PNG/JPG)</p>
                </div>
              )}
            </div>
            <input
              ref={stampInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={e => { const file = e.target.files?.[0]; if (file) uploadFile(file, 'stamp'); }}
            />
            <Button
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              onClick={() => stampInputRef.current?.click()}
              disabled={uploadingStamp}
            >
              {uploadingStamp ? <><Save className="w-3.5 h-3.5 animate-spin" />Uploading...</> : <><Upload className="w-3.5 h-3.5" />Upload Stamp</>}
            </Button>
          </div>
        </div>
      </div>

      {/* Bank Details */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <Landmark className="w-5 h-5 text-blue-600" />
          <h3 className="text-base font-semibold text-slate-800">Bank Details</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="A/c Holder Name">
            <input className={inputClass()} value={form.bank_account_name ?? ''} onChange={e => setForm(f => ({ ...f!, bank_account_name: e.target.value }))} />
          </Field>
          <Field label="Bank Name">
            <input className={inputClass()} value={form.bank_name ?? ''} onChange={e => setForm(f => ({ ...f!, bank_name: e.target.value }))} />
          </Field>
          <Field label="A/c Number">
            <input className={inputClass()} value={form.bank_account_number ?? ''} onChange={e => setForm(f => ({ ...f!, bank_account_number: e.target.value }))} />
          </Field>
          <Field label="Branch">
            <input className={inputClass()} value={form.bank_branch ?? ''} onChange={e => setForm(f => ({ ...f!, bank_branch: e.target.value }))} />
          </Field>
          <Field label="IFSC Code">
            <input className={inputClass()} value={form.bank_ifsc ?? ''} onChange={e => setForm(f => ({ ...f!, bank_ifsc: e.target.value.toUpperCase() }))} />
          </Field>
        </div>
      </div>

      {/* Rental Settings */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <Receipt className="w-5 h-5 text-blue-600" />
          <h3 className="text-base font-semibold text-slate-800">{t('rentalSettings')}</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label={t('invoicePrefix')}>
            <input className={inputClass()} value={form.invoice_prefix} onChange={e => setForm(f => ({ ...f!, invoice_prefix: e.target.value }))} />
          </Field>
          <Field label={t('invoiceStartNumber')}>
            <input type="number" className={inputClass()} value={form.invoice_start_number} onChange={e => setForm(f => ({ ...f!, invoice_start_number: Number(e.target.value) }))} />
          </Field>
        </div>
      </div>

      {/* Invoice Settings */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <FileText className="w-5 h-5 text-blue-600" />
          <h3 className="text-base font-semibold text-slate-800">Invoice Settings</h3>
        </div>
        {invSettings ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="HSN/SAC Code">
                <input className={inputClass()} value={invSettings.hsn_sac} onChange={e => setInvSettings(s => s ? { ...s, hsn_sac: e.target.value } : s)} />
              </Field>
              <Field label="Default Payment Terms">
                <input className={inputClass()} value={invSettings.default_payment_terms} onChange={e => setInvSettings(s => s ? { ...s, default_payment_terms: e.target.value } : s)} />
              </Field>
              <Field label="Terms of Delivery">
                <input className={inputClass()} value={invSettings.terms_of_delivery ?? ''} onChange={e => setInvSettings(s => s ? { ...s, terms_of_delivery: e.target.value } : s)} />
              </Field>
              <Field label="CGST %">
                <input type="number" step="0.01" className={inputClass()} value={invSettings.cgst_percent} onChange={e => setInvSettings(s => s ? { ...s, cgst_percent: Number(e.target.value) } : s)} />
              </Field>
              <Field label="SGST %">
                <input type="number" step="0.01" className={inputClass()} value={invSettings.sgst_percent} onChange={e => setInvSettings(s => s ? { ...s, sgst_percent: Number(e.target.value) } : s)} />
              </Field>
              <Field label="Add GST by Default">
                <select className={inputClass()} value={invSettings.add_gst_by_default ? 'true' : 'false'} onChange={e => setInvSettings(s => s ? { ...s, add_gst_by_default: e.target.value === 'true' } : s)}>
                  <option value="true">{t('yes')}</option>
                  <option value="false">{t('no')}</option>
                </select>
              </Field>
            </div>
            <div className="mt-4">
              <Field label="Declaration">
                <textarea className={inputClass()} rows={3} value={invSettings.declaration} onChange={e => setInvSettings(s => s ? { ...s, declaration: e.target.value } : s)} />
              </Field>
            </div>
            <div className="mt-4 flex justify-end">
              <Button onClick={saveInvSettings} disabled={invSaving} size="sm">
                {invSaving ? <><Save className="w-4 h-4 animate-spin" />{t('saving')}</> : <><Save className="w-4 h-4" />Save Invoice Settings</>}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-400">Loading invoice settings...</p>
        )}
      </div>

      {/* Email Reminder Settings */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <Bell className="w-5 h-5 text-blue-600" />
          <h3 className="text-base font-semibold text-slate-800">Email Reminders</h3>
        </div>
        {reminderSettings ? (
          <>
            <div className="space-y-4">
              <div className="border-t border-slate-100 pt-4 space-y-3">
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={reminderSettings.day1_enabled} onChange={e => setReminderSettings(s => s ? { ...s, day1_enabled: e.target.checked } : s)} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                    <span className="text-sm font-medium text-slate-700">Day 1</span>
                  </label>
                  <span className="text-xs text-slate-400">Scheduled: 1 day after service date</span>
                </div>
                <Field label="Day 1 Subject">
                  <input className={inputClass()} value={reminderSettings.day1_subject} onChange={e => setReminderSettings(s => s ? { ...s, day1_subject: e.target.value } : s)} />
                </Field>
                <Field label="Day 1 Email Body">
                  <textarea className={inputClass()} rows={6} value={reminderSettings.day1_body} onChange={e => setReminderSettings(s => s ? { ...s, day1_body: e.target.value } : s)} />
                </Field>
              </div>

              <div className="border-t border-slate-100 pt-4 space-y-3">
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={reminderSettings.day10_enabled} onChange={e => setReminderSettings(s => s ? { ...s, day10_enabled: e.target.checked } : s)} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                    <span className="text-sm font-medium text-slate-700">Day 10</span>
                  </label>
                  <span className="text-xs text-slate-400">Scheduled: 10 days after service date</span>
                </div>
                <Field label="Day 10 Subject">
                  <input className={inputClass()} value={reminderSettings.day10_subject} onChange={e => setReminderSettings(s => s ? { ...s, day10_subject: e.target.value } : s)} />
                </Field>
                <Field label="Day 10 Email Body">
                  <textarea className={inputClass()} rows={6} value={reminderSettings.day10_body} onChange={e => setReminderSettings(s => s ? { ...s, day10_body: e.target.value } : s)} />
                </Field>
              </div>

              <div className="border-t border-slate-100 pt-4 space-y-3">
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={reminderSettings.day20_enabled} onChange={e => setReminderSettings(s => s ? { ...s, day20_enabled: e.target.checked } : s)} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                    <span className="text-sm font-medium text-slate-700">Day 20</span>
                  </label>
                  <span className="text-xs text-slate-400">Scheduled: 20 days after service date</span>
                </div>
                <Field label="Day 20 Subject">
                  <input className={inputClass()} value={reminderSettings.day20_subject} onChange={e => setReminderSettings(s => s ? { ...s, day20_subject: e.target.value } : s)} />
                </Field>
                <Field label="Day 20 Email Body">
                  <textarea className={inputClass()} rows={6} value={reminderSettings.day20_body} onChange={e => setReminderSettings(s => s ? { ...s, day20_body: e.target.value } : s)} />
                </Field>
              </div>

              <div className="text-xs text-slate-400 bg-slate-50 rounded-lg p-3">
                <strong>Available variables:</strong> {'{{customer_name}}, {{customer_email}}, {{company_name}}, {{company_phone}}, {{company_email}}, {{service_date}}, {{invoice_date}}, {{invoice_number}}, {{reference_number}}, {{vehicle_number}}, {{service_description}}, {{total_amount}}, {{received_amount}}, {{balance_amount}}, {{payment_status}}'}
              </div>

              <div className="flex justify-end">
                <Button onClick={saveReminderSettings} disabled={reminderSaving} size="sm">
                  {reminderSaving ? <><Save className="w-4 h-4 animate-spin" />Saving...</> : <><Save className="w-4 h-4" />Save Reminder Settings</>}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-400">Loading reminder settings...</p>
        )}
      </div>

      {/* Diesel Settings */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <Fuel className="w-5 h-5 text-blue-600" />
          <h3 className="text-base font-semibold text-slate-800">{t('dieselEntry')}</h3>
        </div>
        <Field label={t('currentDieselRate')}>
          <input type="number" step="0.01" className={inputClass()} value={form.diesel_rate} onChange={e => setForm(f => ({ ...f!, diesel_rate: Number(e.target.value) }))} />
        </Field>
        <div className="mt-4 flex justify-end">
          <Button onClick={save} disabled={saving} size="sm">
            {saving ? <><Save className="w-4 h-4 animate-spin" />{t('saving')}</> : <><Save className="w-4 h-4" />{t('save')}</>}
          </Button>
        </div>
      </div>

      {/* Quotation Email Settings */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <Mail className="w-5 h-5 text-blue-600" />
          <h3 className="text-base font-semibold text-slate-800">Quotation Email Settings</h3>
        </div>
        {quoEmailSettings ? (
          <>
            <div className="space-y-4">
              <Field label="Email Subject">
                <input className={inputClass()} value={quoEmailSettings.email_subject} onChange={e => setQuoEmailSettings(s => s ? { ...s, email_subject: e.target.value } : s)} />
              </Field>
              <Field label="Email Body">
                <textarea className={inputClass()} rows={10} value={quoEmailSettings.email_body} onChange={e => setQuoEmailSettings(s => s ? { ...s, email_body: e.target.value } : s)} />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="CC Email (optional)">
                  <input className={inputClass()} value={quoEmailSettings.cc_email ?? ''} onChange={e => setQuoEmailSettings(s => s ? { ...s, cc_email: e.target.value } : s)} placeholder="cc@example.com" />
                </Field>
                <Field label="BCC Email (optional)">
                  <input className={inputClass()} value={quoEmailSettings.bcc_email ?? ''} onChange={e => setQuoEmailSettings(s => s ? { ...s, bcc_email: e.target.value } : s)} placeholder="bcc@example.com" />
                </Field>
              </div>
              <Field label="Email Signature (optional)">
                <textarea className={inputClass()} rows={3} value={quoEmailSettings.email_signature ?? ''} onChange={e => setQuoEmailSettings(s => s ? { ...s, email_signature: e.target.value } : s)} />
              </Field>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={quoEmailSettings.attach_pdf} onChange={e => setQuoEmailSettings(s => s ? { ...s, attach_pdf: e.target.checked } : s)} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                <span className="text-sm font-medium text-slate-700">Attach quotation PDF to email</span>
              </label>
              <div className="text-xs text-slate-400 bg-slate-50 rounded-lg p-3">
                <strong>Available variables:</strong> {'{{quotation_number}}, {{customer_name}}, {{customer_email}}, {{quotation_date}}, {{valid_until}}, {{grand_total}}, {{company_name}}, {{company_email}}, {{company_phone}}'}
              </div>
              <div className="flex justify-end">
                <Button onClick={saveQuoEmailSettings} disabled={quoEmailSaving} size="sm">
                  {quoEmailSaving ? <><Save className="w-4 h-4 animate-spin" />Saving...</> : <><Save className="w-4 h-4" />Save Email Settings</>}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-400">Loading quotation email settings...</p>
        )}
      </div>

      {/* Quotation Format Settings */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <FileSignature className="w-5 h-5 text-blue-600" />
          <h3 className="text-base font-semibold text-slate-800">Quotation Format</h3>
        </div>
        {quoFormatSettings ? (
          <>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Quotation Title">
                  <input className={inputClass()} value={quoFormatSettings.quotation_title} onChange={e => setQuoFormatSettings(s => s ? { ...s, quotation_title: e.target.value } : s)} />
                </Field>
                <Field label="Signature Text">
                  <input className={inputClass()} value={quoFormatSettings.signature_text} onChange={e => setQuoFormatSettings(s => s ? { ...s, signature_text: e.target.value } : s)} />
                </Field>
                <Field label="Default Validity (days)">
                  <input type="number" className={inputClass()} value={quoFormatSettings.default_validity_days} onChange={e => setQuoFormatSettings(s => s ? { ...s, default_validity_days: Number(e.target.value) } : s)} />
                </Field>
                <Field label="Default Payment Terms">
                  <RichTextEditor value={quoFormatSettings.default_payment_terms ?? ''} onChange={html => setQuoFormatSettings(s => s ? { ...s, default_payment_terms: html || null } : s)} rows={4} placeholder="Enter default payment terms..." />
                </Field>
                <Field label="Date Format">
                  <select className={inputClass()} value={quoFormatSettings.date_format} onChange={e => setQuoFormatSettings(s => s ? { ...s, date_format: e.target.value } : s)}>
                    <option value="dd MMM yyyy">dd MMM yyyy</option>
                    <option value="dd/MM/yyyy">dd/MM/yyyy</option>
                    <option value="MM/dd/yyyy">MM/dd/yyyy</option>
                  </select>
                </Field>
              </div>
              <Field label="Terms & Conditions">
                <RichTextEditor value={quoFormatSettings.terms_and_conditions} onChange={html => setQuoFormatSettings(s => s ? { ...s, terms_and_conditions: html } : s)} rows={12} placeholder="Enter terms and conditions..." />
              </Field>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={quoFormatSettings.show_gst} onChange={e => setQuoFormatSettings(s => s ? { ...s, show_gst: e.target.checked } : s)} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                  <span className="text-sm font-medium text-slate-700">Show GST</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={quoFormatSettings.show_1hr_rate} onChange={e => setQuoFormatSettings(s => s ? { ...s, show_1hr_rate: e.target.checked } : s)} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                  <span className="text-sm font-medium text-slate-700">1 Hr Rate</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={quoFormatSettings.show_2hr_rate} onChange={e => setQuoFormatSettings(s => s ? { ...s, show_2hr_rate: e.target.checked } : s)} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                  <span className="text-sm font-medium text-slate-700">2 Hr Rate</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={quoFormatSettings.show_batha} onChange={e => setQuoFormatSettings(s => s ? { ...s, show_batha: e.target.checked } : s)} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                  <span className="text-sm font-medium text-slate-700">Batha</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={quoFormatSettings.show_transport} onChange={e => setQuoFormatSettings(s => s ? { ...s, show_transport: e.target.checked } : s)} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                  <span className="text-sm font-medium text-slate-700">Transport</span>
                </label>
              </div>
              <div className="flex justify-end">
                <Button onClick={saveQuoFormatSettings} disabled={quoFormatSaving} size="sm">
                  {quoFormatSaving ? <><Save className="w-4 h-4 animate-spin" />Saving...</> : <><Save className="w-4 h-4" />Save Format Settings</>}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-400">Loading quotation format settings...</p>
        )}
      </div>

      {/* GST Settings */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <Receipt className="w-5 h-5 text-blue-600" />
          <h3 className="text-base font-semibold text-slate-800">GST {t('settings')}</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Field label={t('gstEnabled')}>
            <select className={inputClass()} value={form.gst_enabled ? 'true' : 'false'} onChange={e => setForm(f => ({ ...f!, gst_enabled: e.target.value === 'true' }))}>
              <option value="true">{t('yes')}</option>
              <option value="false">{t('no')}</option>
            </select>
          </Field>
          <Field label={t('cgstPercent')}>
            <input type="number" step="0.01" className={inputClass()} value={form.cgst_percent} onChange={e => setForm(f => ({ ...f!, cgst_percent: Number(e.target.value) }))} />
          </Field>
          <Field label={t('sgstPercent')}>
            <input type="number" step="0.01" className={inputClass()} value={form.sgst_percent} onChange={e => setForm(f => ({ ...f!, sgst_percent: Number(e.target.value) }))} />
          </Field>
          <Field label={t('igstPercent')}>
            <input type="number" step="0.01" className={inputClass()} value={form.igst_percent} onChange={e => setForm(f => ({ ...f!, igst_percent: Number(e.target.value) }))} />
          </Field>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={save} disabled={saving} size="sm">
            {saving ? <><Save className="w-4 h-4 animate-spin" />{t('saving')}</> : <><Save className="w-4 h-4" />{t('save')}</>}
          </Button>
        </div>
      </div>

      {/* Language */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <Globe className="w-5 h-5 text-blue-600" />
          <h3 className="text-base font-semibold text-slate-800">{t('language')}</h3>
        </div>
        <Field label={t('language')}>
          <select className={inputClass()} value={lang} onChange={e => setLang(e.target.value as 'en' | 'te')}>
            <option value="en">{t('english')}</option>
            <option value="te">{t('telugu')}</option>
          </select>
        </Field>
      </div>

      {/* Save Changes - All Settings */}
      <div className="flex justify-end pb-2">
        <Button onClick={save} disabled={saving} size="lg">
          {saving ? <><Save className="w-4 h-4 animate-spin" />Saving...</> : <><Save className="w-4 h-4" />Save All Changes</>}
        </Button>
      </div>

    </div>
  );
}
