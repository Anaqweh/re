-- =============================================
-- INEXC — ترقية نظام الشهادات (مجاني vs مدفوع)
-- Supabase → SQL Editor → Run
-- لا يحذف البيانات الحالية — يطوّر الجداول الموجودة
-- =============================================

-- ─── 1) جدول أنواع الشهادات certificate_types ───
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS key TEXT;
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS certificate_name TEXT;
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS issuer_name TEXT;
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS price NUMERIC DEFAULT 0;
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS short_description TEXT;
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS default_price NUMERIC DEFAULT 0;
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- مزامنة الأعمدة القديمة مع الجديدة
UPDATE public.certificate_types SET
  certificate_name = COALESCE(NULLIF(TRIM(certificate_name), ''), NULLIF(TRIM(name), ''), NULLIF(TRIM(certificate_type), '')),
  name = COALESCE(NULLIF(TRIM(name), ''), NULLIF(TRIM(certificate_name), ''), NULLIF(TRIM(certificate_type), '')),
  description = COALESCE(NULLIF(TRIM(description), ''), NULLIF(TRIM(short_description), '')),
  short_description = COALESCE(NULLIF(TRIM(short_description), ''), NULLIF(TRIM(description), '')),
  price = COALESCE(NULLIF(price, 0), NULLIF(default_price, 0), 0),
  default_price = COALESCE(NULLIF(default_price, 0), NULLIF(price, 0), 0),
  is_active = COALESCE(is_active, status = 'active', TRUE),
  status = CASE WHEN COALESCE(is_active, status = 'active', TRUE) THEN 'active' ELSE 'inactive' END
WHERE certificate_name IS NULL OR name IS NULL OR description IS NULL OR price IS NULL OR is_active IS NULL;

-- ─── 2) جدول ربط الشهادات بالدورات course_certificates ───
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS certificate_type_id UUID;
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS show_to_student BOOLEAN DEFAULT TRUE;
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS included_in_paid_course BOOLEAN DEFAULT TRUE;
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS allow_purchase_in_free_course BOOLEAN DEFAULT TRUE;
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS price_override NUMERIC;
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS course_id UUID;
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS course_name TEXT;
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS certificate_type TEXT;
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS certificate_price NUMERIC DEFAULT 0;
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- ربط certificate_type_id من الاسم/المفتاح القديم
UPDATE public.course_certificates cc
SET certificate_type_id = ct.id
FROM public.certificate_types ct
WHERE cc.certificate_type_id IS NULL
  AND (
    TRIM(cc.certificate_type) = TRIM(ct.key)
    OR TRIM(cc.certificate_type) = TRIM(ct.certificate_type)
    OR TRIM(cc.certificate_type) = TRIM(ct.certificate_name)
    OR TRIM(cc.certificate_type) = TRIM(ct.name)
  );

-- ترحيل الإعدادات من status/certificate_price القديم
UPDATE public.course_certificates SET
  is_enabled = COALESCE(is_enabled, status = 'active', FALSE),
  show_to_student = COALESCE(show_to_student, TRUE),
  included_in_paid_course = COALESCE(included_in_paid_course, TRUE),
  allow_purchase_in_free_course = COALESCE(allow_purchase_in_free_course, TRUE),
  price_override = COALESCE(price_override, NULLIF(certificate_price, 0)),
  certificate_price = COALESCE(certificate_price, price_override, 0)
WHERE is_enabled IS NULL OR show_to_student IS NULL;

-- ─── 3) أنواع افتراضية إن لم توجد ───
INSERT INTO public.certificate_types (key, certificate_name, name, certificate_type, issuer_name, description, price, default_price, is_active, status)
SELECT * FROM (VALUES
  ('ediola', 'شهادة صادرة من منصة Eduella', 'شهادة صادرة من منصة Eduella', 'شهادة Eduella', 'منصة Eduella', 'شهادة معتمدة صادرة من منصة Eduella', 0, 0, TRUE, 'active'),
  ('inexc', 'شهادة صادرة من شركة INEXC', 'شهادة صادرة من شركة INEXC', 'شهادة INEXC', 'شركة INEXC', 'شهادة صادرة من شركة التميز الابتكاري', 0, 0, TRUE, 'active'),
  ('american_board', 'شهادة صادرة من البورد الأمريكي', 'شهادة صادرة من البورد الأمريكي', 'البورد الأمريكي', 'البورد الأمريكي', 'شهادة دولية من البورد الأمريكي', 0, 0, TRUE, 'active'),
  ('uae_university', 'شهادة صادرة من جامعة إماراتية', 'شهادة صادرة من جامعة إماراتية', 'جامعة إماراتية', 'إحدى الجامعات الإماراتية', 'شهادة أكاديمية معتمدة', 300, 300, TRUE, 'active'),
  ('attendance', 'شهادة حضور', 'شهادة حضور', 'شهادة حضور', 'INEXC', 'شهادة تثبت حضور البرنامج التدريبي', 0, 0, TRUE, 'active'),
  ('professional_diploma', 'شهادة دبلوم مهني', 'شهادة دبلوم مهني', 'دبلوم مهني', 'INEXC', 'شهادة دبلوم مهني معتمد', 0, 0, TRUE, 'active')
) AS v(key, certificate_name, name, certificate_type, issuer_name, description, price, default_price, is_active, status)
WHERE NOT EXISTS (SELECT 1 FROM public.certificate_types WHERE key = v.key);

-- ─── 4) صلاحيات ───
ALTER TABLE public.certificate_types DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_certificates DISABLE ROW LEVEL SECURITY;

GRANT ALL ON public.certificate_types TO anon, authenticated, service_role;
GRANT ALL ON public.course_certificates TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
