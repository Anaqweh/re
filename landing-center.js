async function bootLanding(){
 const tabs=document.querySelector('.tabs');if(!tabs||document.querySelector('[data-view="landing-pages"]'))return;
 tabs.style.flexWrap='wrap';
 const button=document.createElement('button');button.type='button';button.className='light';button.dataset.view='landing-pages';button.textContent='صفحات الهبوط';tabs.append(button);let open;
 button.onclick=async()=>{button.disabled=true;try{if(!open){const m=await import('./landing-studio.js?v=20261015-landing1');open=await m.mountLandingStudio(button)}open()}catch(e){console.error(e);button.textContent='إعادة فتح صفحات الهبوط'}finally{button.disabled=false}};
 if(location.hash==='#landing-pages')button.click();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootLanding);else bootLanding();
