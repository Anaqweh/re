import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const read=p=>fs.readFile(new URL('../../'+p,import.meta.url),'utf8');
test('feature editor formats selected text or whole line, previews safely and clears formatting',async t=>{
 const dom=new JSDOM('<label>المزايا<textarea data-k="featureLines">دبلوم مجاني\nموقع شخصي</textarea><small></small></label>',{runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window;
 w.eval(await read('membership-features.js'));w.INEXCMembershipFeatures.mount();const area=w.document.querySelector('textarea');
 area.setSelectionRange(0,5);w.document.querySelector('[data-feature-format=bold]').click();assert.match(area.value,/^\*\*دبلوم\*\*/);assert.equal(w.document.querySelector('.feature-preview strong').textContent,'دبلوم');
 area.setSelectionRange(area.value.length,area.value.length);w.document.querySelector('[data-feature-format=highlight]').click();assert.equal(w.document.querySelector('.feature-preview mark').textContent,'موقع شخصي');
 w.document.querySelector('[data-feature-format=clear]').click();assert.equal(w.document.querySelector('.feature-preview mark'),null);
 const html=w.INEXCMembershipFeatures.list(['**نص** ==تمييز== <img src=x onerror=alert(1)>']);const host=w.document.createElement('div');host.innerHTML=html;assert.equal(host.querySelector('img'),null);assert.equal(host.querySelector('strong').textContent,'نص');assert.equal(host.querySelector('mark').textContent,'تمييز');
});
