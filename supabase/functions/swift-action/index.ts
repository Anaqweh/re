import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function paidStatuses() {
  return new Set(['completed', 'paid', 'active', 'succeeded']);
}

function mapStripeStatus(session: Stripe.Checkout.Session) {
  if (session.payment_status === 'paid') return 'completed';
  if (session.status === 'complete') return 'completed';
  return 'pending';
}

async function getReceiptUrl(stripe: Stripe, session: Stripe.Checkout.Session) {
  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id;

  if (!paymentIntentId) return null;

  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ['latest_charge'],
  });

  const charge = paymentIntent.latest_charge;
  if (typeof charge === 'object' && charge?.receipt_url) {
    return charge.receipt_url;
  }

  return null;
}

function buildRegistrationEmailHtml(params: Record<string, string>) {
  const name = params.to_name || '';
  const course = params.course_name || '';
  const regType = params.registration_type || '';
  const phone = params.phone || '';

  return (
    '<div dir="rtl" style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;background:#fff;border:1px solid #dde3ec;border-radius:12px;overflow:hidden">' +
    '<div style="background:#1B2A4A;color:#C8A96E;padding:24px;text-align:center;font-weight:800;font-size:22px;letter-spacing:4px">INEXC</div>' +
    '<div style="padding:28px 24px;color:#1B2A4A">' +
    '<h2 style="margin:0 0 12px;font-size:20px">تم تسجيلك بنجاح!</h2>' +
    '<p style="margin:0 0 16px;color:#555;line-height:1.8">عزيزي/عزيزتي <strong>' + name + '</strong>،</p>' +
    '<p style="margin:0 0 16px;color:#555;line-height:1.8">تم استلام طلب تسجيلك في قطاع التدريب والتطوير — INEXC.</p>' +
    '<div style="background:#f7faff;border:1px solid #dce8f5;border-right:3px solid #C8A96E;border-radius:8px;padding:16px;margin-bottom:16px">' +
    '<p style="margin:0 0 8px"><strong>الدورة:</strong> ' + course + '</p>' +
    '<p style="margin:0 0 8px"><strong>نوع التسجيل:</strong> ' + regType + '</p>' +
    '<p style="margin:0"><strong>الجوال:</strong> ' + phone + '</p>' +
    '</div>' +
    '<p style="margin:0;color:#555;line-height:1.8">سيتواصل معك فريقنا قريباً. شكراً لثقتك بنا.</p>' +
    '</div></div>'
  );
}

