/* Local preparation only: project files never go to a third-party compressor. */
(()=>{'use strict';
const maxBytes=10*1024*1024;
function validate(files){if(!files.length||files.length>10)throw Error('اختر من ملف واحد إلى 10 ملفات.');if(files.reduce((n,f)=>n+f.size,0)>50*1024*1024)throw Error('مجموع الملفات المختارة يتجاوز 50 ميغابايت قبل التجهيز.');}
async function imageSize(file){
 if(file.size<2*1024*1024||!['image/jpeg','image/webp'].includes(file.type)||typeof createImageBitmap!=='function')return file;
 let bitmap;try{bitmap=await createImageBitmap(file);if(bitmap.width*bitmap.height>24000000)return file;const scale=Math.min(1,2560/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);const blob=await new Promise(r=>canvas.toBlob(r,file.type,.86));return blob&&blob.type===file.type&&blob.size<file.size*.9?new File([blob],file.name,{type:file.type,lastModified:file.lastModified}):file;}catch{return file}finally{bitmap?.close()}
}
const table=Uint32Array.from({length:256},(_,i)=>{for(let j=0;j<8;j++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0});
const crc=data=>{let c=0xffffffff;for(const byte of data)c=table[(c^byte)&255]^(c>>>8);return(c^0xffffffff)>>>0};
function header(size){const bytes=new Uint8Array(size);return{bytes,view:new DataView(bytes.buffer)}}
async function zip(files,name){const locals=[],central=[];let offset=0;const used=new Set();for(const file of files){let clean=file.name.replace(/[\\/\x00-\x1f]/g,'_')||'file',n=1,original=clean;while(used.has(clean))clean=(n++)+'-'+original;used.add(clean);const filename=new TextEncoder().encode(clean),raw=new Uint8Array(await file.arrayBuffer());let data=raw,method=0;
 if(typeof CompressionStream==='function'){try{const compressed=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());if(compressed.length<raw.length){data=compressed;method=8}}catch{}}
 const sum=crc(raw),h=header(30);h.view.setUint32(0,0x04034b50,true);h.view.setUint16(4,20,true);h.view.setUint16(6,0x800,true);h.view.setUint16(8,method,true);h.view.setUint16(12,33,true);h.view.setUint32(14,sum,true);h.view.setUint32(18,data.length,true);h.view.setUint32(22,raw.length,true);h.view.setUint16(26,filename.length,true);
 const c=header(46);c.view.setUint32(0,0x02014b50,true);c.view.setUint16(4,20,true);c.bytes.set(h.bytes.slice(4,30),6);c.view.setUint32(42,offset,true);locals.push(h.bytes,filename,data);central.push(c.bytes,filename);offset+=30+filename.length+data.length;}
 const end=header(22);end.view.setUint32(0,0x06054b50,true);end.view.setUint16(8,files.length,true);end.view.setUint16(10,files.length,true);end.view.setUint32(12,central.reduce((n,x)=>n+x.length,0),true);end.view.setUint32(16,offset,true);return new File([...locals,...central,end.bytes],name,{type:'application/zip',lastModified:0});}
async function prepare(files,{shrinkImages=true,bundle=false,onProgress=()=>{}}={}){files=Array.from(files);validate(files);const converted=[];for(const [i,file]of files.entries()){onProgress('تجهيز الملف '+(i+1)+' من '+files.length+'…');converted.push(shrinkImages?await imageSize(file):file)}let result;
 if(bundle&&converted.length>1)result=[await zip(converted,'project-files.zip')];else{result=[];for(const f of converted){if(f.size>maxBytes){const packed=await zip([f],f.name+'.zip');result.push(packed.size<f.size?packed:f)}else result.push(f)}}
 if(result.some(f=>f.size>maxBytes))throw Error(bundle?'حجم المشروع بعد التجهيز يتجاوز 10 ميغابايت. قلّل حجم الملفات ثم أعد المحاولة.':'أحد الملفات يتجاوز 10 ميغابايت بعد التجهيز. قلّل حجمه ثم أعد المحاولة.');return result;
}
window.INEXCProjectFiles={prepare,validate,zip};})();
