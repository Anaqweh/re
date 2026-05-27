-- =============================================
-- INEXC — إعداد Supabase الكامل
-- Supabase → SQL Editor → الصق الكل → Run
-- =============================================

-- ─── 1) جدول التسجيلات (registrations) ───
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS registration_type TEXT;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS admin_read BOOLEAN DEFAULT FALSE;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS admin_hidden BOOLEAN DEFAULT FALSE;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS course_id UUID;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS trainee_profile_id UUID;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS access_token TEXT UNIQUE;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS specialty TEXT;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS wants_certificate BOOLEAN DEFAULT false;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS certificate_type TEXT;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS certificate_price NUMERIC DEFAULT 0;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS certificate_types JSONB;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS certificate_payment_status TEXT DEFAULT 'not_required';

ALTER TABLE public.registrations DISABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON public.registrations TO anon, authenticated, service_role;
GRANT DELETE ON public.registrations TO anon, authenticated, service_role;
GRANT ALL ON SEQUENCE registrations_id_seq TO anon, authenticated, service_role;

-- ─── 2) جدول الدورات (courses) ───
CREATE TABLE IF NOT EXISTS public.courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price NUMERIC DEFAULT 0,
  type TEXT DEFAULT 'paid',
  hours TEXT DEFAULT '20 ساعة',
  level TEXT DEFAULT 'متوسط',
  cert TEXT DEFAULT 'شهادة INEXC',
  days INTEGER DEFAULT 20,
  sort_order INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  objectives TEXT DEFAULT '',
  outcomes TEXT DEFAULT '',
  what_you_learn TEXT DEFAULT '',
  course_method TEXT DEFAULT '',
  target_audience TEXT DEFAULT '',
  requirements TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- إصلاح جدول courses إن وُجد مسبقاً بأعمدة ناقصة
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS price NUMERIC DEFAULT 0;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'paid';
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS career_paths JSONB DEFAULT NULL;

ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS level TEXT DEFAULT 'متوسط';
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS cert TEXT DEFAULT 'شهادة INEXC';
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS days INTEGER DEFAULT 20;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS objectives TEXT DEFAULT '';
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS outcomes TEXT DEFAULT '';
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS what_you_learn TEXT DEFAULT '';
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS course_method TEXT DEFAULT '';
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS learn_content TEXT DEFAULT '';
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS delivery_method TEXT DEFAULT '';
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS target_audience TEXT DEFAULT '';
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS requirements TEXT DEFAULT '';
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.courses DISABLE ROW LEVEL SECURITY;

GRANT ALL ON public.courses TO anon, authenticated, service_role;

-- ─── 3) خيارات الشهادات للدورات المجانية (course_certificates) ───
CREATE TABLE IF NOT EXISTS public.course_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID,
  course_name TEXT NOT NULL,
  certificate_type TEXT NOT NULL,
  certificate_price NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS course_name TEXT;
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS certificate_type TEXT;
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS certificate_price NUMERIC DEFAULT 0;
ALTER TABLE public.course_certificates ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';

ALTER TABLE public.course_certificates DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.course_certificates TO anon, authenticated, service_role;

-- ─── 3b) أنواع الشهادات (certificate_types) ───
CREATE TABLE IF NOT EXISTS public.certificate_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE,
  certificate_type TEXT,
  name TEXT NOT NULL,
  subtitle TEXT DEFAULT '',
  short_description TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS certificate_type TEXT;
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS key TEXT;
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS subtitle TEXT DEFAULT '';
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS short_description TEXT DEFAULT '';
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE public.certificate_types ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.certificate_types DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.certificate_types TO anon, authenticated, service_role;

INSERT INTO public.certificate_types (key, name, subtitle, status)
SELECT * FROM (VALUES
  ('attendance', 'شهادة حضور', 'شهادة تثبت حضور البرنامج التدريبي', 'active'),
  ('uae_university', 'شهادة صادرة من إحدى الجامعات الإماراتية', 'شهادة أكاديمية معتمدة حسب الدورة', 'active'),
  ('american_board', 'شهادة من البورد الأمريكي', 'شهادة دولية مرتبطة بالبورد الأمريكي', 'active'),
  ('inexc', 'شهادة من شركة التميز الابتكاري', 'شهادة صادرة من INEXC', 'active'),
  ('ediola', 'شهادة من منصة إديولا', 'شهادة صادرة من منصة Eduella', 'active'),
  ('trainer_card', 'بطاقة مدرب معتمد', 'بطاقة اعتماد احترافية للمدربين', 'active')
) AS v(key, name, subtitle, status)
WHERE NOT EXISTS (SELECT 1 FROM public.certificate_types LIMIT 1);

-- ─── 4) جدول المدفوعات (payments) ───
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id BIGINT,
  full_name TEXT,
  course_name TEXT,
  amount NUMERIC DEFAULT 0,
  currency TEXT DEFAULT 'aed',
  payment_method TEXT DEFAULT 'Stripe',
  status TEXT DEFAULT 'pending',
  stripe_session_id TEXT,
  receipt_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.payments DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.payments TO anon, authenticated, service_role;
