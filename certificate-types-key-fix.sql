-- INEXC — إصلاح سريع: أعمدة certificate_types الناقصة
-- Supabase → SQL Editor → Run
-- يحل خطأ: Could not find the 'key' column of 'certificate_types'

ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS key TEXT;
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS certificate_name TEXT;
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS issuer_name TEXT;
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS price NUMERIC DEFAULT 0;
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS default_price NUMERIC DEFAULT 0;

UPDATE public.certificate_types SET
  key = COALESCE(NULLIF(TRIM(key), ''), 'cert_' || SUBSTRING(REPLACE(id::text, '-', ''), 1, 12)),
  certificate_name = COALESCE(NULLIF(TRIM(certificate_name), ''), NULLIF(TRIM(name), ''), NULLIF(TRIM(certificate_type), '')),
  name = COALESCE(NULLIF(TRIM(name), ''), NULLIF(TRIM(certificate_name), ''), NULLIF(TRIM(certificate_type), '')),
  is_active = COALESCE(is_active, status = 'active', TRUE)
WHERE key IS NULL OR certificate_name IS NULL OR name IS NULL OR is_active IS NULL;

GRANT ALL ON public.certificate_types TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
