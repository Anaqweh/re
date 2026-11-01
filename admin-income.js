/* Display only the server's live certificate receipt amounts, in integer fils. */
(() => {
 'use strict';
 window.INEXCAdminIncome = {
  summarize(rows) {
   let count = 0, fils = 0;
   for (const row of rows) {
    const amount = row.verified_certificate_amount_fils;
    if (!Number.isSafeInteger(amount) || amount < 0) return {ready:false};
    if (amount > 0) { count++; fils += amount; }
   }
   return {ready:Number.isSafeInteger(fils),count,amount:fils/100};
  },
  render(rows) {
   const summary = this.summarize(rows), q = id => document.getElementById(id);
   q('paid').textContent = summary.ready ? summary.count.toLocaleString('ar-AE') : '—';
   q('amount').textContent = summary.ready ? summary.amount.toLocaleString('ar-AE',{maximumFractionDigits:2}) : '—';
   q('incomeNote').textContent = summary.ready ?
    'دخل رسوم الشهادات المسددة إلكترونيًا والمطابقة لهذه الطلبات. طلب الشهادة أو تأكيد التسجيل وحده لا يُحتسب دخلًا.' :
    'يلزم إكمال تحديث الخادم لعرض دخل الشهادات المؤكد.';
  }
 };
})();
