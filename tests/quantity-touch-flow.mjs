import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mockAccess} from './support/access.mjs';
const baseline=process.argv.includes('--baseline');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
 const name='Bún riêu đặc biệt đầy đủ thịt chả và riêu cua';
 await context.route('https://uiwzinyckukaqlbznnam.supabase.co/**',async route=>{
  const path=new URL(route.request().url()).pathname;let body;
  if(path==='/auth/v1/token')body={access_token:'mock',refresh_token:'refresh',token_type:'bearer',expires_in:3600,user:{id:'owner',email:'owner@example.test',aud:'authenticated',role:'authenticated'}};
  else if(path==='/auth/v1/user')body={id:'owner',email:'owner@example.test'};
  else if(path.endsWith('/get_my_access'))body=mockAccess({name:'Owner',role:'chu'});
  else if(path==='/rest/v1/menu_items')body=[{id:'bun',name,price:65000,category:'bun',is_out:false},{id:'tea',name:'Trà đá',price:3000,category:'do_uong',is_out:false}];
  else if(path==='/rest/v1/restaurant_tables')body=[{id:1,name:'Bàn 1'}];
  else if(['/rest/v1/table_sessions','/rest/v1/orders'].includes(path))body=[];
  else throw Error('Unexpected endpoint '+path);
  await route.fulfill({json:body});
 });
 const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://localhost:5173/');await page.getByLabel('Tên đăng nhập',{exact:true}).fill('owner@example.test');await page.getByLabel('Mật khẩu',{exact:true}).fill('mock-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).tap();await page.getByRole('button',{name:/^Bàn 1 /}).tap();
 const plus=page.getByRole('button',{name:'Thêm '+name,exact:true}),minus=page.getByRole('button',{name:'Bớt '+name,exact:true});
 await plus.tap();await plus.tap();await plus.tap();
 async function measure(){return page.locator('.pos-quantity-control').first().evaluate(group=>{
  const outer=group.getBoundingClientRect();return {group:{x:outer.x,y:outer.y,width:outer.width,height:outer.height},buttons:[...group.querySelectorAll('button')].map(button=>{const rect=button.getBoundingClientRect();return {height:rect.height,width:rect.width,inside:rect.top>=outer.top-.5&&rect.bottom<=outer.bottom+.5&&rect.left>=outer.left-.5&&rect.right<=outer.right+.5,background:getComputedStyle(button).backgroundColor,active:button.matches(':active')};})};
 });}
 const before=await measure();await page.screenshot({path:'/workspace/artifacts/quantity-touch-'+(baseline?'before':'after')+'.png'});
 if(baseline){console.log(JSON.stringify(before));}else{
 async function checkReleased(){const value=await measure();assert.ok(value.buttons.every(button=>button.inside),'Button feedback must stay inside the counter border');assert.ok(value.buttons.every(button=>!button.active&&button.background==='rgba(0, 0, 0, 0)'),'Touch release must clear visual press/hover state');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await checkReleased();
 for(const width of [375,390,414]){
  await page.setViewportSize({width,height:844});await checkReleased();
  for(let i=0;i<10;i++)await plus.tap();await checkReleased();for(let i=0;i<10;i++)await minus.tap();
  assert.equal(await page.getByLabel('Số lượng '+name,{exact:true}).filter({hasNot:page.locator('button')}).textContent(),'3');await checkReleased();
 }
 await page.getByRole('button',{name:'Xem đơn hàng',exact:true}).tap();assert.match(await page.locator('.pos-total-line').innerText(),/195\.000đ/);
 await plus.tap();await checkReleased();await minus.tap();await checkReleased();
 await minus.tap();await minus.tap();await minus.tap();const dialog=page.getByRole('dialog',{name:'Xóa món khỏi đơn?',exact:true});await dialog.waitFor();await dialog.getByRole('button',{name:'Quay lại',exact:true}).tap();assert.match(await page.locator('.pos-total-line').innerText(),/65\.000đ/);await checkReleased();
 await plus.focus();await page.keyboard.press('Enter');assert.match(await page.locator('.pos-total-line').innerText(),/130\.000đ/);assert.deepEqual(errors,[]);
 console.log('ĐẠT nút số lượng cảm ứng: trước/sau, không tràn khung hay dính nền sau nhả, tăng/giảm lặp đúng số, menu/đơn, 375/390/414, tên dài, xác nhận xóa, bàn phím. API giả lập.');
 }
 await context.close();
}finally{await browser.close();}
