(()=>{
 const cardName=value=>{const name=String(value??'').trim().replace(/^(?:باقة|بطاقة)\s+/,'').trim();return name?'بطاقة '+name:'بطاقة INEXC'};
 const eligibility=course=>course?.membershipEnabled===false?'التسجيل بالبطاقة غير متاح':course?.membershipPlanIds==null?'صالحة لجميع البطاقات':course.membershipCardNames?.length?'صالحة ل'+course.membershipCardNames.join('، ول'):'صالحة لبطاقات محددة';
 window.INEXCCardLabels={cardName,eligibility};
})();
