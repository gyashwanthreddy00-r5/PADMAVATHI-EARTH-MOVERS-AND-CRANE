/*
  # Bank Module — multiple bank accounts + central ledger

  1. New Tables
  - `bank_accounts` — one row per real-world bank account (Bank Name,
    Account Holder Name, Account Number, IFSC Code, Branch Name, Account
    Type, its own Opening Balance). Exactly one account may be `is_default`
    at a time (enforced by a partial unique index) — this is the account
    every non-Salary module (Customer/GST invoices, Cash/UPI bills,
    Purchase, Diesel, Maintenance, EMI, Other Expense) posts to automatically,
    since those pages don't have an account picker of their own. A default
    "Main Account" row is seeded so those triggers never fail for lack of
    an account before the user has configured their real ones.
  - `bank_transactions` — one row per Credit/Debit, always tied to a
    `bank_account_id`. Every non-cash payment recorded anywhere in the ERP
    is synced here automatically by triggers added in a later migration.
    Manual entries (bank charges, interest, adjustments) can also be added
    directly with `source_module = 'Manual Bank Entry'` and no
    `source_table`/`source_record_id`.

  2. Duplicate prevention
  - `ux_bank_txn_source` is a partial unique index on
    `(source_table, source_record_id)` for rows that have a source. Sync
    triggers always `INSERT ... ON CONFLICT ... DO UPDATE`, so editing a
    payment at its source updates the same bank row instead of creating a
    second one.

  3. Cancellation
  - `is_cancelled` is a soft-reversal flag. Cancelling/deleting a source
    payment flips this to true instead of deleting the bank row, preserving
    accounting history. Cancelled rows are excluded from balance
    calculations.

  4. Security
  - RLS enabled, 4 CRUD policies each, scoped `authenticated`, matching
    every other table in this schema.
*/

CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_name text NOT NULL,
  account_holder_name text,
  account_number text,
  ifsc_code text,
  branch_name text,
  account_type text CHECK (account_type IN ('Current','Savings')),
  opening_balance numeric(12,2) NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;

-- Only one bank account may be the default at any time.
CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_accounts_one_default
  ON public.bank_accounts (is_default) WHERE is_default = true;

DROP POLICY IF EXISTS "auth_select_bank_accounts" ON public.bank_accounts;
CREATE POLICY "auth_select_bank_accounts" ON public.bank_accounts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_bank_accounts" ON public.bank_accounts;
CREATE POLICY "auth_insert_bank_accounts" ON public.bank_accounts FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_bank_accounts" ON public.bank_accounts;
CREATE POLICY "auth_update_bank_accounts" ON public.bank_accounts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_bank_accounts" ON public.bank_accounts;
CREATE POLICY "auth_delete_bank_accounts" ON public.bank_accounts FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_bank_accounts_updated BEFORE UPDATE ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed one default account so every auto-sync trigger always has somewhere
-- to post to, even before the user has added their real accounts.
INSERT INTO public.bank_accounts (bank_name, is_default, opening_balance)
SELECT 'Main Account', true, 0
WHERE NOT EXISTS (SELECT 1 FROM public.bank_accounts);

CREATE TABLE IF NOT EXISTS public.bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id uuid NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  transaction_date date NOT NULL DEFAULT CURRENT_DATE,
  transaction_type text NOT NULL CHECK (transaction_type IN ('Credit','Debit')),
  payment_mode text NOT NULL CHECK (payment_mode IN ('Bank Transfer','UPI','Cheque','NEFT','RTGS','Online','Other')),
  particulars text NOT NULL,
  category text,
  description text,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  purchase_id uuid REFERENCES public.purchases(id) ON DELETE SET NULL,
  reference_number text,
  cheque_number text,
  utr_number text,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  source_module text NOT NULL DEFAULT 'Manual Bank Entry',
  source_table text,
  source_record_id uuid,
  voucher_type text CHECK (voucher_type IN ('Receipt','Payment','Contra')),
  voucher_no text,
  is_cancelled boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_txn_source
  ON public.bank_transactions (source_table, source_record_id)
  WHERE source_record_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bank_txn_account ON public.bank_transactions (bank_account_id, transaction_date, created_at);
CREATE INDEX IF NOT EXISTS idx_bank_txn_date ON public.bank_transactions (transaction_date, created_at);
CREATE INDEX IF NOT EXISTS idx_bank_txn_invoice ON public.bank_transactions (invoice_id);
CREATE INDEX IF NOT EXISTS idx_bank_txn_purchase ON public.bank_transactions (purchase_id);
CREATE INDEX IF NOT EXISTS idx_bank_txn_active ON public.bank_transactions (is_cancelled);

DROP POLICY IF EXISTS "auth_select_bank_transactions" ON public.bank_transactions;
CREATE POLICY "auth_select_bank_transactions" ON public.bank_transactions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_bank_transactions" ON public.bank_transactions;
CREATE POLICY "auth_insert_bank_transactions" ON public.bank_transactions FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_bank_transactions" ON public.bank_transactions;
CREATE POLICY "auth_update_bank_transactions" ON public.bank_transactions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_bank_transactions" ON public.bank_transactions;
CREATE POLICY "auth_delete_bank_transactions" ON public.bank_transactions FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_bank_transactions_updated BEFORE UPDATE ON public.bank_transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
