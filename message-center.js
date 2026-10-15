import {newSubscriberIcon} from './message-subscriptions-ui.js?v=20261015-sub2';
// Keep the existing center usable until the matching API has been deployed.
async function boot() {
  const tabs=document.querySelector('.tabs');if(!tabs||document.querySelector('[data-view="message-center"]'))return;
  const button=document.createElement('button');button.type='button';button.className='light';button.dataset.view='message-center';button.textContent='مركز الرسائل';tabs.append(button);
  const subscribers=document.createElement('button');subscribers.type='button';subscribers.className='light';subscribers.dataset.view='new-subscribers';subscribers.style.cssText='display:inline-flex;align-items:center;justify-content:center;gap:7px';subscribers.innerHTML=newSubscriberIcon+'<span>المشتركون الجدد</span><span data-new-subscriber-count hidden style="background:#0868ce;color:white;border-radius:20px;padding:0 7px;font-size:12px"></span>';tabs.append(subscribers);
  const endpoint=window.INEXC_REGISTRATION_ENDPOINT||'https://api.inexctraining.com/api';
  let openStudio,loading;
  const open=async(view)=>{
    if(!sessionStorage.getItem('inexc_do_admin') || (window.INEXCAdminSession&&!window.INEXCAdminSession.valid()))return;
    if(openStudio)return openStudio(view);
    if(loading){await loading;return openStudio?.(view);}
    button.disabled=subscribers.disabled=true;
    loading=(async()=>{
      try{
        const response=await fetch(endpoint+'/admin/message-capabilities',{headers:{Authorization:'Bearer '+(sessionStorage.getItem('inexc_do_admin')||'')},signal:AbortSignal.timeout(12000)}),caps=await response.json();
        if(response.status===401 || !sessionStorage.getItem('inexc_do_admin'))return;
        if(response.ok&&caps.studio>=2){const studio=await import(caps.studio>=5?'./message-studio-ui.js?v=20261016-workspace1':caps.studio>=4?'./message-studio-v4-ui.js?v=20261015-blue4':caps.studio>=3?'./message-studio-v3-ui.js?v=20261015-studio3':'./message-studio-v2-ui.js?v=20261015-compat');openStudio=await studio.mountMessageStudio(button);await openStudio(view);}
        else{button.remove();subscribers.remove();await import('./message-center-legacy.js?v=20261015-studio3');document.querySelector('[data-view="message-center"]')?.click();}
      }catch{if(!sessionStorage.getItem('inexc_do_admin'))return;button.remove();subscribers.remove();await import('./message-center-legacy.js?v=20261015-studio3');document.querySelector('[data-view="message-center"]')?.click();}
      finally{button.disabled=subscribers.disabled=false;loading=null;}
    })();await loading;
  };
  button.onclick=()=>open();subscribers.onclick=()=>open('new-subscribers');
  async function count(){const token=sessionStorage.getItem('inexc_do_admin');if(!token||document.visibilityState==='hidden')return;try{const response=await fetch(endpoint+'/admin/message-studio/subscriptions/new?countOnly=1',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)});if(!response.ok)return;const data=await response.json();if(!Number.isFinite(data.unread))return;document.querySelectorAll('[data-new-subscriber-count]').forEach(n=>{n.textContent=data.unread.toLocaleString('ar-AE');n.hidden=!data.unread;});}catch{}}
  count();setInterval(count,60000);
  const openHash=()=>{if(!sessionStorage.getItem('inexc_do_admin'))return;if(location.hash==='#new-subscribers')subscribers.click();else if(location.hash==='#message-center')button.click();};
  window.addEventListener('inexc:unlocked',openHash);openHash();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
