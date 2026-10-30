import assert from 'node:assert/strict';
import {createStaffAdminHandler} from '../supabase/functions/staff-admin/index.ts';
const owner='00000000-0000-0000-0000-000000000001',employee='00000000-0000-0000-0000-000000000002',request='90000000-0000-0000-0000-000000000001',secret='mock-server-secret';
const input={action:'reset_password',employee_id:employee,request_id:request,expected_version:3,password:'new-temporary-123'};
function fixture(mode='ok',role='chu'){
 let completed=false,admin=0,finish=0;const calls=[];
 const handler=createStaffAdminHandler({supabaseUrl:'https://example.test',publicKey:'mock-public',serviceKey:secret,fetcher:async(url,init)=>{
  calls.push(url);
  if(url.endsWith('/auth/v1/user'))return Response.json({id:owner});
  if(url.endsWith('/get_my_access'))return Response.json({role,is_active:true,permissions:role==='chu'?['employees.manage']:[]});
  if(url.endsWith('/get_employee_password_reset'))return Response.json({request_id:request,employee_id:employee,expected_version:3,completed});
  if(url.endsWith('/begin_employee_password_reset'))return Response.json({request_id:request,employee_id:employee,expected_version:3,completed,...(mode==='conflict'?{conflict:true}:{})});
  if(url.endsWith('/register_employee_password_attempt'))return Response.json({attempt_id:'80000000-0000-0000-0000-000000000001',completed});
  if(url.includes('/auth/v1/admin/users/')){
   if(init.method==='GET')return Response.json({id:employee,app_metadata:{provider:'email',pos_employee_request:'old-request'}});
   admin++;assert.ok(url.endsWith(employee));assert.equal(init.headers.Authorization,'Bearer '+secret);assert.deepEqual(Object.keys(JSON.parse(init.body)),['password','app_metadata']);assert.equal(JSON.parse(init.body).app_metadata.provider,'email');assert.equal(JSON.parse(init.body).app_metadata.pos_staff_reset_attempt,'80000000-0000-0000-0000-000000000001');
   if(mode==='adminlost'){mode='ok';throw Error('lost '+secret);}
   if(mode==='rejected')return Response.json({error:secret},{status:422});
   return Response.json({id:employee});
  }
  if(url.endsWith('/finish_employee_password_reset')){
   finish++;assert.equal(init.headers.apikey,secret);assert.equal(JSON.parse(init.body).p_owner_id,owner);completed=true;
   if(mode==='finishlost')return Response.json({error:'lost'},{status:503});
   return Response.json({ok:true,completed:true});
  }
  throw Error('Unexpected');
 }});
 async function send(body=input){const response=await handler(new Request('https://edge.test',{method:'POST',headers:{Authorization:'Bearer caller','Content-Type':'application/json'},body:JSON.stringify(body)}));const text=await response.text();assert.ok(!text.includes(secret));assert.ok(!text.includes(input.password));return {status:response.status,...JSON.parse(text)};}
 return {send,calls,counts:()=>({admin,finish})};
}
for(const role of ['phuc_vu','bep']){const f=fixture('ok',role);assert.equal((await f.send()).status,403);assert.deepEqual(f.counts(),{admin:0,finish:0});}
const good=fixture();assert.equal((await good.send({...input,owner_id:'fake'})).completed,true);assert.equal((await good.send()).completed,true);assert.deepEqual(good.counts(),{admin:1,finish:1});
const lost=fixture('adminlost');assert.equal((await lost.send()).pending,true);assert.deepEqual(lost.counts(),{admin:1,finish:0});assert.equal((await lost.send({...input,password:'a-different-temp-123'})).completed,true);
const responseLost=fixture('finishlost');assert.equal((await responseLost.send()).pending,true);assert.equal((await responseLost.send({...input,action:'check_password_reset'})).reset.completed,true);assert.equal(responseLost.counts().admin,1);
const conflict=fixture('conflict');assert.equal((await conflict.send()).status,409);assert.equal(conflict.counts().admin,0);
const rejected=fixture('rejected');assert.equal((await rejected.send()).pending,true);assert.equal(rejected.counts().finish,0);
const short=fixture();assert.equal((await short.send({...input,password:'short'})).status,400);assert.equal(short.calls.length,2);
console.log('ĐẠT reset Edge: Owner, chặn Waiter/Kitchen, backend-only xác nhận, không tin owner_id frontend, retry sau mất phản hồi, không mở tài khoản khi Auth lỗi, không reset lại khi đã hoàn tất; không lộ mật khẩu/key. Fetch giả lập.');
