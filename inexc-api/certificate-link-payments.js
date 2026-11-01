// Payment Link receipts are financial evidence, separate from enrolment and certificate issuance.
// Only the signature-verified webhook dispatcher and the operator reconciliation CLI call record().
import crypto from 'node:crypto';
import {STRIPE_API_VERSION} from './stripe-payments.js';
import {certificateNames} from './certificate-requests.js';
export const CERTIFICATE_LINKS = Object.freeze({
  plink_1UW0woRqVRsTIqOYvKWWzuE7: Object.freeze({
    courseId: 'ea14c5bd-ab64-4e77-8b1b-b5c09aa8eed0',
    courseTag: 'ai-leadership-licence', amount: 19900, currency: 'aed'
  })
});
const fail = message => Object.assign(new Error(message), {status: 409});
const idOf = value => typeof value === 'string' ? value : value?.id;
const emailOf = value => String(value || '').trim().toLowerCase();
const nameOf = value => String(value || '').normalize('NFKC').replace(/[\u200e\u200f\u202a-\u202e]/g,'').trim().replace(/\s+/g,' ').toLowerCase();
const referenceOf = value => String(value || '').trim().toUpperCase();
const validReference = value => /^INX-[A-Z0-9]{6,20}-[A-F0-9]{10}$/.test(value);
export const REVIEW_REASONS = Object.freeze({
  missing_email: 'البريد الإلكتروني غير موجود في عملية الدفع.',
  no_registration: 'لا يوجد تسجيل في هذه الدورة مطابق لبريد الدافع.',
  ambiguous_registration: 'يوجد أكثر من تسجيل بهذا البريد؛ يلزم تحديد صاحب الشهادة.',
  no_request: 'يوجد تسجيل، لكن لا يوجد طلب شهادة مطابق.',
  cancelled: 'التسجيل ملغى؛ يلزم مراجعة الدفعة.',
  amount_mismatch: 'المبلغ أو العملة لا يطابقان رسوم الشهادة المعتمدة.',
  metadata_mismatch: 'بيانات رابط الدفع تحتاج إلى مراجعة.',
  already_paid: 'طلب الشهادة مرتبط بدفعة أخرى بالفعل.',
  intent_in_use: 'هذه الدفعة مرتبطة بطلب آخر بالفعل.',
  in_flight: 'يوجد دفع آخر قيد التنفيذ لهذا الطلب؛ راجع العمليتين.',
  invalid_reference: 'رقم التسجيل المكتوب في الدفع غير صالح؛ يلزم مراجعته.',
  reference_not_found: 'رقم التسجيل المكتوب في الدفع غير موجود في هذه الدورة.',
  registration_changed: 'بيانات التسجيل أو رسوم الشهادة تغيّرت؛ يلزم مراجعتها.'
});

