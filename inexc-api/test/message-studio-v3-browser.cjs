const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
(async()=>{
 const {createHarness}=await import('./studio-harness.js'),{suppressEmail}=await import('../message-suppression.js');
 const h=await createHarness(),browser=await chromium.launch({executablePath:process.env.INEXC_TEST_CHROMIUM,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote','--use-gl=disabled']});
 const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage(),errors=[];
 const artifacts=process.env.INEXC_TEST_ARTIFACTS;await fs.mkdir(artifacts,{recursive:true});
 await context.addInitScript(()=>{if(window.top===window)sessionStorage.setItem('inexc_do_admin','LOCAL-TEST-ONLY')});await context.route('https://**/*',r=>r.abort());page.on('pageerror',e=>errors.push(e.message));
 try{
  await h.request('/contacts','POST',{email:'blocked@example.com',name:'محظور'});await suppressEmail(h.pool,'blocked@example.com');
  await page.goto(h.url+'/admin-portal.html');await page.locator('[data-view="message-center"]').click();await page.getByText('رسالة جيدة تبدأ بفكرة واضحة.').waitFor();
  await page.locator('[data-nav="templates"]').click();await page.locator('[data-inspect-preset="0"]').waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-template-preview]')].every(e=>e.getAttribute('srcdoc')?.includes('<h1')||e.getAttribute('srcdoc')?.includes('أثر')));
  assert.equal(await page.locator('[data-template-preview]').count(),7);
  for(let i=0;i<7;i++){const frame=page.frameLocator('[data-template-preview="'+i+'"]');await frame.locator('body').getByText(i===2?'مرحبًا أحمد،':i===6?'Make room for your next idea.':['خطوتك القادمة تبدأ بمهارة.','فكرة واحدة قد تغيّر طريقة عملك.','','أفكار تستحق مساحة من يومك.','كل مشاركة تترك أثرًا.','التطوير يبدأ بفهم الاحتياج.'][i],{exact:true}).waitFor();}
  await page.locator('[data-template-preview]').last().scrollIntoViewIfNeeded();await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(artifacts,'templates-v3-desktop.png'),fullPage:true});
  await page.locator('[data-inspect-preset="0"]').click();await page.frameLocator('#ms-template-full').getByRole('heading',{name:'خطوتك القادمة تبدأ بمهارة.'}).waitFor();
  await page.locator('.dialog-foot').getByRole('button',{name:'استخدام هذا التصميم'}).click();
  assert.equal(await page.locator('#ms-layout').inputValue(),'course');
  await page.waitForFunction(()=>document.querySelector('#ms-preview-frame').srcdoc.includes('خطوتك القادمة تبدأ بمهارة.'));
  await page.locator('#ms-preview [data-action="test"]').click();await page.locator('#ms-test-email').fill('preview@example.com');await page.locator('#ms-test-name').fill('معاينة أحمد');await page.getByRole('button',{name:'إرسال بريد المعاينة',exact:true}).click();
  await page.getByText('قبل مزود البريد رسالة المعاينة.',{exact:false}).waitFor();assert.equal(h.sent.length,1);assert.equal(h.sent[0].to,'preview@example.com');assert.match(h.sent[0].html,/معاينة أحمد/);assert.match(h.sent[0].html,/خطوتك القادمة تبدأ بمهارة/);assert.equal((await h.query('SELECT count(*)::int AS n FROM email_campaigns')).rows[0].n,0);
  await page.locator('#ms-preview [data-action="test"]').click();await page.locator('#ms-test-email').fill('blocked@example.com');await page.getByRole('button',{name:'إرسال بريد المعاينة',exact:true}).click();await page.locator('#ms-dialog-error').filter({hasText:'ألغى اشتراكه'}).waitFor();assert.equal(h.sent.length,1);await page.locator('[data-close]').click();
  await page.locator('[data-nav="suppressions"]').click();await page.getByRole('heading',{name:'سجل إلغاء الاشتراك والحظر الدائم'}).waitFor();await page.getByRole('cell',{name:'blocked@example.com',exact:true}).waitFor();await page.screenshot({path:path.join(artifacts,'suppression-v3-desktop.png'),fullPage:true});
  for(const width of [390,320]){
   await page.setViewportSize({width,height:844});await page.evaluate(()=>window.scrollTo(0,0));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(artifacts,'suppression-'+width+'.png'),fullPage:true});
   await page.locator('[data-nav="templates"]').click();await page.locator('[data-preset="0"]').waitFor();await page.screenshot({path:path.join(artifacts,'templates-'+width+'.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.locator('[data-preset="0"]').click();await page.locator('button[data-mobile="preview"]').click();await page.screenshot({path:path.join(artifacts,'course-preview-'+width+'.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.locator('[data-nav="suppressions"]').click();
  }
  assert.deepEqual(errors,[]);console.log('PASS v3: seven rendered templates; full preview; explicit single-address test; blocked test rejected; zero campaigns from preview; suppression page and 390/320px layouts. All mail intercepted.');
 }finally{await browser.close();await h.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
