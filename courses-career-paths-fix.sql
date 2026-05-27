-- INEXC — إضافة عمود career_paths لجدول courses
-- Supabase → SQL Editor → Run

ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS career_paths JSONB DEFAULT NULL;

NOTIFY pgrst, 'reload schema';
