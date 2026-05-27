-- =============================================
-- INEXC — ربط البيانات غير المربوطة في Supabase
-- Supabase → SQL Editor → Run
-- المشروع: mhrrktcrbpvaxqltdtgo
-- =============================================

-- ─── 1) أعمدة الربط الناقصة ───
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS course_id UUID;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS trainee_profile_id UUID;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS admin_hidden BOOLEAN DEFAULT FALSE;

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS registration_id BIGINT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS course_id UUID;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS course_name TEXT;

ALTER TABLE public.trainee_messages ADD COLUMN IF NOT EXISTS registration_id BIGINT;

-- ─── 2) جدول enrollments إن لم يكن موجوداً ───
CREATE TABLE IF NOT EXISTS public.trainee_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainee_id UUID REFERENCES public.trainee_profiles(id) ON DELETE CASCADE,
  registration_id BIGINT,
  course_name TEXT NOT NULL,
  course_id UUID,
  status TEXT DEFAULT 'active',
  progress_percent INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enrollments_trainee ON public.trainee_enrollments(trainee_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_registration ON public.trainee_enrollments(registration_id);
ALTER TABLE public.trainee_enrollments DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.trainee_enrollments TO anon, authenticated, service_role;

-- ─── 3) ربط التسجيلات → الدورات (بالاسم) ───
UPDATE public.registrations r
SET course_id = c.id
FROM (
  SELECT DISTINCT ON (name) id, name
  FROM public.courses
  WHERE status IS DISTINCT FROM 'inactive'
  ORDER BY name, created_at DESC
) c
WHERE r.course_id IS NULL
  AND TRIM(r.course_name) = TRIM(c.name);

-- ─── 4) ربط التسجيلات → ملفات المتدرب (بالبريد) ───
UPDATE public.registrations r
SET trainee_profile_id = p.id
FROM public.trainee_profiles p
WHERE r.trainee_profile_id IS NULL
  AND LOWER(TRIM(r.email)) = LOWER(TRIM(p.email));

-- ─── 5) ربط المدفوعات → الدورات ───
UPDATE public.payments pay
SET course_id = c.id
FROM (
  SELECT DISTINCT ON (name) id, name
  FROM public.courses
  ORDER BY name, created_at DESC
) c
WHERE pay.course_id IS NULL
  AND TRIM(pay.course_name) = TRIM(c.name);

-- ─── 6) ربط المدفوعات → التسجيلات (بريد + دورة) ───
UPDATE public.payments pay
SET registration_id = r.id
FROM public.registrations r
WHERE (pay.registration_id IS NULL OR pay.registration_id NOT IN (SELECT id FROM public.registrations))
  AND LOWER(TRIM(COALESCE(pay.trainee_email, ''))) = LOWER(TRIM(r.email))
  AND TRIM(COALESCE(pay.course_name, '')) = TRIM(r.course_name);

-- محاولة ثانية: بالبريد فقط إذا لم يُربط
UPDATE public.payments pay
SET registration_id = r.id
FROM public.registrations r
WHERE pay.registration_id IS NULL
  AND LOWER(TRIM(COALESCE(pay.trainee_email, ''))) = LOWER(TRIM(r.email))
  AND r.id = (
    SELECT r2.id FROM public.registrations r2
    WHERE LOWER(TRIM(r2.email)) = LOWER(TRIM(r.email))
    ORDER BY r2.created_at DESC
    LIMIT 1
  );

-- ─── 7) ربط المدفوعات → ملف المتدرب ───
UPDATE public.payments pay
SET trainee_id = p.id
FROM public.trainee_profiles p
WHERE pay.trainee_id IS NULL
  AND LOWER(TRIM(COALESCE(pay.trainee_email, ''))) = LOWER(TRIM(p.email));

-- ─── 8) ربط رسائل المتدرب → التسجيلات ───
UPDATE public.trainee_messages tm
SET registration_id = r.id
FROM public.registrations r
WHERE tm.registration_id IS NULL
  AND LOWER(TRIM(tm.trainee_email)) = LOWER(TRIM(r.email))
  AND (
    tm.course_name IS NULL
    OR TRIM(tm.course_name) IN ('—', '-', '')
    OR TRIM(tm.course_name) = TRIM(r.course_name)
  );

-- ─── 9) إنشاء enrollments من التسجيلات المربوطة ───
INSERT INTO public.trainee_enrollments (trainee_id, registration_id, course_name, course_id, status, progress_percent)
SELECT
  r.trainee_profile_id,
  r.id,
  r.course_name,
  r.course_id,
  CASE WHEN r.status = 'active' THEN 'active' ELSE 'pending' END,
  COALESCE(r.progress_percent, 0)
FROM public.registrations r
WHERE r.trainee_profile_id IS NOT NULL
  AND r.admin_hidden IS DISTINCT FROM TRUE
  AND NOT EXISTS (
    SELECT 1 FROM public.trainee_enrollments e
    WHERE e.registration_id = r.id
  );

-- ─── 10) صلاحيات ───
ALTER TABLE public.registrations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainee_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainee_profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainee_enrollments DISABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.registrations TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainee_messages TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainee_profiles TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainee_enrollments TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ─── تحقق سريع ───
-- SELECT 'registrations' AS tbl, COUNT(*) FILTER (WHERE course_id IS NOT NULL) AS linked, COUNT(*) AS total FROM registrations
-- UNION ALL
-- SELECT 'payments', COUNT(*) FILTER (WHERE registration_id IS NOT NULL), COUNT(*) FROM payments
-- UNION ALL
-- SELECT 'trainee_messages', COUNT(*) FILTER (WHERE registration_id IS NOT NULL), COUNT(*) FROM trainee_messages;
