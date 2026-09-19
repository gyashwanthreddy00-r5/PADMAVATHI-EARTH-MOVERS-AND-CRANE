-- Same singleton-row guarantee as company_settings (see the prior migration) applied
-- to the other 4 singleton settings tables that shared the identical vulnerable
-- pattern in Settings.tsx (unordered fetch + insert-if-no-local-id). No duplicates
-- were found in any of them at the time of this migration, but the application code
-- race that created one in company_settings could equally have hit these.
CREATE UNIQUE INDEX IF NOT EXISTS invoice_settings_singleton_idx ON invoice_settings ((true));
CREATE UNIQUE INDEX IF NOT EXISTS reminder_settings_singleton_idx ON reminder_settings ((true));
CREATE UNIQUE INDEX IF NOT EXISTS quotation_email_settings_singleton_idx ON quotation_email_settings ((true));
CREATE UNIQUE INDEX IF NOT EXISTS quotation_format_settings_singleton_idx ON quotation_format_settings ((true));
