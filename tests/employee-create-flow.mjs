import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mockAccess} from './support/access.mjs';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:390,height:844}});
 let completed=false,mode='lost',calls=[];
 await context.route('https://uiwzinyckukaqlbznnam.supabase.co/**',async route=>{
  const path=new URL(route.request().url()).pathname;let body;
  if(path==='/auth/v1/token')body={access_token:'mock-owner',refresh_token:'mock-refresh',token_type:'bearer',expires_in:3600,user:{id:'owner',email:'owner@example.test',aud:'authenticated',role:'authenticated'}};
  else if(path==='/auth/v1/user')body={id:'owner',email:'owner@example.test'};
  else if(path.endsWith('/get_my_access'))body=mockAccess({name:'Owner thử nghiệm',role:'chu',is_active:true});
  else if(path.endsWith('/list_employees'))body={items:[],total:0,page:1,page_size:20};
  else if(path==='/functions/v1/staff-admin'){
   const input=route.request().postDataJSON();calls.push(input);
   if(input.action==='create_employee'){
    assert.ok(['phuc_vu','bep'].includes(input.role));assert.ok(input.password.length>=12);
    if(mode==='reject')return route.fulfill({status:409,json:{error:'Email đã tồn tại.',released:true}});
    completed=true;
    return route.fulfill({status:503,json:{error:'Chưa xác nhận kết quả.',pending:true}});
   }
   assert.equal(input.action,'check_creation');assert.ok(!('password' in input));assert.equal(completed,true);body={ok:true,user_id:'new-kitchen'};
  }else if(['/rest/v1/menu_items','/rest/v1/orders','/rest/v1/table_sessions','/rest/v1/restaurant_tables'].includes(path))body=[];
  else throw new Error('Unexpected '+path);
  await route.fulfill({json:body});
 });
 const page=await context.newPage();page.setDefaultTimeout(10000);
 await page.goto('http://localhost:5173');await page.getByLabel('Email',{exact:true}).fill('owner@example.test');await page.getByLabel('Mật khẩu',{exact:true}).fill('mock-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
 async function employees(){await page.locator('.management-menu summary').click();await page.getByRole('button',{name:'Quản lý nhân viên',exact:true}).click();await page.getByRole('heading',{name:'Quản lý nhân viên',exact:true}).waitFor();}
 await employees();await page.getByRole('button',{name:'Thêm nhân viên',exact:true}).click();
 await page.getByLabel('Tên nhân viên',{exact:true}).fill('Bếp mới');await page.getByLabel('Mã nhân viên',{exact:true}).fill('nv-k02');await page.getByLabel('Email đăng nhập',{exact:true}).fill('kitchen@example.test');await page.getByLabel('Vai trò nhân viên',{exact:true}).selectOption('bep');
 assert.equal(await page.getByLabel('Vai trò nhân viên').locator('option').count(),2);
 await page.getByLabel('Mật khẩu tạm',{exact:true}).fill('temporary-test-123');await page.getByRole('button',{name:'Tạo tài khoản',exact:true}).click();
 await page.getByText('Chưa xác nhận kết quả.',{exact:true}).waitFor();assert.equal(await page.getByLabel('Mật khẩu tạm',{exact:true}).inputValue(),'');
 const storage=await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}));assert.ok(!storage.includes('temporary-test-123'));
 assert.equal(await page.getByLabel('Tên nhân viên',{exact:true}).isDisabled(),true);
 await page.reload();await employees();await page.getByRole('button',{name:'Kiểm tra lại',exact:true}).click();await page.getByText(/Đã tạo nhân viên\. Cấp email/).waitFor();
 assert.equal(calls.length,2);assert.equal(calls[0].role,'bep');assert.equal(calls[0].request_id,calls[1].request_id);assert.equal(calls[0].staff_code,'NV-K02');
 assert.equal(await page.evaluate(()=>localStorage.getItem('pos:employee-create:owner')),null);
 mode='reject';await page.getByRole('button',{name:'Thêm nhân viên',exact:true}).click();await page.getByLabel('Tên nhân viên',{exact:true}).fill('Bếp khác');await page.getByLabel('Mã nhân viên',{exact:true}).fill('NV03');await page.getByLabel('Email đăng nhập',{exact:true}).fill('exists@example.test');await page.getByLabel('Mật khẩu tạm',{exact:true}).fill('temporary-test-456');await page.getByRole('button',{name:'Tạo tài khoản',exact:true}).click();await page.getByText('Email đã tồn tại.',{exact:true}).waitFor();assert.equal(await page.getByLabel('Tên nhân viên',{exact:true}).isDisabled(),false);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:'/workspace/artifacts/employee-create-mobile.png'});
 console.log('ĐẠT UI: Owner tạo Kitchen, chỉ hai vai trò, mất phản hồi/tải lại khôi phục cùng mã không lưu mật khẩu; kiểm tra lại không gửi mật khẩu; lỗi email mở lại form, mobile không tràn. API giả lập.');
}finally{await browser.close();}
