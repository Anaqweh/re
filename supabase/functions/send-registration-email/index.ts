import { REGISTRATION_EMAIL_TEMPLATE } from './template-html.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EMAILJS_PUBLIC_KEY = Deno.env.get('EMAILJS_PUBLIC_KEY') || 'gc0MqAK4Mwebs_GOg';
const EMAILJS_PRIVATE_KEY = Deno.env.get('EMAILJS_PRIVATE_KEY') || '';
const EMAILJS_SERVICE_ID = Deno.env.get('EMAILJS_SERVICE_ID') || 'service_58hjcoc';
const EMAILJS_TEMPLATE_ID = Deno.env.get('EMAILJS_TEMPLATE_ID') || 'template_fq8l9x8';

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function escapeHtml(str: unknown) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fillTemplate(params: Record<string, string>) {
  const map: Record<string, string> = {
    to_name: escapeHtml(params.to_name),
    course_name: escapeHtml(params.course_name),
    registration_type: escapeHtml(params.registration_type),
    phone: escapeHtml(params.phone),
  };
  return REGISTRATION_EMAIL_TEMPLATE.replace(
    /\{\{(to_name|course_name|registration_type|phone)\}\}/g,
    (_, key: string) => map[key] || '',
  );
}

async function sendViaEmailJS(params: Record<string, string>, html: string) {
  const subject = 'تم تسجيلك بنجاح — INEXC | قطاع التدريب والتطوير';
  const payload: Record<string, unknown> = {
    service_id: EMAILJS_SERVICE_ID,
    template_id: EMAILJS_TEMPLATE_ID,
    user_id: EMAILJS_PUBLIC_KEY,
    template_params: {
      to_name: params.to_name || '',
      email: params.email || '',
      to_email: params.email || '',
      reply_to: params.email || '',
      full_name: params.to_name || '',
      course_name: params.course_name || '',
      registration_type: params.registration_type || '',
      phone: params.phone || '',
      subject,
      message_html: html,
    },
  };

  if (EMAILJS_PRIVATE_KEY) {
    payload.accessToken = EMAILJS_PRIVATE_KEY;
  }

  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `EmailJS error ${res.status}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const email = String(body.email || '').trim();
  const to_name = String(body.to_name || body.full_name || '').trim();
  const course_name = String(body.course_name || '').trim();
  const registration_type = String(body.registration_type || '').trim();
  const phone = String(body.phone || '').trim();

  if (!email || !to_name) {
    return jsonResponse({ error: 'email and to_name are required' }, 400);
  }

  const params = { email, to_name, course_name, registration_type, phone };
  const html = fillTemplate(params);

  try {
    await sendViaEmailJS(params, html);
    return jsonResponse({ ok: true, sent: true });
  } catch (error) {
    console.error('send-registration-email:', error);
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Failed to send email',
    }, 500);
  }
});
