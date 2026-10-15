// A capability gate keeps the existing center usable until the matching API is deployed.
async function boot() {
  const tabs=document.querySelector('.tabs'); if(!tabs || document.querySelector('[data-view="message-center"]'))return;
  const button=document.createElement('button');button.type='button';button.className='light';button.dataset.view='message-center';button.textContent='مركز الرسائل';tabs.append(button);
  let openStudio;
  button.onclick=async()=>{
    if(openStudio)return openStudio();
    button.disabled=true;
    try{
      const response=await fetch((window.INEXC_REGISTRATION_ENDPOINT||'https://api.inexctraining.com/api')+'/admin/message-capabilities',{headers:{Authorization:'Bearer '+(sessionStorage.getItem('inexc_do_admin')||'')},signal:AbortSignal.timeout(12000)});
      const caps=await response.json();
      if(response.ok && caps.studio>=2){const studio=await import(caps.studio>=5?'./message-studio-ui.js?v=20261015-sub1':caps.studio>=4?'./message-studio-v4-ui.js?v=20261015-blue4':caps.studio>=3?'./message-studio-v3-ui.js?v=20261015-studio3':'./message-studio-v2-ui.js?v=20261015-compat');openStudio=await studio.mountMessageStudio(button);openStudio();}
      else {button.remove();await import('./message-center-legacy.js?v=20261015-studio3');document.querySelector('[data-view="message-center"]')?.click();}
    }catch{button.remove();await import('./message-center-legacy.js?v=20261015-studio3');document.querySelector('[data-view="message-center"]')?.click();}
    finally{button.disabled=false;}
  };
  if(location.hash==='#message-center')button.click();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
