/*
  # Rename "PO Orders" page label to "Log Book Entries"

  Text-only rename for the Pages Management / Role-Page Assignment screens,
  which render `pages.label` directly (not through the app's i18n strings).
  The route (`/po-orders`), label_key (`poOrders`), and every other column
  are unchanged - this only updates the human-readable label shown to admins.
*/

UPDATE public.pages
SET label = 'Log Book Entries'
WHERE path = '/po-orders';
