// Endpoint đăng nhập công khai: Verify JWT OFF chỉ cho staff-login.
// Mật khẩu được Supabase Auth xác thực; không ghi log hoặc tự kiểm tra hash.
type Settings={supabaseUrl:string;publicKey:string;serviceKey:string;fetcher?:typeof fetch};
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
export function createStaffLoginHandler(settings:Settings){
 const base=settings.supabaseUrl.replace(/\/+$/,''),fetcher=settings.fetcher??fetch;
 const reply=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
 return async(request:Request):Promise<Response>=>{
  if(request.method==='OPTIONS')return new Response(null,{headers:cors});
  if(request.method!=='POST')return reply(405,{error:'Chỉ hỗ trợ POST.'});
  if(!base||!settings.publicKey||!settings.serviceKey)return reply(503,{error:'Đăng nhập chưa sẵn sàng.'});
  try{
   if(Number(request.headers.get('Content-Length'))>4096)return reply(400,{error:'Thông tin đăng nhập không hợp lệ.'});
   const raw=await request.text();if(raw.length>4096)return reply(400,{error:'Thông tin đăng nhập không hợp lệ.'});
   let data;try{data=JSON.parse(raw);}catch{return reply(400,{error:'Thông tin đăng nhập không hợp lệ.'});}
   if(!data||typeof data.username!=='string'||typeof data.password!=='string'||!data.password||data.password.length>1024||!data.username.trim()||data.username.length>254)return reply(400,{error:'Thông tin đăng nhập không hợp lệ.'});
   const lookup=await fetcher(`${base}/rest/v1/rpc/resolve_staff_login`,{method:'POST',headers:{apikey:settings.serviceKey,Authorization:`Bearer ${settings.serviceKey}`,'Content-Type':'application/json'},body:JSON.stringify({p_login:data.username.trim().toLowerCase()}),signal:AbortSignal.timeout(10000)});
   if(!lookup.ok)return reply(503,{error:'Chưa kết nối được dịch vụ đăng nhập.'});
   const resolved=await lookup.json();
   if(resolved?.allowed!==true)return reply(429,{error:'Đã thử đăng nhập nhiều lần. Vui lòng đợi một phút rồi thử lại.'});
   // Không trả email hoặc xác nhận tên tồn tại khi mật khẩu chưa được kiểm chứng.
   const email=typeof resolved.email==='string'&&resolved.email?resolved.email:`${crypto.randomUUID()}@missing.pos.invalid`;
   const auth=await fetcher(`${base}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:settings.publicKey,'Content-Type':'application/json'},body:JSON.stringify({email,password:data.password}),signal:AbortSignal.timeout(15000)});
   if(!auth.ok){if(auth.status===429)return reply(429,{error:'Đã thử đăng nhập nhiều lần. Vui lòng đợi rồi thử lại.'});return reply(auth.status>=500?503:401,{error:'Đăng nhập thất bại. Kiểm tra tên đăng nhập và mật khẩu.'});}
   const session=await auth.json();
   if(!resolved.email||typeof session.access_token!=='string'||typeof session.refresh_token!=='string')return reply(401,{error:'Đăng nhập thất bại. Kiểm tra tên đăng nhập và mật khẩu.'});
   return reply(200,{access_token:session.access_token,refresh_token:session.refresh_token});
  }catch{return reply(503,{error:'Chưa kết nối được dịch vụ đăng nhập. Vui lòng thử lại.'});}
 };
}
const runtime=(globalThis as typeof globalThis&{Deno?:{env:{get:(name:string)=>string|undefined};serve:(handler:(request:Request)=>Promise<Response>)=>unknown}}).Deno;
if(runtime)runtime.serve(createStaffLoginHandler({supabaseUrl:runtime.env.get('SUPABASE_URL')??'',publicKey:runtime.env.get('SUPABASE_ANON_KEY')??runtime.env.get('POS_PUBLISHABLE_KEY')??'',serviceKey:runtime.env.get('SUPABASE_SERVICE_ROLE_KEY')??''}));
