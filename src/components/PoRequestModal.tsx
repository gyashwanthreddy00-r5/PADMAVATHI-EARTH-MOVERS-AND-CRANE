import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import { Modal, Button, Field, inputClass } from '@/components/ui/common';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { classNames } from '@/lib/utils';
import { AlertTriangle, Mail } from 'lucide-react';
import type { Customer } from '@/types';

// Prefilled context from a specific "PO balance insufficient" moment (GST Billing).
// When absent, the modal runs in standalone mode (opened directly from PO Orders)
// and the user picks the customer and types the PO details themselves.
export interface PoRequestInitialContext {
  customerId: string;
  poNumber: string;
  currentBalance: number;
  requiredInvoiceAmount: number;
}

interface PoRequestModalProps {
  open: boolean;
  onClose: () => void;
  customers: Customer[];
  initial?: PoRequestInitialContext | null;
}

/**
 * Reusable "Request New PO" modal - used both from GST Billing's PO Balance
 * Insufficient warning (prefilled, customer fixed to the invoice's customer) and
 * from the PO Orders page (standalone, customer picked by the user). This is a
 * request/email action only - it never reads or writes any purchase_orders row,
 * so sending it can never change an existing PO's balance.
 */
export function PoRequestModal({ open, onClose, customers, initial }: PoRequestModalProps) {
  const { show } = useToast();
  const standalone = !initial;

  const [customerId, setCustomerId] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [currentBalance, setCurrentBalance] = useState('');
  const [requiredInvoiceAmount, setRequiredInvoiceAmount] = useState('');
  const [additionalAmount, setAdditionalAmount] = useState('');
  const [sending, setSending] = useState(false);

  // Reset the form every time the modal is (re)opened - deliberately not reactive
  // to `initial`/`customers` changing while it stays open, so the user's own edits
  // are never silently overwritten mid-session (see requirement: values must be
  // editable and never auto-overwritten).
  useEffect(() => {
    if (!open) return;
    setCustomerId(initial?.customerId ?? '');
    setPoNumber(initial?.poNumber ?? '');
    setCurrentBalance(initial ? String(initial.currentBalance) : '');
    setRequiredInvoiceAmount(initial ? String(initial.requiredInvoiceAmount) : '');
    setAdditionalAmount('');
    setSending(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectedCustomer = customers.find(c => c.id === customerId) ?? null;

  async function sendPoRequestEmail() {
    if (!customerId || !selectedCustomer) { show('Please select a customer.', 'error'); return; }
    if (!poNumber.trim()) { show('Please enter the current PO Number.', 'error'); return; }
    if (currentBalance !== '' && !(Number(currentBalance) >= 0)) { show('Current PO Balance must be a valid amount.', 'error'); return; }
    if (requiredInvoiceAmount !== '' && !(Number(requiredInvoiceAmount) >= 0)) { show('Required Invoice Amount must be a valid amount.', 'error'); return; }
    const additional = Number(additionalAmount);
    if (!additionalAmount || !(additional > 0)) { show('Please enter the additional PO amount required.', 'error'); return; }
    if (!selectedCustomer.email) {
      show('Customer email address is not configured. Please update Customer Master before sending the PO request.', 'error');
      return;
    }

    setSending(true);
    try {
      // Values are read fresh from this modal's own state at click time - never
      // from any stale invoice/PO object held elsewhere.
      const { data, error } = await supabase.functions.invoke('send-po-request-email', {
        body: {
          customerId,
          poNumber: poNumber.trim(),
          currentBalance: Number(currentBalance) || 0,
          requiredInvoiceAmount: Number(requiredInvoiceAmount) || 0,
          additionalAmount: additional,
        },
      });
      if (error) {
        let msg = 'Unable to send PO request email. Please try again.';
        if (error.context && typeof error.context.json === 'function') {
          try {
            const errBody = await error.context.json();
            if (errBody?.error) msg = errBody.error;
          } catch { /* fall through to default */ }
        } else if (typeof error.message === 'string' && error.message.length > 0) {
          msg = error.message;
        }
        show(msg, 'error');
        setSending(false);
        return; // keep the modal open on failure
      }
      show(data?.sentTo ? `PO request email sent to ${data.sentTo}` : 'PO request email sent successfully.', 'success');
      setSending(false);
      onClose(); // only close after a confirmed success
    } catch (err) {
      show(err instanceof Error ? err.message : 'Unable to send PO request email. Please try again.', 'error');
      setSending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Request New PO"
      size="sm"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => { void sendPoRequestEmail(); }} disabled={sending}><Mail className="w-4 h-4" />{sending ? 'Sending...' : 'Send PO Request Email'}</Button>
      </>}
    >
      <div className="space-y-3">
        <Field label="Customer / Company" required={standalone}>
          {standalone ? (
            <SearchableSelect value={customerId} onChange={setCustomerId} options={customers.map(c => ({ value: c.id, label: c.name }))} placeholder="Select customer" />
          ) : (
            <div className={classNames(inputClass(), 'bg-slate-100 text-slate-600')}>{selectedCustomer?.name ?? '-'}</div>
          )}
        </Field>
        <Field label="Current PO Number" required>
          <input type="text" className={inputClass()} value={poNumber} onChange={e => setPoNumber(e.target.value)} placeholder="e.g. PO-1234" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Current PO Balance">
            <input type="number" min="0" step="0.01" className={inputClass()} value={currentBalance} onChange={e => setCurrentBalance(e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Required Invoice Amount">
            <input type="number" min="0" step="0.01" className={inputClass()} value={requiredInvoiceAmount} onChange={e => setRequiredInvoiceAmount(e.target.value)} placeholder="0.00" />
          </Field>
        </div>
        <Field label="Additional PO Amount Required" required hint="Enter the amount to request — this is not auto-calculated.">
          <input type="number" min="0" step="0.01" className={inputClass()} value={additionalAmount} onChange={e => setAdditionalAmount(e.target.value)} placeholder="Enter amount" />
        </Field>
        {customerId && !selectedCustomer?.email && (
          <p className="text-xs font-medium text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />Customer email address is not configured. Please update Customer Master before sending the PO request.</p>
        )}
      </div>
    </Modal>
  );
}
