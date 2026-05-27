const SUPABASE_URL = 'https://mhrrktcrbpvaxqltdtgo.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ocnJrdGNyYnB2YXhxbHRkdGdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MzUxNjYsImV4cCI6MjA5NTMxMTE2Nn0.v9KS8UEXiGBrLz-LOmtVaNa1DxrweVZM8OY4FP52x-s';
const h = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };

const cols = 'id,session_id,trainee_name,trainee_email,trainee_phone,status,check_in_at,check_out_at,partial_percent,excuse_notes,check_in_source,notes';
const r = await fetch(`${SUPABASE_URL}/rest/v1/attendance_records?select=${cols}&limit=1`, { headers: h });
const body = await r.json();
if (!r.ok) {
  console.error('Schema/columns error:', r.status, body);
  process.exit(1);
}
console.log('All attendance_records columns OK');
console.log('Columns accessible:', cols.split(','));
