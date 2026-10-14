import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {buttonSettings,buttonHref,renderButton,emailFonts,fontCSS} from '../message-design.js';
import {mailSettings,renderMail,checkMessage} from '../message-mail.js';
import {renderMail as renderV4} from '../message-mail-v4.js';
import {messageDocument,renderMessageBody,richTextPrefix} from '../message-format.js';
import {createHarness} from './studio-harness.js';
const body=richTextPrefix+JSON.stringify({direction:'rtl',blocks:[{type:'paragraph',runs:[{text:'نص مخصص {{name}}',font:'cairo',size:24,bold:true},{text:' ونسخ عربي',font:'noto-naskh',size:22}]},{type:'button',href:'tel:+971501234567',button:{kind:'phone',target:'+971501234567',label:'اتصل',variant:'outline',color:'#0868ce',size:20,radius:12},runs:[{text:'اتصل'}]}]});
const config={designVersion:3,layout:'signature',brandColor:'#0868ce',brandName:'شركة التميز الابتكاري',brandCaption:'INEXC TRAINING',brandTagline:'برامج تدريبية تصنع أثرًا حقيقيًا',fontFamily:'cairo',headingFont:'tajawal',bodySize:20,headingSize:28,lineHeight:2.2,headline:'هذه المرّة كيف حالكم؟',subject:'رسالة اختبار',message:body,extraRecipients:'demo@example.com',audience:'custom',buttons:[{kind:'whatsapp',target:'+971 50 123 4567',label:'تواصل واتساب',message:'مرحبًا {{name}}، أريد معرفة التفاصيل',variant:'solid',color:'#0868ce',radius:12,align:'center',size:18},{kind:'email',target:'hello@example.com',label:'راسلنا',message:'عنوان رسالة',variant:'outline',color:'#0868ce',radius:24,align:'left',size:16}]};
test('typed actions build valid links and reject unsafe or incomplete destinations',()=>{
 assert.equal(buttonHref({kind:'whatsapp',target:'٠٠٩٧١٥٠١٢٣٤٥٦٧',message:'مرحبا & شكرا'}),'https://wa.me/971501234567?text='+encodeURIComponent('مرحبا & شكرا'));
 assert.equal(buttonHref({kind:'whatsapp',target:'0501234567'}),'');
 assert.equal(buttonHref({kind:'email',target:'not-an-email'}),'');assert.equal(buttonHref({kind:'phone',target:'javascript:alert(1)'}),'');
 assert.equal(buttonHref({kind:'url',target:'javascript:alert(1)'}),'');assert.equal(buttonHref({kind:'url',target:'https://example.com/'}),'https://example.com/');
 const html=renderButton({...config.buttons[0],label:'<script>x</script>'});assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);assert.match(html,/border-radius:12px/);
 assert.equal(emailFonts.length,30);assert.match(fontCSS(['cairo']),/fonts.gstatic.com/);assert.equal(fontCSS(['arbitrary-css']), '');
});
test('word fonts and sizes survive parsing; CSS injection and invalid font IDs are discarded',()=>{
 const doc=messageDocument(body);assert.equal(doc.blocks[0].runs[0].font,'cairo');assert.equal(doc.blocks[0].runs[0].size,24);assert.equal(doc.blocks[1].button.variant,'outline');
 const html=renderMessageBody(body,{name:'أحمد'}).html;assert.match(html,/font-size:24px/);assert.match(html,/Cairo/);assert.match(html,/نص مخصص أحمد/);assert.match(html,/href="tel:\+971501234567"/);
 const unsafe=messageDocument(richTextPrefix+JSON.stringify({blocks:[{runs:[{text:'x',font:'x;display:none',size:999,color:'red;display:none'}]}]})).blocks[0].runs[0];assert.equal(unsafe.font,undefined);assert.equal(unsafe.size,undefined);assert.equal(unsafe.color,undefined);
});
test('reference stationery uses clear blue, editable branding, actual font settings and personalized actions',()=>{
 const m=renderMail({subject:config.subject,body,settings:config,person:{name:'أحمد'},unsubscribeUrl:'https://example.com/unsub'});
 assert.match(m.html,/border-radius:18px 18px 0 0/);assert.match(m.html,/linear-gradient\(115deg,#0874dc,#0868ce\)/);assert.match(m.html,/شركة التميز الابتكاري/);assert.match(m.html,/font-size:28px/);assert.match(m.html,/line-height:2.2/);assert.ok(m.html.includes(encodeURIComponent('مرحبًا أحمد، أريد معرفة التفاصيل')));assert.match(m.text,/mailto:hello@example.com/);assert.match(m.text,/tel:\+971501234567/);assert.ok(!m.html.includes('#0b2444'));assert.match(m.html,/إلغاء الاشتراك/);assert.deepEqual(checkMessage(config),[]);
 assert.ok(checkMessage({...config,buttons:[{kind:'whatsapp',target:'050',label:'تواصل'}]}).some(v=>v.includes('الزر 1')));
 const args={subject:'Previous',body:'Existing content',settings:{designVersion:2,layout:'course',headline:'Kept'}};assert.deepEqual(renderMail(args),renderV4(args));
});
test('server saves, reopens, reviews and sends the same new fonts and actions through intercepted preview',async t=>{
 const h=await createHarness();t.after(()=>h.close());const id=crypto.randomUUID();const saved=await h.request('/drafts/'+id,'PUT',{version:0,payload:config});assert.equal(saved.status,200,JSON.stringify(saved));const p=(await h.request('/drafts/'+id)).data.payload;assert.equal(p.fontFamily,'cairo');assert.equal(p.bodySize,20);assert.equal(p.buttons[0].message,config.buttons[0].message);assert.equal(p.designVersion,3);
 const tpl=await h.request('/templates/'+crypto.randomUUID(),'PUT',{name:'اختبار الخطوط والأزرار',payload:p});assert.equal(tpl.status,200);assert.equal(tpl.data.settings.buttons.length,2);assert.equal((await h.request('/review','POST',{payload:p})).data.issues.length,0);
 const mail=await h.request('/test','POST',{payload:p,email:'preview@example.com',name:'أحمد',requestId:crypto.randomUUID()});assert.equal(mail.status,200,JSON.stringify(mail));assert.equal(h.sent.length,1);assert.match(h.sent[0].html,/font-size:24px/);assert.ok(h.sent[0].html.includes(encodeURIComponent('مرحبًا أحمد، أريد معرفة التفاصيل')));assert.equal((await h.query('SELECT count(*)::int AS n FROM email_campaigns')).rows[0].n,0);
});
