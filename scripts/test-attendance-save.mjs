/**
 * اختبار سريع: قراءة/تحديث attendance_records عبر Supabase
 */
const SUPABASE_URL = 'https://mhrrktcrbpvaxqltdtgo.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ocnJrdGNyYnB2YXhxbHRkdGdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MzUxNjYsImV4cCI6MjA5NTMxMTE2Nn0.v9KS8UEXiGBrLz-LOmtVaNa1DxrweVZM8OY4FP52x-s';

const headers = {
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation'
};

async function req(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers, ...opts });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

async function main() {
  console.log('=== INEXC attendance save test ===\n');

  const tables = await req('training_sessions?select=id&limit=1');
  if (!tables.ok) {
    console.error('training_sessions:', tables.status, tables.body);
    process.exit(1);
  }
  console.log('OK training_sessions exists');

  const recs = await req('attendance_records?select=id,session_id,status,partial_percent,trainee_name&limit=3&order=created_at.desc');
  if (!recs.ok) {
    console.error('attendance_records read failed:', recs.status, recs.body);
    process.exit(1);
  }
  console.log('OK attendance_records read, sample:', recs.body);

  const row = Array.isArray(recs.body) ? recs.body[0] : null;
  if (!row?.id) {
    console.log('\nNo records to test update — create a session first in admin.');
    process.exit(0);
  }

  const testNotes = 'test-save-' + Date.now();
  const upd = await req(`attendance_records?id=eq.${row.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'partial',
      partial_percent: 20,
      notes: testNotes,
      updated_at: new Date().toISOString()
    })
  });

  if (!upd.ok) {
    console.error('\nUPDATE FAILED:', upd.status, upd.body);
    console.error('\n→ Run smart-attendance-status-upgrade.sql in Supabase if partial_percent column missing.');
    process.exit(1);
  }

  console.log('\nOK update by id succeeded:', upd.body);

  const verify = await req(`attendance_records?id=eq.${row.id}&select=status,partial_percent,notes`);
  console.log('Verified:', verify.body);
}

main().catch(e => { console.error(e); process.exit(1); });
