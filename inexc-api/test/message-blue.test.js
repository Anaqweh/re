import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {renderMail,mailSettings,checkMessage,mailIdentityDefaults} from '../message-mail.js';
import {renderMail as legacyRender} from '../message-mail-legacy.js';
import {createHarness} from './studio-harness.js';
const editable={...mailIdentityDefaults(),designVersion:2,layout:'course',brandColor:'#1559d6',subject:'اختبار {{name}}',message:'المحتوى الخاص {{name}}',extraRecipients:'sample@example.com',audience:'custom',brandName:'اسم جديد',brandTagline:'شعار لفظي جديد',eyebrow:'عنوان صغير جديد',headline:'عنوان رئيسي جديد',intro:'مقدمة جديدة',footerText:'تذييل جديد',footerLinkLabel:'موقع جديد',footerLinkUrl:'https://example.com/new',unsubscribeLabel:'إيقاف الرسائل الجديدة',signature:'توقيع جديد',ctaLabel:'زر جديد',ctaUrl:'https://example.com/action',panels:[{label:'وسم جديد',title:'بطاقة جديدة',text:'شرح جديد {{name}}'}]};
const render=p=>renderMail({subject:p.subject,body:p.message,settings:p,ctaLabel:p.ctaLabel,ctaUrl:p.ctaUrl,person:{name:'أحمد'},unsubscribeUrl:'https://example.com/unsubscribe'});
test('every authored region appears in HTML and text; clearing optional words does not resurrect defaults',()=>{
 const result=render(editable);
 for(const field of ['brandName','brandTagline','eyebrow','headline','intro','footerText','footerLinkLabel','unsubscribeLabel','signature','ctaLabel']){assert.ok(result.html.includes(editable[field]),field);assert.ok(result.text.includes(editable[field]),field+' plaintext');}
 assert.match(result.html,/شرح جديد أحمد/);assert.match(result.text,/شرح جديد أحمد/);
 const blank=render({...editable,brandName:'',brandTagline:'',eyebrow:'',headline:'',intro:'',signature:'',footerText:'',footerLinkLabel:'',panels:[],ctaLabel:'',ctaUrl:''});
 for(const unwanted of ['INEXC Training','مع خالص التحية','مساحة للتعلّم','<h1','معرفة. تطبيق. أثر.'])assert.ok(!blank.html.includes(unwanted),unwanted);
 assert.match(blank.html,/إيقاف الرسائل الجديدة/);
});
test('unsafe custom words and links cannot become markup; tokens in cards/footer are validated',()=>{
 const input={...editable,brandName:'<img src=x onerror=alert(1)>',headline:'<script>bad()</script>',panels:[{label:'<b>x</b>',title:'<svg onload=alert(1)>',text:'{{name}}'}],footerLinkUrl:'javascript:alert(1)',logoUrl:'javascript:alert(1)'};
 const result=render(input);assert.ok(!result.html.includes('<script>'));assert.ok(!result.html.includes('<svg'));assert.ok(!result.html.includes('<img src=x'));assert.ok(!result.html.includes('href="javascript:'));assert.match(result.html,/&lt;script&gt;/);
 const issues=checkMessage({...editable,panels:[{title:'{{secret}}',text:'{{course}}'}],footerText:'{{bad}}',unsubscribeLabel:''});
 assert.ok(issues.some(x=>x.includes('{{secret}}')));assert.ok(issues.some(x=>x.includes('{{bad}}')));assert.ok(issues.some(x=>x.includes('اختر دورة')));assert.ok(issues.some(x=>x.includes('رابط إلغاء')));
});
test('hiding optional regions keeps unsubscribe operational and legacy output stays byte-for-byte identical',()=>{
 const html=render({...editable,headerEnabled:false,heroEnabled:false,footerEnabled:false,signatureEnabled:false,panels:[]}).html;
 for(const key of ['brandName','brandTagline','headline','intro','footerText','footerLinkLabel','signature'])assert.ok(!html.includes(editable[key]),key);
 assert.match(html,/href="https:\/\/example.com\/unsubscribe"/);
 for(const layout of ['branded','course','workshop','newsletter','thankyou','letter']){const args={subject:'Existing campaign',body:'An existing message',settings:{layout,headline:'Existing title'},unsubscribeUrl:'https://example.com/unsub'};assert.deepEqual(renderMail(args),legacyRender(args));}
});
test('custom layouts and every word survive draft/template reload, review and intercepted preview',async t=>{
 const h=await createHarness();t.after(()=>h.close());const id=crypto.randomUUID();
 const saved=await h.request('/drafts/'+id,'PUT',{version:0,payload:editable});assert.equal(saved.status,200,JSON.stringify(saved));
 const reopened=(await h.request('/drafts/'+id)).data.payload;
 for(const key of Object.keys(mailSettings(editable)))assert.deepEqual(reopened[key],mailSettings(editable)[key],key);
 const tid=crypto.randomUUID();assert.equal((await h.request('/templates/'+tid,'PUT',{name:'هوية خاصة',payload:reopened})).status,200);
 const template=(await h.request('/templates')).data.find(r=>r.id===tid);assert.deepEqual(template.settings.panels,editable.panels);assert.equal(template.settings.footerText,editable.footerText);
 const preview=(await h.request('/preview','POST',{payload:reopened,name:'أحمد'})).data;assert.match(preview.html,/شرح جديد أحمد/);assert.equal((await h.request('/review','POST',{payload:reopened})).data.issues.length,0);
 const request={requestId:crypto.randomUUID(),email:'preview@example.com',name:'أحمد',payload:reopened};assert.equal((await h.request('/test','POST',request)).status,200);assert.equal(h.sent.length,1);assert.match(h.sent[0].html,/تذييل جديد/);assert.match(h.sent[0].html,/شرح جديد أحمد/);
 assert.equal((await h.query('SELECT count(*)::int AS n FROM email_campaigns')).rows[0].n,0);
});
