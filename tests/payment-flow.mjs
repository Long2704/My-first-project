import {mockAccess} from './support/access.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
const context=await browser.newContext({viewport:{width:390,height:844}});
const menu=[{id:'food',name:'Bún riêu truyền thống',price:58000,category:'bun',is_out:false},{id:'drink',name:'Trà đá',price:3000,category:'do_uong',is_out:false}];
const order=(table,id)=>({id:'order'+id,session_id:'s'+table,request_id:'req'+id,status:'cooking',kitchen_relevant:true,created_at:new Date().toISOString(),order_items:menu.map((m,n)=>({...m,id:`line${id}-${n}`,qty:1,note:n?'':'Không hành',paid:false,bill_no:1}))});
let sessions=[{id:'s1',table_id:1,orders:[order(1,1)]},{id:'s2',table_id:2,orders:[order(2,2)]},{id:'s3',table_id:3,orders:[order(3,3)]}];
let bills=[],attempts=[],lostResponse=true,receiptUnavailable=false,role='chu',stale=false;
await context.route('https://uiwzinyckukaqlbznnam.supabase.co/**',async route=>{
 const req=route.request(),u=new URL(req.url());let body;
 if(u.pathname==='/auth/v1/token')body={access_token:'test-access-token',refresh_token:'test-refresh-token',token_type:'bearer',expires_in:3600,user:{id:'payment-test-user',email:'test@example.com',aud:'authenticated',role:'authenticated'}};
 else if(u.pathname==='/auth/v1/user')body={id:'payment-test-user',email:'test@example.com'};
 else if(u.pathname==='/rest/v1/rpc/get_my_access')body=mockAccess({name:'Chủ quán kiểm thử',role});
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
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));

async function management(name){const control=page.locator('.management-menu');if(!await control.evaluate(e=>e.open))await control.locator('summary').click();await page.getByRole('button',{name,exact:true}).click();}
async function tableActions(){const control=page.locator('.table-operations');if(!await control.evaluate(e=>e.open))await control.locator('summary').click();}
await page.goto('http://localhost:5173');await page.getByLabel('Email',{exact:true}).fill('test@example.com');await page.getByLabel('Mật khẩu',{exact:true}).fill('fake-test-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
await page.getByRole('button',{name:/^Bàn 1 /}).click();await page.getByRole('button',{name:'Thanh toán Bàn 1',exact:true}).click();
let dialog=page.getByRole('dialog');await dialog.waitFor();
await dialog.getByLabel('Giảm giá',{exact:true}).fill('10%');await dialog.getByLabel('Tiền khách đưa',{exact:true}).fill('50000');
assert.equal(await dialog.getByRole('button',{name:'Xác nhận thu tiền mặt',exact:true}).isDisabled(),true);
await dialog.getByLabel('Tiền khách đưa',{exact:true}).fill('100000');assert.match(await dialog.innerText(),/45\.100đ/);
await dialog.getByRole('button',{name:'Xác nhận thu tiền mặt',exact:true}).click();
await dialog.getByRole('button',{name:'Thử lại cùng mã',exact:true}).waitFor();
await page.reload();await page.getByRole('button',{name:'Thử lại cùng mã',exact:true}).click();
await page.getByRole('heading',{name:'Hóa đơn đã thanh toán',exact:true}).waitFor();
assert.equal(bills.length,1);assert.equal(attempts.length,2);assert.equal(attempts[0].p_request_id,attempts[1].p_request_id);
if(process.env.POS_SCREENSHOT_DIR)await page.screenshot({path:process.env.POS_SCREENSHOT_DIR+'/receipt-no-print-mobile.png',fullPage:true});
assert.match(await dialog.innerText(),/54\.900đ/);assert.match(await dialog.innerText(),/45\.100đ/);assert.match(await dialog.innerText(),/Không hành/);
assert.equal(await page.getByRole('button',{name:'In hóa đơn',exact:true}).count(),0);
await dialog.getByRole('button',{name:'Đóng',exact:true}).click();
assert.match(await page.getByRole('button',{name:/^Bàn 1 /}).innerText(),/Trống/);
await page.getByRole('button',{name:/^Bếp \(/}).click();assert.equal(await page.locator('.kitchen-card').count(),3);
await page.getByRole('button',{name:'Phục vụ',exact:true}).click();await page.getByRole('button',{name:/^Bàn 2 /}).click();await page.getByRole('button',{name:'Thanh toán Bàn 2',exact:true}).click();
await dialog.getByLabel('Giảm giá',{exact:true}).fill('10000');await dialog.getByLabel('Hình thức',{exact:true}).selectOption('transfer');
receiptUnavailable=true;
await dialog.getByRole('button',{name:'Xác nhận đã nhận chuyển khoản',exact:true}).click();
await dialog.getByText('Đã thanh toán thành công nhưng chưa tải được hóa đơn.',{exact:false}).waitFor();
const requestCount=attempts.length;assert.equal(bills.length,2);assert.equal(bills[1].total,51000);assert.equal(bills[1].method,'transfer');
receiptUnavailable=false;
await dialog.getByRole('button',{name:'Thử lại cùng mã',exact:true}).click();await page.getByRole('heading',{name:'Hóa đơn đã thanh toán',exact:true}).waitFor();assert.equal(attempts.length,requestCount);
await dialog.getByRole('button',{name:'Đóng',exact:true}).click();await page.getByRole('button',{name:'← Danh sách bàn',exact:true}).click();
await page.getByRole('button',{name:/^Bàn 3 /}).click();await page.getByRole('button',{name:'Thanh toán Bàn 3',exact:true}).click();
stale=true;await dialog.getByRole('button',{name:'Xác nhận thu tiền mặt',exact:true}).click();await dialog.getByText('Danh sách món đã thay đổi.',{exact:false}).waitFor();
assert.equal(bills.length,2);assert.equal(await page.evaluate(()=>localStorage.getItem('goc-pho-payment-v1:payment-test-user')),null);
await dialog.getByRole('button',{name:'Đóng',exact:true}).click();
await management('Hóa đơn gần đây');await page.getByRole('button',{name:/^#1 /}).click();await page.getByRole('heading',{name:'Hóa đơn đã thanh toán',exact:true}).waitFor();
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
await dialog.getByRole('button',{name:'Đóng',exact:true}).click();
role='phuc_vu';await page.reload();await page.getByRole('button',{name:/^Bàn 3 /}).click();assert.equal(await page.getByRole('button',{name:'Thanh toán Bàn 3',exact:true}).count(),1);
assert.deepEqual(errors,[]);
console.log('PASS: cash validation, percentage/fixed discounts, change, persisted retry after lost payment response, no duplicate invoice, transfer, receipt-only retry, stale-item rejection, kitchen retains paid orders, empty table, recent receipts, receipt retained without print, mobile width, service can pay without finance administration. All network mocked; no live payments.');
}finally{await browser.close();}
