/*
  # Fix ON CONFLICT target on all bank sync triggers

  ## Problem
  `ux_bank_txn_source` (see 20260918100000) is a PARTIAL unique index:
    CREATE UNIQUE INDEX ux_bank_txn_source ON bank_transactions
      (source_table, source_record_id) WHERE source_record_id IS NOT NULL;
  Postgres only accepts a partial unique index as an `ON CONFLICT` arbiter
  when the `ON CONFLICT` clause restates the exact same predicate. Every
  trigger in 20260918100500 wrote plain
  `ON CONFLICT (source_table, source_record_id) DO UPDATE ...` with no
  `WHERE` clause, so Postgres could not find a matching constraint at all -
  every non-cash payment in every module (Purchase, Diesel, Maintenance,
  EMI, invoice/GST/Cash-UPI payments, Salary, Other Expense) failed with:
    "there is no unique or exclusion constraint matching the
     ON CONFLICT specification"

  ## Fix
  Re-`CREATE OR REPLACE` all 7 trigger functions with
  `ON CONFLICT (source_table, source_record_id) WHERE source_record_id IS NOT NULL
   DO UPDATE ...`, matching the index's predicate exactly. No data, table,
  or trigger-binding changes - only the function bodies are corrected.
  Everything below is otherwise identical to 20260918100500.
*/

/*
  # Bank sync triggers — automatic Credit/Debit posting

  Adds one AFTER INSERT/UPDATE/DELETE trigger per payment-bearing table.
  Each trigger:
  - Skips (and cancels any existing bank row) when payment_mode is NULL or
    'Cash', or the paid/payment amount is <= 0, or the source row is
    itself cancelled/deleted — Cash never reaches the Bank module.
  - Otherwise INSERTs ... ON CONFLICT (source_table, source_record_id) DO
    UPDATE, so recording a payment creates exactly one bank_transactions
    row and editing it in place (amount, mode, date, reference) updates
    that same row rather than creating a duplicate.
  - Uses `auth.uid()` for created_by, matching the RLS session of whoever
    is actually saving the payment.

  The `invoice_payments` trigger additionally recomputes
  `invoices.amount_received/balance_amount/invoice_status/payment_status`
  directly from the sum of its own rows. This replaces the three
  independent client-side copies of this same logic in Invoices.tsx,
  SettlementReport.tsx and CashBills.tsx (removed in this change), and
  fixes SettlementReport's pre-existing bug of never writing
  'Partially Paid' to payment_status.

  Bank-eligible payment modes: everything except 'Cash' (Bank Transfer,
  UPI, Cheque, NEFT, RTGS, Online, Other) - the accounting model here has
  only two buckets, Bank and Cash, per the ERP's requirements.

  Multi-account note: only the Salary Payments page has its own bank account
  picker (`salary_payments.bank_account_id`). Every other module here
  (Customer/GST invoices, Cash/UPI bills, Purchase, Diesel, Maintenance, EMI,
  Other Expense) has no account-selection UI of its own, so their triggers
  always post to `default_bank_account_id()` - the one account flagged
  `is_default` on the Bank page. This keeps those pages completely unchanged
  while still giving every transaction a valid account to belong to.
*/

CREATE OR REPLACE FUNCTION public.default_bank_account_id()
RETURNS uuid AS $$
  SELECT id FROM public.bank_accounts ORDER BY is_default DESC, created_at ASC LIMIT 1;
$$ LANGUAGE sql STABLE SET search_path = public;

-- ============================================================
-- 1. invoice_payments -> invoices totals + Bank sync
--    (Customer Invoices, GST/Company Billing, Cash/UPI Bills, Settlement
--    Report, Record Company Payment all write to this one shared table)
-- ============================================================
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

  -- Payable amount matches the formula already used client-side in
  -- Invoices.tsx/SettlementReport.tsx/CashBills.tsx: grand_total, unless a
  -- discount is enabled, in which case final_payable_amount applies instead.
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
      public.default_bank_account_id(),
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

DROP TRIGGER IF EXISTS trg_sync_bank_invoice_payments ON public.invoice_payments;
CREATE TRIGGER trg_sync_bank_invoice_payments
  AFTER INSERT OR UPDATE OR DELETE ON public.invoice_payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_invoice_payment_to_bank();

