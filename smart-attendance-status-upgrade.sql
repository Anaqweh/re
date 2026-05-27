-- =============================================
-- INEXC — ترقية ربط الحضور بالدورات والمتدربين
-- نفّذ بعد smart-attendance-setup.sql
-- =============================================

ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS check_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS partial_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS excuse_notes TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS trainee_phone TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_attendance_records_session_email
  ON public.attendance_records(session_id, trainee_email);

NOTIFY pgrst, 'reload schema';
