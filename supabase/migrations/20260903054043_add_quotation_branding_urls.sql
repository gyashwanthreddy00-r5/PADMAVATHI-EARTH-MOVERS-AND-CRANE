/*
# Add quotation branding image URLs to company_settings

1. Modified Tables
   - `company_settings`
     - `header_url` (text, nullable) — URL of the company header/letterhead image shown at the top of quotation page 1
     - `watermark_url` (text, nullable) — URL of the faint watermark image placed behind content on every quotation page
     - `stamp_url` (text, nullable) — URL of the authorized stamp/signature image placed on the final quotation page
2. Security
   - No new tables. Existing RLS policies on `company_settings` remain unchanged.
3. Notes
   - All three columns are nullable so the PDF generator can fall back to safe defaults when a URL is not yet configured.
   - These are read dynamically at PDF generation time, so updating the URL in Settings immediately affects future quotations.
*/

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS header_url text,
  ADD COLUMN IF NOT EXISTS watermark_url text,
  ADD COLUMN IF NOT EXISTS stamp_url text;
