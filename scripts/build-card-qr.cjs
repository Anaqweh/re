// Bundle the already installed, MIT-licensed qrcode core for private, offline QR rendering.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),base=path.join(root,'inexc-api/node_modules');
const modules=[],ids=new Map();
function add(file){file=require.resolve(file);if(ids.has(file))return ids.get(file);const id=modules.length;ids.set(file,id);modules.push('');let source=fs.readFileSync(file,'utf8');source=source.replace(/require\(['"]([^'"]+)['"]\)/g,(_,request)=>{const child=request.startsWith('.')?path.resolve(path.dirname(file),request):require.resolve(request,{paths:[base]});return 'load('+add(child)+')';});modules[id]=id+':function(module,exports,load){\n'+source+'\n}';return id;}
const entry=add(path.join(base,'qrcode/lib/core/qrcode.js'));
fs.writeFileSync(path.join(root,'vendor/inexc-qr.js'),'/* qrcode 1.5.4 / dijkstrajs. MIT licenses: inexc-qr-LICENSE.txt. Build: node scripts/build-card-qr.cjs */\n(function(global){const modules={'+modules.join(',\n')+'},cache={};function load(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};modules[id](m,m.exports,load);return m.exports}global.INEXCQRCode=load('+entry+');})(window);\n');
const licenses=['qrcode','dijkstrajs'].map(name=>{const folder=path.dirname(require.resolve(name+'/package.json',{paths:[base]}));const file=fs.readdirSync(folder).find(x=>/^license/i.test(x));return name+'\n'+fs.readFileSync(path.join(folder,file),'utf8')}).join('\n\n');fs.writeFileSync(path.join(root,'vendor/inexc-qr-LICENSE.txt'),licenses);
console.log('QR core bundled locally; no external QR service needed.');
