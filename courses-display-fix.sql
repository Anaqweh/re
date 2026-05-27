-- INEXC — أعمدة تفاصيل الدورة (لظهورها في «مزيد من المعلومات» بالصفحة الرئيسية)
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS objectives TEXT DEFAULT '';
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS outcomes TEXT DEFAULT '';
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS what_you_learn TEXT DEFAULT '';
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS learn_content TEXT DEFAULT '';
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS course_method TEXT DEFAULT '';
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS delivery_method TEXT DEFAULT '';
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS target_audience TEXT DEFAULT '';
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS requirements TEXT DEFAULT '';

NOTIFY pgrst, 'reload schema';
