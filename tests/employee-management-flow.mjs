import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mockAccess} from './support/access.mjs';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const employee={id:'waiter',name:'Phục vụ thử',staff_code:'NV01',username:'nv01',role:'phuc_vu',is_active:true,staff_version:1,created_at:'2026-10-30T00:00:00Z'};
 const owner={...employee,id:'owner',name:'Owner',staff_code:null,role:'chu'};
 const calls=[],stored=new Map();let mode='lost';
 await context.route('https://uiwzinyckukaqlbznnam.supabase.co/**',async route=>{
  const path=new URL(route.request().url()).pathname;let body;
  if(path==='/auth/v1/token')body={access_token:'mock-owner',refresh_token:'mock-refresh',token_type:'bearer',expires_in:3600,user:{id:'owner',email:'owner@example.test',aud:'authenticated',role:'authenticated'}};
  else if(path==='/auth/v1/user')body={id:'owner',email:'owner@example.test'};
  else if(path.endsWith('/get_my_access'))body=mockAccess({name:'Owner',role:'chu',is_active:true});
  else if(path.endsWith('/list_employees'))body={items:[owner,employee],total:2,page:1,page_size:20};
  else if(path.endsWith('/update_employee_account')){
   const p=route.request().postDataJSON();calls.push(p);
   if(stored.has(p.p_request_id))body=stored.get(p.p_request_id);
   else{
    if(mode==='stale'){employee.staff_version++;mode='ok';return route.fulfill({status:400,json:{code:'P0001',message:'Thông tin nhân viên đã thay đổi. Đóng cửa sổ và tải lại danh sách trước khi sửa.'}});}
    assert.equal(p.p_expected_version,employee.staff_version);
    Object.assign(employee,{name:p.p_name,username:p.p_username,role:p.p_role,is_active:p.p_is_active,staff_version:employee.staff_version+1});body={ok:true,employee_id:employee.id,staff_version:employee.staff_version};stored.set(p.p_request_id,body);
    if(mode==='lost'){mode='ok';return route.fulfill({status:503,json:{message:'response unavailable'}});}
   }
  }else if(['/rest/v1/menu_items','/rest/v1/orders','/rest/v1/table_sessions','/rest/v1/restaurant_tables'].includes(path))body=[];
  else throw new Error('Unexpected '+path);
  await route.fulfill({json:body});
 });
 const page=await context.newPage();page.setDefaultTimeout(10000);
 await page.goto('http://localhost:5173');await page.getByLabel('Tên đăng nhập',{exact:true}).fill('owner@example.test');await page.getByLabel('Mật khẩu',{exact:true}).fill('mock-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
 async function openList(){await page.locator('.management-menu summary').click();await page.getByRole('button',{name:'Quản lý nhân viên',exact:true}).click();await page.getByRole('heading',{name:'Phục vụ thử',exact:true}).waitFor();}
 await openList();assert.equal(await page.getByRole('button',{name:'Sửa nhân viên Owner',exact:true}).count(),0);
 await page.getByRole('button',{name:'Sửa nhân viên Phục vụ thử',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Sửa nhân viên',exact:true});await dialog.waitFor();
 await dialog.getByLabel('Tên nhân viên',{exact:true}).fill('Nhân viên đổi tên');await dialog.getByLabel('Vai trò nhân viên',{exact:true}).selectOption('bep');await dialog.getByLabel('Trạng thái tài khoản',{exact:true}).selectOption('locked');
 await dialog.getByRole('button',{name:'Xác nhận khóa và lưu',exact:true}).click();await dialog.getByRole('alert').waitFor();assert.equal(await dialog.getByLabel('Tên nhân viên',{exact:true}).isDisabled(),true);
 assert.ok(await page.evaluate(()=>localStorage.getItem('pos:employee-update:owner')));
 await page.reload();await page.locator('.management-menu summary').click();await page.getByRole('button',{name:'Quản lý nhân viên',exact:true}).click();
 await dialog.waitFor();await dialog.getByRole('button',{name:'Thử lại cùng yêu cầu',exact:true}).click();await dialog.waitFor({state:'hidden'});
 assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.equal(employee.staff_version,2);
 await page.getByRole('button',{name:'Sửa nhân viên Nhân viên đổi tên',exact:true}).click();await dialog.getByLabel('Trạng thái tài khoản',{exact:true}).selectOption('active');mode='stale';
 await dialog.getByRole('button',{name:'Lưu thay đổi',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'đã thay đổi'}).waitFor();
 assert.equal(await dialog.getByLabel('Tên nhân viên',{exact:true}).isDisabled(),false);
 await dialog.getByRole('button',{name:'Đóng',exact:true}).click();await page.getByRole('button',{name:'Sửa nhân viên Nhân viên đổi tên',exact:true}).click();
 await dialog.getByLabel('Vai trò nhân viên',{exact:true}).selectOption('phuc_vu');await dialog.getByLabel('Trạng thái tài khoản',{exact:true}).selectOption('active');
 await page.screenshot({path:'/workspace/artifacts/employee-edit-mobile.png'});
 await dialog.getByRole('button',{name:'Lưu thay đổi',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(employee.is_active,true);assert.equal(employee.role,'phuc_vu');assert.equal(employee.staff_version,4);
 assert.equal(await page.evaluate(()=>localStorage.getItem('pos:employee-update:owner')),null);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 console.log('ĐẠT UI 028: sửa tên/vai trò/khóa/mở, Owner không có nút sửa, mất phản hồi và reload giữ cùng request, không ghi đè phiên bản cũ, lỗi rõ và dialog mobile. API giả lập.');
}finally{await browser.close();}
