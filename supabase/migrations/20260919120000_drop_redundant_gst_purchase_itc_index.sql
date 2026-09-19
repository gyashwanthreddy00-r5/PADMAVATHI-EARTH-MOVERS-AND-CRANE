-- idx_gst_purchase_itc_purchase_id duplicates the primary key index on purchase_id
-- (gst_purchase_itc_pkey already covers the same column). Postgres auto-indexes
-- primary keys, so this extra index is pure redundant write/storage overhead.
DROP INDEX IF EXISTS idx_gst_purchase_itc_purchase_id;
