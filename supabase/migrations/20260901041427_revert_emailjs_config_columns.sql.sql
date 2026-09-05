/*
# Revert EmailJS configuration columns from company_settings

Removes the five EmailJS columns added in the previous migration.
These are no longer needed since the EmailJS integration was reverted.
*/

ALTER TABLE company_settings
  DROP COLUMN IF EXISTS emailjs_service_id,
  DROP COLUMN IF EXISTS emailjs_public_key,
  DROP COLUMN IF EXISTS emailjs_sender_email,
  DROP COLUMN IF EXISTS emailjs_invoice_template_id,
  DROP COLUMN IF EXISTS emailjs_reminder_template_id;