// Course checkout policy. Opening a payment link never confirms payment.
const fail=message=>Object.assign(new Error(message),{status:400});
export function validCoursePaymentLink(value){
 if(typeof value!=='string'||value.length>500)return '';
 try{const url=new URL(value.trim());return url.protocol==='https:'&&url.hostname&&!url.username&&!url.password?url.href:''}catch{return ''}
}
export function validateCoursePayment(course,{method,total,hasReceipt}){
 if(!Number.isFinite(total)||total<0)throw fail('تعذّر تحديد مبلغ التسجيل. تواصل مع الإدارة.');
 if(total===0)return {method:'free',status:'مسجل',paymentLink:''};
 const methods=Array.isArray(course.payment_methods)?course.payment_methods:[];
 if(!['link','bank'].includes(method)||!methods.includes(method))throw fail('اختر وسيلة دفع متاحة لهذه الدورة.');
 if(method==='link'){
  const paymentLink=validCoursePaymentLink(course.payment_link);
  if(!paymentLink)throw fail('رابط الدفع لهذه الدورة غير جاهز. اختر وسيلة أخرى أو تواصل مع الإدارة.');
  return {method,status:'بانتظار الدفع',paymentLink};
 }
 if(!hasReceipt)throw fail('يرجى إرفاق وصل التحويل البنكي.');
 return {method,status:'بانتظار مراجعة الوصل',paymentLink:''};
}
