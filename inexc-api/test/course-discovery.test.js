import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../inexc-course-page.js',import.meta.url),'utf8');
async function open({search='?id=removed-course',ok=true,body=[],endpoint='https://api.inexctraining.com/api'}={}){
 const nodes=[],root={innerHTML:''};let onLoad;
 const document={title:'Course',getElementById(){return root},querySelector(selector){return nodes.find(n=>selector==='meta[name="robots"]'&&n.name==='robots')||null},createElement(tag){return {tag,isConnected:false}},head:{appendChild(n){n.isConnected=true;nodes.push(n)}}};
 vm.runInNewContext(source,{window:{INEXC_REGISTRATION_ENDPOINT:endpoint,addEventListener(_,fn){onLoad=fn}},document,location:{search},URLSearchParams,fetch:async()=>({ok,json:async()=>body})});
 await onLoad();return {nodes,root,document};
}
test('deleted and unpublished courses are explicitly excluded after a successful catalogue response',async()=>{const x=await open();assert.equal(x.nodes[0].content,'noindex,follow');assert.match(x.root.innerHTML,/استعرض الدورات/)});
test('missing course IDs cannot create indexable empty pages',async()=>{const x=await open({search:''});assert.equal(x.nodes[0].content,'noindex,follow')});
test('transient API failures are not confused with deletion',async()=>{for(const input of [{ok:false},{body:{error:'unavailable'}},{endpoint:''}]){const x=await open(input);assert.equal(x.nodes.length,0);assert.match(x.root.innerHTML,/تعذر/);}});
