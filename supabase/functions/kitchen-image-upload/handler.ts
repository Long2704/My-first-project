// No credentials in source, logs, or response. Caller JWT is verified at Auth and each DB gate.
export type DecodedImage={image:Uint8Array;preview:Uint8Array;width:number;height:number};
export type Settings={supabaseUrl:string;publicKey:string;serviceKey:string;decode:(bytes:Uint8Array,mime:string)=>Promise<DecodedImage>;fetcher?:typeof fetch};
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const limit=5*1024*1024;
function reply(status:number,body:unknown){return new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});}
export function sniff(bytes:Uint8Array){
 if(bytes.length>=12&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'image/jpeg';
 if(bytes.length>=24&&[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))return 'image/png';
 if(bytes.length>=20&&new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP')return 'image/webp';
 throw new Error('Chỉ nhận ảnh JPG, PNG hoặc WebP hợp lệ.');
}
async function boundedBody(request:Request){
 if(Number(request.headers.get('content-length'))>limit+65536)throw new Error('Ảnh tối đa 5 MB.');
 const reader=request.body?.getReader();if(!reader)throw new Error('Thiếu ảnh.');
 const parts:Uint8Array[]=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit+65536)throw new Error('Ảnh tối đa 5 MB.');parts.push(value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;
}
export function createKitchenImageHandler(settings:Settings){
 const base=settings.supabaseUrl.replace(/\/+$/,''),fetcher=settings.fetcher??fetch;
 return async(request:Request):Promise<Response>=>{
  if(request.method==='OPTIONS')return new Response(null,{headers:cors});
  if(request.method!=='POST')return reply(405,{error:'Chỉ hỗ trợ POST.'});
  const bearer=request.headers.get('Authorization');if(!/^Bearer \S+$/i.test(bearer??''))return reply(401,{error:'Cần đăng nhập Owner.'});
  if(!base||!settings.publicKey||!settings.serviceKey)return reply(503,{error:'Chưa cấu hình phiếu ảnh.'});
  const userHeaders={apikey:settings.publicKey,Authorization:bearer!,'Content-Type':'application/json'};
  const adminHeaders={apikey:settings.serviceKey,Authorization:`Bearer ${settings.serviceKey}`,'Content-Type':'application/json'};
  async function rpc(name:string,body:unknown,admin=false){
   const response=await fetcher(`${base}/rest/v1/rpc/${name}`,{method:'POST',headers:admin?adminHeaders:userHeaders,body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new Error('Không xác nhận được thao tác. Giữ ảnh và thử lại với cùng mã tải.');
   return response.status===204?null:await response.json();
  }
  try{
   const auth=await fetcher(`${base}/auth/v1/user`,{headers:userHeaders,signal:AbortSignal.timeout(10000)});
   if(!auth.ok)return reply(401,{error:'Phiên đăng nhập hết hiệu lực.'});
   const user=await auth.json();if(typeof user.id!=='string')return reply(401,{error:'Phiên đăng nhập không hợp lệ.'});
   const access=await rpc('has_permission',{p_permission:'kitchen_images.upload'});
   if(access!==true)return reply(403,{error:'Chỉ Owner được tải ảnh.'});
   if(request.headers.get('content-type')?.startsWith('application/json')){
    const raw=await boundedBody(request);if(raw.length>128)return reply(400,{error:'Yêu cầu không hợp lệ.'});
    const body=JSON.parse(new TextDecoder().decode(raw));if(body.action!=='cleanup')return reply(400,{error:'Yêu cầu không hợp lệ.'});
    const jobs=await rpc('claim_kitchen_image_cleanup',{p_owner:user.id},true);
    let cleaned=0;
    for(const job of jobs){
     const response=await fetcher(`${base}/storage/v1/object/kitchen-ticket-images`,{method:'DELETE',headers:adminHeaders,body:JSON.stringify({prefixes:[job.image_path,job.preview_path]}),signal:AbortSignal.timeout(15000)});
     if(response.ok){await rpc('finish_kitchen_image_cleanup',{p_upload_id:job.id},true);cleaned++;}
    }
    return reply(200,{cleaned});
   }
   const raw=await boundedBody(request);
   const form=await new Response(raw,{headers:{'Content-Type':request.headers.get('content-type')??''}}).formData();
   const file=form.get('file'),requestId=form.get('request_id');
   if(!(file instanceof File)||!file.size||file.size>limit)return reply(400,{error:'Chọn một ảnh tối đa 5 MB.'});
   if(typeof requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))return reply(400,{error:'Thiếu mã tải ảnh.'});
   const bytes=new Uint8Array(await file.arrayBuffer()),mime=sniff(bytes);
   if(file.type&&file.type!==mime)return reply(400,{error:'Nội dung ảnh khác định dạng đã chọn.'});
   const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
   const job=await rpc('reserve_kitchen_image_upload',{p_request_id:requestId,p_sha256:sha256});
   if(job.expired)return reply(200,{expired:true});
   if(job.ticket)return reply(200,{ticket:job.ticket});
   if(!job.verified){
    const decoded=await settings.decode(bytes,mime);
    if(!decoded.image.length||decoded.image.length>limit||!decoded.preview.length||decoded.preview.length>limit)throw new Error('Ảnh sau xử lý quá lớn. Chọn ảnh nhỏ hơn.');
    for(const [path,data] of [[job.image_path,decoded.image],[job.preview_path,decoded.preview]] as [string,Uint8Array][]){
     const result=await fetcher(`${base}/storage/v1/object/kitchen-ticket-images/${path}`,{method:'POST',headers:{...adminHeaders,'Content-Type':'image/webp','Cache-Control':'max-age=0','x-upsert':'false'},body:data as BodyInit,signal:AbortSignal.timeout(20000)});
     if(!result.ok)throw new Error('Tải ảnh chưa xong. Giữ ảnh để thử lại.');
    }
    await rpc('verify_kitchen_image_upload',{p_upload_id:job.upload_id,p_byte_size:decoded.image.length,p_width:decoded.width,p_height:decoded.height},true);
   }
   const ticket=await rpc('finalize_kitchen_image_upload',{p_upload_id:job.upload_id});
   return reply(200,{ticket});
  }catch(error){
   // Only our explicit input messages leave the server. Never leak provider responses.
   const safe=error instanceof Error&&/^(Chỉ nhận ảnh|Ảnh |Thiếu ảnh|Không xác nhận|Tải ảnh)/.test(error.message)?error.message:'Chưa xử lý được ảnh. Giữ ảnh và thử lại; không tạo lượt tải mới.';
   return reply(400,{error:safe});
  }
 };
}
