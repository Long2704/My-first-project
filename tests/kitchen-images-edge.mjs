import assert from 'node:assert/strict';
import {createKitchenImageHandler,sniff} from '../supabase/functions/kitchen-image-upload/handler.ts';
const id='11111111-1111-4111-8111-111111111111',upload='22222222-2222-4222-8222-222222222222';
const png=Uint8Array.from([137,80,78,71,13,10,26,10,...Array(30).fill(0)]);
const req=(bytes=png,type='image/png',token='user-token')=>{const form=new FormData();form.append('request_id',id);form.append('file',new File([bytes],'photo.png',{type}));return new Request('https://local.test/function',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:form});};
function fixture({allow=true,auth=true,failUpload=false,failFinalize=false,existing=false,verified=false,expired=false,decodeError=false}={}){
 const calls=[];let decoded=0;
 const handler=createKitchenImageHandler({supabaseUrl:'https://local.supabase.test',publicKey:'public-test',serviceKey:'service-test',decode:async(bytes,mime)=>{decoded++;assert.equal(mime,'image/png');if(decodeError)throw new Error('internal secret');return {image:new Uint8Array(20),preview:new Uint8Array(10),width:200,height:100};},fetcher:async(url,init)=>{
  calls.push({url,...init});const body=typeof init.body==='string'?JSON.parse(init.body):init.body;
  let result=null,status=200;
  if(url.endsWith('/auth/v1/user')){assert.equal(init.headers.Authorization,'Bearer user-token');result={id:'owner-test'};if(!auth)status=401;}
  else if(url.endsWith('/has_permission'))result=allow;
  else if(url.endsWith('/reserve_kitchen_image_upload')){assert.equal(body.p_request_id,id);assert.match(body.p_sha256,/^[a-f0-9]{64}$/);result=expired?{expired:true}:existing?{ticket:{id:'ticket-1'}}:{upload_id:upload,image_path:'safe/image.webp',preview_path:'safe/preview.webp',verified};}
  else if(url.includes('/storage/v1/object/')){assert.equal(init.headers.Authorization,'Bearer service-test');assert.equal(init.headers['x-upsert'],'false');assert.equal(init.headers['Content-Type'],'image/webp');if(failUpload)status=500;}
  else if(url.endsWith('/verify_kitchen_image_upload')){assert.equal(init.headers.Authorization,'Bearer service-test');assert.deepEqual(body,{p_upload_id:upload,p_byte_size:20,p_width:200,p_height:100});}
  else if(url.endsWith('/finalize_kitchen_image_upload')){assert.equal(init.headers.Authorization,'Bearer user-token');assert.deepEqual(body,{p_upload_id:upload});if(failFinalize)status=403;result={id:'ticket-1'};}
  else throw new Error('Unexpected URL '+url);
  return new Response(JSON.stringify(result),{status});
 }});return {handler,calls,decoded:()=>decoded};
}
for(const config of [{allow:false},{auth:false}]){const f=fixture(config);const response=await f.handler(req());assert.equal(response.status,config.auth===false?401:403);assert.equal(f.decoded(),0);assert.ok(!f.calls.some(c=>c.url.includes('/storage/')));}
const success=fixture();assert.equal((await success.handler(req())).status,200);assert.equal(success.decoded(),1);assert.equal(success.calls.filter(c=>c.url.includes('/storage/')).length,2);
for(const config of [{existing:true},{verified:true}]){const f=fixture(config);assert.equal((await f.handler(req())).status,200);assert.equal(f.decoded(),0);assert.equal(f.calls.filter(c=>c.url.includes('/storage/')).length,0);}
for(const config of [{failUpload:true},{decodeError:true}]){const f=fixture(config);const response=await f.handler(req());assert.equal(response.status,400);assert.ok(!f.calls.some(c=>c.url.endsWith('/finalize_kitchen_image_upload')));assert.ok(!(await response.text()).includes('secret'));}
const revoked=fixture({failFinalize:true});assert.equal((await revoked.handler(req())).status,400);
for(const [bytes,mime] of [[new TextEncoder().encode('<svg>fake</svg>'),'image/png'],[png,'image/jpeg'],[new Uint8Array(5*1024*1024+1),'image/png']]){const f=fixture();assert.equal((await f.handler(req(bytes,mime))).status,400);assert.equal(f.decoded(),0);}
const expired=fixture({expired:true});const expiredReply=await expired.handler(req());assert.equal(expiredReply.status,200);assert.deepEqual(await expiredReply.json(),{expired:true});assert.equal(expired.decoded(),0);assert.equal(expired.calls.filter(c=>c.url.includes('/storage/')).length,0);
assert.throws(()=>sniff(new Uint8Array(10)));
const bounded=fixture();let chunks=0;
const stream=new ReadableStream({pull(controller){chunks++;controller.enqueue(new Uint8Array(1024*1024));if(chunks===20)controller.close();}});
const huge=new Request('https://local.test/function',{method:'POST',headers:{Authorization:'Bearer user-token','Content-Type':'multipart/form-data; boundary=mock'},body:stream,duplex:'half'});
assert.equal((await bounded.handler(huge)).status,400);assert.ok(chunks<10,'streaming size cap stops consumption');assert.equal(bounded.decoded(),0);
console.log('PASS Edge handler: JWT check, Owner gate, bounded inputs/type validation, trusted metadata, no browser service key, partial failure no ticket, lost-ACK retry, revocation on finalize. Mock HTTP; decoder tested separately.');
