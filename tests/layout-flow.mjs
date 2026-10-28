import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const menu=[{id:'food',name:'Bún riêu truyền thống',price:58000,category:'bun',is_out:false},{id:'drink',name:'Trà đá',price:3000,category:'do_uong',is_out:false}];
const order=(table,id)=>({id:'order'+id,session_id:'s'+table,request_id:'req'+id,status:'cooking',kitchen_relevant:true,created_at:new Date().toISOString(),order_items:menu.map((m,n)=>({...m,id:`line${id}-${n}`,qty:1,note:n?'':'Không hành',paid:false,bill_no:1}))});
let sessions=[{id:'s1',table_id:1,orders:[order(1,1)]},{id:'s2',table_id:2,orders:[order(2,2)]},{id:'s3',table_id:3,orders:[order(3,3)]}];
let bills=[],attempts=[],lostResponse=true,receiptUnavailable=false,role='chu',stale=false;
await context.route('https://uiwzinyckukaqlbznnam.supabase.co/**',async route=>{
 const req=route.request(),u=new URL(req.url());let body;
 if(u.pathname==='/auth/v1/token')body={access_token:'test-access-token',refresh_token:'test-refresh-token',token_type:'bearer',expires_in:3600,user:{id:'payment-test-user',email:'test@example.com',aud:'authenticated',role:'authenticated'}};
 else if(u.pathname==='/auth/v1/user')body={id:'payment-test-user',email:'test@example.com'};
 else if(u.pathname==='/rest/v1/profiles')body={name:'Chủ quán kiểm thử',role};
 else if(u.pathname==='/rest/v1/menu_items')body=menu;
 else if(u.pathname==='/rest/v1/restaurant_tables')body=Array.from({length:12},(_,i)=>({id:i+1,name:`Bàn ${i+1}`}));
 else if(u.pathname==='/rest/v1/table_sessions')body=sessions.filter(s=>!s.closed);
 else if(u.pathname==='/rest/v1/orders')body=sessions.flatMap(s=>s.orders.filter(o=>o.status==='cooking').map(o=>({...o,table_sessions:{table_id:s.table_id,closed_at:s.closed?'2026-10-27':null}})));
 else if(u.pathname==='/rest/v1/rpc/pay_bill'){
  const p=req.postDataJSON();attempts.push(p);
  if(stale){stale=false;return route.fulfill({status:400,json:{code:'P0001',message:'Danh sách món đã thay đổi. Đồng bộ và kiểm tra lại trước khi thanh toán.'}});}
  let b=bills.find(b=>b.request_id===p.p_request_id);
  if(!b){
   const s=sessions.find(s=>s.id===p.p_session_id);const lines=s.orders.flatMap(o=>o.order_items);
   assert.deepEqual([...p.p_expected_item_ids].sort(),lines.map(i=>i.id).sort());
   const gross=lines.reduce((n,i)=>n+i.qty*i.price,0),discount=p.p_discount_type==='percent'?Math.round(gross*p.p_discount_value/100):p.p_discount_value;
   b={id:'bill'+(bills.length+1),invoice_no:bills.length+1,request_id:p.p_request_id,table_no:s.table_id,gross,discount,total:gross-discount,method:p.p_method,cash_received:p.p_cash_received,change_due:p.p_method==='cash'?p.p_cash_received-(gross-discount):0,paid_at:new Date().toISOString(),bill_items:structuredClone(lines)};
   bills.push(b);s.closed=true;s.orders.forEach(o=>o.order_items.forEach(i=>i.paid=true));
  }
  if(lostResponse){lostResponse=false;return route.fulfill({status:503,json:{message:'Simulated payment acknowledgement lost'}});}
  body=b.id;
 }
 else if(u.pathname==='/rest/v1/bills'){
  if(u.searchParams.has('id')){if(receiptUnavailable)return route.fulfill({status:503,json:{message:'Receipt unavailable'}});body=bills.find(b=>'eq.'+b.id===u.searchParams.get('id'));}
  else body=[...bills].reverse();
 }
 else throw new Error('Unexpected network '+u.pathname);
 await route.fulfill({status:200,json:body});
});
bills.push({id:'history-bill',invoice_no:11,table_no:6,bill_no:1,gross:61000,discount:0,total:61000,method:'cash',cash_received:100000,change_due:39000,paid_at:'2026-10-27T10:00:00Z',bill_items:menu.map(m=>({...m,qty:1,note:''}))});
const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
async function management(name){
 if(await page.getByRole('button',{name:'Đóng thao tác bàn',exact:true}).isVisible())await page.getByRole('button',{name:'Đóng thao tác bàn',exact:true}).click();if(!await page.locator('.management-menu').evaluate(e=>e.open))await page.locator('.management-menu>summary').click();await page.getByRole('button',{name,exact:true}).click();}
