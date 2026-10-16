/* Read public page images for authenticated catalogue editors. No cookies, credentials or scripts. */
import https from 'node:https';
import dns from 'node:dns/promises';
import {isIP,BlockList} from 'node:net';
const blocked=new BlockList();
for(const [ip,bits]of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])blocked.addSubnet(ip,bits,'ipv4');
for(const [ip,bits]of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]])blocked.addSubnet(ip,bits,'ipv6');
export function publicImageAddress(ip){const type=isIP(ip);return type===4?!blocked.check(ip,'ipv4'):type===6&&/^[23]/i.test(ip)&&!blocked.check(ip,'ipv6')}
export function publicImageURL(value,base){
 let u;try{u=new URL(value,base)}catch{throw Error('ضع رابط HTTPS صالحًا لاستخراج الصورة.');}
 const host=u.hostname.replace(/^\[|\]$/g,'').toLowerCase();
 if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||u.href.length>2000||!host||host==='localhost'||/\.(localhost|local|internal|lan|home|invalid|test)$/.test(host)||(!isIP(host)&&!host.includes('.'))||(isIP(host)&&!publicImageAddress(host)))throw Error('استخراج الصور متاح لروابط المواقع العامة الآمنة فقط.');
 u.hash='';return u;
}
export async function publicImageTarget(value,{resolve=dns.lookup,signal}={}){
 const url=publicImageURL(value),hostname=url.hostname.replace(/^\[|\]$/g,'');
 let records;try{records=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await (signal?new Promise((accept,reject)=>{
  const abort=()=>reject(Error('انتهت مهلة الاتصال بالرابط.'));if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});resolve(hostname,{all:true,verbatim:true}).then(accept,reject).finally(()=>signal.removeEventListener('abort',abort));
 }):resolve(hostname,{all:true,verbatim:true}));}catch{throw Error('تعذر الوصول إلى هذا الرابط. تحقق منه أو حاول مجددًا.');}
 if(!records.length||records.some(r=>!publicImageAddress(r.address)))throw Error('تعذر استخدام هذا الرابط لاستخراج صورة.');
 return {url,address:records.find(r=>r.family===4)||records[0]};
}
const decode=value=>value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi,(whole,key)=>{if(key[0]!=='#')return ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'})[key.toLowerCase()];const n=parseInt(key.slice(key[1].toLowerCase()==='x'?2:1),key[1].toLowerCase()==='x'?16:10);return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):''});
function attributes(tag){const out={};for(const m of tag.matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)){const key=m[1].toLowerCase();if(!(key in out))out[key]=decode(m[2]??m[3]??m[4]??'')}return out}
export function extractPageImage(html,pageURL){
 // Ignore raw script/style and commented markup; parsing never executes remote content.
 const clean=html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|textarea|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
 const candidates=[],images=[];let base=pageURL;
 const baseTag=clean.match(/<base\b(?:[^>"']|"[^"]*"|'[^']*')*>/i);if(baseTag){try{base=publicImageURL(attributes(baseTag[0]).href,pageURL).href}catch{}}
 for(const match of clean.matchAll(/<(meta|link|img)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)){
  const a=attributes(match[0]),tag=match[1].toLowerCase(),key=(a.property||a.name||'').toLowerCase();
  if(tag==='meta'&&['og:image:secure_url','og:image','og:image:url','twitter:image','twitter:image:src'].includes(key)&&a.content)candidates.push({value:a.content,rank:key.startsWith('og:')?0:1});
  if(tag==='link'&&(a.rel||'').toLowerCase()==='image_src'&&a.href)candidates.push({value:a.href,rank:2});
  if(tag==='img'){
   const value=a['data-src']||a['data-lazy-src']||a.src;if(!value||((a.width&&Number(a.width)<180)||(a.height&&Number(a.height)<100))||/(?:logo|icon|avatar|pixel|tracker|spacer|badge|favicon)/i.test(value+' '+(a.class||'')))continue;
   images.push({value,rank:Number(a.width)>=300?3:4});
  }
 }
 for(const item of [...candidates,...images].sort((a,b)=>a.rank-b.rank))try{const u=publicImageURL(item.value.trim(),base);if(/\.(?:svg|ico)(?:$|\?)/i.test(u.pathname))continue;return u.href}catch{}
 return '';
}
async function readPage(target,signal){return new Promise((resolve,reject)=>{
 const {url,address}=target;
 const request=https.get(url,{agent:false,signal,lookup:(_host,options,callback)=>options?.all?callback(null,[address]):callback(null,address.address,address.family),headers:{'User-Agent':'INEXC-Service-Preview/1.0','Accept':'text/html,application/xhtml+xml,image/png,image/jpeg,image/webp','Accept-Encoding':'identity'}},response=>{
  const status=response.statusCode,type=String(response.headers['content-type']||'').split(';')[0].toLowerCase();
  if([301,302,303,307,308].includes(status)){response.destroy();return resolve({redirect:response.headers.location})}
  if(status!==200){response.destroy();return reject(Error('الموقع لا يسمح بقراءة الصورة الآن. يمكنك تحميل صورة بنفسك.'))}
  if(['image/png','image/jpeg','image/webp'].includes(type)){response.destroy();return resolve({image:url.href})}
  if(!['text/html','application/xhtml+xml'].includes(type)||!['','identity'].includes(String(response.headers['content-encoding']||'').toLowerCase())){response.destroy();return reject(Error('لم يعرض الرابط صفحة أو صورة يمكن استخدامها.'))}
  if(Number(response.headers['content-length'])>1024*1024){response.destroy();return reject(Error('الصفحة كبيرة جدًا لاستخراج صورتها. يمكنك تحميل صورة بنفسك.'))}
  let size=0;const chunks=[];response.on('data',chunk=>{size+=chunk.length;if(size>1024*1024){response.destroy();reject(Error('الصفحة كبيرة جدًا لاستخراج صورتها.'))}else chunks.push(chunk)});response.on('error',reject);response.on('end',()=>resolve({html:Buffer.concat(chunks).toString('utf8')}));
 });request.on('error',()=>reject(Error('تعذر الاتصال بالرابط لاستخراج الصورة. يمكنك المحاولة مجددًا أو تحميل صورة.')));
})}
export async function fetchServiceLinkImage(value,{resolve=dns.lookup,read=readPage,timeout=9000}={}){
 const signal=AbortSignal.timeout(timeout);let current=publicImageURL(value).href;
 for(let hop=0;hop<4;hop++){
  const target=await publicImageTarget(current,{resolve,signal});if(signal.aborted)throw Error('انتهت مهلة الاتصال بالرابط.');const page=await read(target,signal);
  if(page.redirect){current=publicImageURL(page.redirect,current).href;continue}
  const image=page.image||extractPageImage(page.html||'',target.url.href);
  // Validate the returned image host too; never expose internal image URLs to visitors.
  if(image)await publicImageTarget(image,{resolve,signal});return {image_url:image,source_url:value};
 }
 throw Error('الرابط يحتوي على تحويلات كثيرة. استخدم رابط الصفحة النهائي.');
}
