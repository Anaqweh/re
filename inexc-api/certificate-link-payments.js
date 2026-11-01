// Payment Link receipts are financial evidence, separate from enrolment and certificate issuance.
// Only the signature-verified webhook dispatcher and the operator reconciliation CLI call record().
export const CERTIFICATE_LINKS = Object.freeze({
  plink_1UW0woRqVRsTIqOYvKWWzuE7: Object.freeze({
    courseId: 'ea14c5bd-ab64-4e77-8b1b-b5c09aa8eed0',
    courseTag: 'ai-leadership-licence', amount: 19900, currency: 'aed'
  })
});
const fail = message => Object.assign(new Error(message), {status: 409});
const idOf = value => typeof value === 'string' ? value : value?.id;
const emailOf = value => String(value || '').trim().toLowerCase();
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
  in_flight: 'يوجد دفع آخر قيد التنفيذ لهذا الطلب؛ راجع العمليتين.'
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

export function createCertificateLinkPayments({pool, logger = console}) {
  async function record(session, {evidence, paidAt, paidAtSource, apply = true} = {}) {
    const rule = validateCertificateLinkSession(session);
    if (!rule) return {state: 'ignored'};
    if (!/^(evt_[a-zA-Z0-9]+|stripe-api-read)$/.test(evidence || '') ||
        !['charge', 'checkout_event'].includes(paidAtSource) || !Number.isFinite(new Date(paidAt).getTime())) {
      throw fail('Verified payment evidence and timestamp are required.');
    }
    const intent = idOf(session.payment_intent), link = idOf(session.payment_link);
    const email = emailOf(session.customer_details?.email || session.customer_email);
    const name = String(session.customer_details?.name || '').slice(0,300);
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
        await db.query(apply ? 'COMMIT' : 'ROLLBACK');
        return {sessionId: session.id, paymentIntent: intent, state: 'matched', requestId: saved.request_id, unchanged: true};
      }
      let reason = '', request, beforeState;
      if (session.amount_total !== rule.amount || session.currency !== rule.currency) reason = 'amount_mismatch';
      else if (session.metadata?.item !== 'certificate' || session.metadata?.course !== rule.courseTag) reason = 'metadata_mismatch';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) reason = 'missing_email';
      if (!reason) {
        const registrations = (await db.query(`SELECT id,status,certificate,certificate_fee_amount,certificate_fee_status,request_kind
          FROM registrations WHERE course_id=$1 AND lower(btrim(email))=$2 ORDER BY id LIMIT 2 FOR UPDATE`, [rule.courseId,email])).rows;
        if (!registrations.length) reason = 'no_registration';
        else if (registrations.length !== 1) reason = 'ambiguous_registration';
        else {
          const registration = registrations[0];
          request = (await db.query('SELECT * FROM certificate_requests WHERE registration_id=$1 FOR UPDATE', [registration.id])).rows[0];
          beforeState = request ? {requestId: request.id, registrationId: registration.id, requestState: request.state,
            paymentIntent: request.payment_intent, paidAt: request.paid_at, certificateFeeStatus: registration.certificate_fee_status} : null;
          if (registration.status === 'ملغى') reason = 'cancelled';
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
      }
      await db.query(`UPDATE certificate_link_payments SET state=$2,reason=$3,request_id=$4,before_state=COALESCE(before_state,$5::jsonb),updated_at=now() WHERE stripe_session_id=$1`,
        [session.id,reason ? 'review' : 'matched',reason,reason ? null : request.id,reason ? null : JSON.stringify(beforeState)]);
      await db.query(apply ? 'COMMIT' : 'ROLLBACK');
      return {sessionId: session.id,paymentIntent: intent,state: reason ? 'review' : 'matched',reason,requestId: reason ? null : request.id,dryRun: !apply};
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
    return {items: items.map(({evidence,before_state,...row}) => ({...row,reasonLabel: REVIEW_REASONS[row.reason] || ''})),summary,offset,hasMore: offset + items.length < summary.total};
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
  return {record,handleWebhook,list,install};
}
