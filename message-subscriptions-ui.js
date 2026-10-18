import {subscriptionFields,legacyConfirmationFields} from './inexc-api/message-subscription-links.js?v=20261015-sub2';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=v=>v?new Intl.DateTimeFormat('ar-AE',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Dubai'}).format(new Date(v)):'—';
export async function loadSubscriptionManager({target,call,api,notify,supported,onSettings,onCompose}){
 if(!supported){target.innerHTML='<div class="card"><h2>رابط الاشتراك والمشاركة</h2><p>يلزم تحديث خدمة مركز الرسائل على الخادم لتفعيل الاشتراك وتأكيد البريد.</p></div>';return;}
 target.innerHTML='<div class="empty">جارٍ تحميل الاشتراكات…</div>';
 try{
  const data=await call('/subscriptions');
  target.innerHTML=`<div class="row between section-head"><div><h2>رابط الاشتراك والمشاركة</h2><p class="muted">رابط واحد للمشاركة، وإضافة مباشرة إلى جهات الاتصال.</p></div><button id="sub-compose" class="primary" ${!data.listId||!data.stats.subscribed?'disabled':''}>إنشاء رسالة للمشتركين</button></div>
  ${!data.mailEnabled?'<div class="notice error">خدمة إرسال البريد غير مهيأة. التسجيل يعمل وتُحفظ العناوين؛ يتطلب إرسال الحملات تفعيل خدمة البريد.</div>':''}
  <div class="stats">${[['المشتركون من الرابط',data.stats.subscribed],['مشتركون جدد',data.stats.new],['طلبات تأكيد سابقة',data.stats.pending],['اشتراكات مستبعدة',data.stats.blocked]].map(([label,n])=>`<div class="stat"><span>${label}</span><b>${Number(n).toLocaleString('ar-AE')}</b></div>`).join('')}</div>
  <div class="two section-space"><div class="card"><h3>شارك الرابط أينما تريد</h3><p class="hint">يمكن مشاركته منفردًا أو داخل الرسالة. لا يحتوي على بيانات المستلم.</p><div class="fields"><label>مصدر الاشتراكات<select id="sub-source"><option value="">الرابط العام</option>${data.campaigns.map(c=>`<option value="${c.subscription_code}">${esc(c.subject)}</option>`).join('')}</select></label><label>رابط الاشتراك<input id="sub-link" readonly dir="ltr" value="${esc(data.url)}"></label></div><div class="row section-space"><button id="sub-copy" class="primary">نسخ الرابط</button><a id="sub-open" href="${esc(data.url)}" target="_blank" rel="noopener noreferrer">فتح الصفحة ↗</a><a id="sub-whatsapp" target="_blank" rel="noopener noreferrer">واتساب ↗</a><button id="sub-qr">تنزيل QR</button></div><img id="sub-qr-preview" alt="رمز الاشتراك" width="180" height="180" hidden><p class="hint">عند اختيار حملة، تُنسب الاشتراكات الجديدة عبر هذا الرابط إلى تلك الحملة.</p></div>
  <div class="card"><h3>كيف ينضم الشخص إلى رسائلك؟</h3><ol class="checklist"><li>يفتح الرابط ويكتب بريده ويوافق على الاشتراك.</li><li>يُضاف فورًا إلى جهات الاتصال ومجموعة «مشتركو الرسائل».</li><li>يظهر التسجيل في أيقونة «المشتركون الجدد» مع التاريخ والمصدر.</li></ol><p class="notice">من ألغى اشتراكه يبقى مستبعدًا دائمًا. لا تعيده صفحة الاشتراك أو استيراد الملفات، ولا يظهر ضمن تصدير جهات الاتصال.</p><p class="hint">يمكنك إضافة زر «شارك مع صديق» من إعدادات التذييل عند كتابة رسالة. لا تُرسل حملة تلقائيًا عند إنشاء الاشتراك.</p></div></div>
  <details class="card section-space" id="sub-customize"><summary>تعديل نصوص صفحة الاشتراك</summary><form id="sub-settings" class="fields section-space"><label class="row"><input type="checkbox" name="enabled" ${data.settings.enabled?'checked':''}>استقبال اشتراكات جديدة</label><div class="two">${Object.entries(subscriptionFields).filter(([key])=>!legacyConfirmationFields.includes(key)).map(([key,[label,max]])=>`<label>${label}${max>300?`<textarea name="${key}" maxlength="${max}" required dir="auto">${esc(data.settings[key])}</textarea>`:`<input name="${key}" maxlength="${max}" required dir="auto" value="${esc(data.settings[key])}">`}</label>`).join('')}</div><button type="submit" class="primary">حفظ محتوى الاشتراك</button></form></details>
  <div class="card section-space"><h3>الاشتراكات حسب الحملة</h3>${data.campaigns.length?`<div class="table-wrap"><table><thead><tr><th>الحملة</th><th>المشتركون</th><th>طلبات تأكيد سابقة</th></tr></thead><tbody>${data.campaigns.map(c=>`<tr><td>${esc(c.subject)}<small>${date(c.created_at)}</small></td><td>${c.subscribed}</td><td>${c.pending}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">ستظهر الحملات هنا عند إنشائها.</p>'}</div>
  `;
  const $=s=>target.querySelector(s);let qrBlob;
  const update=()=>{const c=data.campaigns.find(c=>c.subscription_code===$('#sub-source').value),url=c?.url||data.url;$('#sub-link').value=url;$('#sub-open').href=url;$('#sub-whatsapp').href='https://wa.me/?text='+encodeURIComponent(data.settings.shareText+'\n'+url);$('#sub-qr-preview').hidden=true;};
  update();$('#sub-source').onchange=update;
  $('#sub-copy').onclick=async()=>{try{await navigator.clipboard.writeText($('#sub-link').value);notify('تم نسخ رابط الاشتراك.','success');}catch{$('#sub-link').focus();$('#sub-link').select();notify('حدّد الرابط وانسخه للمشاركة.');}};
  $('#sub-qr').onclick=async()=>{const button=$('#sub-qr');button.disabled=true;try{const r=await api('/admin/message-studio/subscriptions/qr?source='+encodeURIComponent($('#sub-source').value),{raw:true});if(qrBlob)URL.revokeObjectURL(qrBlob);qrBlob=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=qrBlob;a.download='inexc-subscribe-qr.svg';a.click();$('#sub-qr-preview').src=qrBlob;$('#sub-qr-preview').hidden=false;notify('تم تجهيز رمز QR للرابط المختار.','success');}catch(e){notify(e.message,'error')}finally{button.disabled=false}};
  $('#sub-compose').onclick=()=>onCompose(data.listId);
  $('#sub-settings').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('[type=submit]');button.disabled=true;try{const payload=Object.fromEntries(new FormData(form));payload.enabled=form.elements.enabled.checked;const saved=await call('/subscriptions/settings','PUT',payload);data.settings=saved.settings;onSettings(saved.settings);update();notify('تم حفظ نصوص صفحة الاشتراك.','success');}catch(e){notify(e.message,'error')}finally{button.disabled=false}};
 }catch(e){target.innerHTML='<div class="notice error">'+esc(e.message)+'</div>';}
}

export const newSubscriberIcon='<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="9" cy="7" r="3.5"/><path d="M2.5 21v-2.5a6.5 6.5 0 0 1 13 0V21M19 7v8m-4-4h8"/></svg>';
let noticeRevision=0,reviewingSubscribers=null;
export function subscriberNoticeRevision(){return noticeRevision;}
export function updateSubscriberNotice(count,revision=noticeRevision){
 if(reviewingSubscribers||revision!==noticeRevision||!Number.isFinite(Number(count)))return;
 document.querySelectorAll('[data-new-subscriber-count]').forEach(node=>{
  node.textContent=Number(count).toLocaleString('ar-AE');node.hidden=!Number(count);
  node.setAttribute('aria-label',count+' مشترك جديد');
 });
}
async function reviewOpenedSubscribers(call,cutoff){
 if(reviewingSubscribers)return reviewingSubscribers;
 noticeRevision++;
 reviewingSubscribers=(async()=>{
  let page=0,data=await call('/subscriptions/new?filter=new&page=0');
  // A fixed boundary keeps later signups unread while existing pages are acknowledged.
  while(cutoff&&data.rows.length){
   const emails=data.rows.filter(row=>new Date(row.subscribed_at)<=new Date(cutoff)).map(row=>row.email);
   if(emails.length)await call('/subscriptions/new/seen','POST',{emails});
   else page++;
   // Reviewed rows leave the unread result, so read this same page again.
   if(!emails.length&&page*50>=data.total)break;
   data=await call('/subscriptions/new?filter=new&page='+page);
  }
  return await call('/subscriptions/new?countOnly=1');
 })().finally(()=>{reviewingSubscribers=null;noticeRevision++;});
 return reviewingSubscribers;
}
export async function loadNewSubscribers({target,call,notify,onCount,onCompose,onContacts,onLists,supported}){
 if(!supported){target.innerHTML='<div class="card"><h2>المشتركون الجدد</h2><p>يلزم تحديث خدمة مركز الرسائل لتفعيل التسجيل الفوري وقائمة المشتركين الجدد.</p></div>';return;}
 let page=0,current,loadRevision=0;
 const view=Symbol('new-subscribers');target.subscriberView=view;
 target.innerHTML=`<div class="row between section-head"><div><h2 class="row">${newSubscriberIcon} المشتركون الجدد</h2><p class="muted">من سجّل عبر رابط الاشتراك يظهر هنا ويُضاف مباشرة إلى جهات الاتصال.</p></div><div class="row"><button id="new-contacts">جهات الاتصال</button><button id="new-compose" class="primary" disabled>إنشاء رسالة للمشتركين</button></div></div><div id="new-stats" class="stats"></div><div class="card section-space"><div class="row between"><div class="row"><input id="new-search" type="search" placeholder="ابحث بالاسم أو البريد" aria-label="البحث في المشتركين"><select id="new-filter" aria-label="فلترة المشتركين"><option value="all">كل التسجيلات</option><option value="new">الجدد غير المراجعين</option></select></div><div class="row"><button id="new-refresh">تحديث</button><button id="new-seen" disabled>اعتبار المعروض مراجَعًا</button></div></div><div id="new-table" class="section-space"></div><div id="new-pager" class="pager"></div></div>`;
 const $=s=>target.querySelector(s);
 async function load(review=false){
  const revision=++loadRevision,noticeAtStart=subscriberNoticeRevision();
  $('#new-table').innerHTML='<p class="muted">جارٍ تحميل المشتركين…</p>';
  try{
   const data=await call('/subscriptions/new?'+new URLSearchParams({page,search:$('#new-search').value,filter:$('#new-filter').value}));
   if(target.subscriberView!==view||revision!==loadRevision)return;
   current=data;onCount(data.stats.unread,noticeAtStart);
   $('#new-stats').innerHTML=[['المشتركون من الرابط',data.stats.total],['جدد لم تراجعهم بعد',data.stats.unread]].map(([label,n])=>`<div class="stat"><span>${label}</span><b>${Number(n).toLocaleString('ar-AE')}</b></div>`).join('');
   $('#new-compose').disabled=!data.listId||!data.stats.total;$('#new-seen').disabled=!data.rows.some(r=>!r.seen_at);
   $('#new-table').innerHTML=data.rows.length?`<div class="table-wrap"><table><thead><tr><th>الاسم والبريد</th><th>التسجيل</th><th>الحالة</th><th>المصدر</th><th>تاريخ الاشتراك</th><th>إضافة إلى قائمة</th></tr></thead><tbody>${data.rows.map(s=>`<tr><td><strong>${esc(s.full_name||'بدون اسم')}</strong><small dir="ltr">${esc(s.email)}</small></td><td>${!s.seen_at?'<span class="badge">جديد</span>':'<span class="muted">تمت المراجعة</span>'}<small>${s.added_new_contact===true?'جديد في جهات الاتصال':s.added_new_contact===false?'بريد موجود سابقًا':'مسجل من الرابط'}</small></td><td><span class="badge ${s.status==='active'?'good':s.status==='blocked'?'bad':'warn'}">${{active:'مضاف لجهات الاتصال',blocked:'ألغى الاشتراك أو موقوف',removed:'حُذفت جهة الاتصال'}[s.status]}</span></td><td>${esc(s.subject||'الرابط العام')}</td><td>${date(s.subscribed_at)}</td><td>${s.status==='active'&&s.contact_id?`<button type="button" data-add-subscriber-list="${esc(s.contact_id)}">اختر قائمة</button>`:'—'}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty"><h3>لا توجد تسجيلات مطابقة</h3><p>ستظهر هنا الاشتراكات القادمة من الرابط. يمكنك تغيير البحث أو الفلتر.</p></div>';
   $('#new-table').querySelectorAll('[data-add-subscriber-list]').forEach(button=>button.onclick=async()=>{try{const lists=await onLists();const available=lists.filter(item=>item.id!==data.listId);if(!available.length)return notify('أنشئ قائمة جديدة من جهات الاتصال أولًا.','error');const subscriber=data.rows.find(item=>item.contact_id===button.dataset.addSubscriberList);if(!subscriber)return;const dialog=document.createElement('dialog');dialog.className='subscriber-list-dialog';dialog.innerHTML=`<form method="dialog"><h3>إضافة البريد إلى قائمة</h3><p dir="ltr">${esc(subscriber.email)}</p><label>القائمة<select required>${available.map(item=>`<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}</select></label><div class="row"><button type="button" data-cancel>إلغاء</button><button type="submit" class="primary">إضافة إلى القائمة</button></div></form>`;target.append(dialog);const cleanup=()=>{dialog.close();dialog.remove()};dialog.querySelector('[data-cancel]').onclick=cleanup;dialog.oncancel=event=>{event.preventDefault();cleanup()};dialog.querySelector('form').onsubmit=async event=>{event.preventDefault();const submit=dialog.querySelector('[type=submit]');submit.disabled=true;try{const selection=await call('/contacts/selection','POST',{ids:[subscriber.contact_id]});const selected=dialog.querySelector('select'),listName=selected.selectedOptions[0]?.textContent?.trim()||'القائمة المختارة';const result=await call('/contacts/bulk','POST',{...selection,action:'group',listId:selected.value});if(Number(result.affected)!==1){notify('لم تُؤكَّد إضافة هذا البريد. قد يكون موجودًا في القائمة مسبقًا أو محظورًا؛ راجع القائمة المختارة.','error');submit.disabled=false;return;}cleanup();notify('تمت إضافة '+subscriber.email+' إلى قائمة «'+listName+'» بنجاح.','success')}catch(error){notify(error.message,'error');submit.disabled=false}};dialog.showModal()}catch(error){notify(error.message,'error')}});
   $('#new-pager').innerHTML=`<button id="new-prev" ${page===0?'disabled':''}>السابقة</button><span>صفحة ${page+1} من ${Math.max(1,Math.ceil(data.total/50))}</span><button id="new-next" ${(page+1)*50>=data.total?'disabled':''}>التالية</button>`;
   $('#new-prev').onclick=()=>{page--;load()};$('#new-next').onclick=()=>{page++;load()};
   if(review&&data.stats.unread){
    try{const counts=await reviewOpenedSubscribers(call,data.rows[0]?.subscribed_at);onCount(counts.unread);if(target.subscriberView===view)await load();}
    catch(error){if(target.subscriberView===view)notify('تعذر تحديث إشعار المشتركين. اضغط تحديث للمحاولة مجددًا. '+error.message,'error');}
   }
  }catch(e){if(target.subscriberView===view&&revision===loadRevision)$('#new-table').innerHTML='<div class="notice error">'+esc(e.message)+'</div>';}
 }
 let timer;$('#new-search').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{page=0;load()},250)};$('#new-filter').onchange=()=>{page=0;load()};$('#new-refresh').onclick=()=>load(true);
 $('#new-contacts').onclick=onContacts;$('#new-compose').onclick=()=>onCompose(current.listId);
 $('#new-seen').onclick=async()=>{const button=$('#new-seen');button.disabled=true;try{await call('/subscriptions/new/seen','POST',{emails:current.rows.filter(r=>!r.seen_at).map(r=>r.email)});await load();notify('تم تحديث حالة المراجعة.','success')}catch(e){notify(e.message,'error');button.disabled=false}};
 await load(true);
}
