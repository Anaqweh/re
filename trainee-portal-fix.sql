-- =============================================
-- INEXC — إصلاح جدول trainee_profiles والجداول الناقصة
-- Supabase → SQL Editor → Run (مرة واحدة)
-- =============================================

-- إنشاء الجدول كاملاً إن لم يكن موجوداً
CREATE TABLE IF NOT EXISTS public.trainee_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  full_name TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  country TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- إضافة الأعمدة الناقصة (يصلح خطأ auth_user_id does not exist)
ALTER TABLE public.trainee_profiles ADD COLUMN IF NOT EXISTS auth_user_id UUID;
ALTER TABLE public.trainee_profiles ADD COLUMN IF NOT EXISTS specialty TEXT DEFAULT '';
ALTER TABLE public.trainee_profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT '';
ALTER TABLE public.trainee_profiles ADD COLUMN IF NOT EXISTS loyalty_points INTEGER DEFAULT 0;
ALTER TABLE public.trainee_profiles ADD COLUMN IF NOT EXISTS membership_tier TEXT DEFAULT 'bronze';
ALTER TABLE public.trainee_profiles ADD COLUMN IF NOT EXISTS interests JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.trainee_profiles ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE public.trainee_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS career_paths JSONB DEFAULT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_trainee_profiles_auth_user
  ON public.trainee_profiles(auth_user_id) WHERE auth_user_id IS NOT NULL;

ALTER TABLE public.trainee_profiles DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.trainee_profiles TO anon, authenticated, service_role;

-- باقي الجداول (إن نُفّذ trainee-portal-setup.sql جزئياً)
CREATE TABLE IF NOT EXISTS public.trainee_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainee_id UUID,
  registration_id BIGINT,
  course_name TEXT NOT NULL,
  course_id UUID,
  status TEXT DEFAULT 'active',
  progress_percent INTEGER DEFAULT 0,
  last_activity_at TIMESTAMPTZ,
  last_activity_label TEXT DEFAULT '',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.trainee_enrollments DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.trainee_enrollments TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.trainee_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainee_id UUID,
  badge_key TEXT NOT NULL,
  badge_name TEXT NOT NULL,
  badge_icon TEXT DEFAULT '🏅',
  earned_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.trainee_badges DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.trainee_badges TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  title TEXT DEFAULT '',
  discount_percent NUMERIC DEFAULT 5,
  max_uses INTEGER DEFAULT 100,
  used_count INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ,
  min_purchase NUMERIC DEFAULT 0,
  allowed_courses JSONB,
  active_members_only BOOLEAN DEFAULT FALSE,
  min_tier TEXT DEFAULT 'bronze',
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.coupons DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.coupons TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
