import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mockAccess} from './support/access.mjs';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:390,height:844}}),calls=[];
 const employee={id:'00000000-0000-0000-0000-000000000002',name:'Nhân viên',username:'bep01',role:'bep',is_active:true,staff_version:3,created_at:'2026-10-30T00:00:00Z'};
 const owner={...employee,id:'owner',name:'Owner',role:'chu',username:'owner'};
 let reset=null,mode='lostCompleted';
 await context.route('https://uiwzinyckukaqlbznnam.supabase.co/**',async route=>{
  const path=new URL(route.request().url()).pathname;let body;
  if(path==='/auth/v1/token')body={access_token:'mock-owner',refresh_token:'mock-refresh',token_type:'bearer',expires_in:3600,user:{id:'owner',email:'owner@example.test',aud:'authenticated',role:'authenticated'}};
  else if(path==='/auth/v1/user')body={id:'owner',email:'owner@example.test'};
  else if(path.endsWith('/get_my_access'))body=mockAccess({name:'Owner',role:'chu',is_active:true});
  else if(path.endsWith('/list_employees'))body={items:[owner,employee],total:2,page:1,page_size:20};
  else if(path==='/functions/v1/staff-admin'){
   const input=route.request().postDataJSON();calls.push(input);
   if(input.action==='check_password_reset')body={ok:true,reset:input.request_id?reset:reset?.completed?null:reset};
   else{
    assert.equal(input.action,'reset_password');assert.ok(input.password.length>=6&&input.password.length<=12);
    if(reset&&!reset.completed)assert.equal(input.request_id,reset.request_id);
    reset={request_id:input.request_id,employee_id:employee.id,expected_version:input.expected_version,completed:mode!=='pending'};
    employee.password_reset_pending=!reset.completed;employee.is_active=reset.completed;employee.staff_version++;
    if(mode==='lostCompleted'||mode==='pending')return route.fulfill({status:503,json:{error:'Chưa xác nhận được kết quả.',pending:true}});
    body={ok:true,completed:true};
   }
  }else if(['/rest/v1/menu_items','/rest/v1/orders','/rest/v1/table_sessions','/rest/v1/restaurant_tables'].includes(path))body=[];
  else throw Error('Unexpected '+path);
  await route.fulfill({json:body});
 });
 const page=await context.newPage();page.setDefaultTimeout(10000);await page.goto('http://localhost:5173');await page.getByLabel('Tên đăng nhập',{exact:true}).fill('owner@example.test');await page.getByLabel('Mật khẩu',{exact:true}).fill('mock-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
 async function openList(){await page.locator('.management-menu summary').click();await page.getByRole('button',{name:'Quản lý nhân viên',exact:true}).click();await page.getByRole('heading',{name:'Nhân viên',exact:true}).waitFor();}
 await openList();assert.equal(await page.getByRole('button',{name:'Đặt lại mật khẩu Owner',exact:true}).count(),0);
 await page.getByRole('button',{name:'Đặt lại mật khẩu Nhân viên',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Đặt lại mật khẩu nhân viên',exact:true});await dialog.waitFor();
 await dialog.getByLabel('Mật khẩu tạm mới',{exact:true}).fill('First123!');await dialog.getByRole('button',{name:'Xác nhận đặt lại',exact:true}).click();await dialog.getByText('Chưa xác nhận được kết quả.',{exact:true}).waitFor();
 assert.equal(await dialog.getByLabel('Mật khẩu tạm mới',{exact:true}).inputValue(),'');
 assert.ok(!(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).includes('First123!'));
 await page.reload();await openList();await dialog.waitFor({state:'hidden'});await page.getByText(/Đã đặt lại mật khẩu\. Cấp mật khẩu tạm/).waitFor();assert.equal(calls.filter(c=>c.action==='reset_password').length,1);
 mode='pending';await page.getByRole('button',{name:'Đặt lại mật khẩu Nhân viên',exact:true}).click();await dialog.getByLabel('Mật khẩu tạm mới',{exact:true}).fill('Second123!');await dialog.getByRole('button',{name:'Xác nhận đặt lại',exact:true}).click();await dialog.getByText('Chưa xác nhận được kết quả.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Sửa nhân viên Nhân viên',exact:true}).isDisabled(),true);
 await dialog.getByRole('button',{name:'Kiểm tra lại',exact:true}).click();await dialog.getByText(/Yêu cầu chưa hoàn tất/).waitFor();
 mode='ok';await dialog.getByLabel('Mật khẩu tạm mới',{exact:true}).fill('Other456!');await page.screenshot({path:'/workspace/artifacts/password-reset-mobile.png'});await dialog.getByRole('button',{name:'Tiếp tục đặt lại',exact:true}).click();await dialog.waitFor({state:'hidden'});
 const updates=calls.filter(c=>c.action==='reset_password');assert.equal(updates[1].request_id,updates[2].request_id);assert.notEqual(updates[1].password,updates[2].password);
 assert.equal(await page.evaluate(()=>localStorage.getItem('pos:password-reset:owner')),null);
 console.log('ĐẠT UI reset: Owner bảo vệ, xác nhận, không lưu mật khẩu, mất phản hồi/tải lại kiểm tra hoàn tất không reset hai lần, pending khóa sửa, nhập mật khẩu khác tiếp tục cùng yêu cầu. API giả lập.');
}finally{await browser.close();}
