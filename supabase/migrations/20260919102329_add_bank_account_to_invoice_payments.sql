/*
  # Bank Account selection for invoice_payments

  ## Problem
  invoice_payments (shared by Cash/UPI's Record Payment, Customer Invoices'
  Record Company Payment, and Settlement Report's Record Payment) has no
  bank_account_id column. The existing sync_invoice_payment_to_bank trigger
  always posts every non-Cash payment to default_bank_account_id() - there
  is no way today to record that a specific payment went to a specific
  account (e.g. AXIS vs HDFC), unlike Purchase/Diesel/Maintenance/Salary
  which already got this via their own ledger tables.

  ## Fix
  Add a nullable bank_account_id column (mirrors the exact pattern used by
  purchase_payments/diesel_payments/maintenance_payments/salary_payments),
  and repoint the trigger to use it when present, falling back to the
  default account when not set - so existing rows and any caller that
  doesn't pass one keep working exactly as before.

  ## Data safety
  Purely additive. No existing row is modified. Every existing caller of
  invoice_payments (that never set payment_mode/bank_account_id together)
  is unaffected until the frontend starts sending a bank_account_id.
*/

ALTER TABLE public.invoice_payments ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES public.bank_accounts(id);

CREATE OR REPLACE FUNCTION public.sync_invoice_payment_to_bank()
RETURNS trigger AS $$
DECLARE
  v_invoice_id uuid;
  v_payable numeric(12,2);
  v_total_received numeric(12,2);
  v_balance numeric(12,2);
  v_status text;
BEGIN
  v_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);

  SELECT CASE WHEN discount_enabled THEN COALESCE(final_payable_amount, grand_total) ELSE grand_total END
    INTO v_payable FROM public.invoices WHERE id = v_invoice_id;
  IF FOUND THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_total_received
      FROM public.invoice_payments WHERE invoice_id = v_invoice_id;
    v_balance := GREATEST(0, ROUND(COALESCE(v_payable, 0) - v_total_received, 2));
    IF v_total_received <= 0 THEN v_status := 'Pending';
    ELSIF v_balance <= 0 THEN v_status := 'Paid';
    ELSE v_status := 'Partially Paid';
    END IF;

    UPDATE public.invoices SET
      amount_received = v_total_received,
      balance_amount = v_balance,
      invoice_status = v_status,
      payment_status = v_status
    WHERE id = v_invoice_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    UPDATE public.bank_transactions SET is_cancelled = true, updated_at = now()
      WHERE source_table = 'invoice_payments' AND source_record_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.payment_mode IS NULL OR NEW.payment_mode = 'Cash' OR NEW.amount <= 0 THEN
    UPDATE public.bank_transactions SET is_cancelled = true, updated_at = now()
      WHERE source_table = 'invoice_payments' AND source_record_id = NEW.id;
  ELSE
    INSERT INTO public.bank_transactions (
      bank_account_id, transaction_date, transaction_type, payment_mode, particulars, category, description,
      customer_id, invoice_id, reference_number, cheque_number, amount,
      voucher_type, voucher_no,
      source_module, source_table, source_record_id, is_cancelled, created_by
    )
    SELECT
      COALESCE(NEW.bank_account_id, public.default_bank_account_id()),
      NEW.payment_date, 'Credit', NEW.payment_mode,
      COALESCE(i.customer_name, 'Customer'),
      CASE WHEN i.invoice_type = 'Cash' THEN 'Cash/UPI Bill Receipt' ELSE 'Customer Receipt' END,
      NEW.remarks,
      i.customer_id, i.id,
      NEW.reference,
      CASE WHEN NEW.payment_mode = 'Cheque' THEN NEW.reference ELSE NULL END,
      NEW.amount,
       'Receipt', i.invoice_number,
      CASE WHEN i.invoice_type = 'Cash' THEN 'Cash/UPI Bill' WHEN i.invoice_type = 'GST' THEN 'GST Billing' ELSE 'Customer Invoice' END,
      'invoice_payments', NEW.id, false, auth.uid()
    FROM public.invoices i WHERE i.id = NEW.invoice_id
    ON CONFLICT (source_table, source_record_id) WHERE source_record_id IS NOT NULL DO UPDATE SET
      bank_account_id = EXCLUDED.bank_account_id,
      transaction_date = EXCLUDED.transaction_date,
      payment_mode = EXCLUDED.payment_mode,
      particulars = EXCLUDED.particulars,
      category = EXCLUDED.category,
      description = EXCLUDED.description,
      reference_number = EXCLUDED.reference_number,
      cheque_number = EXCLUDED.cheque_number,
      amount = EXCLUDED.amount,
      voucher_type = EXCLUDED.voucher_type,
      voucher_no = EXCLUDED.voucher_no,
      is_cancelled = false,
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
