// Stable plan IDs control eligibility. Names are display-only and follow the package.
export function membershipCardName(value) {
  const name=String(value??'').trim().replace(/^(?:باقة|بطاقة)\s+/, '').trim();
  return name ? 'بطاقة '+name : 'بطاقة INEXC';
}

const fail=message=>Object.assign(new Error(message),{status:400});
const uuid=value=>typeof value==='string'&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
export async function courseCardInput(db,input,previous={}) {
  if(input.featured!==undefined&&typeof input.featured!=='boolean')throw fail('اختر حالة تمييز الدورة.');
  let ids=previous.membership_plan_ids??null;
  if(Object.hasOwn(input,'membershipPlanIds')) {
    ids=input.membershipPlanIds;
    if(ids!==null) {
      if(!Array.isArray(ids)||!ids.length||ids.length>200||!ids.every(uuid))throw fail('اختر بطاقة واحدة على الأقل، أو اختر جميع البطاقات.');
      ids=[...new Set(ids.map(id=>id.toLowerCase()))];
      const result=await db.query('SELECT id FROM membership_plans WHERE id=ANY($1::uuid[])',[ids]);
      if(result.rows.length!==ids.length)throw fail('إحدى البطاقات المختارة غير موجودة. حدّث قائمة الباقات.');
    }
  }
  return {featured:input.featured??(previous.featured===true),membershipPlanIds:ids};
}

export function cardAllowedForCourse(card,course) {
  return course.membership_enabled!==false && (course.membership_plan_ids==null || course.membership_plan_ids.some(id=>String(id).toLowerCase()===String(card.plan_id).toLowerCase()));
}

export async function attachCourseCardNames(db,rows) {
  const ids=[...new Set(rows.flatMap(row=>row.membership_plan_ids||[]))];
  const plans=ids.length?(await db.query('SELECT id,name FROM membership_plans WHERE id=ANY($1::uuid[])',[ids])).rows:[];
  const names=new Map(plans.map(p=>[p.id,membershipCardName(p.name)]));
  return rows.map(row=>({...row,membership_card_names:(row.membership_plan_ids||[]).map(id=>names.get(id)).filter(Boolean)}));
}
