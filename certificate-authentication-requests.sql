-- =============================================
-- INEXC — طلبات مصادقة الشهادات (الماجستير المهني)
-- Supabase → SQL Editor → Run
-- =============================================

CREATE TABLE IF NOT EXISTS public.certificate_authentication_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainee_id UUID REFERENCES public.trainee_profiles(id) ON DELETE SET NULL,
  full_name TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  total_hours NUMERIC DEFAULT 0,
  completion_percent NUMERIC DEFAULT 0,
  certificates_count INTEGER DEFAULT 0,
  completed_courses JSONB DEFAULT '[]'::jsonb,
  certificates JSONB DEFAULT '[]'::jsonb,
  uploaded_files JSONB DEFAULT '[]'::jsonb,
  payment_history JSONB DEFAULT '[]'::jsonb,
  status TEXT DEFAULT 'new',
  payment_status TEXT DEFAULT 'not_required',
  payment_amount NUMERIC DEFAULT 0,
  payment_link TEXT DEFAULT '',
  verification_code TEXT DEFAULT '',
  verification_url TEXT DEFAULT '',
  admin_notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cert_auth_requests_trainee ON public.certificate_authentication_requests(trainee_id);
CREATE INDEX IF NOT EXISTS idx_cert_auth_requests_status ON public.certificate_authentication_requests(status);
CREATE INDEX IF NOT EXISTS idx_cert_auth_requests_email ON public.certificate_authentication_requests(email);

ALTER TABLE public.certificate_authentication_requests DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.certificate_authentication_requests TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
