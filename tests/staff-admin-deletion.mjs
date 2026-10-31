import assert from 'node:assert/strict';
import {createStaffAdminHandler} from '../supabase/functions/staff-admin/index.ts';
const employee='00000000-0000-0000-0000-000000000002',request='90000000-0000-0000-0000-000000000001',owner='00000000-0000-0000-0000-000000000001';
function fixture(mode='ok',role='chu'){
 let softDeleted=false,completed=false,adminCalls=0;const calls=[];
 const handler=createStaffAdminHandler({supabaseUrl:'https://example.test',publicKey:'public',serviceKey:'server-secret',fetcher:async(url,init)=>{
  calls.push(url);
  if(url.endsWith('/auth/v1/user'))return Response.json({id:owner});
  if(url.endsWith('/get_my_access'))return Response.json({role,is_active:true,permissions:role==='chu'?['employees.manage']:[]});
  if(url.endsWith('/get_employee_deletion'))return Response.json({request_id:request,employee_id:employee,expected_version:3,completed});
  if(url.endsWith('/begin_employee_deletion'))return Response.json({completed});
  if(url.endsWith('/finish_employee_deletion')){assert.equal(JSON.parse(init.body).p_owner_id,owner);if(softDeleted)completed=true;return Response.json(completed?{ok:true,completed:true}:{pending:true});}
  if(url.includes('/auth/v1/admin/users/')){adminCalls++;assert.equal(init.method,'DELETE');assert.deepEqual(JSON.parse(init.body),{should_soft_delete:true});assert.equal(init.headers.Authorization,'Bearer server-secret');if(mode==='rejected')return Response.json({msg:'private'},{status:422});softDeleted=true;if(mode==='lost')throw Error('lost');return Response.json({});}
  throw Error('Unexpected');
 }});
 async function send(action='delete_employee',confirmed=true){const r=await handler(new Request('https://edge.test',{method:'POST',headers:{Authorization:'Bearer caller','Content-Type':'application/json'},body:JSON.stringify({action,employee_id:employee,request_id:request,expected_version:3,confirmed,owner_id:'fake'})}));const text=await r.text();assert.ok(!text.includes('server-secret'));return {status:r.status,...JSON.parse(text)};}
 return {send,calls,count:()=>adminCalls};
}
for(const role of ['phuc_vu','bep']){const f=fixture('ok',role);assert.equal((await f.send()).status,403);assert.equal(f.count(),0);}
const f=fixture();assert.equal((await f.send('delete_employee',false)).status,400);assert.equal((await f.send()).completed,true);assert.equal((await f.send()).completed,true);assert.equal(f.count(),1);
const lost=fixture('lost');assert.equal((await lost.send()).pending,true);assert.equal((await lost.send('check_employee_deletion')).deletion.completed,true);assert.equal(lost.count(),1);
const rejected=fixture('rejected');assert.equal((await rejected.send()).pending,true);
console.log('ĐẠT Edge xóa: Owner, phải xác nhận, chỉ soft-delete, không tin actor frontend, mất phản hồi kiểm tra phục hồi không DELETE lần hai, Auth lỗi giữ pending. Fetch giả lập.');
