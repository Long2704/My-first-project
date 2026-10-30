import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mockAccess} from './support/access.mjs';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:390,height:844}}),calls=[];
 const user={id:'owner',email:'hidden@example.test',aud:'authenticated',role:'authenticated'};
 const token=[{alg:'HS256',typ:'JWT'},{sub:'owner',exp:Math.floor(Date.now()/1000)+3600},'mock'].map(v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url')).join('.');
 let mode='wrong';
 await context.route('https://uiwzinyckukaqlbznnam.supabase.co/**',async route=>{
  const path=new URL(route.request().url()).pathname;let body;
  if(path==='/functions/v1/staff-login'){
   const input=route.request().postDataJSON();calls.push(input);assert.equal(input.username,'owner');assert.ok(!('email' in input));
   if(mode==='wrong')return route.fulfill({status:401,json:{error:'Đăng nhập thất bại. Kiểm tra tên đăng nhập và mật khẩu.'}});
   if(mode==='limited')return route.fulfill({status:429,json:{error:'Đã thử đăng nhập nhiều lần. Vui lòng đợi một phút rồi thử lại.'}});
   body={access_token:token,refresh_token:'mock-refresh'};
  }else if(path==='/auth/v1/user')body=user;
  else if(path.endsWith('/get_my_access'))body=mockAccess({name:'Owner',role:'chu',is_active:true});
  else if(path.endsWith('/list_employees'))body={items:[{id:'owner',name:'Owner',role:'chu',is_active:true,username:'owner',staff_version:3,created_at:'2026-10-30T00:00:00Z'}],total:1,page:1,page_size:20};
  else if(['/rest/v1/menu_items','/rest/v1/orders','/rest/v1/table_sessions','/rest/v1/restaurant_tables'].includes(path))body=[];
  else throw Error('Unexpected '+path);
  await route.fulfill({json:body});
 });
 const page=await context.newPage();page.setDefaultTimeout(10000);await page.goto('http://localhost:5173');
 assert.equal(await page.getByLabel('Email',{exact:true}).count(),0);await page.getByLabel('Tên đăng nhập',{exact:true}).fill('Owner');await page.getByLabel('Mật khẩu',{exact:true}).fill('private-test-password');
 await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.getByRole('alert').filter({hasText:'Kiểm tra tên đăng nhập'}).waitFor();
 mode='limited';await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.getByRole('alert').filter({hasText:'đợi một phút'}).waitFor();
 mode='ok';await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.getByRole('button',{name:'Phục vụ',exact:true}).waitFor();
 await page.locator('.management-menu summary').click();await page.getByRole('button',{name:'Quản lý nhân viên',exact:true}).click();await page.getByText('Đăng nhập: owner',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Thêm nhân viên',exact:true}).click();const create=page.locator('.employee-create');
 assert.equal(await create.getByLabel('Mã nhân viên',{exact:true}).count(),0);assert.equal(await create.getByLabel('Email đăng nhập',{exact:true}).count(),0);assert.equal(await create.getByLabel('Tên đăng nhập',{exact:true}).count(),1);
 assert.equal(await page.getByText('hidden@example.test',{exact:true}).count(),0);
 const storage=await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}));assert.ok(!storage.includes('private-test-password'));assert.equal(calls.length,3);
 await page.screenshot({path:'/workspace/artifacts/username-mobile.png'});
 console.log('ĐẠT UI username: đăng nhập owner, thông báo sai mật khẩu/rate limit, lưu phiên chuẩn Auth, không còn email/mã trên form, danh sách hiện username, không lưu mật khẩu. API giả lập.');
}finally{await browser.close();}
