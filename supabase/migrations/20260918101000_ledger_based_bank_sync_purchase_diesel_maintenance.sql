/*
  # Repoint Purchase/Diesel/Maintenance Bank sync onto their new ledgers

  ## Why
  The old `sync_purchase_payment_to_bank`/`sync_diesel_payment_to_bank`/
  `sync_maintenance_payment_to_bank` triggers (20260918100500) fired on the
  parent row itself, so a second installment just overwrote the first
  Bank transaction's amount instead of creating a second one. Now that
  `purchase_payments`/`diesel_payments`/`maintenance_payments` exist as
  real ledgers (20260918100900), Bank sync must key off each ledger row's
  own id instead - exactly the pattern `invoice_payments`/`salary_payments`
  already use correctly, where N installments always produce N Bank rows.

  ## Changes
  1. Drop the three old parent-row triggers so they can never again fire
     on `purchases`/`diesel_entries`/`maintenance` (the old trigger
     functions are left in place, just unbound - harmless, nothing calls
     them anymore).
  2. Soft-cancel any Bank transaction rows those old triggers already
     created (`source_table IN ('purchases','diesel_entries','maintenance')`)
     - they're being superseded by fresh, correctly-scoped ledger-based
       rows below, and cancelling (not deleting) preserves accounting
       history per this schema's established pattern.
  3. New combined trigger per ledger table: recomputes the parent's own
     paid_amount/balance columns from the sum of its (non-cancelled)
     ledger rows - so every existing read path (list views, reports,
     PurchaseReport, etc.) that already reads
     `purchases.paid_amount`/`diesel_entries.paid_amount`/
     `maintenance.paid_amount` keeps working unchanged - then syncs
     Bank exactly like every other per-payment-row trigger in this schema.
  4. Backfill: for any purchase/diesel entry/maintenance record that
     already has `paid_amount > 0` from before this change (and has no
     ledger rows yet), insert one ledger row carrying that historical
     amount forward (using its existing payment_mode/reference/cheque
     columns, defaulting to 'Cash' if unset) BEFORE creating the new
     triggers... note: this INSERT happens AFTER the triggers are created
     below, specifically so it naturally fires them - recomputing the
     parent (a no-op, since the amount already matches) and creating one
     fresh, correctly-linked Bank transaction for that historical payment,
     replacing the one cancelled in step 2. No existing purchase, diesel,
     or maintenance row is modified or deleted by this migration.
*/

-- ============================================================
-- 1 & 2. Retire the old parent-row-level triggers and their Bank rows
-- ============================================================
DROP TRIGGER IF EXISTS trg_sync_bank_purchases ON public.purchases;
DROP TRIGGER IF EXISTS trg_sync_bank_diesel ON public.diesel_entries;
DROP TRIGGER IF EXISTS trg_sync_bank_maintenance ON public.maintenance;

UPDATE public.bank_transactions SET is_cancelled = true, updated_at = now()
  WHERE source_table IN ('purchases', 'diesel_entries', 'maintenance') AND is_cancelled = false;

-- ============================================================
-- 3a. purchase_payments -> purchases totals + Bank sync
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_purchase_payment_ledger_to_bank()
RETURNS trigger AS $$
DECLARE
  v_purchase_id uuid;
  v_paid numeric(12,2);
  v_total numeric(12,2);
  v_vendor_name text;
  v_bill_no text;
