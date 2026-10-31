import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mockAccess} from './support/access.mjs';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const user={id:'owner',email:'owner@example.test',aud:'authenticated',role:'authenticated'};
const token=[{alg:'HS256',typ:'JWT'},{sub:'owner',exp:Math.floor(Date.now()/1000)+3600},'mock'].map(value=>Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64url')).join('.');
const hash=new URLSearchParams({access_token:token,refresh_token:'mock-refresh',token_type:'bearer',expires_in:'3600',type:'recovery'}).toString();
try{
 const context=await browser.newContext({viewport:{width:390,height:844}});const updates=[],business=[],errors=[];let mode='weak';
 await context.route('https://uiwzinyckukaqlbznnam.supabase.co/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(path==='/auth/v1/user'&&request.method()==='PUT'){
   updates.push(request.postDataJSON());
   if(mode==='weak')return route.fulfill({status:422,json:{code:'weak_password',message:'weak password'}});
   if(mode==='lost')return route.fulfill({status:503,json:{message:'lost response'}});
   await new Promise(resolve=>setTimeout(resolve,150));return route.fulfill({json:user});
  }
  if(path==='/auth/v1/user')return route.fulfill({json:user});
  if(path==='/auth/v1/logout')return route.fulfill({status:204,body:''});
  if(path.startsWith('/rest/')){business.push(path);return route.fulfill({json:path.endsWith('/get_my_access')?mockAccess({name:'Owner',role:'chu'}):[]});}
  throw Error('Unexpected endpoint '+path);
 });
 const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://localhost:5173/#'+hash);await page.getByRole('heading',{name:'Đặt lại mật khẩu',exact:true}).waitFor();
 const submit=page.getByRole('button',{name:'Lưu mật khẩu mới',exact:true});assert.equal(updates.length,0);assert.equal(submit?await submit.isDisabled():false,true);assert.equal(business.length,0);
 await page.reload();await page.getByRole('heading',{name:'Đặt lại mật khẩu',exact:true}).waitFor();assert.equal(business.length,0);
 await page.getByLabel('Mật khẩu mới',{exact:true}).fill('OwnerNew123');await page.getByLabel('Nhập lại mật khẩu',{exact:true}).fill('Mismatch');assert.equal(await submit.isDisabled(),true);
 await page.getByLabel('Nhập lại mật khẩu',{exact:true}).fill('OwnerNew123');await submit.click();await page.getByRole('alert').filter({hasText:'Mật khẩu chưa được chấp nhận'}).waitFor();assert.equal(updates.length,1);assert.equal(await page.getByLabel('Mật khẩu mới',{exact:true}).inputValue(),'');
 mode='lost';await page.getByLabel('Mật khẩu mới',{exact:true}).fill('OwnerNew123');await page.getByLabel('Nhập lại mật khẩu',{exact:true}).fill('OwnerNew123');await submit.click();await page.getByRole('alert').filter({hasText:'Chưa xác nhận được kết quả'}).waitFor();assert.equal(await page.getByRole('heading',{name:'Đã đổi mật khẩu',exact:true}).count(),0);
 mode='ok';await page.getByLabel('Mật khẩu mới',{exact:true}).fill('OwnerNew123');await page.getByLabel('Nhập lại mật khẩu',{exact:true}).fill('OwnerNew123');
 const before=updates.length;await submit.click();await page.getByRole('heading',{name:'Đã đổi mật khẩu',exact:true}).waitFor();assert.equal(updates.length,before+1);assert.equal(updates.at(-1).password,'OwnerNew123');assert.equal(business.length,0);
 assert.ok(!await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('OwnerNew123')));
 await page.getByRole('button',{name:'Về đăng nhập',exact:true}).click();await page.getByRole('heading',{name:'Đăng nhập nhân viên',exact:true}).waitFor();assert.equal(await page.evaluate(()=>sessionStorage.getItem('goc-pho-password-recovery-user')),null);
 assert.equal(await page.locator('body').evaluate(element=>element.scrollWidth<=innerWidth),true);
 const invalid=await context.newPage();await invalid.goto('http://localhost:5173/#error=access_denied&error_code=otp_expired');await invalid.getByRole('alert').filter({hasText:'Liên kết khôi phục không hợp lệ'}).waitFor();assert.equal(await invalid.getByRole('button',{name:'Lưu mật khẩu mới',exact:true}).count(),0);assert.deepEqual(errors,[]);
 console.log('ĐẠT khôi phục mật khẩu: Auth recovery thật trong SDK với API giả, reload giữ màn hình, không mở nghiệp vụ, kiểm tra 6–12/ký tự khớp, lỗi/không rõ kết quả không báo thành công, đổi mật khẩu và về đăng nhập, không lưu mật khẩu, link hết hạn.');
 await context.close();
}finally{await browser.close();}
