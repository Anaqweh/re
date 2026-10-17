/* Display the issued membership card with the existing approved INEXC design. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),token=params.get('token')||'',share=params.get('share')||'';
 const preview=params.get('preview')==='1'&&!token&&!share;
 let current,shareUrl='';
 const date=value=>value&&Number.isFinite(new Date(value).getTime())?new Intl.DateTimeFormat('ar-AE',{year:'numeric',month:'long',day:'numeric'}).format(new Date(value)):'غير محدد';
 function cardData(snapshot){
  const plan=snapshot.plan||{},title=window.INEXCCardLabels.cardName(snapshot.cardName||plan.name);
  const expired=snapshot.status==='expired'||(snapshot.expiresAt&&new Date(snapshot.expiresAt).getTime()<Date.now());
  const status=snapshot.status==='suspended'?'بطاقة موقوفة':expired?'انتهت صلاحية البطاقة':snapshot.publicStatus|| (Number(snapshot.unitsRemaining)===0?'الرصيد مستنفد':snapshot.status==='active'?'بطاقة فعّالة':'بطاقة تدريبية');
  return {
   data:{profile:{full_name:snapshot.holderName,specialty:plan.name||title},digitalId:{idNumber:share?'INEXC':snapshot.cardNumber,tierLabel:status}},
   options:{demo:preview,title,subtitle:'INEXC MEMBERSHIP CARD',numberLabel:share?'بطاقة تدريبية':'رقم البطاقة',status:'صالحة حتى '+date(snapshot.expiresAt),qrCaption:'افتح صفحة البطاقة',
    // Membership access tokens are private. The QR opens lookup, never the bearer link.
    qrUrl:share?location.href:new URL('/my-card/',location.origin).href}
  };
 }
 function show(snapshot){
  current=cardData(snapshot);
  $('membershipCard').innerHTML=window.TraineeCard.renderCard(current.data,current.options);
  document.querySelector('.intro h1').textContent=current.options.title;
  document.querySelector('.intro p').textContent='بيانات بطاقتك ورصيدك التدريبي وسجل الحجوزات.';
  $('credits').textContent=snapshot.unitsRemaining+' من '+snapshot.unitsTotal;
  $('expires').textContent=date(snapshot.expiresAt);
  const plan=snapshot.plan||{};
  $('discount').textContent=plan.certificateDiscount?plan.certificateDiscount+'%':'غير متاح';
  $('early').textContent=plan.earlyAccessHours?'قبل العامة بـ'+plan.earlyAccessHours+' ساعة':'غير متاح';
  const history=$('history');history.replaceChildren();
  for(const row of snapshot.redemptions||[]){
   const entry=document.createElement('div'),name=document.createElement('b'),details=document.createElement('span');
   entry.className='entry';name.textContent=row.courseName;details.textContent='استخدم '+row.unitsUsed+' من الرصيد · '+date(row.createdAt);
   entry.append(name,details);history.append(entry);
  }
  if(!history.childElementCount){const empty=document.createElement('p');empty.className='entry';empty.textContent='لم تستخدم البطاقة في أي حجز بعد.';history.append(empty)}
  $('lookup').style.display='none';$('result').style.display='block';
  if(share){
   $('learnerWorkspaceLink').parentElement.hidden=true;
   $('downloadCard').hidden=true;
   document.querySelector('.stats').hidden=true;
   document.querySelector('.history').hidden=true;
   document.querySelector('.intro p').textContent='بطاقة تدريبية تمت مشاركتها للعرض.';
   const offer=snapshot.offer||{},free=offer.free===true&&/^[a-f0-9-]{36}$/i.test(offer.planId||'');
   $('sharedOffer').hidden=false;
   $('sharedOfferText').textContent=free?'يمكنك الاطلاع على الباقة المجانية نفسها ومزاياها على الموقع.':'تعرّف إلى الباقات التدريبية المتاحة واختر ما يناسبك.';
   $('sharedOfferLink').textContent=free?'الانتقال إلى الباقة المجانية ←':'استعرض جميع الباقات ←';
   $('sharedOfferLink').href=free?'/cards/?plan='+encodeURIComponent(offer.planId):'/cards/';
  }else if(!preview){$('shareTools').hidden=false}
 }
 async function load(){
  $('error').textContent='';$('show').disabled=true;
  try{
   const query=share?'share='+encodeURIComponent(share):token?'token='+encodeURIComponent(token):'code='+encodeURIComponent($('code').value.trim())+'&email='+encodeURIComponent($('email').value.trim());
   const response=await fetch(window.INEXC_REGISTRATION_ENDPOINT+(share?'/memberships/card/shared?':'/memberships/card?')+query,{cache:'no-store'}),snapshot=await response.json();
   if(!response.ok)throw Error(snapshot.error||'تعذر عرض البطاقة.');
   show(snapshot);
  }catch(error){$('error').textContent=error.message||'تعذر عرض البطاقة.'}
  finally{$('show').disabled=false}
 }
 $('show').addEventListener('click',load);
 async function getShareUrl(){
  if(shareUrl)return shareUrl;
  const body=token?{token}:{code:$('code').value.trim(),email:$('email').value.trim()};
  const response=await fetch(window.INEXC_REGISTRATION_ENDPOINT+'/memberships/card/share',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
  const payload=await response.json();if(!response.ok)throw Error(payload.error||'تعذر تجهيز رابط المشاركة.');
  shareUrl=payload.url;return shareUrl;
 }
 function renderSharePreview(url){
  const publicData={...current.data,digitalId:{...current.data.digitalId,idNumber:'INEXC'}};
  const publicOptions={...current.options,numberLabel:'بطاقة تدريبية',qrUrl:url||new URL('/my-card/',location.origin).href};
  $('shareCardPreview').innerHTML=window.TraineeCard.renderCard(publicData,publicOptions);
 }
 async function saveSocialPreview(url){
  const shareToken=new URL(url).pathname.split('/').pop();
  if(!/^[a-f0-9]{64}$/.test(shareToken))throw Error('تعذر تجهيز رابط البطاقة.');
  const publicData={...current.data,digitalId:{...current.data.digitalId,idNumber:'INEXC'}};
  const publicOptions={...current.options,numberLabel:'بطاقة تدريبية',qrUrl:url};
  const image=await window.TraineeCard.socialPreviewPNG(publicData,publicOptions);
  const credentials=token?{'X-Card-Token':token}:{'X-Card-Code':$('code').value.trim(),'X-Card-Email':$('email').value.trim()};
  const response=await fetch(window.INEXC_REGISTRATION_ENDPOINT+'/memberships/card/share/image',{method:'POST',headers:{'Content-Type':'image/png','X-Card-Share':shareToken,...credentials},body:image,cache:'no-store'});
  if(!response.ok)throw Error('تعذر حفظ صورة معاينة الرابط. حاول مرة أخرى.');
  const saved=await response.json();
  if(!saved.url||new URL(saved.url).pathname!==new URL(url).pathname)throw Error('تعذر تأكيد رابط المشاركة.');
  return saved.url;
 }
 $('openShare').addEventListener('click',async()=>{
  if(!current)return;
  const dialog=$('shareDialog'),status=$('shareStatus');
  status.textContent='جارٍ تجهيز رابط البطاقة…';
  $('shareLink').value='جارٍ تجهيز الرابط…';
  $('copyShare').disabled=true;$('nativeShare').disabled=true;
  renderSharePreview('');
  dialog.showModal();
  try{
   const url=await getShareUrl();
   $('shareLink').value=url;renderSharePreview(url);
   status.textContent='جارٍ تجهيز صورة البطاقة لتظهر عند مشاركة الرابط…';
   shareUrl=await saveSocialPreview(url);
   $('shareLink').value=shareUrl;
   $('copyShare').disabled=false;$('nativeShare').disabled=false;
   status.textContent='أصبحت صورة البطاقة جاهزة للظهور مع الرابط. انسخه أو شاركه.';
  }catch(error){status.textContent=error.message||'تعذر تجهيز رابط المشاركة.'}
 });
 $('closeShare').addEventListener('click',()=>$('shareDialog').close());
 $('shareDialog').addEventListener('click',event=>{if(event.target===$('shareDialog'))$('shareDialog').close()});
 async function shareAction(native){
  const status=$('shareStatus'),button=$(native?'nativeShare':'copyShare');status.textContent='جارٍ تجهيز الرابط…';button.disabled=true;
  try{
   const url=await getShareUrl();
   if(native&&navigator.share){await navigator.share({title:current.options.title,text:'بطاقتي التدريبية لدى INEXC',url});status.textContent='تم فتح خيارات المشاركة.'}
   else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(url);status.textContent='نُسخ رابط المشاركة. رقم البطاقة لا يظهر للآخرين.'}
   else{$('shareLink').focus();$('shareLink').select();status.textContent='الرابط محدد؛ انسخه للمشاركة.'}
  }catch(error){status.textContent=error.name==='AbortError'?'أُلغيت المشاركة.':error.message||'تعذر مشاركة البطاقة.'}
  finally{button.disabled=false}
 }
 $('copyShare').addEventListener('click',()=>shareAction(false));
 $('nativeShare').addEventListener('click',()=>shareAction(true));
 $('downloadCard').addEventListener('click',async()=>{
  if(!current)return;
  const button=$('downloadCard'),feedback=$('downloadStatus');button.disabled=true;feedback.textContent='';
  try{
   const blob=await window.TraineeCard.pngFile(current.data,current.options);
   window.TraineeCard.downloadPNG(blob,current.data.digitalId.idNumber,preview);
   feedback.textContent='تم تجهيز البطاقة كصورة PNG.';feedback.style.color='#27623c';
  }catch(error){feedback.textContent=error.message||'تعذر تحميل البطاقة. أعد المحاولة.';feedback.style.color='#b02b3a'}
  finally{button.disabled=false}
 });
 $('learnerWorkspaceLink').addEventListener('click',event=>{if(token){event.preventDefault();location.assign('/account.html#card='+encodeURIComponent(token))}});
 if(preview){
  $('previewNotice').hidden=false;
  show({cardName:'بطاقة الريادة',cardNumber:'INEXC-DEMO-001',holderName:'سارة محمد عبدالله',status:'active',expiresAt:'2027-01-28T00:00:00Z',unitsRemaining:8,unitsTotal:10,plan:{name:'باقة الريادة',certificateDiscount:20,earlyAccessHours:24},redemptions:[]});
 }else if(token||share)load();
})();
