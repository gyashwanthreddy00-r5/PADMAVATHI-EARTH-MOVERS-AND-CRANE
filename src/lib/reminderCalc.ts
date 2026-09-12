import { formatCurrency, formatDate, todayISO, addDays } from '@/lib/utils';
import type { InvoiceWithRelations, InvoiceReminder, ReminderSettings, CompanySettings } from '@/types';

export type ReminderStage = 10 | 20;
export const REMINDER_STAGES: ReminderStage[] = [10, 20];
export type ReminderRowStatus = 'Pending' | 'Due' | 'Sent' | 'Not Required';

export interface ReminderRowData {
  invoice: InvoiceWithRelations;
  stage: ReminderStage;
  dueDate: string;
  status: ReminderRowStatus;
  sentAt: string | null;
  balance: number;
  received: number;
  total: number;
  reminderRowId: string | null;
}

/**
 * One row per (invoice, stage) — computed fresh from the current balance and today's
 * date every call, never from a stale scheduled snapshot. Only the "Sent" state (and
 * its date) is persisted, from invoice_reminders. Moved here (unchanged) from the old
 * standalone Balance Reminders page so Customer Statements can reuse it without
 * duplicating the computation.
 */
export function computeReminderRows(
  invoices: InvoiceWithRelations[],
  reminders: InvoiceReminder[],
  reminderSettings: ReminderSettings | null,
): ReminderRowData[] {
  const today = todayISO();
  const rows: ReminderRowData[] = [];
  for (const inv of invoices) {
    if (Number(inv.grand_total) <= 0 && (inv.items ?? []).length === 0) continue; // abandoned draft, not a real bill
    const payable = inv.discount_enabled ? Number(inv.final_payable_amount ?? inv.grand_total) : Number(inv.grand_total);
    const received = Math.round((inv.payments ?? []).reduce((s, p) => s + Number(p.amount), 0) * 100) / 100;
    const balance = Math.max(0, Math.round((payable - received) * 100) / 100);
    for (const stage of REMINDER_STAGES) {
      const stageEnabled = stage === 10 ? reminderSettings?.day10_enabled : reminderSettings?.day20_enabled;
      if (reminderSettings && stageEnabled === false) continue;
      const dueDate = addDays(inv.invoice_date, stage);
      const existing = reminders.find(r => r.invoice_id === inv.id && r.reminder_stage === stage) ?? null;
      let status: ReminderRowStatus;
      if (balance <= 0) status = 'Not Required';
      else if (existing?.status === 'sent') status = 'Sent';
      else if (today >= dueDate) status = 'Due';
      else status = 'Pending';
      rows.push({ invoice: inv, stage, dueDate, status, sentAt: existing?.sent_at ?? null, balance, received, total: payable, reminderRowId: existing?.id ?? null });
    }
  }
  return rows.sort((a, b) => b.dueDate.localeCompare(a.dueDate));
}

export function replaceReminderVars(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.split(`{{${key}}}`).join(value);
  }
  return result;
}

export function buildReminderTemplateVars(row: ReminderRowData, settings: CompanySettings | null): Record<string, string> {
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

export function getReminderEmailErrorMessage(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('testing emails') || normalized.includes('verify a domain') || normalized.includes('testing mode')) {
    return 'Email delivery is still in testing mode. A sending domain must be verified before reminders can be sent to customers.';
  }
  return message;
}
