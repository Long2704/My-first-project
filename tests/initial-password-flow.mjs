import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mockAccess} from './support/access.mjs';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 for(const mode of ['success','uncertain','rejected']){
  const context=await browser.newContext({viewport:{width:390,height:844}});
  let pending=true,updates=0,reads=0;
  const user={id:'waiter',email:'waiter@example.test',aud:'authenticated',role:'authenticated'};
  await context.route('https://uiwzinyckukaqlbznnam.supabase.co/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname;let body;
   if(path==='/auth/v1/token')body={access_token:'mock-access',refresh_token:'mock-refresh',token_type:'bearer',expires_in:3600,user};
   else if(path==='/auth/v1/user'){
    if(req.method()==='PUT'){
     updates++;
     if(mode==='rejected'&&updates===1)return route.fulfill({status:422,json:{msg:'Password rejected',code:'weak_password'}});
     pending=false;
     if(mode==='uncertain')return route.fulfill({status:503,json:{msg:'response unavailable'}});
    }
    body=user;
   }else if(path==='/rest/v1/rpc/get_my_access')body={...mockAccess({name:'Phục vụ thử nghiệm',role:'phuc_vu',is_active:true}),must_change_password:pending,...(pending?{permissions:[]}:{})};
   else if(['/rest/v1/menu_items','/rest/v1/orders','/rest/v1/table_sessions','/rest/v1/restaurant_tables'].includes(path)){
    reads++;assert.equal(pending,false,'Không đọc dữ liệu POS trước khi đổi mật khẩu');body=path.endsWith('restaurant_tables')?[{id:1,name:'Bàn thử 1'}]:[];
   }else throw new Error('Unexpected endpoint '+path);
   await route.fulfill({status:200,json:body});
  });
  const page=await context.newPage();page.setDefaultTimeout(10000);
  await page.goto('http://localhost:5173');
  await page.getByLabel('Email',{exact:true}).fill(user.email);await page.getByLabel('Mật khẩu',{exact:true}).fill('temporary-test-only');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
  await page.getByRole('heading',{name:'Đặt mật khẩu riêng'}).waitFor();assert.equal(reads,0);assert.equal(await page.getByRole('button',{name:'Phục vụ',exact:true}).count(),0);
  await page.reload();await page.getByRole('heading',{name:'Đặt mật khẩu riêng'}).waitFor();
  await page.getByLabel('Mật khẩu mới',{exact:true}).fill('new-private-test-123');await page.getByLabel('Nhập lại mật khẩu',{exact:true}).fill('not-matching');assert.equal(await page.getByRole('button',{name:'Lưu mật khẩu mới'}).isDisabled(),true);
  await page.getByLabel('Nhập lại mật khẩu',{exact:true}).fill('new-private-test-123');
  if(mode==='success')await page.screenshot({path:'/workspace/artifacts/initial-password-mobile.png'});
  await page.getByRole('button',{name:'Lưu mật khẩu mới'}).click();
  if(mode==='rejected'){
   await page.getByRole('alert').filter({hasText:'Mật khẩu chưa được chấp nhận'}).waitFor();assert.equal(pending,true);assert.equal(reads,0);
   await page.getByLabel('Mật khẩu mới',{exact:true}).fill('another-private-test-123');await page.getByLabel('Nhập lại mật khẩu',{exact:true}).fill('another-private-test-123');await page.getByRole('button',{name:'Lưu mật khẩu mới'}).click();
  }
  if(mode==='uncertain'){await page.getByRole('button',{name:'Kiểm tra lại',exact:true}).click();}
  await page.getByRole('button',{name:/^Bàn thử 1 /}).waitFor();assert.equal(updates,mode==='rejected'?2:1);
  const stored=await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}));assert.ok(!stored.includes('new-private-test-123'));assert.ok(!stored.includes('temporary-test-only'));
  await context.close();
 }
 console.log('ĐẠT UI: chặn POS trước đổi mật khẩu, tải lại vẫn chặn, xác nhận khớp, Auth từ chối/thành công, mất phản hồi kiểm tra lại không đổi lần hai; không lưu mật khẩu trong storage. API giả lập.');
}finally{await browser.close();}
