import type { InvoicePayment, InvoiceStatus } from '@/types';

export interface PaymentCalculation {
  grandTotal: number;
  totalReceived: number;
  remainingBalance: number;
  status: InvoiceStatus;
  lastPaymentDate: string | null;
  paymentCount: number;
  isOverdue: boolean;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function sortPayments(payments: InvoicePayment[]): InvoicePayment[] {
  return [...payments].sort(
    (a, b) =>
      new Date(a.payment_date).getTime() - new Date(b.payment_date).getTime() ||
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

export function computeInvoicePayment(
  inv: { grand_total: number | string | null; invoice_date?: string | null; payments?: InvoicePayment[] | null },
  overdueDays = 30,
): PaymentCalculation {
  const payments = sortPayments((inv.payments ?? []) as InvoicePayment[]);
  const grandTotal = round2(Number(inv.grand_total) || 0);
  const totalReceived = round2(payments.reduce((s, p) => s + Number(p.amount), 0));
  const remainingBalance = Math.max(0, round2(grandTotal - totalReceived));

  let status: InvoiceStatus;
  if (totalReceived <= 0) status = 'Pending';
  else if (remainingBalance <= 0) status = 'Paid';
  else status = 'Partially Paid';

  const lastPaymentDate =
    payments.length > 0 ? payments[payments.length - 1].payment_date : null;

  let isOverdue = false;
  if (status !== 'Paid' && inv.invoice_date) {
    const invDate = new Date(inv.invoice_date);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - invDate.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays > overdueDays) isOverdue = true;
  }

  return {
    grandTotal,
    totalReceived,
    remainingBalance,
    status,
    lastPaymentDate,
    paymentCount: payments.length,
    isOverdue,
  };
}

export function computeRunningBalances(
  grandTotal: number,
  payments: InvoicePayment[],
): { payment: InvoicePayment; remainingAfter: number }[] {
  const sorted = sortPayments(payments);
  let running = 0;
  return sorted.map((p) => {
    running = round2(running + Number(p.amount));
    return { payment: p, remainingAfter: Math.max(0, round2(grandTotal - running)) };
  });
}

export function statusVariant(status: InvoiceStatus): 'green' | 'amber' | 'gray' | 'red' {
  if (status === 'Paid') return 'green';
  if (status === 'Partially Paid') return 'amber';
  return 'gray';
}
