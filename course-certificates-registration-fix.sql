-- INEXC — إصلاح ظهور وحفظ شهادات الدورة في التسجيل
-- Supabase Dashboard → SQL Editor → Run
--
-- الهدف:
-- 1) تجهيز جدول course_certificates ليقبل الحفظ من لوحة التحكم.
-- 2) دعم الأعمدة القديمة والجديدة معًا حتى تظهر الشهادات في register.html.
-- 3) ربط شهادة الدورة بنوع الشهادة من certificate_types عند توفره.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.course_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID,
  course_name TEXT DEFAULT '',
  certificate_type TEXT DEFAULT '',
  certificate_price NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.certificate_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT,
  certificate_name TEXT,
  name TEXT,
  certificate_type TEXT,
  issuer_name TEXT DEFAULT '',
  description TEXT DEFAULT '',
  short_description TEXT DEFAULT '',
  price NUMERIC DEFAULT 0,
  default_price NUMERIC DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS key TEXT;
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS certificate_name TEXT;
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS certificate_type TEXT;
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS issuer_name TEXT DEFAULT '';
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS short_description TEXT DEFAULT '';
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS price NUMERIC DEFAULT 0;
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS default_price NUMERIC DEFAULT 0;
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS course_id UUID;
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS course_name TEXT DEFAULT '';
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS certificate_type_id UUID;
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS certificate_type TEXT DEFAULT '';
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS certificate_name TEXT;
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS issuer_name TEXT DEFAULT '';
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS price NUMERIC DEFAULT 0;
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS certificate_price NUMERIC DEFAULT 0;
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS price_override NUMERIC;
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS show_to_student BOOLEAN DEFAULT TRUE;
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS included_in_course BOOLEAN DEFAULT FALSE;
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS included_in_paid_course BOOLEAN DEFAULT FALSE;
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS is_optional_purchase BOOLEAN DEFAULT TRUE;
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS allow_purchase_in_free_course BOOLEAN DEFAULT TRUE;
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- تعبئة اسم الدورة للصفوف القديمة إن كان course_id مربوطًا بجدول courses.
UPDATE public.course_certificates cc
SET course_name = COALESCE(NULLIF(TRIM(cc.course_name), ''), c.name, '')
FROM public.courses c
WHERE cc.course_id = c.id
  AND (cc.course_name IS NULL OR TRIM(cc.course_name) = '');

-- ربط الشهادات القديمة بأنواع الشهادات إذا كان النوع محفوظًا كنص.
UPDATE public.course_certificates cc
SET certificate_type_id = ct.id
FROM public.certificate_types ct
WHERE cc.certificate_type_id IS NULL
  AND (
    TRIM(COALESCE(cc.certificate_type, '')) = TRIM(COALESCE(ct.key, ''))
    OR TRIM(COALESCE(cc.certificate_type, '')) = TRIM(COALESCE(ct.certificate_type, ''))
    OR TRIM(COALESCE(cc.certificate_type, '')) = TRIM(COALESCE(ct.certificate_name, ''))
    OR TRIM(COALESCE(cc.certificate_type, '')) = TRIM(COALESCE(ct.name, ''))
  );

-- نسخ بيانات نوع الشهادة إلى شهادة الدورة عند نقص الاسم/الجهة/السعر.
UPDATE public.course_certificates cc
SET
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
    NULLIF(ct.default_price, 0),
    0
  ),
  certificate_price = COALESCE(
    NULLIF(cc.certificate_price, 0),
    NULLIF(cc.price, 0),
    NULLIF(cc.price_override, 0),
    NULLIF(ct.price, 0),
    NULLIF(ct.default_price, 0),
    0
  ),
  updated_at = NOW()
FROM public.certificate_types ct
WHERE cc.certificate_type_id = ct.id;

-- قيم افتراضية آمنة لما تبقى من الصفوف.
UPDATE public.course_certificates
SET
  course_name = COALESCE(NULLIF(TRIM(course_name), ''), ''),
  certificate_type = COALESCE(NULLIF(TRIM(certificate_type), ''), NULLIF(TRIM(certificate_name), ''), 'certificate'),
  certificate_name = COALESCE(NULLIF(TRIM(certificate_name), ''), NULLIF(TRIM(certificate_type), ''), 'شهادة'),
  issuer_name = COALESCE(NULLIF(TRIM(issuer_name), ''), ''),
  description = COALESCE(NULLIF(TRIM(description), ''), ''),
  price = COALESCE(NULLIF(price, 0), NULLIF(price_override, 0), NULLIF(certificate_price, 0), 0),
  certificate_price = COALESCE(NULLIF(certificate_price, 0), NULLIF(price, 0), NULLIF(price_override, 0), 0),
  is_enabled = COALESCE(is_enabled, status = 'active', TRUE),
  show_to_student = COALESCE(show_to_student, TRUE),
  included_in_course = COALESCE(included_in_course, included_in_paid_course, FALSE),
  included_in_paid_course = COALESCE(included_in_paid_course, included_in_course, FALSE),
  is_optional_purchase = COALESCE(is_optional_purchase, allow_purchase_in_free_course, TRUE),
  allow_purchase_in_free_course = COALESCE(allow_purchase_in_free_course, is_optional_purchase, TRUE),
  status = COALESCE(NULLIF(TRIM(status), ''), CASE WHEN is_enabled IS FALSE THEN 'inactive' ELSE 'active' END),
  updated_at = NOW();

CREATE INDEX IF NOT EXISTS idx_course_certificates_course_id ON public.course_certificates(course_id);
CREATE INDEX IF NOT EXISTS idx_course_certificates_type_id ON public.course_certificates(certificate_type_id);

ALTER TABLE public.course_certificates DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificate_types DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.course_certificates TO anon, authenticated, service_role;
GRANT ALL ON public.certificate_types TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
