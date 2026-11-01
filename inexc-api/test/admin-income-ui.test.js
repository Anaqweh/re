import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const source=readFileSync(new URL('../../admin-income.js',import.meta.url),'utf8');
test('paid-income display ignores registration totals/status, respects filters and does not substitute totals on older servers',t=>{
 const dom=new JSDOM('<b id="paid"></b><b id="amount"></b><p id="incomeNote"></p>',{runScripts:'outside-only'});t.after(()=>dom.window.close());
 const w=dom.window;w.eval(source);const report=w.INEXCAdminIncome,q=id=>w.document.getElementById(id);
 const rows=[{status:'مؤكد',total:4000,verified_certificate_amount_fils:0},{status:'مسجل بالبطاقة',total:0,verified_certificate_amount_fils:19900},{status:'مدفوع',total:999,verified_certificate_amount_fils:0},{verified_certificate_amount_fils:12345}];
 assert.equal(report.summarize(rows).amount,322.45);report.render(rows);assert.equal(q('amount').textContent,(322.45).toLocaleString('ar-AE'));assert.equal(q('paid').textContent,(2).toLocaleString('ar-AE'));
 report.render(rows.slice(0,1));assert.equal(q('amount').textContent,(0).toLocaleString('ar-AE'));
 for(const row of [{total:4000,status:'مدفوع'},{verified_certificate_amount_fils:'19900'},{verified_certificate_amount_fils:-1}]){report.render([row]);assert.equal(q('amount').textContent,'—');assert.match(q('incomeNote').textContent,/تحديث الخادم/);}
 report.render([]);assert.equal(q('amount').textContent,(0).toLocaleString('ar-AE'));
});
