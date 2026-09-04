-- Quotation email settings table
CREATE TABLE IF NOT EXISTS quotation_email_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_subject text NOT NULL DEFAULT 'Quotation {{quotation_number}} – {{customer_name}}',
  email_body text NOT NULL DEFAULT 'Dear {{customer_name}},\n\nPlease find attached our quotation {{quotation_number}} for your requirement.\n\nQuotation Total: {{grand_total}}\nQuotation Date: {{quotation_date}}\nValid Until: {{valid_until}}\n\nPlease review the attached quotation and contact us if you require any clarification.\n\nRegards,\n{{company_name}}',
  cc_email text,
  bcc_email text,
  attach_pdf boolean NOT NULL DEFAULT true,
  email_signature text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Quotation format settings table
CREATE TABLE IF NOT EXISTS quotation_format_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  letterhead_url text,
  quotation_title text NOT NULL DEFAULT 'QUOTATION',
  terms_and_conditions text NOT NULL DEFAULT '1. JCB hire charges per day: As per rate mentioned above.
2. JCB hourly hire charges: As per rate mentioned above, minimum hours applicable as specified.
3. Minimum hours: Minimum hours charge is applicable as per the rate mentioned.
4. Batha: Batha charges are extra as mentioned in the quotation.
5. Work Order: Work Order / Purchase Order is required before deployment of machinery.
6. Machinery idle hours: Machinery idle hours due to site conditions will be charged as per the hourly rate.
7. GST: GST will be charged extra as applicable.
8. TDS: TDS deduction, if any, will be as per applicable rules and deducted from the bill amount.
9. Machinery supply: Machinery will be supplied only after receipt of the Purchase Order / Work Order.
10. Safety: Safety measures at site are to be provided by the customer.
11. Log Book: Daily log book / attendance register is to be signed by the customer''s authorized representative.
12. Damage / Repair: Any damage to machinery due to site conditions or customer negligence will be charged extra.
13. Repairs: Repairs due to normal wear and tear are our responsibility.
14. Payment Terms: As per the payment terms mentioned above.
15. Quotation Validity: This quotation is valid until the date mentioned above.
16. Jurisdiction: Any dispute shall be subject to Hyderabad jurisdiction only.',
  signature_text text NOT NULL DEFAULT 'Authorized Signatory',
  show_gst boolean NOT NULL DEFAULT true,
  default_payment_terms text,
  default_validity_days integer NOT NULL DEFAULT 30,
  show_1hr_rate boolean NOT NULL DEFAULT true,
  show_2hr_rate boolean NOT NULL DEFAULT true,
  show_batha boolean NOT NULL DEFAULT true,
  show_transport boolean NOT NULL DEFAULT true,
  date_format text NOT NULL DEFAULT 'dd MMM yyyy',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Quotation email history table
CREATE TABLE IF NOT EXISTS quotation_email_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  quotation_number text,
  customer_name text,
  recipient_email text NOT NULL,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'Sent',
  attachment_name text,
  error_message text,
  sent_by uuid,
  sent_at timestamptz NOT NULL DEFAULT now()
);

-- Seed default settings
INSERT INTO quotation_email_settings (email_subject, email_body)
SELECT 'Quotation {{quotation_number}} – {{customer_name}}',
'Dear {{customer_name}},

Please find attached our quotation {{quotation_number}} for your requirement.

Quotation Total: {{grand_total}}
Quotation Date: {{quotation_date}}
Valid Until: {{valid_until}}

Please review the attached quotation and contact us if you require any clarification.

Regards,
{{company_name}}'
WHERE NOT EXISTS (SELECT 1 FROM quotation_email_settings);

INSERT INTO quotation_format_settings (quotation_title)
SELECT 'QUOTATION'
WHERE NOT EXISTS (SELECT 1 FROM quotation_format_settings);

-- Enable RLS
ALTER TABLE quotation_email_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_format_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_email_history ENABLE ROW LEVEL SECURITY;

-- Policies for quotation_email_settings (authenticated users can manage)
CREATE POLICY "select_quotation_email_settings" ON quotation_email_settings FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "insert_quotation_email_settings" ON quotation_email_settings FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY "update_quotation_email_settings" ON quotation_email_settings FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

-- Policies for quotation_format_settings
CREATE POLICY "select_quotation_format_settings" ON quotation_format_settings FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "insert_quotation_format_settings" ON quotation_format_settings FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY "update_quotation_format_settings" ON quotation_format_settings FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

-- Policies for quotation_email_history
CREATE POLICY "select_quotation_email_history" ON quotation_email_history FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "insert_quotation_email_history" ON quotation_email_history FOR INSERT
  TO authenticated WITH CHECK (true);
