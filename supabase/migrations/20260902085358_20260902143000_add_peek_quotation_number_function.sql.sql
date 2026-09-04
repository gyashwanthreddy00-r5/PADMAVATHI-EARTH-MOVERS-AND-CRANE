/*
# Add non-consuming quotation number preview

1. New function
- `peek_next_quotation_number(text)` returns the next global quotation number without incrementing the counter.

2. Purpose
- Opening the Add Quotation form can display an auto-generated number without reserving it.
- The existing `next_quotation_number` function remains the only function that increments the global counter.

3. Security
- The function is SECURITY DEFINER and is callable by the existing frontend roles.
- It only reads the quotation counter and does not modify quotation or billing data.
*/

CREATE OR REPLACE FUNCTION public.peek_next_quotation_number(p_quote_date text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num integer;
  parsed_date date;
  raw_date text;
BEGIN
  raw_date := COALESCE(p_quote_date, to_char(now()::date, 'DD-MM-YYYY'));
  BEGIN
    parsed_date := to_date(raw_date, 'DD-MM-YYYY');
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      parsed_date := to_date(raw_date, 'YYYY-MM-DD');
    EXCEPTION WHEN OTHERS THEN
      parsed_date := now()::date;
    END;
  END;

  SELECT COALESCE(last_number, 0) + 1 INTO next_num
  FROM public.quotation_counter
  WHERE id = 1;

  next_num := COALESCE(next_num, 1);
  RETURN 'QUO/' || to_char(parsed_date, 'DD-MM-YYYY') || '/' || lpad(next_num::text, 3, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.peek_next_quotation_number(text) TO anon, authenticated;