import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import { useSettings } from '@/context/SettingsContext';
import { Modal, Button, Field, inputClass, LoadingSpinner } from '@/components/ui/common';
import { DatePicker } from '@/components/ui/DatePicker';
import { formatCurrency, formatDate, todayISO, addDays } from '@/lib/utils';
import { Bell, Search, Send, Eye, X, Wallet, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import type { InvoiceWithRelations, InvoiceReminder, ReminderSettings } from '@/types';

type Stage = 1 | 10 | 20;
const STAGES: Stage[] = [1, 10, 20];
type RowStatus = 'Pending' | 'Due' | 'Sent' | 'Not Required';

interface ReminderRowData {
  invoice: InvoiceWithRelations;
  stage: Stage;
  dueDate: string;
  status: RowStatus;
  sentAt: string | null;
  balance: number;
  received: number;
  total: number;
  reminderRowId: string | null;
}

function getEmailErrorMessage(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('testing emails') || normalized.includes('verify a domain') || normalized.includes('testing mode')) {
    return 'Email delivery is still in testing mode. A sending domain must be verified before reminders can be sent to customers.';
  }
  return message;
}

function replaceVars(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.split(`{{${key}}}`).join(value);
  }
  return result;
}

export default function BalanceReminders() {
  const { show } = useToast();
  const { settings } = useSettings();

  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<InvoiceWithRelations[]>([]);
  const [reminders, setReminders] = useState<InvoiceReminder[]>([]);
  const [reminderSettings, setReminderSettings] = useState<ReminderSettings | null>(null);

  const [customerSearch, setCustomerSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<'All' | Stage>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | RowStatus>('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [previewRow, setPreviewRow] = useState<ReminderRowData | null>(null);
  const [previewSubject, setPreviewSubject] = useState('');
  const [previewBody, setPreviewBody] = useState('');
  const [sending, setSending] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [invRes, remRes, settingsRes] = await Promise.all([
      supabase
        .from('invoices')
        .select('*, customer:customers!invoices_customer_id_fkey(*), items:invoice_items(id), payments:invoice_payments(*)')
        .eq('invoice_type', 'GST')
        .eq('is_cancelled', false)
        .not('invoice_number', 'is', null)
        .order('invoice_date', { ascending: false }),
      supabase.from('invoice_reminders').select('*'),
      supabase.from('reminder_settings').select('*').limit(1).maybeSingle(),
    ]);
    if (invRes.error) { show('Unable to load invoices: ' + invRes.error.message, 'error'); setLoading(false); return; }
    setInvoices((invRes.data ?? []) as unknown as InvoiceWithRelations[]);
    setReminders((remRes.data ?? []) as InvoiceReminder[]);
    setReminderSettings(settingsRes.data as ReminderSettings | null);
    setLoading(false);
  }, [show]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // One row per (invoice, stage) — computed fresh from the current balance and
  // today's date every render, never from a stale scheduled snapshot. Only the
  // "Sent" state (and its date) is persisted, from invoice_reminders.
  const allRows: ReminderRowData[] = useMemo(() => {
    const today = todayISO();
    const rows: ReminderRowData[] = [];
    for (const inv of invoices) {
      if (Number(inv.grand_total) <= 0 && (inv.items ?? []).length === 0) continue; // abandoned draft, not a real bill
      const payable = inv.discount_enabled ? Number(inv.final_payable_amount ?? inv.grand_total) : Number(inv.grand_total);
      const received = Math.round((inv.payments ?? []).reduce((s, p) => s + Number(p.amount), 0) * 100) / 100;
      const balance = Math.max(0, Math.round((payable - received) * 100) / 100);
      for (const stage of STAGES) {
        const stageEnabled = stage === 1 ? reminderSettings?.day1_enabled : stage === 10 ? reminderSettings?.day10_enabled : reminderSettings?.day20_enabled;
        if (reminderSettings && stageEnabled === false) continue;
        const dueDate = addDays(inv.invoice_date, stage);
        const existing = reminders.find(r => r.invoice_id === inv.id && r.reminder_stage === stage) ?? null;
        let status: RowStatus;
        if (balance <= 0) status = 'Not Required';
        else if (existing?.status === 'sent') status = 'Sent';
        else if (today >= dueDate) status = 'Due';
        else status = 'Pending';
        rows.push({ invoice: inv, stage, dueDate, status, sentAt: existing?.sent_at ?? null, balance, received, total: payable, reminderRowId: existing?.id ?? null });
      }
    }
    return rows.sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  }, [invoices, reminders, reminderSettings]);

  const filteredRows = useMemo(() => {
    let result = allRows;
    if (customerSearch.trim()) {
      const q = customerSearch.toLowerCase().trim();
      result = result.filter(r =>
        (r.invoice.customer_name ?? r.invoice.customer?.name ?? '').toLowerCase().includes(q) ||
        (r.invoice.invoice_number ?? '').toLowerCase().includes(q),
      );
    }
    if (stageFilter !== 'All') result = result.filter(r => r.stage === stageFilter);
    if (statusFilter !== 'All') result = result.filter(r => r.status === statusFilter);
    if (dateFrom) result = result.filter(r => r.dueDate >= dateFrom);
    if (dateTo) result = result.filter(r => r.dueDate <= dateTo);
    return result;
  }, [allRows, customerSearch, stageFilter, statusFilter, dateFrom, dateTo]);

  const summary = useMemo(() => ({
    totalOutstanding: Math.round(Array.from(new Map(allRows.map(r => [r.invoice.id, r.balance])).values()).reduce((s, b) => s + b, 0) * 100) / 100,
    day1Due: allRows.filter(r => r.stage === 1 && r.status === 'Due').length,
    day10Due: allRows.filter(r => r.stage === 10 && r.status === 'Due').length,
    day20Due: allRows.filter(r => r.stage === 20 && r.status === 'Due').length,
    sent: allRows.filter(r => r.status === 'Sent').length,
  }), [allRows]);

  function buildTemplateVars(row: ReminderRowData): Record<string, string> {
    const inv = row.invoice;
    return {
      customer_name: inv.customer?.name ?? inv.customer_name ?? 'Customer',
      customer_email: inv.customer?.email ?? inv.customer_email ?? '',
      company_name: settings?.company_name ?? 'PADMAVATHI EARTH MOVERS AND CRANE SERVICES',
      company_phone: settings?.phone ?? '',
      company_email: settings?.email ?? '',
      service_date: formatDate(inv.invoice_date),
      invoice_date: formatDate(inv.invoice_date),
      invoice_number: inv.invoice_number ?? '',
      reference_number: inv.reference_no ?? '',
      vehicle_number: inv.motor_vehicle_numbers ?? '',
      total_amount: formatCurrency(row.total).replace('₹', ''),
      received_amount: formatCurrency(row.received).replace('₹', ''),
      balance_amount: formatCurrency(row.balance).replace('₹', ''),
      payment_status: row.received <= 0 ? 'UNPAID' : 'PARTIALLY PAID',
    };
  }

  function openPreview(row: ReminderRowData) {
    if (!reminderSettings) { show('Reminder settings are not configured yet.', 'error'); return; }
    const subjectTemplate = row.stage === 1 ? reminderSettings.day1_subject : row.stage === 10 ? reminderSettings.day10_subject : reminderSettings.day20_subject;
    const bodyTemplate = row.stage === 1 ? reminderSettings.day1_body : row.stage === 10 ? reminderSettings.day10_body : reminderSettings.day20_body;
    const vars = buildTemplateVars(row);
    setPreviewRow(row);
    setPreviewSubject(replaceVars(subjectTemplate, vars));
    setPreviewBody(replaceVars(bodyTemplate, vars));
  }

  async function sendPreview() {
    if (!previewRow) return;
    const email = previewRow.invoice.customer?.email ?? previewRow.invoice.customer_email;
    if (!email) { show('This customer does not have an email address configured. Please add an email in Customer Master.', 'error'); return; }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('process-reminders', {
        body: {
          action: 'send_manual',
          invoiceId: previewRow.invoice.id,
          reminderStage: previewRow.stage,
          subjectOverride: previewSubject,
          bodyOverride: previewBody,
        },
      });
      if (error) {
        let msg = 'Unable to send reminder. Please try again.';
        if (error.context && typeof error.context.json === 'function') {
          try {
            const errBody = await error.context.json();
            if (errBody?.error) msg = errBody.error;
          } catch { /* fall through */ }
        } else if (typeof error.message === 'string' && error.message.length > 0) {
          msg = error.message;
        }
        show(getEmailErrorMessage(msg), 'error');
      } else if (data?.error) {
        show(getEmailErrorMessage(data.error), 'error');
      } else {
        show(`Day ${previewRow.stage} reminder sent to ${email}.`, 'success');
        setPreviewRow(null);
        await fetchAll();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to send reminder. Please try again.';
      show(getEmailErrorMessage(msg), 'error');
    }
    setSending(false);
  }

  const statusBadge = (status: RowStatus) => {
    const map: Record<RowStatus, string> = {
      'Pending': 'bg-slate-100 text-slate-600 border-slate-200',
      'Due': 'bg-amber-50 text-amber-700 border-amber-200',
      'Sent': 'bg-emerald-50 text-emerald-700 border-emerald-200',
      'Not Required': 'bg-slate-50 text-slate-400 border-slate-200',
    };
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${map[status]}`}>{status}</span>;
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Bell className="w-5 h-5 text-blue-600" />Balance Statement Reminders</h2>
        <p className="text-sm text-slate-500">Reminders are never sent automatically — review and click Send for each one you want to go out.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1"><Wallet className="w-4 h-4 text-red-400" /><span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Outstanding</span></div>
          <p className="text-xl font-bold text-red-600">{formatCurrency(summary.totalOutstanding)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1"><Clock className="w-4 h-4 text-amber-500" /><span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Day 1 Due</span></div>
          <p className="text-xl font-bold text-slate-800">{summary.day1Due}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1"><Clock className="w-4 h-4 text-amber-500" /><span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Day 10 Due</span></div>
          <p className="text-xl font-bold text-slate-800">{summary.day10Due}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1"><AlertCircle className="w-4 h-4 text-amber-500" /><span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Day 20 Due</span></div>
          <p className="text-xl font-bold text-slate-800">{summary.day20Due}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1"><CheckCircle2 className="w-4 h-4 text-emerald-500" /><span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Reminders Sent</span></div>
          <p className="text-xl font-bold text-emerald-600">{summary.sent}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative lg:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input type="text" className={`${inputClass()} pl-9`} placeholder="Search customer or invoice number..." value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} />
          </div>
          <select className={inputClass()} value={stageFilter} onChange={e => setStageFilter(e.target.value === 'All' ? 'All' : Number(e.target.value) as Stage)}>
            <option value="All">All Stages</option>
            <option value={1}>Day 1</option>
            <option value={10}>Day 10</option>
            <option value={20}>Day 20</option>
          </select>
          <select className={inputClass()} value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}>
            <option value="All">All Status</option>
            <option value="Pending">Pending</option>
            <option value="Due">Due</option>
            <option value="Sent">Sent</option>
            <option value="Not Required">Not Required</option>
          </select>
          <div className="flex gap-2">
            <DatePicker value={dateFrom} onChange={setDateFrom} />
            <DatePicker value={dateTo} onChange={setDateTo} />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100">
                <th className="text-center px-3 py-2.5 text-xs font-bold text-slate-800 uppercase tracking-wider">Sl.No</th>
                <th className="text-left px-3 py-2.5 text-xs font-bold text-slate-800 uppercase tracking-wider">Customer</th>
                <th className="text-left px-3 py-2.5 text-xs font-bold text-slate-800 uppercase tracking-wider">Invoice No</th>
                <th className="text-left px-3 py-2.5 text-xs font-bold text-slate-800 uppercase tracking-wider">Invoice Date</th>
                <th className="text-right px-3 py-2.5 text-xs font-bold text-slate-800 uppercase tracking-wider">Balance</th>
                <th className="text-center px-3 py-2.5 text-xs font-bold text-slate-800 uppercase tracking-wider">Reminder</th>
                <th className="text-left px-3 py-2.5 text-xs font-bold text-slate-800 uppercase tracking-wider">Due Date</th>
                <th className="text-center px-3 py-2.5 text-xs font-bold text-slate-800 uppercase tracking-wider">Status</th>
                <th className="text-center px-3 py-2.5 text-xs font-bold text-slate-800 uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRows.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-10 text-slate-400">No reminders match this filter.</td></tr>
              ) : filteredRows.map((r, idx) => (
                <tr key={`${r.invoice.id}-${r.stage}`} className="hover:bg-slate-50">
                  <td className="text-center px-3 py-2">{idx + 1}</td>
                  <td className="px-3 py-2 font-medium text-slate-700">{r.invoice.customer_name ?? r.invoice.customer?.name ?? '-'}</td>
                  <td className="px-3 py-2 text-blue-700 font-medium whitespace-nowrap">{r.invoice.invoice_number}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDate(r.invoice.invoice_date)}</td>
                  <td className="text-right px-3 py-2 font-semibold text-red-600">{formatCurrency(r.balance)}</td>
                  <td className="text-center px-3 py-2 whitespace-nowrap">Day {r.stage}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDate(r.dueDate)}</td>
                  <td className="text-center px-3 py-2">
                    {statusBadge(r.status)}
                    {r.status === 'Sent' && r.sentAt && <div className="text-[11px] text-slate-400 mt-0.5">{new Date(r.sentAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</div>}
                  </td>
                  <td className="text-center px-3 py-2">
                    {r.status === 'Not Required' ? (
                      <span className="text-slate-300">—</span>
                    ) : (
                      <button onClick={() => openPreview(r)} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md">
                        {r.status === 'Sent' ? <><Eye className="w-3.5 h-3.5" />Send Again</> : <><Send className="w-3.5 h-3.5" />Send</>}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Preview / Confirm / Send Modal — the email is not sent until Send Email is clicked */}
      <Modal
        open={!!previewRow}
        onClose={() => setPreviewRow(null)}
        title={`Day ${previewRow?.stage ?? ''} Reminder Preview`}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPreviewRow(null)}>Cancel</Button>
            <Button onClick={sendPreview} disabled={sending}><Send className="w-4 h-4" />{sending ? 'Sending...' : 'Send Email'}</Button>
          </>
        }
      >
        {previewRow && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div><span className="text-slate-500">Customer: </span><b>{previewRow.invoice.customer?.name ?? previewRow.invoice.customer_name}</b></div>
              <div><span className="text-slate-500">Invoice: </span><b>{previewRow.invoice.invoice_number}</b></div>
              <div><span className="text-slate-500">Balance: </span><b className="text-red-600">{formatCurrency(previewRow.balance)}</b></div>
              <div><span className="text-slate-500">Email: </span><b>{previewRow.invoice.customer?.email ?? previewRow.invoice.customer_email ?? <span className="text-red-500">Not on file</span>}</b></div>
            </div>
            <Field label="Subject">
              <input type="text" className={inputClass()} value={previewSubject} onChange={e => setPreviewSubject(e.target.value)} />
            </Field>
            <Field label="Body" hint="You can edit this before sending — the saved Day templates in Settings are not changed.">
              <textarea className={inputClass()} rows={12} value={previewBody} onChange={e => setPreviewBody(e.target.value)} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
