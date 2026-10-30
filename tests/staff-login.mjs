import assert from 'node:assert/strict';
import {createStaffLoginHandler} from '../supabase/functions/staff-login/index.ts';
const secret='mock-server-secret',password='mock-private-password',email='internal@example.test';
function fixture({resolved={allowed:true,email},authStatus=200,lookupStatus=200,fail=false}={}){
 const calls=[];
 const handler=createStaffLoginHandler({supabaseUrl:'https://example.test',publicKey:'mock-public',serviceKey:secret,fetcher:async(url,init)=>{
  calls.push({url,...init});if(fail)throw Error(secret);
  if(url.includes('resolve_staff_login')){assert.equal(init.headers.Authorization,'Bearer '+secret);assert.ok(!init.body.includes(password));return Response.json(resolved,{status:lookupStatus});}
  assert.ok(url.includes('/auth/v1/token?grant_type=password'));assert.ok(!JSON.stringify(init.headers).includes(secret));assert.equal(JSON.parse(init.body).password,password);
  return Response.json(authStatus===200?{access_token:'mock-access',refresh_token:'mock-refresh',user:{email}}:{msg:'internal '+secret},{status:authStatus});
 }});
 async function send(username=' owner ',pw=password){const response=await handler(new Request('https://edge.test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:pw})}));const text=await response.text();assert.ok(!text.includes(secret));assert.ok(!text.includes(email));assert.ok(!text.includes(password));return {status:response.status,...JSON.parse(text)};}
 return {handler,send,calls};
}
assert.equal((await fixture().send()).access_token,'mock-access');
assert.equal((await fixture({authStatus:400}).send()).status,401);
const unknown=fixture({resolved:{allowed:true,email:null},authStatus:400});assert.equal((await unknown.send('missing')).status,401);assert.equal(unknown.calls.length,2);
const rate=fixture({resolved:{allowed:false}});assert.equal((await rate.send()).status,429);assert.equal(rate.calls.length,1);
assert.equal((await fixture({lookupStatus:503}).send()).status,503);assert.equal((await fixture({fail:true}).send()).status,503);
assert.equal((await fixture().send('','')).status,400);
const pre=fixture();assert.equal((await pre.handler(new Request('https://edge.test',{method:'OPTIONS'}))).status,200);assert.equal(pre.calls.length,0);
console.log('ĐẠT login Edge: Auth xác thực mật khẩu, resolver server-only, không lộ email/key/password, lỗi chung cho tên không tồn tại/sai mật khẩu, chặn rate limit. Fetch giả lập.');
