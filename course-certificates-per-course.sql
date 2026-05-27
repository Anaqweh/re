-- INEXC — شهادات خاصة بكل دورة (course_certificates)
-- Supabase → SQL Editor → Run
-- يضيف أعمدة الشهادة داخل صف الدورة دون حذف البيانات الحالية

ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS certificate_name TEXT;
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS issuer_name TEXT DEFAULT '';
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS price NUMERIC DEFAULT 0;
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS included_in_course BOOLEAN DEFAULT FALSE;
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS is_optional_purchase BOOLEAN DEFAULT TRUE;
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ترحيل من الأعمدة القديمة / certificate_types
UPDATE public.course_certificates cc SET
  certificate_name = COALESCE(
    NULLIF(TRIM(cc.certificate_name), ''),
    NULLIF(TRIM(ct.certificate_name), ''),
    NULLIF(TRIM(ct.name), ''),
    NULLIF(TRIM(cc.certificate_type), ''),
    'شهادة'
  ),
  issuer_name = COALESCE(NULLIF(TRIM(cc.issuer_name), ''), NULLIF(TRIM(ct.issuer_name), ''), ''),
  description = COALESCE(
    NULLIF(TRIM(cc.description), ''),
    NULLIF(TRIM(ct.description), ''),
    NULLIF(TRIM(ct.short_description), ''),
    ''
  ),
  price = COALESCE(
    NULLIF(cc.price, 0),
    NULLIF(cc.price_override, 0),
    NULLIF(cc.certificate_price, 0),
    NULLIF(ct.price, 0),
    0
  ),
  certificate_price = COALESCE(
    NULLIF(cc.certificate_price, 0),
    NULLIF(cc.price, 0),
    NULLIF(cc.price_override, 0),
    0
  ),
  included_in_course = COALESCE(
    cc.included_in_course,
    cc.included_in_paid_course,
    FALSE
  ),
  is_optional_purchase = COALESCE(
    cc.is_optional_purchase,
    cc.allow_purchase_in_free_course,
    TRUE
  ),
  is_enabled = COALESCE(cc.is_enabled, cc.status = 'active', FALSE),
  show_to_student = COALESCE(cc.show_to_student, TRUE),
  updated_at = COALESCE(cc.updated_at, cc.created_at, NOW())
FROM public.certificate_types ct
WHERE cc.certificate_type_id = ct.id
  AND (cc.certificate_name IS NULL OR TRIM(cc.certificate_name) = '');

UPDATE public.course_certificates cc SET
  certificate_name = COALESCE(
    NULLIF(TRIM(cc.certificate_name), ''),
    NULLIF(TRIM(cc.certificate_type), ''),
    'شهادة'
  ),
  issuer_name = COALESCE(NULLIF(TRIM(cc.issuer_name), ''), ''),
  description = COALESCE(NULLIF(TRIM(cc.description), ''), ''),
  price = COALESCE(NULLIF(cc.price, 0), NULLIF(cc.price_override, 0), NULLIF(cc.certificate_price, 0), 0),
  certificate_price = COALESCE(NULLIF(cc.certificate_price, 0), NULLIF(cc.price, 0), 0),
  included_in_course = COALESCE(cc.included_in_course, cc.included_in_paid_course, FALSE),
  is_optional_purchase = COALESCE(cc.is_optional_purchase, cc.allow_purchase_in_free_course, TRUE),
  is_enabled = COALESCE(cc.is_enabled, cc.status = 'active', FALSE),
  show_to_student = COALESCE(cc.show_to_student, TRUE),
  updated_at = COALESCE(cc.updated_at, cc.created_at, NOW())
WHERE cc.certificate_name IS NULL OR TRIM(cc.certificate_name) = '';

ALTER TABLE public.course_certificates DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.course_certificates TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
