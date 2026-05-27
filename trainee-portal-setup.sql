-- =============================================
-- INEXC — نظام حسابات المتدربين المتقدم
-- Supabase → SQL Editor → Run
-- فعّل Email Auth من: Authentication → Providers → Email
-- =============================================

-- ─── ملف المتدرب ───
CREATE TABLE IF NOT EXISTS public.trainee_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  country TEXT DEFAULT '',
  specialty TEXT DEFAULT '',
  avatar_url TEXT DEFAULT '',
  loyalty_points INTEGER DEFAULT 0,
  membership_tier TEXT DEFAULT 'bronze',
  interests JSONB DEFAULT '[]'::jsonb,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.trainee_profiles DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.trainee_profiles TO anon, authenticated, service_role;

-- ─── تقدم المتدرب في الدورات ───
CREATE TABLE IF NOT EXISTS public.trainee_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainee_id UUID REFERENCES public.trainee_profiles(id) ON DELETE CASCADE,
  registration_id BIGINT,
  course_name TEXT NOT NULL,
  course_id UUID,
  status TEXT DEFAULT 'active',
  progress_percent INTEGER DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
  last_activity_at TIMESTAMPTZ,
  last_activity_label TEXT DEFAULT '',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enrollments_trainee ON public.trainee_enrollments(trainee_id);
ALTER TABLE public.trainee_enrollments DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.trainee_enrollments TO anon, authenticated, service_role;

-- ─── الشارات والإنجازات ───
CREATE TABLE IF NOT EXISTS public.trainee_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainee_id UUID REFERENCES public.trainee_profiles(id) ON DELETE CASCADE,
  badge_key TEXT NOT NULL,
  badge_name TEXT NOT NULL,
  badge_icon TEXT DEFAULT '🏅',
  earned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(trainee_id, badge_key)
);

ALTER TABLE public.trainee_badges DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.trainee_badges TO anon, authenticated, service_role;

-- ─── الكوبونات ───
CREATE TABLE IF NOT EXISTS public.coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  title TEXT DEFAULT '',
  discount_percent NUMERIC DEFAULT 5 CHECK (discount_percent > 0 AND discount_percent <= 25),
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

-- ─── استخدام الكوبونات ───
CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id UUID REFERENCES public.coupons(id) ON DELETE CASCADE,
  trainee_id UUID REFERENCES public.trainee_profiles(id) ON DELETE SET NULL,
  registration_id BIGINT,
  email TEXT,
  redeemed_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.coupon_redemptions DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.coupon_redemptions TO anon, authenticated, service_role;

-- ─── إشعارات المتدرب ───
CREATE TABLE IF NOT EXISTS public.trainee_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainee_id UUID REFERENCES public.trainee_profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  type TEXT DEFAULT 'info',
  read BOOLEAN DEFAULT FALSE,
  action_url TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.trainee_notifications DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.trainee_notifications TO anon, authenticated, service_role;

-- ─── مسارات تعليمية ───
CREATE TABLE IF NOT EXISTS public.learning_paths (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  course_names JSONB NOT NULL DEFAULT '[]'::jsonb,
  bundle_discount_percent NUMERIC DEFAULT 8,
  status TEXT DEFAULT 'active',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.learning_paths DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.learning_paths TO anon, authenticated, service_role;

-- ─── ربط التسجيلات بالحساب ───
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS trainee_profile_id UUID;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS progress_percent INTEGER DEFAULT 0;

-- ─── كوبونات افتراضية ───
INSERT INTO public.coupons (code, title, discount_percent, max_uses, min_purchase, min_tier, expires_at)
SELECT * FROM (VALUES
  ('INEXC5', 'خصم ترحيبي للمتدربين الجدد', 5, 500, 300, 'bronze', NOW() + INTERVAL '365 days'),
  ('LOYAL10', 'مكافأة الولاء — Silver فأعلى', 10, 200, 500, 'silver', NOW() + INTERVAL '180 days'),
  ('VIP12', 'عرض VIP حصري', 12, 50, 800, 'gold', NOW() + INTERVAL '90 days')
) AS v(code, title, discount_percent, max_uses, min_purchase, min_tier, expires_at)
WHERE NOT EXISTS (SELECT 1 FROM public.coupons WHERE code = 'INEXC5');

-- ─── مسارات افتراضية ───
INSERT INTO public.learning_paths (name, description, course_names, bundle_discount_percent, sort_order)
SELECT * FROM (VALUES
  ('مسار الذكاء الاصطناعي التعليمي', 'من الأساسيات إلى التخصص المتقدم', '["الذكاء الاصطناعي في التعليم","هندسة الأوامر Prompt Engineering","بناء المناهج الذكية"]'::jsonb, 8, 1),
  ('مسار المدرب المحترف', 'تأهيل شامل للمدربين الرقميين', '["تدريب المدربين AI TOT","صناعة المحتوى الرقمي","بناء الشات بوتات التعليمية"]'::jsonb, 10, 2)
) AS v(name, description, course_names, bundle_discount_percent, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.learning_paths LIMIT 1);

NOTIFY pgrst, 'reload schema';
