// Owner tạo nhân viên qua Auth Admin; không lưu/log mật khẩu.
// Dán nguyên file vào Edge Function staff-admin của project thử nghiệm.
type Settings = {
  supabaseUrl: string;
  publicKey: string;
  serviceKey?: string;
  fetcher?: typeof fetch;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function createStaffAdminHandler(settings: Settings) {
  const baseUrl = settings.supabaseUrl.replace(/\/+$/, '');
  const fetcher = settings.fetcher ?? fetch;

  function reply(status: number, body: Record<string, unknown>) {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: corsHeaders });
    }
    if (request.method !== 'POST') {
      return reply(405, { error: 'Chỉ hỗ trợ POST.' });
    }

    const match = request.headers.get('Authorization')?.trim().match(/^Bearer\s+(\S+)$/i);
    if (!match) {
      return reply(401, { error: 'Bạn cần đăng nhập bằng tài khoản Owner.' });
    }
    if (!baseUrl || !settings.publicKey) {
      return reply(500, { error: 'Chưa cấu hình kết nối của function.' });
    }

    const headers = {
      apikey: settings.publicKey,
      Authorization: `Bearer ${match[1]}`,
    };

    try {
      // Xác minh JWT với Supabase Auth; không chỉ đọc/decode payload của token.
      const authResult = await fetcher(`${baseUrl}/auth/v1/user`, {
        method: 'GET', headers, cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      if (authResult.status === 401 || authResult.status === 403) {
        return reply(401, { error: 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.' });
      }
      if (!authResult.ok) {
        return reply(503, { error: 'Chưa kiểm tra được phiên đăng nhập. Vui lòng thử lại.' });
      }
      const user = await authResult.json();
      if (!user || typeof user.id !== 'string' || !user.id) {
        return reply(401, { error: 'Không xác minh được người đăng nhập.' });
      }

      // Chuyển chính JWT đã xác minh vào database để lấy quyền hiện tại.
      // Không tin role, user_id hoặc trạng thái do frontend gửi trong body.
      const accessResult = await fetcher(`${baseUrl}/rest/v1/rpc/get_my_access`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(10000),
      });
      if (accessResult.status === 401) {
        return reply(401, { error: 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.' });
      }
      if (!accessResult.ok) {
        return reply(503, { error: 'Chưa kiểm tra được quyền. Vui lòng thử lại.' });
      }
      const access = await accessResult.json();
      if (!access || access.role !== 'chu' || access.is_active !== true
          || !Array.isArray(access.permissions)
          || !access.permissions.includes('employees.manage')) {
        return reply(403, { error: 'Chỉ Owner đang hoạt động được dùng quản lý nhân viên.' });
      }

      let input: unknown;
      try { input = await request.json(); }
      catch { return reply(400, { error: 'Yêu cầu JSON không hợp lệ.' }); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) return reply(400,{error:'Yêu cầu không hợp lệ.'});
      const data=input as Record<string,unknown>;
      if(data.action==='check_access')return reply(200,{ok:true,message:'Owner đã được xác thực và có quyền quản lý nhân viên.'});
      if(['reset_password','check_password_reset'].includes(String(data.action))){
       const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
       if(!uuid(data.employee_id)||data.request_id!==undefined&&!uuid(data.request_id))return reply(400,{error:'Yêu cầu đặt lại không hợp lệ.'});
       const rpc=async(name:string,body:unknown,admin=false)=>{
        const response=await fetcher(`${baseUrl}/rest/v1/rpc/${name}`,{method:'POST',headers:admin?{apikey:settings.serviceKey!,Authorization:`Bearer ${settings.serviceKey}`,'Content-Type':'application/json'}:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
        return {response,data:await response.json()};
       };
       if(data.action==='check_password_reset'){
        const status=await rpc('get_employee_password_reset',{p_employee_id:data.employee_id,p_request_id:data.request_id??null});
        if(!status.response.ok)return reply(403,{error:'Chưa đọc được yêu cầu đặt lại.'});
        return reply(200,{ok:true,reset:status.data});
       }
       if(!settings.serviceKey)return reply(503,{error:'Backend đặt lại chưa sẵn sàng.'});
       if(!uuid(data.request_id)||!Number.isInteger(data.expected_version)||(data.expected_version as number)<1||typeof data.password!=='string'||data.password.length<12||data.password.length>128)return reply(400,{error:'Mật khẩu tạm cần 12–128 ký tự và yêu cầu phải hợp lệ.'});
       const prepared=await rpc('begin_employee_password_reset',{p_request_id:data.request_id,p_employee_id:data.employee_id,p_expected_version:data.expected_version});
       if(!prepared.response.ok)return reply(409,{error:'Không bắt đầu được đặt lại. Kiểm tra quyền và tải lại danh sách nhân viên.'});
       if(prepared.data?.completed===true)return reply(200,{ok:true,completed:true});
       if(prepared.data?.conflict)return reply(409,{error:'Đã có yêu cầu đặt lại đang chờ. Bấm Kiểm tra lại để tiếp tục.',pending:true,reset:prepared.data});
       const attempt=await rpc('register_employee_password_attempt',{p_request_id:data.request_id,p_owner_id:user.id},true);
       if(!attempt.response.ok)return reply(503,{error:'Chưa bắt đầu được lần đổi mật khẩu. Nhân viên vẫn bị khóa; kiểm tra lại.',pending:true});
       if(attempt.data?.completed)return reply(200,{ok:true,completed:true});
       if(!uuid(attempt.data?.attempt_id))return reply(503,{error:'Chưa xác nhận được yêu cầu. Kiểm tra lại.',pending:true});
       const existing=await fetcher(`${baseUrl}/auth/v1/admin/users/${data.employee_id}`,{method:'GET',headers:{apikey:settings.serviceKey,Authorization:`Bearer ${settings.serviceKey}`},signal:AbortSignal.timeout(10000)});
       if(!existing.ok)return reply(503,{error:'Chưa đọc được tài khoản. Nhân viên vẫn bị khóa; thử lại.',pending:true});
       const authBody=await existing.json();
       const authUser=authBody.user??authBody;
       const metadata=authUser.app_metadata&&typeof authUser.app_metadata==='object'?authUser.app_metadata:{};
       let changed:Response;
       try{changed=await fetcher(`${baseUrl}/auth/v1/admin/users/${data.employee_id}`,{method:'PUT',headers:{apikey:settings.serviceKey,Authorization:`Bearer ${settings.serviceKey}`,'Content-Type':'application/json'},body:JSON.stringify({password:data.password,app_metadata:{...metadata,pos_staff_reset_attempt:attempt.data.attempt_id}}),signal:AbortSignal.timeout(15000)});}
       catch{return reply(503,{error:'Chưa xác nhận được kết quả. Nhân viên vẫn bị khóa; chọn mật khẩu tạm khác rồi thử lại cùng yêu cầu.',pending:true});}
       if(!changed.ok)return reply(changed.status>=500?503:409,{error:'Auth chưa chấp nhận mật khẩu. Nhân viên vẫn bị khóa; chọn mật khẩu tạm khác rồi thử lại.',pending:true});
       const finished=await rpc('finish_employee_password_reset',{p_request_id:data.request_id,p_owner_id:user.id},true);
       if(!finished.response.ok)return reply(503,{error:'Chưa xác nhận hoàn tất. Bấm Kiểm tra lại; nếu còn chờ, chọn mật khẩu tạm khác và thử lại.',pending:true});
       return reply(200,{ok:true,completed:true,message:'Đã đặt mật khẩu tạm mới. Nhân viên phải đăng nhập lại và đổi mật khẩu.'});
      }
      if(!['create_employee','check_creation','cancel_creation'].includes(String(data.action)))return reply(400,{error:'Chức năng này chưa được bật.'});
      if(!settings.serviceKey)return reply(503,{error:'Chưa cấu hình backend tạo nhân viên.'});
      const usernameMode=typeof data.username==='string';
      if(typeof data.request_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.request_id)
       ||typeof data.name!=='string'||!['phuc_vu','bep'].includes(String(data.role)))return reply(400,{error:'Thông tin nhân viên không hợp lệ.'});
      const name=data.name.trim(),username=usernameMode?(data.username as string).trim().toLowerCase():'';
      if(!name||name.length>100||usernameMode&&!/^[a-z0-9][a-z0-9_.-]{2,39}$/.test(username))return reply(400,{error:'Tên hoặc tên đăng nhập không hợp lệ.'});
      // Giữ đường cũ cho yêu cầu đang chờ từ trước khi đổi giao diện.
      const email=usernameMode?`${data.request_id}@staff.pos.invalid`:typeof data.email==='string'?data.email.trim().toLowerCase():'';
      const code=typeof data.staff_code==='string'?data.staff_code.trim().toUpperCase():'';
      if(!usernameMode&&(email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email)||!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(code)))return reply(400,{error:'Thông tin yêu cầu cũ không hợp lệ.'});
      const params=usernameMode?{p_request_id:data.request_id,p_username:username,p_name:name,p_role:data.role}:{p_request_id:data.request_id,p_email:email,p_staff_code:code,p_name:name,p_role:data.role};
      const prepare=async()=>{
       const result=await fetcher(`${baseUrl}/rest/v1/rpc/${usernameMode?'prepare_employee_account':'prepare_employee_creation'}`,{
        method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(params),signal:AbortSignal.timeout(10000)
       });
       return {response:result,data:await result.json()};
      };
      const prepared=await prepare();
      if(!prepared.response.ok)return reply(prepared.response.status===401?401:409,{error:'Không thể giữ yêu cầu. Kiểm tra quyền, tên đăng nhập và mã yêu cầu.',...(prepared.data?.code==='23505'||['Mã nhân viên đã tồn tại.','Tên đăng nhập đã được sử dụng.'].includes(prepared.data?.message)?{released:true}:{pending:true})});
      if(prepared.data?.completed===true)return reply(200,{ok:true,user_id:prepared.data.user_id,message:'Tài khoản đã được tạo. Nhân viên phải đổi mật khẩu khi đăng nhập.'});
      const cancel=async()=>{
       const response=await fetcher(`${baseUrl}/rest/v1/rpc/cancel_employee_creation`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({p_request_id:data.request_id}),signal:AbortSignal.timeout(10000)});
       const body=await response.json();
       if(!response.ok)return reply(503,{error:'Chưa xác nhận được kết quả. Bấm Kiểm tra lại.',pending:true});
       if(body?.completed)return reply(200,{ok:true,user_id:body.user_id,message:'Tài khoản đã được tạo.'});
       return reply(200,{ok:false,released:true,message:'Đã hủy yêu cầu chưa hoàn tất. Tài khoản đã tạo không bị xóa.'});
      };
      if(data.action==='cancel_creation')return await cancel();
      if(data.action==='check_creation')return reply(200,{ok:false,pending:true,message:'Chưa xác nhận đã tạo. Nhập lại mật khẩu tạm và thử lại cùng yêu cầu.'});
      if(typeof data.password!=='string'||data.password.length<12||data.password.length>128)return reply(400,{error:'Mật khẩu tạm cần từ 12 đến 128 ký tự.',pending:true});
      // Service key chỉ dùng ở server. Không chuyển role/metadata tùy ý từ client.
      let created:Response;
      try{
       created=await fetcher(`${baseUrl}/auth/v1/admin/users`,{
        method:'POST',headers:{apikey:settings.serviceKey,Authorization:`Bearer ${settings.serviceKey}`,'Content-Type':'application/json'},
        body:JSON.stringify({email,password:data.password,email_confirm:true,app_metadata:{pos_employee_request:data.request_id}}),
        signal:AbortSignal.timeout(15000)
       });
      }catch{return reply(503,{error:'Chưa xác nhận được kết quả. Giữ yêu cầu và bấm Kiểm tra lại.',pending:true});}
      // Trigger Auth đã ghi profile/nhật ký atomically. Đọc ledger để xác nhận,
      // kể cả lần POST trả lỗi do lần gọi đồng thời đã tạo cùng email.
      const confirmed=await prepare();
      if(confirmed.response.ok&&confirmed.data?.completed===true)return reply(200,{ok:true,user_id:confirmed.data.user_id,message:'Đã tạo nhân viên. Nhân viên phải đổi mật khẩu lần đầu.'});
      if(created.status>=400&&created.status<500){
       // Không tự reset hay sửa tài khoản Auth có email đã tồn tại.
       const cancelled=await cancel();
       const result=await cancelled.json();
       if(result.ok||result.pending)return reply(cancelled.status,result);
       return reply(409,{error:'Auth chưa chấp nhận tài khoản. Kiểm tra tên đăng nhập hoặc chính sách mật khẩu; tài khoản cũ không bị sửa.',released:true});
      }
      return reply(503,{error:'Chưa xác nhận được kết quả. Bấm Kiểm tra lại.',pending:true});
    } catch {
      // Không đưa token, thông tin đăng nhập hoặc lỗi nội bộ vào phản hồi/log.
      return reply(503, { error: 'Chưa xác nhận được kết quả. Vui lòng kiểm tra lại.', pending:true });
    }
  };
}

// Supabase tự cung cấp các biến môi trường mặc định này ở Edge Function.
// Không điền API key hoặc mật khẩu trực tiếp vào code.
const edgeRuntime = (globalThis as typeof globalThis & {
  Deno?: {
    env: { get: (name: string) => string | undefined };
    serve: (handler: (request: Request) => Promise<Response>) => unknown;
  };
}).Deno;

if (edgeRuntime) {
  edgeRuntime.serve(createStaffAdminHandler({
    supabaseUrl: edgeRuntime.env.get('SUPABASE_URL') ?? '',
    serviceKey: edgeRuntime.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    publicKey: edgeRuntime.env.get('SUPABASE_ANON_KEY')
      ?? edgeRuntime.env.get('POS_PUBLISHABLE_KEY') ?? '',
  }));
}
