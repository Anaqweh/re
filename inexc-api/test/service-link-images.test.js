import test from 'node:test';import assert from 'node:assert/strict';
import {publicImageURL,publicImageAddress,publicImageTarget,extractPageImage,fetchServiceLinkImage} from '../service-link-images.js';
const resolve=async()=>[{address:'93.184.216.34',family:4}];
test('page extraction prefers Open Graph, handles attributes/entities and resolves relative images',()=>{
 assert.equal(extractPageImage(`<img src='/hero.jpg'><meta content='/share.jpg?a=1&amp;b=2' property='og:image'><meta name="twitter:image" content="/twitter.png">`,'https://site.example/path/page'),'https://site.example/share.jpg?a=1&b=2');
 assert.equal(extractPageImage(`<base href="/assets/"><meta property=og:image content="pic&#46;jpg">`,'https://site.example/page'),'https://site.example/assets/pic.jpg');
 assert.equal(extractPageImage(`<meta name="twitter:image" content="//cdn.example/preview.png">`,'https://site.example/'),'https://cdn.example/preview.png');
 assert.equal(extractPageImage(`<img src="/logo.png"><img src="/tracker.gif" width="1" height="1"><img data-src="/hero.webp" width="600" height="400">`,'https://site.example/'),'https://site.example/hero.webp');
 assert.equal(extractPageImage(`<!-- <meta property='og:image' content='/comment.png'> --><script>var tag='<meta property="og:image" content="/script.png">'</script><img src='/real.jpg'>`,'https://site.example/'),'https://site.example/real.jpg');
 assert.equal(extractPageImage('<meta property="og:image" content="http://127.0.0.1/private"><img src="data:image/png;base64,x">','https://site.example/'),'');
 assert.equal(extractPageImage('<img src="/logo.svg">','https://site.example/'),'');
});
test('internal, local, encoded and special IPs never become fetch targets',async()=>{
 for(const url of ['http://site.example/','https://user:password@site.example/','https://127.1/','https://2130706433/','https://0x7f000001/','https://10.1.2.3/','https://169.254.169.254/latest/meta-data','https://[::1]/','https://[::ffff:127.0.0.1]/','https://[fc00::1]/','https://localhost/','https://host.internal/','https://host.local/','https://site.example:8443/'])assert.throws(()=>publicImageURL(url),undefined,url);
 for(const ip of ['0.0.0.0','10.0.0.1','100.64.0.1','127.0.0.1','169.254.10.1','172.16.0.1','192.168.1.1','192.0.2.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','::1','::ffff:8.8.8.8','2001:db8::1','2002:7f00:1::','fe80::1','fc00::1','ff02::1'])assert.equal(publicImageAddress(ip),false,ip);
 assert.equal(publicImageAddress('8.8.8.8'),true);assert.equal(publicImageAddress('2606:4700:4700::1111'),true);
 await assert.rejects(publicImageTarget('https://site.example/',{resolve:async()=>[{address:'93.184.216.34',family:4},{address:'10.0.0.1',family:4}]}));
 const target=await publicImageTarget('https://site.example/page',{resolve});assert.equal(target.address.address,'93.184.216.34');assert.equal(target.url.hostname,'site.example');
});
test('redirects are revalidated and page and image DNS are checked before returning a preview',async()=>{
 const visited=[],lookups=[];const lookup=async(host,options)=>{lookups.push(host);assert.equal(options.all,true);return resolve()};
 const result=await fetchServiceLinkImage('https://site.example/start',{resolve:lookup,read:async({url,address})=>{visited.push(url.href);assert.equal(address.address,'93.184.216.34');return visited.length===1?{redirect:'/final'}:{html:'<meta property="og:image" content="https://cdn.example/cover.jpg">'}}});
 assert.equal(result.image_url,'https://cdn.example/cover.jpg');assert.deepEqual(visited,['https://site.example/start','https://site.example/final']);assert.deepEqual(lookups,['site.example','site.example','cdn.example']);
 let reads=0;await assert.rejects(fetchServiceLinkImage('https://site.example/',{resolve,read:async()=>{reads++;return {redirect:'https://169.254.169.254/private'}}}));assert.equal(reads,1);
 await assert.rejects(fetchServiceLinkImage('https://site.example/',{resolve:async host=>host==='cdn.example'?[{address:'127.0.0.1',family:4}]:resolve(),read:async()=>({html:'<meta property="og:image" content="https://cdn.example/secret.png">'})}));
 const direct=await fetchServiceLinkImage('https://site.example/image.jpg',{resolve,read:async()=>({image:'https://site.example/image.jpg'})});assert.equal(direct.image_url,'https://site.example/image.jpg');
 const none=await fetchServiceLinkImage('https://site.example/',{resolve,read:async()=>({html:'<h1>No image</h1>'})});assert.equal(none.image_url,'');
});
