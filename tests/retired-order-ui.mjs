import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mockAccess} from './support/access.mjs';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const c=await browser.newContext(),user='retired-test',request='00000000-0000-4000-8000-000000000099',food={id:'food',name:'Bún riêu',price:58000,category:'bun',is_out:false};let calls=0;
 await c.addInitScript(({user,request})=>localStorage.setItem(`goc-pho-pending-v1:${user}`,JSON.stringify({requestId:request,tableId:1,items:[{menu_item_id:'food',qty:1,note:'',expected_price:58000}]})),{user,request});
 await c.route('https://uiwzinyckukaqlbznnam.supabase.co/**',async r=>{const p=new URL(r.request().url()).pathname;let body;
  if(p==='/auth/v1/token')body={access_token:'fake',refresh_token:'fake-refresh',expires_in:3600,token_type:'bearer',user:{id:user,email:'retired@example.test',aud:'authenticated',role:'authenticated'}};
  else if(p==='/auth/v1/user')body={id:user,email:'retired@example.test'};
  else if(p.endsWith('/get_my_access'))body=mockAccess({name:'Waiter',role:'phuc_vu'});
  else if(p==='/rest/v1/menu_items')body=[food];
  else if(p==='/rest/v1/restaurant_tables')body=[{id:1,name:'Bàn 1'}];
  else if(p==='/rest/v1/table_sessions'||p==='/rest/v1/orders')body=[];
  else if(p.endsWith('/submit_order')){calls++;assert.equal(r.request().postDataJSON().p_request_id,request);return r.fulfill({status:400,json:{code:'P0001',message:'Mã đơn đã hết thời gian lưu. Không gửi lại đơn cũ.'}});}
  else throw Error('Unexpected '+p);
  await r.fulfill({json:body});
 });
 const p=await c.newPage();p.setDefaultTimeout(10000);await p.goto(process.env.POS_TEST_URL||'http://127.0.0.1:5182');await p.getByLabel('Tên đăng nhập',{exact:true}).fill('retired@example.test');await p.getByLabel('Mật khẩu',{exact:true}).fill('fake-password');await p.getByRole('button',{name:'Đăng nhập',exact:true}).click();await p.getByRole('button',{name:'Thử gửi lại đơn này',exact:true}).click();await p.getByRole('alert').filter({hasText:'Đơn cũ đã được dọn'}).waitFor();
 assert.equal(await p.evaluate(user=>localStorage.getItem(`goc-pho-pending-v1:${user}`),user),null);assert.equal(calls,1);assert.equal(await p.getByRole('button',{name:'Thử gửi lại đơn này',exact:true}).count(),0);
 await p.waitForTimeout(6000);assert.equal(calls,1);console.log('PASS retired order UI: old pending request rejected, only matching stale draft/request cleared, no automatic resubmission or new UUID. Mock API only.');
}finally{await browser.close();}