-- ============================================================
-- 2. purchases -> Bank sync (cumulative paid_amount field)
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_purchase_payment_to_bank()
RETURNS trigger AS $$
DECLARE
  v_vendor_name text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.bank_transactions SET is_cancelled = true, updated_at = now()
      WHERE source_table = 'purchases' AND source_record_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.payment_mode IS NULL OR NEW.payment_mode = 'Cash' OR COALESCE(NEW.paid_amount, 0) <= 0 THEN
    UPDATE public.bank_transactions SET is_cancelled = true, updated_at = now()
      WHERE source_table = 'purchases' AND source_record_id = NEW.id;
  ELSE
    SELECT name INTO v_vendor_name FROM public.vendors WHERE id = NEW.vendor_id;
    INSERT INTO public.bank_transactions (
      bank_account_id, transaction_date, transaction_type, payment_mode, particulars, category, description,
      supplier_id, purchase_id, reference_number, cheque_number, amount,
      voucher_type, voucher_no,
      source_module, source_table, source_record_id, is_cancelled, created_by
    ) VALUES (
      public.default_bank_account_id(),
      NEW.purchase_date, 'Debit', NEW.payment_mode, COALESCE(v_vendor_name, 'Vendor'), 'Purchase Payment', NEW.bill_no,
      NEW.vendor_id, NEW.id, NEW.payment_reference, NEW.cheque_number, NEW.paid_amount,
      'Payment', NEW.bill_no,
      'Purchase', 'purchases', NEW.id, false, auth.uid()
    )
    ON CONFLICT (source_table, source_record_id) WHERE source_record_id IS NOT NULL DO UPDATE SET
      transaction_date = EXCLUDED.transaction_date,
      payment_mode = EXCLUDED.payment_mode,
      particulars = EXCLUDED.particulars,
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

DROP TRIGGER IF EXISTS trg_sync_bank_purchases ON public.purchases;
CREATE TRIGGER trg_sync_bank_purchases
  AFTER INSERT OR UPDATE OR DELETE ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.sync_purchase_payment_to_bank();

-- ============================================================
-- 3. diesel_entries -> Bank sync (cumulative paid_amount field)
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_diesel_payment_to_bank()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.bank_transactions SET is_cancelled = true, updated_at = now()
      WHERE source_table = 'diesel_entries' AND source_record_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.is_cancelled OR NEW.payment_mode IS NULL OR NEW.payment_mode = 'Cash' OR COALESCE(NEW.paid_amount, 0) <= 0 THEN
    UPDATE public.bank_transactions SET is_cancelled = true, updated_at = now()
      WHERE source_table = 'diesel_entries' AND source_record_id = NEW.id;
  ELSE
    INSERT INTO public.bank_transactions (
      bank_account_id, transaction_date, transaction_type, payment_mode, particulars, category, description,
      reference_number, cheque_number, amount,
      voucher_type,
      source_module, source_table, source_record_id, is_cancelled, created_by
    ) VALUES (
      public.default_bank_account_id(),
      NEW.diesel_date, 'Debit', NEW.payment_mode, COALESCE(NEW.pump_name, 'Diesel Station'), 'Diesel', NEW.remarks,
      NEW.payment_reference, NEW.cheque_number, NEW.paid_amount,
      'Payment',
      'Diesel', 'diesel_entries', NEW.id, false, auth.uid()
    )
    ON CONFLICT (source_table, source_record_id) WHERE source_record_id IS NOT NULL DO UPDATE SET
      transaction_date = EXCLUDED.transaction_date,
      payment_mode = EXCLUDED.payment_mode,
      particulars = EXCLUDED.particulars,
      description = EXCLUDED.description,
      reference_number = EXCLUDED.reference_number,
      cheque_number = EXCLUDED.cheque_number,
      amount = EXCLUDED.amount,
      voucher_type = EXCLUDED.voucher_type,
      is_cancelled = false,
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_sync_bank_diesel ON public.diesel_entries;
CREATE TRIGGER trg_sync_bank_diesel
  AFTER INSERT OR UPDATE OR DELETE ON public.diesel_entries
  FOR EACH ROW EXECUTE FUNCTION public.sync_diesel_payment_to_bank();