async function sendRegistrationEmailViaEmailJS(params: Record<string, string>) {
  const publicKey = Deno.env.get('EMAILJS_PUBLIC_KEY') || 'gc0MqAK4Mwebs_GOg';
  const privateKey = Deno.env.get('EMAILJS_PRIVATE_KEY') || '';
  const serviceId = Deno.env.get('EMAILJS_SERVICE_ID') || 'service_58hjcoc';
  const templateId = Deno.env.get('EMAILJS_TEMPLATE_ID') || 'template_fq8l9x8';

  if (!templateId) {
    throw new Error('EMAILJS_TEMPLATE_ID secret is not configured');
  }
  if (!privateKey) {
    throw new Error('EMAILJS_PRIVATE_KEY secret is not configured');
  }

  const email = String(params.email || '').trim();
  const toName = params.to_name || '';
  const title = 'تم تسجيلك بنجاح — INEXC | قطاع التدريب والتطوير';

  const payload = {
    service_id: serviceId,
    template_id: templateId,
    user_id: publicKey,
    accessToken: privateKey,
    template_params: {
      to_email: email,
      email,
      name: toName,
      title,
      to_name: toName,
      full_name: toName,
      course_name: params.course_name || '',
      registration_type: params.registration_type || '',
      phone: params.phone || '',
    },
  };

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

async function syncCheckoutSession(stripe: Stripe, supabase: ReturnType<typeof createClient>, sessionId: string) {
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['payment_intent.latest_charge'],
  });

  const status = mapStripeStatus(session);
  let receiptUrl: string | null = null;

  if (paidStatuses().has(status)) {
    receiptUrl = await getReceiptUrl(stripe, session);
  }

  const updatePayload: Record<string, unknown> = { status };
  if (receiptUrl) updatePayload.receipt_url = receiptUrl;

  const { data: payment, error } = await supabase
    .from('payments')
    .update(updatePayload)
    .eq('stripe_session_id', sessionId)
    .select('*')
    .maybeSingle();

  if (error) throw error;

  if (payment?.registration_id && paidStatuses().has(status)) {
    await supabase
      .from('registrations')
      .update({
        status: 'active',
        payment_method: 'Stripe',
        notes: receiptUrl ? 'تم الدفع عبر Stripe — الوصل جاهز' : 'تم الدفع عبر Stripe',
      })
      .eq('id', payment.registration_id);
  }

  return payment;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!stripeSecret || !supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server configuration missing Stripe or Supabase secrets' }, 500);
  }

  const stripe = new Stripe(stripeSecret, { apiVersion: '2023-10-16' });
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const action = String(body.action || 'create');

  if (action === 'send_registration_email') {
    const email = String(body.email || '').trim();
    const to_name = String(body.to_name || body.full_name || '').trim();
    const course_name = String(body.course_name || '').trim();
    const registration_type = String(body.registration_type || '').trim();
    const phone = String(body.phone || '').trim();

    if (!email || !to_name) {
      return jsonResponse({ error: 'email and to_name are required' }, 400);
    }

    try {
      await sendRegistrationEmailViaEmailJS({ email, to_name, course_name, registration_type, phone });
      return jsonResponse({ ok: true, sent: true });
    } catch (error) {
      console.error('send_registration_email error:', error);
      return jsonResponse({
        error: error instanceof Error ? error.message : 'Failed to send registration email',
      }, 500);
    }
  }

  if (action === 'sync_session') {
    const sessionId = String(body.session_id || '').trim();
    if (!sessionId) {
      return jsonResponse({ error: 'session_id is required' }, 400);
    }

    try {
      const payment = await syncCheckoutSession(stripe, supabase, sessionId);
      if (!payment) {
        return jsonResponse({ error: 'Payment record not found for this session' }, 404);
      }
      return jsonResponse({ payment });
    } catch (error) {
      console.error('sync_session error:', error);
      return jsonResponse({ error: error instanceof Error ? error.message : 'Failed to sync session' }, 500);
    }
  }

  if (action === 'delete_registration') {
    const adminUser = String(body.admin_user || '').trim();
    const adminPass = String(body.admin_pass || '').trim();
    const expectedUser = Deno.env.get('ADMIN_USER') || 'admin';
    const expectedPass = Deno.env.get('ADMIN_PASS') || 'admin123';

    if (adminUser !== expectedUser || adminPass !== expectedPass) {
      return jsonResponse({ error: 'Unauthorized admin credentials' }, 403);
    }

    const registrationId = body.registration_id;
    if (registrationId == null || registrationId === '') {
      return jsonResponse({ error: 'registration_id is required' }, 400);
    }

    const regId = Number.isFinite(Number(registrationId)) ? Number(registrationId) : registrationId;
    const relatedTables = [
      { table: 'payments', column: 'registration_id' },
      { table: 'trainee_enrollments', column: 'registration_id' },
      { table: 'coupon_redemptions', column: 'registration_id' },
      { table: 'trainee_messages', column: 'registration_id' },
      { table: 'certificates', column: 'registration_id' },
    ];

    try {
      for (const { table, column } of relatedTables) {
        const { error } = await supabase.from(table).delete().eq(column, regId);
        if (error) {
          console.warn('delete related (' + table + '):', error.message);
        }
      }

      const { data, error } = await supabase
        .from('registrations')
        .delete()
        .eq('id', regId)
        .select('id');

      if (error) throw error;

      if (!data?.length) {
        const { data: hiddenRows, error: hideError } = await supabase
          .from('registrations')
          .update({ admin_hidden: true, status: 'inactive' })
          .eq('id', regId)
          .select('id, admin_hidden');

        if (hideError) throw hideError;
        if (!hiddenRows?.length) {
          return jsonResponse({ error: 'Registration not found or could not be removed' }, 404);
        }

        return jsonResponse({ ok: true, deleted: false, hidden: true });
      }

      return jsonResponse({ ok: true, deleted: true, hidden: false });
    } catch (error) {
      console.error('delete_registration error:', error);
      return jsonResponse({
        error: error instanceof Error ? error.message : 'Failed to delete registration',
      }, 500);
    }
  }

  const registrationId = body.registration_id ?? null;
  const fullName = String(body.full_name || '').trim();
  const email = String(body.email || '').trim();
  const phone = String(body.phone || '').trim();
  const courseName = String(body.course_name || 'دورة تدريبية').trim();
  const courseId = body.course_id ? String(body.course_id) : null;
  const amount = Number(body.amount) || 0;
  const currency = String(body.currency || 'aed').toLowerCase();
  const requestReceipt = body.request_receipt !== false;

  if (!fullName || !courseName || amount <= 0) {
    return jsonResponse({ error: 'full_name, course_name, and amount are required' }, 400);
  }

  const referer = req.headers.get('referer') || req.headers.get('origin') || '';
  const origin = String(body.origin || referer || 'http://localhost:3000').replace(/\/$/, '');
  const successUrl =
    String(body.success_url || '').trim() ||
    `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl =
    String(body.cancel_url || '').trim() ||
    `${origin}/register.html?payment=cancelled`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: email || undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: Math.round(amount * 100),
            product_data: {
              name: courseName,
              description: `تسجيل INEXC — ${courseName}`,
            },
          },
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        registration_id: registrationId ? String(registrationId) : '',
        full_name: fullName,
        course_name: courseName,
        phone,
        request_receipt: requestReceipt ? 'true' : 'false',
      },
    });

    const { error: paymentError } = await supabase.from('payments').insert([
      {
        registration_id: registrationId,
        course_id: courseId,
        full_name: fullName,
        course_name: courseName,
        amount,
        currency,
        payment_method: 'Stripe',
        status: 'pending',
        stripe_session_id: session.id,
        trainee_email: email || null,
      },
    ]);

    if (paymentError) {
      console.error('payment insert error:', paymentError);
      return jsonResponse({ error: paymentError.message }, 500);
    }

    return jsonResponse({ url: session.url, session_id: session.id });
  } catch (error) {
    console.error('create checkout error:', error);
    return jsonResponse({ error: error instanceof Error ? error.message : 'Failed to create checkout' }, 500);
  }
});
