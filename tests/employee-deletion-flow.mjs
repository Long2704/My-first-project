import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mockAccess} from './support/access.mjs';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:390,height:844}}),calls=[];
 const employee={id:'00000000-0000-0000-0000-000000000002',name:'Nhân viên',username:'bep01',role:'bep',is_active:true,staff_version:3,created_at:'2026-10-30T00:00:00Z'};
 const owner={...employee,id:'owner',name:'Owner',role:'chu',username:'owner'};let deletion=null,deleted=false;
 await context.route('https://uiwzinyckukaqlbznnam.supabase.co/**',async route=>{
  const path=new URL(route.request().url()).pathname;let body;
  if(path==='/auth/v1/token')body={access_token:'mock-owner',refresh_token:'mock-refresh',token_type:'bearer',expires_in:3600,user:{id:'owner',email:'owner@example.test',aud:'authenticated',role:'authenticated'}};
  else if(path==='/auth/v1/user')body={id:'owner',email:'owner@example.test'};
  else if(path.endsWith('/get_my_access'))body=mockAccess({name:'Owner',role:'chu',is_active:true});
  else if(path.endsWith('/list_employees'))body={items:deleted?[owner]:[owner,employee],total:deleted?1:2,page:1,page_size:20};
  else if(path==='/functions/v1/staff-admin'){
   const input=route.request().postDataJSON();calls.push(input);
   if(input.action==='check_employee_deletion')body={ok:true,deletion};
   else{
    assert.equal(input.action,'delete_employee');assert.equal(input.confirmed,true);deleted=true;deletion={request_id:input.request_id,employee_id:employee.id,expected_version:3,completed:true};
    return route.fulfill({status:503,json:{error:'Chưa xác nhận kết quả xóa.',pending:true}});
   }
  }else if(['/rest/v1/menu_items','/rest/v1/orders','/rest/v1/table_sessions','/rest/v1/restaurant_tables'].includes(path))body=[];
  else throw Error('Unexpected '+path);
  await route.fulfill({json:body});
 });
 const page=await context.newPage();page.setDefaultTimeout(10000);await page.goto('http://localhost:5173');await page.getByLabel('Tên đăng nhập',{exact:true}).fill('owner@example.test');await page.getByLabel('Mật khẩu',{exact:true}).fill('old-long-password-is-still-valid');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
 async function openList(){await page.locator('.management-menu summary').click();await page.getByRole('button',{name:'Quản lý nhân viên',exact:true}).click();await page.getByRole('heading',{name:'Bún Riêu Góc Phố',exact:true}).waitFor();}
 await openList();assert.equal(await page.getByRole('button',{name:'Xóa tài khoản Owner',exact:true}).count(),0);
 await page.getByRole('button',{name:'Xóa tài khoản Nhân viên',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Xóa tài khoản nhân viên',exact:true});await dialog.waitFor();await dialog.getByText('Đơn hàng, thanh toán và nhật ký cũ vẫn được giữ để đối chiếu.',{exact:true}).waitFor();assert.equal(calls.filter(c=>c.action==='delete_employee').length,0);
 await dialog.getByRole('button',{name:'Xác nhận xóa tài khoản',exact:true}).click();await dialog.getByText('Chưa xác nhận kết quả xóa.',{exact:true}).waitFor();await page.reload();await openList();await dialog.waitFor({state:'hidden'});
 await page.getByText(/Đã xóa quyền đăng nhập/).waitFor();assert.equal(calls.filter(c=>c.action==='delete_employee').length,1);assert.equal(await page.getByRole('button',{name:'Xóa tài khoản Nhân viên',exact:true}).count(),0);assert.equal(await page.evaluate(()=>localStorage.getItem('pos:employee-delete:owner')),null);
 // Mật khẩu mới 6–12, tài khoản cũ dài hơn vẫn đã đăng nhập thành công ở trên.
 await page.getByRole('button',{name:'Thêm nhân viên',exact:true}).click();const password=page.locator('.employee-create').getByLabel('Mật khẩu tạm',{exact:true});assert.equal(await password.getAttribute('minlength'),'6');assert.equal(await password.getAttribute('maxlength'),'12');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 console.log('ĐẠT UI xóa: xác nhận trước gửi, Owner không có nút, mất phản hồi/reload kiểm tra không xóa hai lần, nhân viên biến mất, mật khẩu mới 6–12 và mật khẩu đăng nhập cũ dài vẫn dùng được. API giả lập.');
}finally{await browser.close();}