-- ============================================================
-- 4. maintenance -> Bank sync (cumulative paid_amount field)
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_maintenance_payment_to_bank()
RETURNS trigger AS $$
DECLARE
  v_vehicle_no text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.bank_transactions SET is_cancelled = true, updated_at = now()
      WHERE source_table = 'maintenance' AND source_record_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.is_cancelled OR NEW.payment_mode IS NULL OR NEW.payment_mode = 'Cash' OR COALESCE(NEW.paid_amount, 0) <= 0 THEN
    UPDATE public.bank_transactions SET is_cancelled = true, updated_at = now()
      WHERE source_table = 'maintenance' AND source_record_id = NEW.id;
  ELSE
    SELECT registration_number INTO v_vehicle_no FROM public.vehicles WHERE id = NEW.vehicle_id;
    INSERT INTO public.bank_transactions (
      bank_account_id, transaction_date, transaction_type, payment_mode, particulars, category, description,
      reference_number, cheque_number, amount,
      voucher_type,
      source_module, source_table, source_record_id, is_cancelled, created_by
    ) VALUES (
      public.default_bank_account_id(),
      NEW.maintenance_date, 'Debit', NEW.payment_mode, COALESCE(v_vehicle_no, NEW.maintenance_type, 'Maintenance'), 'Maintenance', COALESCE(NEW.remark, NEW.description),
      NEW.payment_reference, NEW.cheque_number, NEW.paid_amount,
      'Payment',
      'Maintenance', 'maintenance', NEW.id, false, auth.uid()
    )
    ON CONFLICT (source_table, source_record_id) WHERE source_record_id IS NOT NULL DO UPDATE SET
      transaction_date = EXCLUDED.transaction_date,
      payment_mode = EXCLUDED.payment_mode,
      particulars = EXCLUDED.particulars,
      description = EXCLUDED.description,
      reference_number = EXCLUDED.reference_number,
      cheque_number = EXCLUDED.cheque_number,
      amount = EXCLUDED.amount,
      voucher_type = EXCLUDED.voucher_type,
      is_cancelled = false,
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_sync_bank_maintenance ON public.maintenance;
CREATE TRIGGER trg_sync_bank_maintenance
  AFTER INSERT OR UPDATE OR DELETE ON public.maintenance
  FOR EACH ROW EXECUTE FUNCTION public.sync_maintenance_payment_to_bank();

-- ============================================================
-- 5. emi_records -> Bank sync (single payment per due row, only when Paid)
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_emi_payment_to_bank()
RETURNS trigger AS $$
DECLARE
  v_vehicle_no text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.bank_transactions SET is_cancelled = true, updated_at = now()
      WHERE source_table = 'emi_records' AND source_record_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.status <> 'Paid' OR NEW.payment_mode IS NULL OR NEW.payment_mode = 'Cash' OR COALESCE(NEW.emi_amount, 0) <= 0 THEN
    UPDATE public.bank_transactions SET is_cancelled = true, updated_at = now()
      WHERE source_table = 'emi_records' AND source_record_id = NEW.id;
  ELSE
    SELECT registration_number INTO v_vehicle_no FROM public.vehicles WHERE id = NEW.vehicle_id;
    INSERT INTO public.bank_transactions (
      bank_account_id, transaction_date, transaction_type, payment_mode, particulars, category, description,
      amount, voucher_type, source_module, source_table, source_record_id, is_cancelled, created_by
    ) VALUES (
      public.default_bank_account_id(),
      COALESCE(NEW.paid_date, NEW.due_date), 'Debit', NEW.payment_mode,
      COALESCE(v_vehicle_no, 'Vehicle') || ' - EMI', 'EMI', NEW.remarks,
      NEW.emi_amount, 'Payment', 'EMI', 'emi_records', NEW.id, false, auth.uid()
    )
    ON CONFLICT (source_table, source_record_id) WHERE source_record_id IS NOT NULL DO UPDATE SET
      transaction_date = EXCLUDED.transaction_date,
      payment_mode = EXCLUDED.payment_mode,
      particulars = EXCLUDED.particulars,
      description = EXCLUDED.description,
      amount = EXCLUDED.amount,
      voucher_type = EXCLUDED.voucher_type,
      is_cancelled = false,
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_sync_bank_emi ON public.emi_records;
CREATE TRIGGER trg_sync_bank_emi
  AFTER INSERT OR UPDATE OR DELETE ON public.emi_records
  FOR EACH ROW EXECUTE FUNCTION public.sync_emi_payment_to_bank();

