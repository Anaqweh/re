import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import express from 'express';
import {setupBoardCardOffers,saveBoardCardOffer,installBoardCardOffers,cardOfferInput,safeCardUrl} from '../board-card-offers.js';
const id='00000000-0000-4000-8000-000000000001';
const input={name:'بطاقة البورد',description:'نموذج',price:149,paymentUrl:'https://buy.stripe.com/example',sampleUrl:'',enabled:true};
test('URL and money validation protects all public links',()=>{
 for(const url of ['javascript:alert(1)','http://example.com','https://name:secret@example.com','//example.com'])assert.throws(()=>safeCardUrl(url));
 for(const price of ['',null,-1,0,1.234,'NaN',Infinity])assert.throws(()=>cardOfferInput({...input,price}));
 assert.equal(cardOfferInput({...input,paymentUrl:''}).enabled,true);
 assert.equal(cardOfferInput({...input,paymentUrl:'',enabled:false}).enabled,false);
 assert.equal(cardOfferInput(input).price,149);
});
test('authenticated settings support archived courses; disabled offers are never public',async()=>{
 const db=new PGlite();await db.exec('CREATE TABLE courses(id UUID PRIMARY KEY,name TEXT,active BOOLEAN,created_at TIMESTAMPTZ DEFAULT now())');
 await db.query('INSERT INTO courses(id,name,active) VALUES($1,$2,false)',[id,'دورة سابقة']);await setupBoardCardOffers(db);await setupBoardCardOffers(db);
 await saveBoardCardOffer(db,id,input);assert.equal((await db.query('SELECT active FROM courses')).rows[0].active,false);
 const app=express();app.use(express.json());installBoardCardOffers({app,pool:db,auth:(req,res,next)=>req.headers.authorization==='Bearer test'?next():res.sendStatus(401),courseMediaUpload:{single:()=>((_req,_res,next)=>next())},apiOrigin:'https://api.example.com'});app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));
 const server=app.listen(0);await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 try{
 assert.equal((await fetch(base+'/api/admin/board-cards')).status,401);
 const admin=await (await fetch(base+'/api/admin/board-cards',{headers:{Authorization:'Bearer test'}})).json();assert.equal(admin.courses.length,1);
 const publicOffer=await (await fetch(base+'/api/board-cards/'+id)).json();assert.equal(publicOffer.price,149);assert.equal(publicOffer.courseName,'دورة سابقة');assert.equal(publicOffer.currency,'AED');
 await saveBoardCardOffer(db,id,{...input,enabled:false});assert.equal((await fetch(base+'/api/board-cards/'+id)).status,404);
 assert.equal((await fetch(base+'/api/board-cards/invalid')).status,404);
 assert.equal((await db.query('SELECT count(*) AS n FROM board_card_offers')).rows[0].n,1);
 }finally{await new Promise(r=>server.close(r));await db.close();}
});
