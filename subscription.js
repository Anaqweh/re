import {subscriptionUrl} from './inexc-api/message-subscription-links.js?v=20261015-sub1';
const $=s=>document.querySelector(s),endpoint=window.INEXC_REGISTRATION_ENDPOINT||'https://api.inexctraining.com/api';
const params=new URLSearchParams(location.search),source=params.get('source')||'';
const token=new URLSearchParams(location.hash.slice(1)).get('confirm')||'';
// Remove bearer tokens from the address bar; never forward them in share links.
if(token)history.replaceState(null,'',location.pathname);
let config;
const status=(message,kind='')=>{const node=$('#status');node.textContent=message;node.className='notice '+kind;node.hidden=!message;};
async function api(path,body){const r=await fetch(endpoint+'/message-subscriptions/'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});const data=await r.json().catch(()=>({}));if(!r.ok||!data||Array.isArray(data))throw Error(data.error||'خدمة الاشتراك غير متاحة الآن. يرجى المحاولة لاحقًا.');return data;}
async function init(){
 try{
  const data=await api('config');if(data.version!==1||!data.settings)throw Error('سيُتاح الاشتراك قريبًا. يرجى المحاولة لاحقًا.');config=data.settings;
  document.querySelectorAll('[data-copy]').forEach(n=>{if(typeof config[n.dataset.copy]==='string')n.textContent=config[n.dataset.copy]});document.title=config.formTitle+' | '+config.brandName;
  const link=subscriptionUrl(source,false,location.origin);$('#share-link').value=link;$('#whatsapp').href='https://wa.me/?text='+encodeURIComponent(config.shareText+'\n'+link);
  $('#copy-link').onclick=async()=>{try{await navigator.clipboard.writeText(link);$('#share-feedback').textContent='تم نسخ رابط الاشتراك.';}catch{$('#copy-fallback').hidden=false;$('#share-link').focus();$('#share-link').select();$('#share-feedback').textContent='حدّد الرابط وانسخه للمشاركة.'}};
  if(navigator.share){$('#native-share').hidden=false;$('#native-share').onclick=async()=>{try{await navigator.share({title:config.formTitle,text:config.shareText,url:link})}catch(e){if(e.name!=='AbortError')$('#share-feedback').textContent='يمكنك نسخ الرابط أو مشاركته عبر واتساب.'}};}
  if(!config.enabled){status('الاشتراك غير متاح حاليًا. يمكنك زيارة الموقع للاطلاع على برامجنا.');return;}
  status('');$('#share-box').hidden=false;
  if(params.get('share')==='1'&&!token){$('#share-box').classList.add('featured');$('.form-side').prepend($('#share-box'));}
  if(token){$('#confirmation').hidden=false;$('#share-box').hidden=true;return;}
  if(!data.available){status('خدمة الاشتراك غير متاحة الآن. يرجى المحاولة لاحقًا.');return;}
  $('#subscribe-content').hidden=false;
 }catch(e){status(e.name==='TimeoutError'?'تعذر الاتصال بالخادم. حدّث الصفحة للمحاولة مجددًا.':e.message,'error');}
}
$('#subscribe-form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('button[type=submit]');if(!form.reportValidity())return;button.disabled=true;status('جارٍ إرسال طلب الاشتراك…');try{const result=await api('request',{name:form.elements.name.value,email:form.elements.email.value,consent:form.elements.consent.checked,website:form.elements.website.value,source});status(result.message,'success');form.hidden=true;}catch(e){status(e.message,'error')}finally{button.disabled=false}};
$('#confirm-button').onclick=async()=>{const button=$('#confirm-button');button.disabled=true;status('جارٍ تأكيد الاشتراك…');try{await api('confirm',{token});status('');$('#confirmation').hidden=true;$('#confirmed').hidden=false;$('#share-box').hidden=false;}catch(e){status(e.message,'error');$('#restart').hidden=false;}finally{button.disabled=false}};
init();
