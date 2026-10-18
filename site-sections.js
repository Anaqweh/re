(()=>{'use strict';
const api=window.INEXC_REGISTRATION_ENDPOINT||'';
const legacyServices=()=>fetch(api+'/services',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(data=>{if(data?.items?.some(item=>item.published===true))document.querySelectorAll('[data-site-section=services]').forEach(node=>node.hidden=false)}).catch(()=>{});
fetch(api+'/site-sections',{cache:'no-store',signal:AbortSignal.timeout(12000)}).then(response=>response.ok?response.json():null).then(settings=>{
 if(!settings){legacyServices();return;}
 for(const key of ['courses','packages','services'])document.querySelectorAll('[data-site-section="'+key+'"]').forEach(node=>node.hidden=settings[key]===false);
 const courses=document.getElementById('courses');if(courses)courses.hidden=settings.courses===false;
 const nav=document.querySelector('.topbar nav');if(!nav)return;
 for(const item of Array.isArray(settings.links)?settings.links.slice(0,6):[]){if(item.visible!==true||typeof item.href!=='string'||!/^\/(?!\/)/.test(item.href)||!item.label)continue;const link=document.createElement('a');link.href=item.href;link.textContent=String(item.label).slice(0,45);nav.insertBefore(link,nav.querySelector('.nav-cta'))}
}).catch(legacyServices);
})();
