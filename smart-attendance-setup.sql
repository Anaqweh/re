-- =============================================
-- INEXC — نظام الحضور والغياب الذكي
-- Supabase → SQL Editor → Run (كامل الملف)
-- بعد التشغيل: Settings → API → Reload schema (أو انتظر دقيقة)
-- =============================================

CREATE TABLE IF NOT EXISTS public.training_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID,
  course_name TEXT NOT NULL DEFAULT '',
  trainer_name TEXT DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  session_date DATE,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  late_after_minutes INTEGER DEFAULT 15,
  min_attendance_percent NUMERIC DEFAULT 75,
  status TEXT DEFAULT 'scheduled',
  current_qr_token TEXT DEFAULT '',
  qr_token_expires_at TIMESTAMPTZ,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.training_sessions(id) ON DELETE CASCADE,
  registration_id BIGINT,
  trainee_profile_id UUID,
  course_id UUID,
  course_name TEXT DEFAULT '',
  trainee_name TEXT DEFAULT '',
  trainee_email TEXT DEFAULT '',
  trainee_phone TEXT DEFAULT '',
  check_in_at TIMESTAMPTZ,
  status TEXT DEFAULT 'absent',
  check_in_source TEXT DEFAULT 'manual',
  notes TEXT DEFAULT '',
  check_out_at TIMESTAMPTZ,
  partial_percent NUMERIC,
  excuse_notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, registration_id)
);

CREATE INDEX IF NOT EXISTS idx_training_sessions_course ON public.training_sessions(course_id);
CREATE INDEX IF NOT EXISTS idx_training_sessions_status ON public.training_sessions(status);
CREATE INDEX IF NOT EXISTS idx_training_sessions_date ON public.training_sessions(session_date);
CREATE INDEX IF NOT EXISTS idx_attendance_records_session ON public.attendance_records(session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_registration ON public.attendance_records(registration_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_course ON public.attendance_records(course_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_email ON public.attendance_records(trainee_email);

ALTER TABLE public.training_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records DISABLE ROW LEVEL SECURITY;

GRANT ALL ON public.training_sessions TO anon, authenticated, service_role;
GRANT ALL ON public.attendance_records TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
