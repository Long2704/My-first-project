import assert from 'node:assert/strict';
import {createStaffAdminHandler} from '../supabase/functions/staff-admin/index.ts';

const base='https://example.supabase.co',token='mock-user-access-token',key='mock-public-key';
const owner={role:'chu',is_active:true,permissions:['employees.manage']};
const request=(body={action:'check_access'},headers={Authorization:`Bearer ${token}`})=>new Request('https://example.test/staff-admin',{
 method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)
});
function fixture({access=owner,authStatus=200,accessStatus=200,authBody={id:'00000000-0000-0000-0000-000000000001'},fail=false}={}){
 const calls=[];
 const handler=createStaffAdminHandler({supabaseUrl:base+'/',publicKey:key,fetcher:async(url,init)=>{
  calls.push({url,...init});
  assert.equal(init.headers.apikey,key);assert.equal(init.headers.Authorization,`Bearer ${token}`);
  if(fail)throw new Error('internal details '+token+' '+key);
  if(url===base+'/auth/v1/user'){assert.equal(init.method,'GET');return new Response(JSON.stringify(authBody),{status:authStatus});}
  assert.equal(url,base+'/rest/v1/rpc/get_my_access');assert.equal(init.method,'POST');assert.equal(init.body,'{}');
  return new Response(JSON.stringify(access),{status:accessStatus});
 }});
 return {handler,calls};
}
async function status(fixture,req,expected){
 const response=await fixture.handler(req);assert.equal(response.status,expected);
 assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');
 const text=await response.text();assert.ok(!text.includes(token));assert.ok(!text.includes(key));
 return JSON.parse(text);
}

const preflight=fixture();
assert.equal((await preflight.handler(new Request('https://example.test/staff-admin',{method:'OPTIONS'}))).status,200);
assert.equal(preflight.calls.length,0);
await status(preflight,new Request('https://example.test/staff-admin'),405);
for(const authorization of [undefined,'','Bearer','Basic fake','Bearer fake token']){
 const f=fixture();await status(f,request({},authorization?{Authorization:authorization}:{}),401);assert.equal(f.calls.length,0);
}
for(const code of [401,403]){
 const f=fixture({authStatus:code});await status(f,request(),401);assert.equal(f.calls.length,1);
}
await status(fixture({authStatus:503}),request(),503);
await status(fixture({authBody:{}}),request(),401);
for(const access of [null,{},
 {role:'phuc_vu',is_active:true,permissions:[]},
 {role:'bep',is_active:true,permissions:[]},
 {role:'thu_ngan',is_active:true,permissions:['employees.manage']},
 {role:'phuc_vu',is_active:true,permissions:['employees.manage']},
 {...owner,is_active:false},
 {...owner,permissions:[]},
 {...owner,permissions:'employees.manage'}
])await status(fixture({access}),request({action:'check_access',role:'chu',user_id:'someone-else'}),403);
await status(fixture({accessStatus:401}),request(),401);
await status(fixture({accessStatus:503}),request(),503);
await status(fixture({accessStatus:404}),request(),503);
await status(fixture({fail:true}),request(),503);
const good=fixture();assert.equal((await status(good,request(),200)).ok,true);assert.equal(good.calls.length,2);
assert.ok(good.calls.every(c=>!c.url.includes('/admin/')&&!c.url.includes('service_role')));
for(const body of [null,[],{}, {action:'create_user',role:'chu'}, {action:'delete_user'}])await status(fixture(),request(body),400);
await status(fixture(),new Request('https://example.test/staff-admin',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:'not json'}),400);
const missing=createStaffAdminHandler({supabaseUrl:'',publicKey:'',fetcher:async()=>{throw new Error('must not fetch');}});
assert.equal((await missing(request())).status,500);
// Cùng JWT: Auth vẫn xác nhận, nhưng DB vừa khóa Owner thì phải từ chối.
const state={...owner};const locked=fixture({access:state});
await status(locked,request(),200);state.is_active=false;await status(locked,request(),403);state.is_active=true;await status(locked,request(),200);
console.log('ĐẠT: JWT được kiểm chứng qua Auth; Owner hoạt động + quyền DB; chặn Waiter/Kitchen/role giả/khóa phiên cũ/ẩn danh; lỗi kết nối fail closed, CORS, không lộ token/key và không có thao tác quản trị tài khoản. Fetch giả lập, chưa deploy Deno/Supabase.');
