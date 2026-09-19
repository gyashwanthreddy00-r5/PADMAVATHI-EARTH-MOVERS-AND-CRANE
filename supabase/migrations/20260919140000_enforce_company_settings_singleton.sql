-- company_settings is designed to hold exactly one row (see Settings.tsx comments),
-- but nothing enforced that at the database level. A client-side race between the
-- initial load and a save could INSERT a second row instead of UPDATE-ing the first;
-- once two rows existed, the unordered `.limit(1)` fetch used throughout the app
-- returned whichever one Postgres felt like on a given query, making edits appear to
-- randomly "revert". The application code path that could cause this has been fixed
-- separately - this is a belt-and-suspenders guarantee that a second row can never be
-- inserted again by any code path, present or future.
CREATE UNIQUE INDEX IF NOT EXISTS company_settings_singleton_idx ON company_settings ((true));
