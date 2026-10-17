/* Display the issued membership card with the existing approved INEXC design. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),token=params.get('token')||'';
 const preview=params.get('preview')==='1'&&!token;
 let current;
 const date=value=>value&&Number.isFinite(new Date(value).getTime())?new Intl.DateTimeFormat('ar-AE',{year:'numeric',month:'long',day:'numeric'}).format(new Date(value)):'غير محدد';
 function cardData(snapshot){
  const plan=snapshot.plan||{},title=window.INEXCCardLabels.cardName(snapshot.cardName||plan.name);
  const expired=snapshot.status==='expired'||(snapshot.expiresAt&&new Date(snapshot.expiresAt).getTime()<Date.now());
  const status=snapshot.status==='suspended'?'بطاقة موقوفة':expired?'انتهت صلاحية البطاقة':Number(snapshot.unitsRemaining)===0?'الرصيد مستنفد':snapshot.status==='active'?'بطاقة فعّالة':'بطاقة تدريبية';
  return {
   data:{profile:{full_name:snapshot.holderName,specialty:plan.name||title},digitalId:{idNumber:snapshot.cardNumber,tierLabel:status}},
   options:{demo:preview,title,subtitle:'INEXC MEMBERSHIP CARD',numberLabel:'رقم البطاقة',status:'صالحة حتى '+date(snapshot.expiresAt),qrCaption:'افتح صفحة البطاقة',
    // Membership access tokens are private. The QR opens lookup, never the bearer link.
    qrUrl:new URL('/my-card/',location.origin).href}
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
 }
 async function load(){
  $('error').textContent='';$('show').disabled=true;
  try{
   const query=token?'token='+encodeURIComponent(token):'code='+encodeURIComponent($('code').value.trim())+'&email='+encodeURIComponent($('email').value.trim());
   const response=await fetch(window.INEXC_REGISTRATION_ENDPOINT+'/memberships/card?'+query),snapshot=await response.json();
   if(!response.ok)throw Error(snapshot.error||'تعذر عرض البطاقة.');
   show(snapshot);
  }catch(error){$('error').textContent=error.message||'تعذر عرض البطاقة.'}
  finally{$('show').disabled=false}
 }
 $('show').addEventListener('click',load);
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
 }else if(token)load();
})();
