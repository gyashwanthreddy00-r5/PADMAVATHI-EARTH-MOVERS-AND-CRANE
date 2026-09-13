/*
  # Add Remarks to PO Order items

  Purely descriptive, optional per-line text (e.g. "MEDCHAL WORK", "NIGHT SHIFT")
  shown alongside a PO item on view/print/export - never used in any taxable/CGST/
  SGST/total or PO balance/utilization calculation.
*/

ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS remarks text;
