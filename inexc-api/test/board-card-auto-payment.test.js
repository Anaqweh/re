import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {setupBoardCardOffers,saveAutomaticBoardCard,boardCardStripe} from '../board-card-offers.js';
const id='00000000-0000-4000-8000-000000000001';
const input={name:'بطاقة البورد',price:149,enabled:true};
test('automatic saved price creates one link, replaces on price change, disables and reactivates',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec('CREATE TABLE courses(id UUID PRIMARY KEY)');await db.query('INSERT INTO courses VALUES($1)',[id]);await setupBoardCardOffers(db);
 const pool={connect:async()=>({query:(...args)=>db.query(...args),release(){}})};let creates=0;const states=[];
 const client={create:async p=>{creates++;assert.ok(p.key.startsWith('board-card/'));return{id:'plink_'+creates,url:'https://buy.stripe.com/'+creates}},active:async(...v)=>states.push(v)};
 const save=p=>saveAutomaticBoardCard(pool,id,p,{client});
 let r=await save(input);assert.equal(r.paymentUrl,'https://buy.stripe.com/1');assert.equal(r.price,149);
 await save({...input,paymentUrl:'https://evil.example'});assert.equal(creates,1);
 r=await save({...input,price:199});assert.equal(creates,2);assert.equal(r.price,199);assert.deepEqual(states,[['plink_1',false]]);
 await save({...input,price:199,enabled:false});assert.deepEqual(states.at(-1),['plink_2',false]);
 await save({...input,price:199});assert.equal(creates,2);assert.deepEqual(states.at(-1),['plink_2',true]);
 await save({...input,price:200,enabled:false});await save({...input,price:200});assert.equal(creates,3);
 await assert.rejects(()=>saveAutomaticBoardCard(pool,id,{...input,price:299},{client:{create:async()=>{throw Error('provider down')}}}));
 assert.equal((await db.query('SELECT price FROM board_card_offers')).rows[0].price,'200.00');
});
test('Stripe receives exact AED amount and card metadata with idempotent requests',async()=>{
 const calls=[];const api=boardCardStripe({env:{STRIPE_SECRET_KEY:'sk_live_fake',STRIPE_CHECKOUT_ENABLED:'1'},fetcher:async(url,options)=>{calls.push({url,options,params:new URLSearchParams(options.body)});return{ok:true,json:async()=>url.endsWith('/prices')?{id:'price_1',unit_amount:14900,currency:'aed',livemode:true}:{id:'plink_1',url:'https://buy.stripe.com/example',active:true,livemode:true}}}});
 const link=await api.create({courseId:id,name:input.name,price:149,key:'fixed'});assert.equal(link.id,'plink_1');assert.equal(calls[0].params.get('unit_amount'),'14900');assert.equal(calls[0].params.get('currency'),'aed');assert.equal(calls[1].params.get('line_items[0][price]'),'price_1');assert.equal(calls[1].params.get('metadata[course_id]'),id);assert.equal(calls[0].options.headers['Idempotency-Key'],'fixed/price');assert.equal(calls[1].options.headers['Idempotency-Key'],'fixed/link');
 await assert.rejects(()=>boardCardStripe({env:{}}).create({courseId:id,name:'x',price:149,key:'x'}),/غير مفعّل/);
});
