/*
  # One salary payment per employee per month

  ## Why
  Prevent an employee from being paid twice for the same month, whether
  through the UI or any other route that writes to `salary_payments`
  directly. `salary_month` (e.g. "September 2026") is generated
  consistently from `payment_date` by the frontend (`salaryMonthFor()`),
  so it's a reliable month+year key without needing a separate
  year/month-number column.

  ## Constraint
  Partial unique index on (employee_id, salary_month), excluding cancelled
  (soft-reversed) rows - a cancelled payment must not block a real one for
  the same employee/month, matching the soft-delete pattern used
  everywhere else in this schema. NULL employee_id (possible via the
  table's ON DELETE SET NULL) is excluded too, since an orphaned payment
  with no employee can't conflict with anything.

  ## Safety
  No data is deleted or modified - this only adds a constraint. If any
  existing rows already violate it (duplicate active employee+month pairs),
  the migration will fail loudly rather than silently dropping data, so
  it can be resolved manually before re-running.
*/

CREATE UNIQUE INDEX IF NOT EXISTS ux_salary_payments_employee_month
  ON public.salary_payments (employee_id, salary_month)
  WHERE is_cancelled = false AND employee_id IS NOT NULL;