await page.goto('http://localhost:5173');await page.getByLabel('Email',{exact:true}).fill('test@example.com');await page.getByLabel('Mật khẩu',{exact:true}).fill('fake-test-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
await page.getByRole('button',{name:/^Bàn 1 /}).waitFor();assert.equal(await page.locator('.table-card:visible').count(),12);assert.equal(await page.locator('.management-page:visible').count(),0);assert.equal(await page.getByRole('button',{name:'Quản lý thực đơn',exact:true}).count(),0);
assert.equal(await page.getByRole('button',{name:'Hóa đơn gần đây',exact:true}).count(),0);
await page.locator('.table-filters button').nth(1).click();assert.equal(await page.locator('.table-card:visible').count(),9);await page.locator('.table-filters button').nth(2).click();assert.equal(await page.locator('.table-card:visible').count(),3);
await page.getByRole('textbox',{name:'Tìm bàn',exact:true}).fill('Bàn 2');assert.equal(await page.locator('.table-card:visible').count(),1);await page.getByRole('textbox',{name:'Tìm bàn',exact:true}).fill('');await page.locator('.table-filters button').first().click();
await page.screenshot({path:'/workspace/work/pos-desktop.png',fullPage:true});
await page.getByRole('button',{name:/^Bàn 1 /}).click();await page.getByRole('button',{name:'Thêm Bún riêu truyền thống',exact:true}).click();assert.match(await page.locator('footer').innerText(),/58\.000đ/);
assert.equal(await page.getByRole('button',{name:'Chuyển Bàn 1',exact:true}).count(),0);await page.getByRole('button',{name:'Thao tác bàn',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Chuyển Bàn 1',exact:true}).isDisabled(),true);
await management('Báo cáo doanh thu');await page.getByRole('button',{name:'Xem báo cáo',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Gửi bếp',exact:true}).count(),0);
await page.getByRole('button',{name:'Phục vụ',exact:true}).click();assert.match(await page.locator('footer').innerText(),/58\.000đ/);await page.getByRole('button',{name:'Xóa chọn',exact:true}).click();
await page.screenshot({path:'/workspace/work/pos-order-desktop.png',fullPage:true});
await management('Hóa đơn gần đây');await page.getByRole('button',{name:/^#11 /}).click();await page.getByRole('dialog').waitFor();assert.match(await page.getByRole('dialog').innerText(),/Hóa đơn #11/);
await page.emulateMedia({media:'print'});assert.equal(await page.locator('.receipt').evaluate(e=>getComputedStyle(e).visibility),'visible');await page.emulateMedia({media:'screen'});await page.getByRole('dialog').getByRole('button',{name:'Đóng',exact:true}).click();
await page.getByRole('button',{name:'Phục vụ',exact:true}).click();await page.getByRole('button',{name:'← Danh sách bàn',exact:true}).click();await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'/workspace/work/pos-mobile.png',fullPage:true});
await page.getByRole('button',{name:/^Bàn 1 /}).click();await page.getByRole('button',{name:'Thêm Bún riêu truyền thống',exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'/workspace/work/pos-order-mobile.png',fullPage:true});
// Khôi phục thanh toán chờ vẫn nhìn thấy trên màn hình phục vụ mới.
await page.evaluate(()=>localStorage.setItem('goc-pho-payment-v1:payment-test-user',JSON.stringify({requestId:'recover-payment',sessionId:'s1',tableId:1,billNo:1,itemIds:['line1-0'],items:[{id:'line1-0',name:'Bún riêu',qty:1,price:58000}],method:'cash',discountType:'amount',discountValue:0,cash:58000,gross:58000,discount:0,total:58000,billId:'history-bill'})));
await page.reload();await page.getByRole('button',{name:'Thử lại cùng mã',exact:true}).click();await page.getByRole('button',{name:'In hóa đơn',exact:true}).waitFor();assert.equal(bills.length,1);assert.deepEqual(errors,[]);
console.log('PASS: compact dashboard, management hidden by default, table search/status filters, contextual actions, draft survives navigation, invoice route and modal/print, desktop/mobile widths and visible pending payment recovery. Mock Supabase only.');
}finally{await browser.close();}
