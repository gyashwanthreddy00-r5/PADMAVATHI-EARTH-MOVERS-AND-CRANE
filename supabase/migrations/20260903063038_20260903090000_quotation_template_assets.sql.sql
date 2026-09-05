/* Quotation assets are stored privately; company_settings keeps storage object paths, not URLs. */
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS signature_path text,
  ADD COLUMN IF NOT EXISTS stamp_path text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('quotation-assets', 'quotation-assets', false, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp']::text[])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']::text[];

CREATE POLICY "quotation_assets_select_authenticated" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'quotation-assets' AND (storage.foldername(name))[1] = 'company');

CREATE POLICY "quotation_assets_insert_authenticated" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'quotation-assets' AND (storage.foldername(name))[1] = 'company');

CREATE POLICY "quotation_assets_update_authenticated" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'quotation-assets' AND (storage.foldername(name))[1] = 'company')
  WITH CHECK (bucket_id = 'quotation-assets' AND (storage.foldername(name))[1] = 'company');

CREATE POLICY "quotation_assets_delete_authenticated" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'quotation-assets' AND (storage.foldername(name))[1] = 'company');