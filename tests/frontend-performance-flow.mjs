import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {mockAccess} from './support/access.mjs';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:390,height:844}}),requested=new Set(),errors=[];
 await context.addInitScript(()=>{window.formatterCreations=0;Intl.NumberFormat=new Proxy(Intl.NumberFormat,{construct(target,args){window.formatterCreations++;return Reflect.construct(target,args);}});});
 const menu=Array.from({length:180},(_,i)=>({id:'item-'+i,name:i===0?'Bún Riêu Đặc Biệt':'Món thử '+i,price:65000+i*1000,category:i%3===0?'bun':i%3===1?'an_them':'do_uong',is_out:false}));
 const writes=[];
 await context.route('https://uiwzinyckukaqlbznnam.supabase.co/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;let body;
  if(path==='/auth/v1/token')body={access_token:'mock',refresh_token:'refresh',token_type:'bearer',expires_in:3600,user:{id:'owner',email:'owner@example.test',aud:'authenticated',role:'authenticated'}};
  else if(path==='/auth/v1/user')body={id:'owner',email:'owner@example.test'};
  else if(path.endsWith('/get_my_access'))body=mockAccess({name:'Owner',role:'chu'});
  else if(path==='/rest/v1/menu_items')body=menu;
  else if(path==='/rest/v1/restaurant_tables')body=Array.from({length:24},(_,i)=>({id:i+1,name:'Bàn '+(i+1)}));
  else if(['/rest/v1/table_sessions','/rest/v1/orders','/rest/v1/audit_log','/rest/v1/bills'].includes(path))body=[];
  else {writes.push(path);throw Error('Unexpected endpoint '+path);}
  await route.fulfill({json:body});
 });
 const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requested.add(new URL(request.url()).pathname));
 await page.goto('http://localhost:5173/');await page.getByLabel('Tên đăng nhập',{exact:true}).fill('owner@example.test');await page.getByLabel('Mật khẩu',{exact:true}).fill('mock-pass');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.getByRole('button',{name:/^Bàn 1 /}).waitFor();
 for(const module of ['RevenuePanel','InvoiceHistory','AuditPanel'])assert.ok(!requested.has('/src/'+module+'.tsx'),'Read-only module should not load until opened: '+module);
 await page.getByRole('button',{name:/^Bàn 1 /}).click();await page.locator('.pos-product-row').last().waitFor();assert.equal(await page.locator('.pos-product-row').count(),180);
 const initialFormatters=await page.evaluate(()=>window.formatterCreations);const client=await context.newCDPSession(page);await client.send('Emulation.setCPUThrottlingRate',{rate:4});
 const timings=[];for(let i=0;i<20;i++){const start=performance.now();await page.getByRole('button',{name:'Thêm Bún Riêu Đặc Biệt',exact:true}).click();timings.push(performance.now()-start);}
 const row=page.locator('.pos-product-row').first();await row.getByLabel('Ghi chú món',{exact:true}).fill('Không hành');
 assert.equal(await page.evaluate(()=>window.formatterCreations),initialFormatters,'Adding quantities/notes must reuse money formatter');
 await page.getByRole('button',{name:'Tìm kiếm món',exact:true}).click();await page.getByRole('searchbox',{name:'Tìm món',exact:true}).fill('bun rieu dac biet');assert.equal(await page.locator('.pos-product-row').count(),1);await page.getByRole('searchbox',{name:'Tìm món',exact:true}).fill('khong tim thay');await page.getByRole('heading',{name:'Không tìm thấy món',exact:true}).waitFor();await page.getByRole('searchbox',{name:'Tìm món',exact:true}).fill('');
 await page.getByRole('button',{name:'Xem đơn hàng',exact:true}).click();assert.match(await page.locator('.pos-total-line').innerText(),/1\.300\.000đ/);assert.equal(await page.getByLabel('Ghi chú món',{exact:true}).inputValue(),'Không hành');
 await page.getByRole('button',{name:'Quay lại danh sách bàn',exact:true}).click();
 async function navigate(name){await page.locator('.management-menu summary').click();await page.getByRole('button',{name,exact:true}).click();}
 await navigate('Báo cáo doanh thu');await page.getByLabel('Từ ngày',{exact:true}).fill('2026-10-01');assert.ok(requested.has('/src/RevenuePanel.tsx'));
 await page.getByRole('button',{name:'Phục vụ',exact:true}).click();await navigate('Báo cáo doanh thu');assert.equal(await page.getByLabel('Từ ngày',{exact:true}).inputValue(),'2026-10-01');
 await navigate('Nhật ký hoạt động');await page.getByRole('heading',{name:'100 hoạt động gần nhất',exact:true}).waitFor();assert.ok(requested.has('/src/AuditPanel.tsx'));
 await navigate('Hóa đơn gần đây');await page.getByRole('heading',{name:'30 hóa đơn gần nhất',exact:true}).waitFor();assert.ok(requested.has('/src/InvoiceHistory.tsx'));
 await page.getByRole('button',{name:'Phục vụ',exact:true}).click();menu[0].price=70000;await page.getByRole('button',{name:'Đồng bộ',exact:true}).click();await page.getByRole('button',{name:/^Bàn 1 /}).click();await page.getByRole('button',{name:'Xem đơn hàng',exact:true}).click();await page.locator('.pos-total-line').filter({hasText:'1.400.000đ'}).waitFor();assert.equal(await page.getByLabel('Ghi chú món',{exact:true}).inputValue(),'Không hành');
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);timings.sort((a,b)=>a-b);
 const report={items:180,tables:24,cpuThrottle:4,formatterConstructors:initialFormatters,newFormattersAfter20AddsAndNote:0,clickMsMedian:Math.round(timings[10]),clickMsP95:Math.round(timings[19]),lazyReadOnlyModules:true,draftAndNotesPreserved:true,serverPriceUpdatePreserved:true};await writeFile('/workspace/artifacts/frontend-performance.json',JSON.stringify(report,null,2));console.log(report);
 await context.route('**/src/RevenuePanel.tsx*',route=>route.abort());
 const failurePage=await context.newPage();await failurePage.goto('http://localhost:5173/');await failurePage.getByRole('button',{name:/^Bàn 1 /}).click();await failurePage.getByRole('button',{name:'Thêm Bún Riêu Đặc Biệt',exact:true}).click();await failurePage.getByRole('button',{name:'Xem đơn hàng',exact:true}).click();await failurePage.getByLabel('Ghi chú món',{exact:true}).fill('Giữ đơn khi lỗi mạng');await failurePage.getByRole('button',{name:'Quay lại danh sách bàn',exact:true}).click();await failurePage.locator('.management-menu summary').click();await failurePage.getByRole('button',{name:'Báo cáo doanh thu',exact:true}).click();await failurePage.getByRole('heading',{name:'Chưa tải được màn hình này.',exact:true}).waitFor();await failurePage.getByRole('button',{name:'Về Phục vụ',exact:true}).click();await failurePage.getByRole('button',{name:/^Bàn 1 /}).click();await failurePage.getByRole('button',{name:'Xem đơn hàng',exact:true}).click();assert.equal(await failurePage.getByLabel('Ghi chú món',{exact:true}).inputValue(),'Giữ đơn khi lỗi mạng');console.log('ĐẠT: lỗi tải báo cáo không làm trắng POS, vẫn quay về phục vụ và giữ món/ghi chú chưa gửi.');
 await context.close();
}finally{await browser.close();}
