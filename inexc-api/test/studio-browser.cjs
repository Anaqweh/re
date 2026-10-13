const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
(async()=>{
 const {createHarness}=await import('./studio-harness.js');const h=await createHarness();
 const browser=await chromium.launch({headless:true,...(process.env.INEXC_TEST_CHROMIUM?{executablePath:process.env.INEXC_TEST_CHROMIUM,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote','--use-gl=disabled']}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',async r=>{if(r.status()>=400&&r.url().includes('/message-studio'))console.log('HTTP ERROR',r.status(),await r.text())});
 await context.addInitScript(()=>{if(window.top===window)sessionStorage.setItem('inexc_do_admin','LOCAL-TEST-ONLY')});
 // Never permit a local test to call any live service, image or mail endpoint.
 await context.route('https://**/*',route=>route.abort());
 const artifacts=process.env.INEXC_TEST_ARTIFACTS||path.join(__dirname,'artifacts');await fs.mkdir(artifacts,{recursive:true});
 const shot=async name=>{await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(artifacts,name+'.png'),fullPage:true})};
 try{
  await page.goto(h.url+'/admin-portal.html');await page.locator('[data-view="message-center"]').click();await page.getByText('رسالة جيدة تبدأ بفكرة واضحة.').waitFor();
  assert.ok(await page.evaluate(()=>document.fonts.check('16px "IBM Plex Sans Arabic"')));await shot('overview-desktop');
  await page.locator('.header [data-action="new"]').click();await page.locator('#ms-subject').fill('رسالة عربية وإنجليزية');
  await page.locator('#mc-body').fill('مرحبًا بكم في برامج التدريب\nWelcome to INEXC Training');
  await page.locator('#mc-body').evaluate(el=>{const first=el.firstChild;const text=first.nodeType===3?first:first.firstChild;const range=document.createRange();range.setStart(text,0);range.setEnd(text,5);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);el.focus()});
  await page.locator('[data-command="bold"]').click();
  await page.locator('#ms-preheader').fill('تمهيد محفوظ');await page.locator('#ms-recipients').fill('أحمد، local@example.com');
  await page.locator('#ms-save-state.saved').waitFor();
  const savedBody=await page.locator('#mc-body').evaluate(e=>e.value);assert.match(savedBody,/"bold":true/);
  const parsed=JSON.parse(savedBody.split('\n').slice(1).join('\n'));assert.equal(parsed.blocks.length,2);
  await page.waitForFunction(()=>document.querySelector('#ms-preview-frame').srcdoc.includes('<strong>'));
  const html=await page.locator('#ms-preview-frame').getAttribute('srcdoc');assert.match(html,/dir="rtl"/);assert.match(html,/dir="ltr"/);assert.match(html,/<strong>/);
  await shot('compose-desktop');
  await page.reload();await page.locator('[data-view="message-center"]').click();await page.locator('[data-open-draft]').first().click();
  assert.equal(await page.locator('#mc-body').evaluate(e=>e.value),savedBody);assert.equal(await page.locator('#ms-preheader').inputValue(),'تمهيد محفوظ');
  // Real keyboard formatting/undo and explicit paragraph direction persist.
  await page.locator('#mc-body').click();await page.keyboard.press('Control+End');await page.keyboard.type(' test');await page.keyboard.press('Control+z');
  await page.locator('[data-paragraph-dir="ltr"]').click();await page.locator('[data-align="center"]').click();
  await page.locator('#ms-save-state.saved').waitFor();assert.match(await page.locator('#mc-body').evaluate(e=>e.value),/"align":"center"/);
  // Word-style HTML paste is sanitized but keeps paragraphs and bold text.
  await page.locator('#mc-body').evaluate(el=>{el.focus();const range=document.createRange();range.selectNodeContents(el);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);const data=new DataTransfer();data.setData('text/html','<p class="MsoNormal" style="font-family:Comic Sans MS"><b>نص من Word</b></p><p>English paragraph <script>alert(1)</script></p>');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:data}));});
  assert.match(await page.locator('#mc-body').evaluate(e=>e.value),/"bold":true/);assert.ok(!(await page.locator('#mc-body').innerHTML()).includes('<script>'));
  await page.locator('#ms-save-state.saved').waitFor();
  await context.setOffline(true);await page.locator('#ms-subject').fill('كتابة أثناء انقطاع الاتصال');await page.waitForTimeout(1300);
  assert.ok(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('inexc-message-studio-v2:'))));
  await context.setOffline(false);await page.locator('#ms-save-state.saved').waitFor();
  await page.locator('[data-action="versions"]').click();await page.locator('[data-restore-version]').last().click();await page.locator('#ms-save-state.saved').waitFor();
  await page.locator('[data-action="save-template"]').click();await page.locator('#ms-template-name').fill('قالب محفوظ للاختبار');await page.locator('.dialog-foot').getByRole('button',{name:'حفظ القالب',exact:true}).click();
  await page.locator('[data-nav="templates"]').click();await page.getByRole('heading',{name:'قالب محفوظ للاختبار'}).waitFor();await shot('templates-desktop');
  await page.locator('[data-use-template]').first().click();assert.ok((await page.locator('#mc-body').evaluate(e=>e.value)).length>0);
  for(const width of [390,320]){await page.setViewportSize({width,height:844});await page.evaluate(()=>window.scrollTo(0,0));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow at '+width);await shot('compose-'+width);await page.locator('[data-mobile="preview"]').click();assert.ok(await page.locator('#ms-preview-frame').isVisible());await shot('preview-'+width);await page.locator('[data-mobile="write"]').click();}
  await page.setViewportSize({width:1440,height:1000});await page.locator('[data-nav="contacts"]').click();await page.locator('[data-action="import"]').click();
  await page.locator('#ms-import-text').fill('Name,Email\nAhmad,one@example.com\nDuplicate,one@example.com\nBad,broken@\nOnly Name,\n,two@example.com');
  await page.locator('.dialog-foot').getByRole('button',{name:'استخراج ومراجعة'}).click();await page.locator('[data-import-email="2"]').fill('fixed@example.com');await page.locator('#ms-import-group-name').fill('مجموعة المعلمين');await shot('import-review');
  await page.locator('.dialog-foot').getByRole('button',{name:'حفظ جهات الاتصال المحددة'}).click();await page.locator('#ms-contact-count').filter({hasText:'4'}).waitFor();
  await page.locator('[data-edit-contact]').first().click();await page.locator('#ms-contact-name-edit').fill('اسم معدّل');await page.locator('.dialog-foot').getByRole('button',{name:'حفظ جهة الاتصال'}).click();await page.getByText('اسم معدّل',{exact:true}).waitFor();
  await page.locator('#ms-page-select').check();await page.locator('#ms-select-all-results').click();await page.locator('[data-action="bulk-edit"]').click();await page.locator('#ms-bulk-tags').fill('VIP');await page.locator('.dialog-foot').getByRole('button',{name:'تطبيق التعديل'}).click();await page.locator('#ms-contact-tag').fill('VIP');await page.locator('#ms-contact-count').filter({hasText:'4'}).waitFor();
  await shot('contacts-desktop');
  await page.locator('[data-delete-contact]').first().click();await page.locator('.dialog-foot').getByRole('button',{name:'حذف 1 جهة'}).click();await page.locator('#ms-contact-count').filter({hasText:'3'}).waitFor();
  await page.locator('#ms-page-select').check();await page.locator('[data-action="delete-selection"]').click();await page.locator('.dialog-foot').getByRole('button',{name:'حذف 3 جهة'}).click();await page.getByText('لا توجد جهات مطابقة').waitFor();
  await page.locator('.header [data-action="new"]').click();await page.locator('#ms-subject').fill('رسالة مجدولة للاختبار');await page.locator('#mc-body').fill('مرحبًا بكم');await page.locator('#ms-recipients').fill('local@example.com');await page.getByText('المرفق وموعد الإرسال',{exact:true}).click();await page.locator('#ms-schedule').fill('2099-10-12T22:00');await page.locator('[data-action="review"]').click();await page.locator('#ms-dialog').waitFor({state:'visible'});await page.locator('#ms-review-consent').check();await page.locator('.dialog-foot').getByRole('button',{name:'تأكيد الجدولة'}).click();await page.locator('#ms-dialog').waitFor({state:'hidden'});await page.locator('[data-cancel-campaign]:visible').first().waitFor();assert.equal(h.sent.length,0);
  await page.locator('[data-edit-campaign]:visible').first().click();await page.locator('#ms-subject').fill('جدولة معدلة');await page.locator('[data-action="review"]').click();await page.locator('#ms-dialog').waitFor({state:'visible'});await page.locator('#ms-review-consent').check();await page.locator('.dialog-foot').getByRole('button',{name:'حفظ تعديل الجدولة'}).click();try{await page.locator('#ms-dialog').waitFor({state:'hidden',timeout:5000})}catch(e){console.log('DIALOG ERROR',await page.locator('#ms-dialog-error').textContent());await shot('schedule-error');throw e}await page.locator('[data-panel="reports"]').getByText('جدولة معدلة',{exact:true}).waitFor();await shot('reports-desktop');
  await page.locator('[data-cancel-campaign]:visible').first().click();await page.locator('.dialog-foot').getByRole('button',{name:'تأكيد الإلغاء'}).click();await page.getByText('ملغاة',{exact:true}).waitFor();
  await page.locator('[data-nav="settings"]').click();await page.locator('#ms-setting-signature').fill('توقيع الاختبار');await page.getByRole('button',{name:'حفظ الإعدادات',exact:true}).click();await page.getByText('تم حفظ الإعدادات للرسائل الجديدة.').waitFor();
  await page.setViewportSize({width:390,height:844});await shot('settings-mobile');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.deepEqual(errors,[]);assert.equal(h.sent.length,0);console.log('PASS: desktop + 390/320 mobile; formatting/save/reload; offline recovery; versions; templates; import/edit/filter/bulk/delete; schedule/edit/cancel; settings. No real mail or external requests.');
 }finally{await browser.close();await h.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
