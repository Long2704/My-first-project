import assert from 'node:assert/strict';
import {createStaffAdminHandler} from '../supabase/functions/staff-admin/index.ts';
const base='https://example.supabase.co',secret='mock-server-secret',publicKey='mock-public';
const draft={action:'create_employee',request_id:'90000000-0000-0000-0000-000000000001',name:'Nhân viên',staff_code:'NV01',email:'new@example.test',role:'phuc_vu',password:'temporary-only-123'};
function fixture(mode='ok',role='chu'){
 let completed=false,adminCalls=0;const bodies=[];
 const handler=createStaffAdminHandler({supabaseUrl:base,publicKey,serviceKey:secret,fetcher:async(url,init)=>{
  if(url.endsWith('/auth/v1/admin/users')){
   adminCalls++;assert.equal(init.headers.Authorization,`Bearer ${secret}`);
   const body=JSON.parse(init.body);bodies.push(body);assert.deepEqual(Object.keys(body).sort(),['app_metadata','email','email_confirm','password']);
   assert.equal(body.app_metadata.pos_employee_request,draft.request_id);assert.equal(body.email_confirm,true);
   if(mode==='lost'){completed=true;throw new Error('lost '+secret);}
   if(mode==='rejected')return Response.json({msg:'internal secret '+secret},{status:422});
   completed=true;return Response.json({id:'new-user'});
  }
  assert.equal(init.headers.Authorization,'Bearer mock-user');assert.equal(init.headers.apikey,publicKey);
  if(url.endsWith('/auth/v1/user'))return Response.json({id:'owner'});
  if(url.endsWith('/get_my_access'))return Response.json({role,is_active:mode!=='locked',permissions:role==='chu'?['employees.manage']:[]});
  if(url.endsWith('/prepare_employee_creation')||url.endsWith('/prepare_employee_account'))return mode==='collision'?Response.json({code:'23505'},{status:409}):Response.json({completed,user_id:completed?'new-user':null});
  if(url.endsWith('/cancel_employee_creation'))return Response.json({released:true});
  throw new Error('unexpected URL');
 }});
 async function send(body=draft){const response=await handler(new Request('https://edge.test',{method:'POST',headers:{Authorization:'Bearer mock-user','Content-Type':'application/json'},body:JSON.stringify(body)}));const text=await response.text();assert.ok(!text.includes(secret));assert.ok(!text.includes(draft.password));return {status:response.status,...JSON.parse(text)};}
 return {send,count:()=>adminCalls,bodies};
}
for(const role of ['phuc_vu','bep','thu_ngan']){const f=fixture('ok',role);assert.equal((await f.send()).status,403);assert.equal(f.count(),0);}
assert.equal((await fixture('locked').send()).status,403);
const collision=fixture('collision');assert.equal((await collision.send()).released,true);assert.equal(collision.count(),0);
const valid=fixture();assert.equal((await valid.send()).ok,true);assert.equal((await valid.send()).ok,true);assert.equal(valid.count(),1);
const lost=fixture('lost');assert.equal((await lost.send()).pending,true);assert.equal((await lost.send({...draft,action:'check_creation',password:undefined})).ok,true);assert.equal(lost.count(),1);
const rejected=fixture('rejected');const fail=await rejected.send();assert.equal(fail.status,409);assert.equal(fail.released,true);
for(const role of ['chu','thu_ngan','owner'])assert.equal((await fixture().send({...draft,role})).status,400);
assert.equal((await fixture().send({...draft,password:'short'})).status,400);
const check=fixture();assert.equal((await check.send({...draft,action:'check_creation',password:undefined})).pending,true);assert.equal(check.count(),0);
assert.equal((await check.send({...draft,action:'cancel_creation',password:undefined})).released,true);
const usernameFixture=fixture();const usernameInput={...draft,username:'bep01',role:'bep'};delete usernameInput.email;delete usernameInput.staff_code;assert.equal((await usernameFixture.send(usernameInput)).ok,true);assert.equal(usernameFixture.bodies[0].email,draft.request_id+'@staff.pos.invalid');
console.log('ĐẠT Edge tạo nhân viên: Owner, chặn Kitchen/Waiter/khóa/nâng quyền, retry không tạo trùng, mất phản hồi phục hồi, không reset email cũ, không lộ mật khẩu/key. Fetch giả lập.');
