/* Named card eligibility in the existing course editor. No payment configuration writes. */
(()=>{
 const $=id=>document.getElementById(id),form=$('courseForm');if(!form)return;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const box=document.createElement('fieldset');box.id='courseCardAccess';box.className='course-card-settings';box.disabled=true;
 box.innerHTML='<legend>تمييز الدورة والبطاقات المقبولة</legend><label class="course-featured-choice"><input id="courseFeatured" type="checkbox"> دورة مميّزة <small>إظهار شارة «مميّزة» على الدورة.</small></label><label for="courseCardScope">صلاحية التسجيل بالبطاقة</label><select id="courseCardScope"><option value="all">صالحة لجميع البطاقات</option><option value="selected">صالحة لبطاقات محددة</option><option value="none">التسجيل بالبطاقة غير متاح</option></select><div id="courseCardPlans" class="course-card-options" hidden></div><p id="courseCardSummary" class="note" aria-live="polite"></p>';
 $('courseActive').closest('label').before(box);
 const notice=document.createElement('p');notice.id='courseCardNotice';notice.className='note';notice.setAttribute('role','status');box.after(notice);
 const legacy=$('payMembership');legacy.closest('label').hidden=true;
 let ready=false,plans=[],current={},loadedCourses=[],generation=0,loading;
 const signedIn=()=>window.INEXCAdminSession?.valid?.()&&!!sessionStorage.getItem('inexc_do_admin');
 const selected=()=>[...$('courseCardPlans').querySelectorAll('input:checked')].map(n=>n.value);
 function renderSummary(){
  const mode=$('courseCardScope').value;legacy.checked=mode!=='none';$('courseCardPlans').hidden=mode!=='selected';
  const names=plans.filter(p=>selected().includes(p.id)).map(p=>p.cardName);
  $('courseCardSummary').textContent=mode==='all'?'صالحة لجميع البطاقات الحالية والجديدة، وفق الرصيد والصلاحية.':mode==='none'?'التسجيل بالبطاقة غير متاح لهذه الدورة.':names.length?'صالحة لـ'+names.join('، ولـ'):'اختر بطاقة واحدة على الأقل.';
 }
 function setCourse(course={}){
  current=course;$('courseFeatured').checked=course.featured===true;
  $('courseCardScope').value=course.membershipEnabled===false?'none':Array.isArray(course.membershipPlanIds)?'selected':'all';
  $('courseCardPlans').innerHTML=plans.map(p=>'<label><input id="course-card-'+esc(p.id)+'" type="checkbox" value="'+esc(p.id)+'" '+(course.membershipPlanIds?.includes(p.id)?'checked':'')+'>'+esc(p.cardName)+(p.active===false?'<small>غير معروضة للبيع</small>':'')+'</label>').join('');
  renderSummary();
 }
 function restore(list=loadedCourses){
  loadedCourses=list;const course=list.find(c=>c.id===$('courseId').value);
  if(course)setCourse(course);
  window.INEXCAdminDrafts?.restoreScope?.(form,true);
  if(!course&&current.id==null&&$('courseCardScope').value==='all'&&!legacy.checked)$('courseCardScope').value='none';
  renderSummary();
 }
 function payload(){
  if(!ready||($('courseId').value&&current.id!==$('courseId').value))return {};
  const mode=$('courseCardScope').value,ids=selected();
  return {featured:$('courseFeatured').checked,membershipPlanIds:mode==='all'?null:mode==='selected'?ids:(ids.length?ids:current.membershipPlanIds??null)};
 }
 async function load(){
  if(!signedIn()||loading)return loading;const version=++generation,wasReady=ready,snapshot=ready?{...current,...payload(),membershipEnabled:legacy.checked}:current;
  notice.textContent='جارٍ تحميل أسماء البطاقات…';
  loading=(async()=>{try{
   const r=await fetch(window.INEXC_REGISTRATION_ENDPOINT+'/admin/course-card-options',{cache:'no-store',headers:{Authorization:'Bearer '+sessionStorage.getItem('inexc_do_admin')}}),d=await r.json();
   if(!r.ok||d.version!==1||!Array.isArray(d.plans))throw Error('يلزم تحديث الخادم لإتاحة تمييز الدورة واختيار البطاقات بأسمائها.');
   if(version!==generation)return;plans=d.plans;ready=true;box.disabled=false;legacy.closest('label').hidden=true;notice.textContent='';setCourse(snapshot);if(!wasReady)restore();
  }catch(e){if(version!==generation)return;ready=false;box.disabled=true;legacy.closest('label').hidden=false;notice.textContent=e.message;}
  finally{if(version===generation)loading=null;}})();return loading;
 }
 box.addEventListener('change',renderSummary);
 form.addEventListener('submit',event=>{if(ready&&$('courseCardScope').value==='selected'&&!selected().length){event.preventDefault();event.stopImmediatePropagation();$('courseError').textContent='اختر بطاقة واحدة على الأقل، أو اختر «صالحة لجميع البطاقات».';$('courseCardScope').focus();}},true);
 window.INEXCCourseCards={setCourse,payload,restore,refresh:load,ready:()=>ready,reset:()=>setCourse({membershipEnabled:legacy.checked})};
 window.addEventListener('inexc:unlocked',()=>void load());
 window.addEventListener('inexc:membership-plans-updated',()=>void load());
 window.addEventListener('inexc:locked',()=>{generation++;loading=null;ready=false;plans=[];box.disabled=true;setCourse({});notice.textContent='سجّل الدخول لعرض البطاقات.';});
 setCourse({membershipEnabled:legacy.checked});if(signedIn())void load();
})();