-- ============================================================
-- 6. salary_payments -> Bank sync (ledger: one row per payment event)
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_salary_payment_to_bank()
RETURNS trigger AS $$
DECLARE
  v_employee_name text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.bank_transactions SET is_cancelled = true, updated_at = now()
      WHERE source_table = 'salary_payments' AND source_record_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.is_cancelled OR NEW.payment_mode IS NULL OR NEW.payment_mode = 'Cash' OR COALESCE(NEW.amount, 0) <= 0 THEN
    UPDATE public.bank_transactions SET is_cancelled = true, updated_at = now()
      WHERE source_table = 'salary_payments' AND source_record_id = NEW.id;
  ELSE
    SELECT name INTO v_employee_name FROM public.employees WHERE id = NEW.employee_id;
    INSERT INTO public.bank_transactions (
      bank_account_id, transaction_date, transaction_type, payment_mode, particulars, category, description,
      reference_number, cheque_number, amount,
      voucher_type,
      source_module, source_table, source_record_id, is_cancelled, created_by
    ) VALUES (
      COALESCE(NEW.bank_account_id, public.default_bank_account_id()),
      NEW.payment_date, 'Debit', NEW.payment_mode, 'Salary - ' || COALESCE(v_employee_name, 'Employee'), 'Salary', NEW.salary_month || COALESCE(' - ' || NEW.remarks, ''),
      NEW.reference_number, NEW.cheque_number, NEW.amount,
      'Payment',
      'Salary', 'salary_payments', NEW.id, false, auth.uid()
    )
    ON CONFLICT (source_table, source_record_id) WHERE source_record_id IS NOT NULL DO UPDATE SET
      bank_account_id = EXCLUDED.bank_account_id,
      transaction_date = EXCLUDED.transaction_date,
      payment_mode = EXCLUDED.payment_mode,
      particulars = EXCLUDED.particulars,
      description = EXCLUDED.description,
      reference_number = EXCLUDED.reference_number,
      cheque_number = EXCLUDED.cheque_number,
      amount = EXCLUDED.amount,
      voucher_type = EXCLUDED.voucher_type,
      is_cancelled = false,
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_sync_bank_salary ON public.salary_payments;
CREATE TRIGGER trg_sync_bank_salary
  AFTER INSERT OR UPDATE OR DELETE ON public.salary_payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_salary_payment_to_bank();

-- ============================================================
-- 7. other_expenses -> Bank sync (ledger: one row per expense event)
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_expense_payment_to_bank()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.bank_transactions SET is_cancelled = true, updated_at = now()
      WHERE source_table = 'other_expenses' AND source_record_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.is_cancelled OR NEW.payment_mode IS NULL OR NEW.payment_mode = 'Cash' OR COALESCE(NEW.amount, 0) <= 0 THEN
    UPDATE public.bank_transactions SET is_cancelled = true, updated_at = now()
      WHERE source_table = 'other_expenses' AND source_record_id = NEW.id;
  ELSE
    INSERT INTO public.bank_transactions (
      bank_account_id, transaction_date, transaction_type, payment_mode, particulars, category, description,
      reference_number, cheque_number, amount,
      voucher_type,
      source_module, source_table, source_record_id, is_cancelled, created_by
    ) VALUES (
      public.default_bank_account_id(),
      NEW.expense_date, 'Debit', NEW.payment_mode, NEW.particulars, NEW.category, NEW.remarks,
      NEW.reference_number, NEW.cheque_number, NEW.amount,
      'Payment',
      'Other Expense', 'other_expenses', NEW.id, false, auth.uid()
    )
    ON CONFLICT (source_table, source_record_id) WHERE source_record_id IS NOT NULL DO UPDATE SET
      transaction_date = EXCLUDED.transaction_date,
      payment_mode = EXCLUDED.payment_mode,
      particulars = EXCLUDED.particulars,
      category = EXCLUDED.category,
      description = EXCLUDED.description,
      reference_number = EXCLUDED.reference_number,
      cheque_number = EXCLUDED.cheque_number,
      amount = EXCLUDED.amount,
      voucher_type = EXCLUDED.voucher_type,
      is_cancelled = false,
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_sync_bank_expenses ON public.other_expenses;
CREATE TRIGGER trg_sync_bank_expenses
  AFTER INSERT OR UPDATE OR DELETE ON public.other_expenses
  FOR EACH ROW EXECUTE FUNCTION public.sync_expense_payment_to_bank();
