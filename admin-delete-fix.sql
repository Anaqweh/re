-- INEXC — تفعيل الحذف النهائي للمتدربين من لوحة الإدارة
-- Supabase → SQL Editor → Run

ALTER TABLE public.registrations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainee_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificates DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainee_enrollments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_redemptions DISABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.registrations TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainee_messages TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.certificates TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainee_enrollments TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coupon_redemptions TO anon, authenticated, service_role;

-- تأكد من وجود عمود الإخفاء
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS admin_hidden BOOLEAN DEFAULT FALSE;

NOTIFY pgrst, 'reload schema';