export async function setupCertificateLinkPayments(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS certificate_link_payments (
    stripe_session_id TEXT PRIMARY KEY, payment_intent TEXT NOT NULL UNIQUE,
    payment_link TEXT NOT NULL, course_id UUID NOT NULL,
    payer_email TEXT NOT NULL DEFAULT '', payer_name TEXT NOT NULL DEFAULT '',
    amount INTEGER NOT NULL CHECK(amount>0), currency TEXT NOT NULL,
    paid_at TIMESTAMPTZ NOT NULL, paid_at_source TEXT NOT NULL,
    evidence TEXT NOT NULL, before_state JSONB, state TEXT NOT NULL DEFAULT 'review' CHECK(state IN ('review','matched')),
    reason TEXT NOT NULL DEFAULT '', request_id UUID REFERENCES certificate_requests(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await db.query('CREATE INDEX IF NOT EXISTS certificate_link_review ON certificate_link_payments(course_id,state,paid_at DESC)');
  await db.query("ALTER TABLE certificate_link_payments ADD COLUMN IF NOT EXISTS match_basis TEXT NOT NULL DEFAULT ''");
  await db.query("ALTER TABLE certificate_link_payments ADD COLUMN IF NOT EXISTS submitted_reference TEXT NOT NULL DEFAULT ''");
  await db.query(`CREATE TABLE IF NOT EXISTS certificate_link_sync (
    payment_link TEXT PRIMARY KEY, cursor TEXT NOT NULL DEFAULT '', checked_at TIMESTAMPTZ,
    error TEXT NOT NULL DEFAULT '', locked_until TIMESTAMPTZ, lock_token TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  for (const link of Object.keys(CERTIFICATE_LINKS)) await db.query('INSERT INTO certificate_link_sync(payment_link) VALUES($1) ON CONFLICT DO NOTHING',[link]);
}

// No payer-controlled metadata can choose a course, a registration, or a price.
export function validateCertificateLinkSession(session) {
  const rule = CERTIFICATE_LINKS[idOf(session?.payment_link)];
  if (!rule) return null;
  if (session.payment_status !== 'paid') return null;
  if (session.livemode !== true || session.mode !== 'payment' || session.status !== 'complete' ||
      !/^cs_live_[a-zA-Z0-9]+$/.test(session.id || '') || !/^pi_[a-zA-Z0-9]+$/.test(idOf(session.payment_intent) || '') ||
      !Number.isSafeInteger(session.amount_total) || session.amount_total <= 0 || !/^[a-z]{3}$/.test(session.currency || '')) {
    throw fail('Invalid paid certificate Checkout session.');
  }
  return rule;
}

export function createCertificateLinkPayments({pool, logger = console, env = process.env, fetcher = fetch}) {
  const secret = String(env.STRIPE_SECRET_KEY || '').trim();
  async function stripeGet(path,operation) {
    if (!/^(rk|sk)_live_/.test(secret)) throw fail('Live Stripe key is not configured.');
    let response;
    try { response = await fetcher('https://api.stripe.com/v1/'+path,{headers:{Authorization:'Bearer '+secret,'Stripe-Version':STRIPE_API_VERSION},signal:AbortSignal.timeout(20000)}); }
    catch { throw fail('Stripe connection failed: '+operation); }
    const data = await response.json().catch(()=>null);
    if (!response.ok || !data) {
      const permissions = [...new Set(String(data?.error?.message || '').match(/\brak_[a-z_]+\b/g) || [])];
      const error = fail('Stripe read failed: '+operation);
      error.diagnostic = {operation,httpStatus:response.status,permissions,
        requestId:/^req_[a-zA-Z0-9]+$/.test(response.headers.get('request-id') || '')?response.headers.get('request-id'):null};
      throw error;
    }
    return data;
  }
  async function verifySession(id) {
    if (!/^cs_live_[a-zA-Z0-9]+$/.test(id || '')) throw fail('Invalid Checkout session ID.');
    const session = await stripeGet('checkout/sessions/'+encodeURIComponent(id),'read_checkout_session');
    if (session.id !== id || !validateCertificateLinkSession(session)) throw fail('Session is not a paid approved certificate Payment Link.');
    const intentId = idOf(session.payment_intent);
    const intent = await stripeGet('payment_intents/'+encodeURIComponent(intentId)+'?expand[]=latest_charge','read_payment_intent_and_charge');
    const charge = intent.latest_charge;
    if (intent.id !== intentId || intent.livemode !== true || intent.status !== 'succeeded' || intent.currency !== session.currency ||
        intent.amount_received !== session.amount_total || !charge || charge.livemode !== true || charge.paid !== true ||
        charge.refunded !== false || charge.amount_refunded !== 0 || charge.disputed !== false || charge.payment_intent !== intentId ||
        charge.amount !== session.amount_total || charge.currency !== session.currency || !Number.isSafeInteger(charge.created)) {
      throw fail('Payment has changed or requires refund/dispute review: '+intentId);
    }
    return {session,paidAt:new Date(charge.created*1000).toISOString()};
  }
  async function record(session, {evidence, paidAt, paidAtSource, apply = true, reviewedMatch} = {}) {
    const rule = validateCertificateLinkSession(session);
    if (!rule) return {state: 'ignored'};
    if (!/^(evt_[a-zA-Z0-9]+|stripe-api-read)$/.test(evidence || '') ||
        !['charge', 'checkout_event'].includes(paidAtSource) || !Number.isFinite(new Date(paidAt).getTime())) {
      throw fail('Verified payment evidence and timestamp are required.');
    }
    const intent = idOf(session.payment_intent), link = idOf(session.payment_link);
    const email = emailOf(session.customer_details?.email || session.customer_email);
    const name = String(session.customer_details?.name || '').slice(0,300);
    // A reviewed mapping is operator-only, tied to one verified payment and one audited registration.
    // It is never a general email alias and is not accepted from webhook metadata or a public route.
    if (reviewedMatch && (evidence !== 'stripe-api-read' || reviewedMatch.paymentIntent !== intent ||
        !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(reviewedMatch.registrationId || '') ||
        !validReference(referenceOf(reviewedMatch.reference)) || !reviewedMatch.registrationEmail ||
        emailOf(reviewedMatch.payerEmail) !== email || nameOf(reviewedMatch.payerName) !== nameOf(name))) {
      throw fail('Reviewed payment identity does not match the live Stripe evidence.');
    }
    const referenceField = (session.custom_fields || []).find(field => field.key === 'inexcregistrationreference');
    const submittedReference = referenceOf(referenceField?.text?.value);
    let submittedNames;
    try {
      submittedNames = certificateNames({
        arabicName:(session.custom_fields || []).find(field=>field.key==='inexcarabicname')?.text?.value,
        englishName:(session.custom_fields || []).find(field=>field.key==='inexcenglishname')?.text?.value
      });
    } catch { /* A malformed name cannot hide an otherwise successful payment. Admin sees missing names. */ }
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(`INSERT INTO certificate_link_payments
        (stripe_session_id,payment_intent,payment_link,course_id,payer_email,payer_name,amount,currency,paid_at,paid_at_source,evidence)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(stripe_session_id) DO NOTHING`,
        [session.id,intent,link,rule.courseId,email,name,session.amount_total,session.currency,paidAt,paidAtSource,evidence]);
      const saved = (await db.query('SELECT * FROM certificate_link_payments WHERE stripe_session_id=$1 FOR UPDATE', [session.id])).rows[0];
      if (saved.payment_intent !== intent || saved.payment_link !== link || saved.course_id !== rule.courseId ||
          saved.amount !== session.amount_total || saved.currency !== session.currency || saved.payer_email !== email) {
        throw fail('Stored receipt differs from Stripe evidence; manual review required.');
      }
      // A repeat delivery never reassigns an already matched payment.
      if (saved.state === 'matched') {
        if (reviewedMatch) {
          const linked = (await db.query('SELECT registration_id FROM certificate_requests WHERE id=$1',[saved.request_id])).rows[0];
          if (linked?.registration_id !== reviewedMatch.registrationId) throw fail('Payment is already matched to a different registration.');
        }
        await db.query(apply ? 'COMMIT' : 'ROLLBACK');
        return {sessionId: session.id, paymentIntent: intent, state: 'matched', requestId: saved.request_id, unchanged: true};
      }
      let reason = '', request, beforeState, createdRequest = false;
      const matchBasis = reviewedMatch ? 'operator_reviewed' : referenceField ? 'registration_reference' : 'email';
      if (session.amount_total !== rule.amount || session.currency !== rule.currency) reason = 'amount_mismatch';
      else if (session.metadata?.item !== 'certificate' || session.metadata?.course !== rule.courseTag) reason = 'metadata_mismatch';
      else if (!reviewedMatch && referenceField && !validReference(submittedReference)) reason = 'invalid_reference';
      else if (!reviewedMatch && !referenceField && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) reason = 'missing_email';
      if (!reason) {
        const registrations = (await db.query(`SELECT id,reference,name,email,status,payment_method,total,certificate,certificate_fee_amount,certificate_fee_status,request_kind
          FROM registrations WHERE course_id=$1 AND ${reviewedMatch ? 'id=$2::uuid' : referenceField ? 'upper(btrim(reference))=$2' : 'lower(btrim(email))=$2'} ORDER BY id LIMIT 2 FOR UPDATE`,
          [rule.courseId,reviewedMatch ? reviewedMatch.registrationId : referenceField ? submittedReference : email])).rows;
        if (!registrations.length) reason = reviewedMatch || referenceField ? 'reference_not_found' : 'no_registration';
        else if (registrations.length !== 1) reason = 'ambiguous_registration';
        else {
          const registration = registrations[0];
          if (reviewedMatch && (referenceOf(registration.reference) !== referenceOf(reviewedMatch.reference) ||
              emailOf(registration.email) !== emailOf(reviewedMatch.registrationEmail) || nameOf(registration.name) !== nameOf(reviewedMatch.payerName))) {
            throw fail('Audited registration identity changed; no payment was reassigned.');
          }
          request = (await db.query('SELECT * FROM certificate_requests WHERE registration_id=$1 FOR UPDATE', [registration.id])).rows[0];
          beforeState = {requestId: request?.id || null, registrationId: registration.id, requestState: request?.state || null,
            paymentIntent: request?.payment_intent || '', paidAt: request?.paid_at || null, certificateFeeStatus: registration.certificate_fee_status,
            certificate: registration.certificate, certificateFeeAmount: registration.certificate_fee_amount, total: registration.total,
            arabicName:request?.arabic_name || '',englishName:request?.english_name || '',namesConfirmedAt:request?.names_confirmed_at || null};
          // Paying for a certificate after registering without it is an explicit certificate purchase.
          // Only an exact course registration reference or an operator-reviewed mapping may create its request.
          if (!request && (reviewedMatch || referenceField) && registration.status !== 'ملغى') {
            const course = (await db.query('SELECT price,certificate_mode,certificate_name,certificate_price FROM courses WHERE id=$1 FOR SHARE',[rule.courseId])).rows[0];
            const used = (await db.query('SELECT id FROM certificate_requests WHERE payment_intent=$1',[intent])).rows[0];
            if (used) reason = 'intent_in_use';
            else if (!course || Number(course.price) !== 0 || course.certificate_mode !== 'optional' ||
                !String(course.certificate_name || '').trim() || Math.round(Number(course.certificate_price)*100) !== session.amount_total ||
                registration.status !== 'مسجل بالبطاقة' || registration.payment_method !== 'membership' ||
                Number(registration.total) !== 0 || Number(registration.certificate_fee_amount) !== 0 || registration.certificate !== 'لا' ||
                registration.certificate_fee_status !== 'not_required' || (registration.request_kind && registration.request_kind !== 'individual')) reason = 'registration_changed';
            else {
              request = (await db.query(`INSERT INTO certificate_requests(registration_id,access_token,amount,currency,state,payment_intent,paid_at,email_status)
                VALUES($1,$2,$3,$4,'paid',$5,$6,'skipped') RETURNING *`,[registration.id,crypto.randomBytes(32).toString('hex'),session.amount_total,session.currency,intent,paidAt])).rows[0];
              await db.query("UPDATE registrations SET certificate=$1,total=$2,certificate_fee_amount=$2,certificate_fee_status='paid',updated_at=now() WHERE id=$3",
                [course.certificate_name,session.amount_total/100,registration.id]);
              createdRequest = true;
              registration.certificate = course.certificate_name;
              registration.certificate_fee_amount = session.amount_total/100;
              registration.certificate_fee_status = 'paid';
            }
          }
          if (registration.status === 'ملغى') reason = 'cancelled';
          else if (reason) { /* Preserve the precise reason for a blocked late certificate purchase. */ }
          else if (!request || (registration.request_kind && registration.request_kind !== 'individual') ||
                   ['', 'لا', 'غير محدد'].includes(String(registration.certificate || '').trim())) reason = 'no_request';
          else if (request.amount !== session.amount_total || request.currency !== session.currency ||
                   Math.round(Number(registration.certificate_fee_amount) * 100) !== session.amount_total) reason = 'amount_mismatch';
          else if ((request.payment_intent && request.payment_intent !== intent) ||
                   ((request.state === 'paid' || registration.certificate_fee_status === 'paid') && request.payment_intent !== intent)) reason = 'already_paid';
          else {
            const other = (await db.query('SELECT id FROM certificate_requests WHERE payment_intent=$1 AND id<>$2', [intent,request.id])).rows[0];
            if (other) reason = 'intent_in_use';
            else {
              const active = (await db.query(`SELECT id FROM certificate_payment_attempts WHERE request_id=$1
                AND (state='processing' OR (state IN ('creating','open') AND expires_at>now())) LIMIT 1`, [request.id])).rows[0];
              if (active && request.state !== 'paid') reason = 'in_flight';
            }
          }
        }
      }
      if (!reason) {
        await db.query(`UPDATE certificate_requests SET state='paid',payment_intent=$1,paid_at=COALESCE(paid_at,$2),updated_at=now() WHERE id=$3`, [intent,paidAt,request.id]);
        await db.query("UPDATE registrations SET certificate_fee_status='paid',updated_at=now() WHERE id=$1", [request.registration_id]);
        if (submittedNames) await db.query(`UPDATE certificate_requests SET arabic_name=$1,english_name=$2,names_confirmed_at=now(),updated_at=now()
          WHERE id=$3 AND names_confirmed_at IS NULL`,[submittedNames.arabic,submittedNames.english,request.id]);
      }
      await db.query(`UPDATE certificate_link_payments SET state=$2,reason=$3,request_id=$4,before_state=COALESCE(before_state,$5::jsonb),match_basis=$6,submitted_reference=$7,updated_at=now() WHERE stripe_session_id=$1`,
        [session.id,reason ? 'review' : 'matched',reason,reason ? null : request.id,reason ? null : JSON.stringify(beforeState),matchBasis,reviewedMatch ? referenceOf(reviewedMatch.reference) : submittedReference]);
      await db.query(apply ? 'COMMIT' : 'ROLLBACK');
      return {sessionId: session.id,paymentIntent: intent,state: reason ? 'review' : 'matched',reason,requestId: reason ? null : request.id,createdRequest,matchBasis,dryRun: !apply};
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally { db.release(); }
  }

  // Called ONLY after stripe-payments.js has verified the raw-body signature and live mode.
  // The signed paid Checkout snapshot suffices; a restricted key needs no extra read permission here.
  async function handleWebhook(event) {
    if (!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)) return;
    if (!CERTIFICATE_LINKS[idOf(event.data?.object?.payment_link)]) return;
    if (event.livemode !== true || !/^evt_[a-zA-Z0-9]+$/.test(event.id || '') || !Number.isSafeInteger(event.created)) throw fail('Invalid Stripe event.');
    return record(event.data.object, {evidence: event.id,paidAt: new Date(event.created * 1000).toISOString(),paidAtSource: 'checkout_event'});
  }

  // A persistent cursor and lease recover missed notifications without requiring an open browser.
  // Every sweep retries review items. Matched payments are never assigned again.
  let syncing = false;
  async function sync() {
    if (syncing || env.STRIPE_CHECKOUT_ENABLED !== '1' || !/^(rk|sk)_live_/.test(secret)) return;
    syncing = true;
    try {
      for (const link of Object.keys(CERTIFICATE_LINKS)) {
        const lockToken = crypto.randomUUID();
        const state = (await pool.query(`UPDATE certificate_link_sync SET locked_until=now()+interval '10 minutes',lock_token=$2
          WHERE payment_link=$1 AND (locked_until IS NULL OR locked_until<now())
          AND updated_at<=now()-interval '5 minutes' RETURNING *`,[link,lockToken])).rows[0];
        if (!state) continue;
        try {
          // Small pages bound each pass and keep the cursor valid after partial failures.
          const params = new URLSearchParams({payment_link:link,status:'complete',limit:'10',...(state.cursor?{starting_after:state.cursor}:{})});
          const page = await stripeGet('checkout/sessions?'+params,'list_certificate_link_sessions');
          if (!Array.isArray(page.data) || (page.has_more && !page.data.length)) throw fail('Invalid Stripe session page.');
          const errors = [];
          for (const item of page.data) {
            if (item.payment_status !== 'paid') continue;
            const saved = (await pool.query('SELECT state FROM certificate_link_payments WHERE stripe_session_id=$1',[item.id])).rows[0];
            if (saved?.state === 'matched') continue;
            try {
              const proof = await verifySession(item.id);
              await record(proof.session,{evidence:'stripe-api-read',paidAt:proof.paidAt,paidAtSource:'charge'});
            } catch (error) {
              errors.push(error.diagnostic?JSON.stringify(error.diagnostic):String(error.message).slice(0,250));
            }
          }
          await pool.query(`UPDATE certificate_link_sync SET cursor=$2,checked_at=now(),error=$3,locked_until=NULL,lock_token=NULL,updated_at=now()
            WHERE payment_link=$1 AND lock_token=$4`,[link,page.has_more?page.data.at(-1).id:'',errors.join(' | ').slice(0,1200),lockToken]);
        } catch (error) {
          await pool.query(`UPDATE certificate_link_sync SET error=$2,locked_until=NULL,lock_token=NULL,updated_at=now() WHERE payment_link=$1 AND lock_token=$3`,
            [link,error.diagnostic?JSON.stringify(error.diagnostic):String(error.message).slice(0,500),lockToken]);
        }
      }
    } catch { logger.error('Certificate payment synchronization unavailable'); }
    finally { syncing = false; }
  }

  async function list(input = {}) {
    const course = String(input.course || ''), state = String(input.state || '');
    if (course && !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(course)) throw fail('اختر دورة صالحة.');
    if (state && !['review','matched'].includes(state)) throw fail('حالة الدفعة غير صالحة.');
    const offset = Math.max(0,Math.min(1000000,Number.parseInt(input.offset,10) || 0));
    const args = [course || null,state || null];
    const where = '($1::uuid IS NULL OR p.course_id=$1) AND ($2::text IS NULL OR p.state=$2)';
    const summary = (await pool.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE p.state='review')::int AS review,
      count(*) FILTER(WHERE p.state='matched')::int AS matched FROM certificate_link_payments p WHERE ${where}`, args)).rows[0];
    const items = (await pool.query(`SELECT p.*,c.name AS course_name,r.name AS trainee_name,r.reference,q.registration_id
      FROM certificate_link_payments p LEFT JOIN courses c ON c.id=p.course_id
      LEFT JOIN certificate_requests q ON q.id=p.request_id LEFT JOIN registrations r ON r.id=q.registration_id
      WHERE ${where} ORDER BY p.paid_at DESC,p.stripe_session_id LIMIT 50 OFFSET $3`, [...args,offset])).rows;
    const synchronization = (await pool.query('SELECT payment_link,checked_at,error FROM certificate_link_sync ORDER BY payment_link')).rows;
    return {items: items.map(({evidence,before_state,...row}) => ({...row,reasonLabel: REVIEW_REASONS[row.reason] || ''})),summary,synchronization,offset,hasMore: offset + items.length < summary.total};
  }

  function install(app,auth) {
    app.get('/api/admin/certificate-link-payments',auth,async(req,res)=>{
      res.set('Cache-Control','no-store');
      try { res.json(await list(req.query)); }
      catch (error) {
        logger.error('Certificate link receipt listing failed', {status: error.status || 500});
        res.status(error.status || 500).json({error: error.status ? error.message : 'تعذّر تحميل دفعات روابط الشهادات.'});
      }
    });
  }
  return {record,handleWebhook,list,install,verifySession,sync};
}