GRANT DELETE ON public.payments TO anon, authenticated, service_role;

-- إصلاح جدول payments إن وُجد مسبقاً بأعمدة ناقصة
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS registration_id BIGINT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS course_name TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS amount NUMERIC DEFAULT 0;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'aed';
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'Stripe';
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS receipt_url TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- ─── 5) جدول الرسائل (messages) ───
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_name TEXT,
  sender_email TEXT,
  subject TEXT,
  body TEXT,
  read BOOLEAN DEFAULT FALSE,
  hidden BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.messages DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.messages TO anon, authenticated, service_role;

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS sender_phone TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS organization_name TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS partnership_type TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS source TEXT;

-- ─── 5b) رسائل المتدربين (trainee_messages) ───
CREATE TABLE IF NOT EXISTS public.trainee_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id BIGINT,
  trainee_name TEXT,
  trainee_email TEXT,
  course_name TEXT,
  subject TEXT,
  message_body TEXT,
  message_type TEXT DEFAULT 'manual',
  status TEXT DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  open_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.trainee_messages ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE public.trainee_messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE public.trainee_messages ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;
ALTER TABLE public.trainee_messages ADD COLUMN IF NOT EXISTS open_count INTEGER DEFAULT 0;

ALTER TABLE public.trainee_messages DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.trainee_messages TO anon, authenticated, service_role;

-- ─── 5c) الشهادات الصادرة (certificates) ───
CREATE TABLE IF NOT EXISTS public.certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id BIGINT,
  trainee_name TEXT,
  trainee_email TEXT,
  course_name TEXT,
  certificate_number TEXT UNIQUE,
  certificate_type TEXT DEFAULT 'شهادة إتمام',
  verification_url TEXT,
  status TEXT DEFAULT 'issued',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS registration_id BIGINT;
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS trainee_name TEXT;
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS trainee_email TEXT;
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS course_name TEXT;
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS certificate_number TEXT;
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS certificate_type TEXT DEFAULT 'شهادة إتمام';
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS verification_url TEXT;
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'issued';
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.certificates DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.certificates TO anon, authenticated, service_role;

-- ─── 6) بيانات الدورات الافتراضية ───
INSERT INTO public.courses (name, description, price, type, hours, level, cert, days, sort_order)
SELECT * FROM (VALUES
  ('الذكاء الاصطناعي في التعليم', 'توظيف أدوات الذكاء الاصطناعي داخل الفصل الدراسي لتحسين جودة التعليم وتفاعل الطلاب.', 800, 'paid', '20 ساعة', 'متوسط', 'شهادة INEXC', 20, 1),
  ('تدريب المدربين AI TOT', 'إعداد المدربين القادرين على تقديم برامج الذكاء الاصطناعي باحترافية عالية.', 1200, 'paid', '30 ساعة', 'متقدم', 'شهادة دولية', 15, 2),
  ('هندسة الأوامر Prompt Engineering', 'إتقان صياغة الأوامر للحصول على أفضل النتائج من نماذج الذكاء الاصطناعي التوليدي.', 600, 'paid', '15 ساعة', 'مبتدئ', 'شهادة INEXC', 10, 3),
  ('بناء المناهج الذكية', 'تصميم مناهج تعليمية مدعومة بالذكاء الاصطناعي تلبي احتياجات المتعلمين.', 900, 'paid', '25 ساعة', 'متوسط', 'شهادة دولية', 25, 4),
  ('صناعة المحتوى الرقمي', 'إنتاج محتوى تعليمي رقمي احترافي باستخدام أحدث أدوات الذكاء الاصطناعي.', 700, 'paid', '20 ساعة', 'مبتدئ', 'شهادة INEXC', 18, 5),
  ('بناء الشات بوتات التعليمية', 'تصميم وبرمجة شات بوتات ذكية مخصصة للبيئة التعليمية لتعزيز التعلم.', 650, 'paid', '18 ساعة', 'متوسط', 'شهادة INEXC', 12, 6),
  ('التحول الرقمي للمؤسسات', 'استراتيجيات عملية لقيادة التحول الرقمي في المؤسسات التعليمية والتدريبية.', 950, 'paid', '24 ساعة', 'متقدم', 'شهادة دولية', 30, 7),
  ('المهارات المستقبلية', 'تطوير المهارات الحياتية والمهنية المطلوبة في سوق العمل المستقبلي.', 0, 'free', '12 ساعة', 'مبتدئ', 'شهادة INEXC', 8, 8),
  ('تطوير القيادات التعليمية', 'تأهيل القادة التربويين على توظيف الذكاء الاصطناعي في القرارات والأداء المؤسسي.', 1100, 'paid', '22 ساعة', 'متقدم', 'دبلوم مهني', 22, 9)
) AS v(name, description, price, type, hours, level, cert, days, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.courses LIMIT 1);

-- ─── 7) تحديث cache الـ API ───
NOTIFY pgrst, 'reload schema';
