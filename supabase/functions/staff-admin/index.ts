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
      if(!['create_employee','check_creation','cancel_creation'].includes(String(data.action)))return reply(400,{error:'Chức năng này chưa được bật.'});
      if(!settings.serviceKey)return reply(503,{error:'Chưa cấu hình backend tạo nhân viên.'});
      if(typeof data.request_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.request_id)
       ||typeof data.email!=='string'||typeof data.staff_code!=='string'||typeof data.name!=='string'
       ||!['phuc_vu','bep'].includes(String(data.role)))return reply(400,{error:'Thông tin nhân viên không hợp lệ.'});
      const email=data.email.trim().toLowerCase(),name=data.name.trim(),code=data.staff_code.trim().toUpperCase();
      if(email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email)||!name||name.length>100||!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(code))return reply(400,{error:'Tên, email hoặc mã nhân viên không hợp lệ.'});
      const params={p_request_id:data.request_id,p_email:email,p_staff_code:code,p_name:name,p_role:data.role};
      const prepare=async()=>{
       const result=await fetcher(`${baseUrl}/rest/v1/rpc/prepare_employee_creation`,{
        method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(params),signal:AbortSignal.timeout(10000)
       });
       return {response:result,data:await result.json()};
      };
      const prepared=await prepare();
      if(!prepared.response.ok)return reply(prepared.response.status===401?401:409,{error:'Không thể giữ yêu cầu. Kiểm tra quyền, mã nhân viên, email và mã yêu cầu.',...(prepared.data?.code==='23505'||prepared.data?.message==='Mã nhân viên đã tồn tại.'?{released:true}:{pending:true})});
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
       return reply(409,{error:'Auth chưa chấp nhận tài khoản. Kiểm tra email đã tồn tại hoặc chính sách mật khẩu; tài khoản cũ không bị sửa.',released:true});
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