BEGIN
  v_purchase_id := COALESCE(NEW.purchase_id, OLD.purchase_id);

  SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM public.purchase_payments
    WHERE purchase_id = v_purchase_id AND is_cancelled = false;
  SELECT total_amount, bill_no INTO v_total, v_bill_no FROM public.purchases WHERE id = v_purchase_id;
  IF FOUND THEN
    UPDATE public.purchases SET paid_amount = v_paid, balance_amount = COALESCE(v_total, 0) - v_paid WHERE id = v_purchase_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    UPDATE public.bank_transactions SET is_cancelled = true, updated_at = now()
      WHERE source_table = 'purchase_payments' AND source_record_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.is_cancelled OR NEW.payment_mode = 'Cash' OR NEW.amount <= 0 THEN
    UPDATE public.bank_transactions SET is_cancelled = true, updated_at = now()
      WHERE source_table = 'purchase_payments' AND source_record_id = NEW.id;
  ELSE
    SELECT v.name INTO v_vendor_name FROM public.purchases p JOIN public.vendors v ON v.id = p.vendor_id WHERE p.id = NEW.purchase_id;
    INSERT INTO public.bank_transactions (
      bank_account_id, transaction_date, transaction_type, payment_mode, particulars, category, description,
      purchase_id, reference_number, cheque_number, amount, voucher_type, voucher_no,
      source_module, source_table, source_record_id, is_cancelled, created_by
    ) VALUES (
      COALESCE(NEW.bank_account_id, public.default_bank_account_id()),
      NEW.payment_date, 'Debit', NEW.payment_mode, COALESCE(v_vendor_name, 'Vendor'), 'Purchase Payment', NEW.remarks,
      NEW.purchase_id, NEW.reference_number, NEW.cheque_number, NEW.amount, 'Payment', v_bill_no,
      'Purchase', 'purchase_payments', NEW.id, false, COALESCE(NEW.created_by, auth.uid())
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
      voucher_no = EXCLUDED.voucher_no,
      is_cancelled = false,
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_sync_purchase_payment_ledger ON public.purchase_payments;
CREATE TRIGGER trg_sync_purchase_payment_ledger
  AFTER INSERT OR UPDATE OR DELETE ON public.purchase_payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_purchase_payment_ledger_to_bank();

-- ============================================================
-- 3b. diesel_payments -> diesel_entries totals + Bank sync
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_diesel_payment_ledger_to_bank()
RETURNS trigger AS $$
DECLARE
  v_entry_id uuid;
  v_paid numeric(12,2);
  v_total numeric(12,2);
  v_status text;
  v_pump_name text;
BEGIN
  v_entry_id := COALESCE(NEW.diesel_entry_id, OLD.diesel_entry_id);

  SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM public.diesel_payments
    WHERE diesel_entry_id = v_entry_id AND is_cancelled = false;
  SELECT total_amount, pump_name INTO v_total, v_pump_name FROM public.diesel_entries WHERE id = v_entry_id;
  IF FOUND THEN
    v_status := CASE WHEN v_paid <= 0 THEN 'Pending' WHEN v_paid >= COALESCE(v_total, 0) THEN 'Paid' ELSE 'Partially Paid' END;
    UPDATE public.diesel_entries SET paid_amount = v_paid, pending_amount = GREATEST(0, COALESCE(v_total, 0) - v_paid), payment_status = v_status WHERE id = v_entry_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    UPDATE public.bank_transactions SET is_cancelled = true, updated_at = now()
      WHERE source_table = 'diesel_payments' AND source_record_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.is_cancelled OR NEW.payment_mode = 'Cash' OR NEW.amount <= 0 THEN
    UPDATE public.bank_transactions SET is_cancelled = true, updated_at = now()
      WHERE source_table = 'diesel_payments' AND source_record_id = NEW.id;
  ELSE
    INSERT INTO public.bank_transactions (
      bank_account_id, transaction_date, transaction_type, payment_mode, particulars, category, description,
      reference_number, cheque_number, amount, voucher_type,
      source_module, source_table, source_record_id, is_cancelled, created_by
    ) VALUES (
      COALESCE(NEW.bank_account_id, public.default_bank_account_id()),
      NEW.payment_date, 'Debit', NEW.payment_mode, COALESCE(v_pump_name, 'Diesel Station'), 'Diesel', NEW.remarks,
      NEW.reference_number, NEW.cheque_number, NEW.amount, 'Payment',
      'Diesel', 'diesel_payments', NEW.id, false, COALESCE(NEW.created_by, auth.uid())
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
      is_cancelled = false,
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_sync_diesel_payment_ledger ON public.diesel_payments;
CREATE TRIGGER trg_sync_diesel_payment_ledger
  AFTER INSERT OR UPDATE OR DELETE ON public.diesel_payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_diesel_payment_ledger_to_bank();

-- ============================================================
-- 3c. maintenance_payments -> maintenance totals + Bank sync
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_maintenance_payment_ledger_to_bank()
RETURNS trigger AS $$
DECLARE
  v_maintenance_id uuid;
  v_paid numeric(12,2);
  v_total numeric(12,2);
  v_vehicle_no text;
  v_maintenance_type text;
BEGIN
  v_maintenance_id := COALESCE(NEW.maintenance_id, OLD.maintenance_id);

  SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM public.maintenance_payments
    WHERE maintenance_id = v_maintenance_id AND is_cancelled = false;
  SELECT amount, maintenance_type INTO v_total, v_maintenance_type FROM public.maintenance WHERE id = v_maintenance_id;
  IF FOUND THEN
    UPDATE public.maintenance SET paid_amount = v_paid, balance = COALESCE(v_total, 0) - v_paid WHERE id = v_maintenance_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    UPDATE public.bank_transactions SET is_cancelled = true, updated_at = now()
      WHERE source_table = 'maintenance_payments' AND source_record_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.is_cancelled OR NEW.payment_mode = 'Cash' OR NEW.amount <= 0 THEN
    UPDATE public.bank_transactions SET is_cancelled = true, updated_at = now()
      WHERE source_table = 'maintenance_payments' AND source_record_id = NEW.id;
  ELSE
    SELECT vh.registration_number INTO v_vehicle_no FROM public.maintenance m JOIN public.vehicles vh ON vh.id = m.vehicle_id WHERE m.id = NEW.maintenance_id;
    INSERT INTO public.bank_transactions (
      bank_account_id, transaction_date, transaction_type, payment_mode, particulars, category, description,
      reference_number, cheque_number, amount, voucher_type,
      source_module, source_table, source_record_id, is_cancelled, created_by
    ) VALUES (
      COALESCE(NEW.bank_account_id, public.default_bank_account_id()),
      NEW.payment_date, 'Debit', NEW.payment_mode, COALESCE(v_vehicle_no, v_maintenance_type, 'Maintenance'), 'Maintenance', NEW.remarks,
      NEW.reference_number, NEW.cheque_number, NEW.amount, 'Payment',
      'Maintenance', 'maintenance_payments', NEW.id, false, COALESCE(NEW.created_by, auth.uid())
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
      is_cancelled = false,
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_sync_maintenance_payment_ledger ON public.maintenance_payments;
CREATE TRIGGER trg_sync_maintenance_payment_ledger
  AFTER INSERT OR UPDATE OR DELETE ON public.maintenance_payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_maintenance_payment_ledger_to_bank();

-- ============================================================
-- 4. Backfill: carry forward any pre-existing cumulative paid_amount as
--    one historical ledger row each, only where no ledger row exists yet.
-- ============================================================
INSERT INTO public.purchase_payments (purchase_id, amount, payment_date, payment_mode, reference_number, cheque_number)
SELECT id, paid_amount, purchase_date, COALESCE(payment_mode, 'Cash'), payment_reference, cheque_number
FROM public.purchases p
WHERE COALESCE(p.paid_amount, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM public.purchase_payments pp WHERE pp.purchase_id = p.id);

INSERT INTO public.diesel_payments (diesel_entry_id, amount, payment_date, payment_mode, reference_number, cheque_number)
SELECT id, paid_amount, diesel_date, COALESCE(payment_mode, 'Cash'), payment_reference, cheque_number
FROM public.diesel_entries d
WHERE COALESCE(d.paid_amount, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM public.diesel_payments dp WHERE dp.diesel_entry_id = d.id);

INSERT INTO public.maintenance_payments (maintenance_id, amount, payment_date, payment_mode, reference_number, cheque_number)
SELECT id, paid_amount, maintenance_date, COALESCE(payment_mode, 'Cash'), payment_reference, cheque_number
FROM public.maintenance m
WHERE COALESCE(m.paid_amount, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM public.maintenance_payments mp WHERE mp.maintenance_id = m.id);
