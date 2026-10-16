import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {membershipCardName,courseCardInput,cardAllowedForCourse,attachCourseCardNames} from '../course-card-access.js';
import {cardQuote} from '../learner-service.js';
test('names follow existing, renamed and custom packages without doubling the card prefix',()=>{
 for(const value of ['باقة الريادة','بطاقة الريادة','الريادة'])assert.equal(membershipCardName(value),'بطاقة الريادة');
 assert.equal(membershipCardName('باقة التطوير المهني'),'بطاقة التطوير المهني');
 assert.equal(membershipCardName(''),'بطاقة INEXC');
});
test('all, selected and disabled policies use plan IDs and apply to card quotes',()=>{
 const card={plan_id:'a',plan_name:'باقة الريادة',status:'active',expires_at:'2099-01-01',units_remaining:5,course_unit_cost:2};
 const course={active:true,membership_enabled:true};
 assert.equal(cardAllowedForCourse(card,course),true);
 assert.equal(cardQuote(card,course).remainingAfter,3);
 assert.throws(()=>cardQuote(card,{...course,membership_plan_ids:['b']}),/بطاقة الريادة/);
 assert.equal(cardQuote(card,{...course,membership_plan_ids:['b','a']}).remainingAfter,3);
 assert.equal(cardAllowedForCourse(card,{...course,membership_plan_ids:[]}),false);
 assert.equal(cardAllowedForCourse(card,{...course,membership_enabled:false}),false);
});
test('admin validation preserves omitted settings, checks plan existence, and resolves current names including hidden plans',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec('CREATE TABLE membership_plans(id UUID PRIMARY KEY,name TEXT,active BOOLEAN)');
 const id='11111111-1111-4111-8111-111111111111';await db.query('INSERT INTO membership_plans VALUES($1,$2,false)',[id,'باقة الريادة']);
 const previous={featured:true,membership_plan_ids:[id]};
 assert.deepEqual(await courseCardInput(db,{},previous),{featured:true,membershipPlanIds:[id]});
 assert.deepEqual(await courseCardInput(db,{membershipPlanIds:null,featured:false},previous),{featured:false,membershipPlanIds:null});
 assert.deepEqual((await courseCardInput(db,{membershipPlanIds:[id,id]})).membershipPlanIds,[id]);
 for(const ids of [[],['invalid'],['22222222-2222-4222-8222-222222222222']])await assert.rejects(courseCardInput(db,{membershipPlanIds:ids}),e=>e.status===400);
 await assert.rejects(courseCardInput(db,{featured:'true'}),e=>e.status===400);
 assert.deepEqual((await attachCourseCardNames(db,[previous]))[0].membership_card_names,['بطاقة الريادة']);
 await db.query('UPDATE membership_plans SET name=$1',['باقة الريادة المتقدمة']);
 assert.deepEqual((await attachCourseCardNames(db,[previous]))[0].membership_card_names,['بطاقة الريادة المتقدمة']);
});
