/*
  # Add Monthly rate type to GST/Company Billing entries

  invoice_billing_lines.rate_type only allowed ('Hourly', 'Daily'). GST/Company
  Billing (and Cash/UPI Billing, which doesn't use this table) now offer a third
  "Monthly" option, billing at the vehicle's Rate Master monthly_rate x a
  decimal quantity of months instead of hours/days.

  Log Book Entries (po_working_records/po_order_lines) is intentionally NOT
  touched - Monthly is only being added to GST/Company Billing and Cash/UPI
  Billing per spec.
*/

ALTER TABLE invoice_billing_lines DROP CONSTRAINT IF EXISTS invoice_billing_lines_rate_type_check;
ALTER TABLE invoice_billing_lines ADD CONSTRAINT invoice_billing_lines_rate_type_check
  CHECK (rate_type IN ('Hourly', 'Daily', 'Monthly'));
