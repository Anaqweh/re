/* Read-only card directory. Existing payment and issuance workflows stay in their own section. */
(()=>{'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const date=v=>v&&Number.isFinite(Date.parse(v))?new Intl.DateTimeFormat('ar-AE',{dateStyle:'medium',timeZone:'Asia/Dubai'}).format(new Date(v)):'—';
 const money=v=>Number.isFinite(Number(v))?Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' USD':'—';
 const uuid=/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
 const token=()=>sessionStorage.getItem('inexc_do_admin')||'';
 const allowed=()=>!!token()&&window.INEXCAdminSession?.valid()===true;
 const apiBase=window.INEXC_REGISTRATION_ENDPOINT;
 let root,tab,mode='orders',orders=[],cards=[],profiles=[],total=0,page=0,seq=0,controller,sdkPromise,searchTimer;
 const size=25,$=selector=>root.querySelector(selector);
 const cardLink=card=>/^[a-f\d]{48}$/i.test(card?.access_token||'')?'/my-card/?token='+encodeURIComponent(card.access_token):'';
 const openLink=(href,label)=>href?`<a class="cd-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`:'<span class="cd-muted">غير متاحة بعد</span>';
 async function api(path,signal){
   const response=await fetch(apiBase+path,{headers:{Authorization:'Bearer '+token()},cache:'no-store',signal});
   const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||'تعذّر تحميل السجلات.');return data;
 }
 function script(src){return new Promise((resolve,reject)=>{const el=document.createElement('script');el.src=src;const timer=setTimeout(()=>{el.remove();reject(Error('انتهت مهلة تحميل خدمة سجلات المتدربين.'))},12000);el.onload=()=>{clearTimeout(timer);resolve()};el.onerror=()=>{clearTimeout(timer);el.remove();reject(Error('تعذر تحميل خدمة سجلات المتدربين.'))};document.head.append(el)})}
 function client(){
   if(window.supabaseClient)return Promise.resolve(window.supabaseClient);
   if(!sdkPromise)sdkPromise=(async()=>{if(!window.supabase?.createClient)await script('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');if(!window.supabaseClient)await script('/supabase-config.js');if(!window.supabaseClient)throw Error('خدمة سجلات المتدربين غير مهيأة.');return window.supabaseClient})().catch(e=>{sdkPromise=null;throw e});
   return sdkPromise;
 }
 function status(value,issued=false){return `<span class="cd-status ${issued?'is-issued':''}">${esc(value||'—')}</span>`}
 function cardStatus(card){const state=card.status==='active'&&Date.parse(card.expires_at)<=Date.now()?'expired':card.status;return status(({active:'فعّالة',suspended:'موقوفة',expired:'منتهية الصلاحية'})[state]||state||'صادرة',state==='active')}
 function issuedCard(order){return cards.find(c=>c.id===order.card_id||c.order_id===order.id)||null}
 function memberRows(){
   const term=$('[data-cd-search]').value.trim().toLowerCase(),state=$('[data-cd-state]').value;
   if(mode==='orders')return orders.filter(o=>{
     const card=issuedCard(o),issued=!!(o.card_number||card);
     return (!state||(state==='issued'?issued:!issued&&o.status===state))&&[o.name,o.email,o.phone,o.plan_name,o.reference,o.card_number,card?.card_number].join(' ').toLowerCase().includes(term);
   });
   return cards.filter(c=>[c.holder_name,c.holder_email,c.holder_phone,c.plan_name,c.card_number].join(' ').toLowerCase().includes(term));
 }
 function metrics(){
   const issued=orders.filter(o=>o.card_number||issuedCard(o)),buyers=new Set(issued.map(o=>String(o.email||'').trim().toLowerCase()).filter(Boolean));
   $('[data-cd-metrics]').innerHTML=[['المشترون الذين صدرت بطاقاتهم',buyers.size],['البطاقات التدريبية الصادرة',cards.length],['طلبات شراء البطاقات',orders.length]].map(([label,n])=>`<div><span>${label}</span><strong>${n.toLocaleString('ar-AE')}</strong></div>`).join('');
 }
 function render(){
   const rows=mode==='trainees'?profiles:memberRows();total=mode==='trainees'?total:rows.length;
   if(mode!=='trainees')page=Math.min(page,Math.max(0,Math.ceil(total/size)-1));
   const visible=mode==='trainees'?rows:rows.slice(page*size,(page+1)*size);
   let headings,body;
   if(mode==='orders'){
     headings=['المشتري','البطاقة / الطلب','المبلغ وطريقة الدفع','الحالة والتاريخ','البطاقة الصادرة'];
     body=visible.map(o=>{const card=issuedCard(o),number=o.card_number||card?.card_number;return `<tr><td><strong>${esc(o.name)}</strong><bdi>${esc(o.email)}</bdi>${o.phone?`<bdi>${esc(o.phone)}</bdi>`:''}</td><td>${esc(o.plan_name)}<small>${esc(o.reference)}</small></td><td><bdi>${money(o.total)}</bdi><small>${o.payment_method==='stripe'?'دفع إلكتروني':o.payment_method==='bank'?'تحويل بنكي':'رابط دفع'}</small></td><td>${status(o.status,!!number)}<small>${date(o.created_at)}</small></td><td>${number?`<bdi>${esc(number)}</bdi>`:''}${openLink(cardLink(card),'فتح البطاقة التدريبية')}</td></tr>`}).join('');
   }else if(mode==='cards'){
     headings=['صاحب البطاقة','الفئة ورقم البطاقة','الرصيد المتبقي','الحالة والصلاحية','عرض البطاقة'];
     body=visible.map(c=>`<tr><td><strong>${esc(c.holder_name)}</strong><bdi>${esc(c.holder_email)}</bdi>${c.holder_phone?`<bdi>${esc(c.holder_phone)}</bdi>`:''}</td><td>${esc(c.plan_name)}<bdi>${esc(c.card_number)}</bdi></td><td><bdi>${Number(c.units_remaining)||0} / ${Number(c.units_total)||0}</bdi></td><td>${cardStatus(c)}<small>تنتهي ${date(c.expires_at)}</small></td><td>${openLink(cardLink(c),'فتح البطاقة التدريبية')}</td></tr>`).join('');
   }else{
     headings=['المتدرب','رقم المتدرب','التخصص','تاريخ إنشاء السجل','البطاقة الرقمية'];
     body=visible.map(p=>`<tr><td><strong>${esc(p.full_name||'متدرب INEXC')}</strong><bdi>${esc(p.email)}</bdi>${p.phone?`<bdi>${esc(p.phone)}</bdi>`:''}</td><td><bdi>${uuid.test(p.id)?'INEXC-'+p.id.replaceAll('-','').slice(0,8).toUpperCase():'—'}</bdi></td><td>${esc(p.specialty||'—')}</td><td>${date(p.created_at)}</td><td>${openLink(uuid.test(p.id)?'/digital-id.html?id='+encodeURIComponent(p.id):'','عرض بطاقة المتدرب')}</td></tr>`).join('');
   }
   $('[data-cd-table]').innerHTML=visible.length?`<table><thead><tr>${headings.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`:'<div class="cd-empty">لا توجد سجلات تطابق العرض الحالي.</div>';
   $('[data-cd-count]').textContent=total===null?(visible.length?`${page*size+1}–${page*size+visible.length}`:'لا توجد سجلات في هذه الصفحة'):total?`${page*size+1}–${Math.min((page+1)*size,total)} من ${total}`:'0 سجلات';
   $('[data-cd-prev]').disabled=page===0;$('[data-cd-next]').disabled=total===null?visible.length<size:(page+1)*size>=total;
 }
 async function load(){
   if(!allowed())return;
   const current=++seq,session=token();controller?.abort();controller=new AbortController();
   const signal=controller.signal,currentMode=mode,stillCurrent=()=>current===seq&&session===token()&&allowed();
   $('[data-cd-error]').hidden=true;$('[data-cd-table]').innerHTML='<p class="cd-empty" role="status">جارٍ تحميل السجلات…</p>';$('[data-cd-prev]').disabled=$('[data-cd-next]').disabled=true;
   const requestController=controller,timeout=setTimeout(()=>requestController.abort(),20000),refresh=$('[data-cd-refresh]');refresh.disabled=true;
   try{
     if(currentMode==='trainees'){
       // Validate the administrator with the protected API before reading the
       // existing trainee source. No admin token is sent to the trainee service.
       await api('/admin/memberships/plans',signal);if(!stillCurrent())return;
       const db=await client();if(!stillCurrent())return;
       let query=db.from('trainee_profiles').select('id,full_name,email,phone,specialty,created_at',{count:'exact'}).order('created_at',{ascending:false}).order('id',{ascending:false});
       const search=$('[data-cd-search]').value.trim(),field=$('[data-cd-field]').value;
       if(search&&['full_name','email','phone'].includes(field))query=query.ilike(field,'%'+search+'%');
       const result=await query.range(page*size,(page+1)*size-1).abortSignal(signal);
       if(result.error)throw Error('تعذّر تحميل بطاقات المتدربين: '+result.error.message);
       if(!stillCurrent())return;profiles=result.data||[];total=Number.isFinite(result.count)?result.count:null;
     }else{
       const [orderData,cardData]=await Promise.all([api('/admin/memberships/orders',signal),api('/admin/memberships/cards',signal)]);
       if(!stillCurrent())return;if(!Array.isArray(orderData)||!Array.isArray(cardData))throw Error('تعذّر قراءة سجلات البطاقات.');orders=orderData;cards=cardData;metrics();
     }
     if(stillCurrent())render();
   }catch(e){if(stillCurrent()){const error=$('[data-cd-error]');error.hidden=false;error.textContent=e.name==='AbortError'?'انتهت مهلة الاتصال. اضغط تحديث للمحاولة مجددًا.':e.message;$('[data-cd-table]').replaceChildren();$('[data-cd-metrics]').replaceChildren();$('[data-cd-count]').textContent='تعذّر التحميل';}}
   finally{clearTimeout(timeout);if(current===seq)refresh.disabled=false;}
 }
 function switchMode(value){
   if(!allowed()||!['orders','cards','trainees'].includes(value))return;mode=value;page=0;clearTimeout(searchTimer);$('[data-cd-search]').value='';$('[data-cd-state]').value='';
   root.querySelectorAll('[data-cd-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.cdMode===mode)));
   $('[data-cd-search]').placeholder=mode==='trainees'?'ابحث بحسب الحقل المختار':'الاسم أو البريد أو الهاتف أو رقم البطاقة';$('[data-cd-state-wrap]').hidden=mode!=='orders';$('[data-cd-field-wrap]').hidden=mode!=='trainees';$('[data-cd-metrics]').hidden=mode==='trainees';
   $('[data-cd-description]').textContent=mode==='orders'?'أسماء المشترين وطلبات الشراء وحالة الدفع والبطاقات الصادرة.':mode==='cards'?'البطاقات التدريبية الصادرة، وأصحابها، وأرصدتها وصلاحيتها.':'بطاقات المتدربين الرقمية المرتبطة بحساباتهم وسجلاتهم التدريبية.';
   load();
 }
 function open(){if(!allowed())return;document.querySelectorAll('.tabs button,.view').forEach(n=>n.classList.remove('active'));tab.classList.add('active');root.classList.add('active');load()}
 function mount(){
   if(document.getElementById('card-directory')||!document.querySelector('.tabs'))return;
   const link=document.createElement('link');link.rel='stylesheet';link.href='/admin-card-directory.css?v=20261016-directory1';document.head.append(link);
   tab=document.createElement('button');tab.type='button';tab.className='light';tab.dataset.view='card-directory';tab.textContent='البطاقات والمتدربون';document.querySelector('.tabs').append(tab);
   root=document.createElement('section');root.id='card-directory';root.className='view';root.dir='rtl';document.querySelector('main').append(root);
   root.innerHTML=`<header class="cd-head"><div><p class="cd-eyebrow">INEXC / CARD DIRECTORY</p><h2>مشترو البطاقات وبطاقات المتدربين</h2><p data-cd-description>أسماء المشترين وطلبات الشراء وحالة الدفع والبطاقات الصادرة.</p></div><div class="cd-actions"><button type="button" class="light" data-cd-manage>إدارة طلبات البطاقات</button><button type="button" class="light" data-cd-refresh>تحديث</button></div></header>
   <nav class="cd-tabs" aria-label="نوع سجلات البطاقات"><button type="button" data-cd-mode="orders" aria-pressed="true">المشترون والطلبات</button><button type="button" data-cd-mode="cards" aria-pressed="false">البطاقات التدريبية الصادرة</button><button type="button" data-cd-mode="trainees" aria-pressed="false">بطاقات المتدربين</button></nav>
   <div class="cd-metrics" data-cd-metrics></div><div class="cd-filters"><label class="cd-search">بحث<input type="search" data-cd-search placeholder="الاسم أو البريد أو الهاتف أو رقم البطاقة" autocomplete="off"></label><label data-cd-state-wrap>حالة الطلب<select data-cd-state><option value="">جميع الطلبات</option><option value="issued">المشترون — صدرت بطاقاتهم</option><option value="بانتظار الدفع">بانتظار الدفع</option><option value="بانتظار مراجعة الدفع">بانتظار مراجعة الدفع</option><option value="مرفوض">مرفوض</option><option value="انتهت مهلة الدفع">انتهت مهلة الدفع</option><option value="لم يكتمل الدفع">لم يكتمل الدفع</option></select></label><label data-cd-field-wrap hidden>البحث حسب<select data-cd-field><option value="full_name">اسم المتدرب</option><option value="email">البريد الإلكتروني</option><option value="phone">رقم الهاتف</option></select></label></div>
   <p class="cd-error" data-cd-error role="alert" hidden></p><div class="cd-table" data-cd-table></div><footer class="cd-pagination"><span data-cd-count role="status"></span><div><button type="button" class="light" data-cd-prev disabled>السابق</button><button type="button" class="light" data-cd-next disabled>التالي</button></div></footer>`;
   tab.onclick=open;window.addEventListener('inexc:card-directory',open);
   root.querySelectorAll('[data-cd-mode]').forEach(b=>b.onclick=()=>switchMode(b.dataset.cdMode));$('[data-cd-refresh]').onclick=()=>load();
   $('[data-cd-manage]').onclick=()=>document.querySelector('[data-view="memberships"]')?.click();
   $('[data-cd-search]').oninput=()=>{clearTimeout(searchTimer);page=0;if(mode==='trainees'){seq++;controller?.abort();$('[data-cd-table]').innerHTML='<p class="cd-empty" role="status">جارٍ البحث…</p>';$('[data-cd-prev]').disabled=$('[data-cd-next]').disabled=true;searchTimer=setTimeout(load,300)}else if(allowed())render()};
   $('[data-cd-state]').onchange=()=>{if(allowed()){page=0;render()}};$('[data-cd-field]').onchange=()=>{page=0;load()};
   for(const [selector,direction]of [['[data-cd-prev]',-1],['[data-cd-next]',1]])$(selector).onclick=()=>{if(!allowed())return;page+=direction;if(mode==='trainees')load();else render()};
   window.addEventListener('inexc:locked',()=>{seq++;controller?.abort();clearTimeout(searchTimer);orders=[];cards=[];profiles=[];total=page=0;for(const selector of ['[data-cd-table]','[data-cd-metrics]','[data-cd-count]'])$(selector).replaceChildren();$('[data-cd-search]').value='';$('[data-cd-error]').hidden=true;$('[data-cd-refresh]').disabled=false;});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();
