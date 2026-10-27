import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
const context=await browser.newContext({viewport:{width:390,height:844}});
const menu=[{id:'food',name:'Bún riêu truyền thống',price:58000,category:'bun',is_out:false},{id:'drink',name:'Trà đá',price:3000,category:'do_uong',is_out:false}];
const order=(table,id)=>({id:'order'+id,session_id:'s'+table,request_id:'req'+id,status:'cooking',kitchen_relevant:true,created_at:new Date().toISOString(),order_items:menu.map((m,n)=>({...m,id:`line${id}-${n}`,qty:1,note:n?'':'Không hành',paid:false,bill_no:1}))});
let sessions=[{id:'s1',table_id:1,orders:[order(1,1)]},{id:'s2',table_id:2,orders:[order(2,2)]},{id:'s3',table_id:3,orders:[order(3,3)]}];
let bills=[],attempts=[],lostResponse=true,receiptUnavailable=false,role='chu',stale=false,reportMode='ok',reportCalls=[];
await context.route('https://uiwzinyckukaqlbznnam.supabase.co/**',async route=>{
 const req=route.request(),u=new URL(req.url());let body;
 if(u.pathname==='/auth/v1/token')body={access_token:'test-access-token',refresh_token:'test-refresh-token',token_type:'bearer',expires_in:3600,user:{id:'payment-test-user',email:'test@example.com',aud:'authenticated',role:'authenticated'}};
 else if(u.pathname==='/auth/v1/user')body={id:'payment-test-user',email:'test@example.com'};
 else if(u.pathname==='/rest/v1/profiles')body={name:'Chủ quán kiểm thử',role};
 else if(u.pathname==='/rest/v1/menu_items')body=menu;
 else if(u.pathname==='/rest/v1/restaurant_tables')body=Array.from({length:12},(_,i)=>({id:i+1,name:`Bàn ${i+1}`}));
 else if(u.pathname==='/rest/v1/table_sessions')body=sessions.filter(s=>!s.closed);
 else if(u.pathname==='/rest/v1/orders')body=sessions.flatMap(s=>s.orders.filter(o=>o.status==='cooking').map(o=>({...o,table_sessions:{table_id:s.table_id,closed_at:s.closed?'2026-10-27':null}})));
 else if(u.pathname==='/rest/v1/rpc/revenue_report'){
  const p=req.postDataJSON();reportCalls.push(p);
  if(reportMode==='missing')return route.fulfill({status:404,json:{code:'PGRST202',message:'missing RPC'}});
  if(reportMode==='fail')return route.fulfill({status:400,json:{code:'P0001',message:'denied'}});
  const empty=reportMode==='empty';body={from:p.p_from,to:p.p_to,generated_at:'2026-10-27T17:00:00Z',invoices:empty?0:2,gross:empty?0:232000,discount:empty?0:22000,total:empty?0:210000,cash:empty?0:100000,transfer:empty?0:110000,days:empty?[]:[{day:p.p_from,invoices:2,gross:232000,discount:22000,total:210000,cash:100000,transfer:110000}],products:empty?[]:[{name:'Bún riêu',qty:4,gross:232000}]};
 }
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
const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));

async function management(name){const control=page.locator('.management-menu');if(!await control.evaluate(e=>e.open))await control.locator('summary').click();await page.getByRole('button',{name,exact:true}).click();}
async function tableActions(){const control=page.locator('.table-operations');if(!await control.evaluate(e=>e.open))await control.locator('summary').click();}
await page.goto('http://localhost:5173');await page.getByLabel('Email',{exact:true}).fill('test@example.com');await page.getByLabel('Mật khẩu',{exact:true}).fill('fake-test-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
await management('Báo cáo doanh thu');
await page.getByLabel('Từ ngày',{exact:true}).fill('2026-10-27');await page.getByLabel('Đến ngày',{exact:true}).fill('2026-10-27');
const load=page.getByRole('button',{name:'Xem báo cáo',exact:true});await load.click();
await page.getByText('210.000đ',{exact:true}).first().waitFor();assert.equal(reportCalls.length,1);assert.equal(reportCalls[0].p_from,'2026-10-27');
assert.match(await page.locator('.report-result').innerText(),/110\.000đ/);assert.match(await page.locator('.report-result').innerText(),/Bún riêu/);
await page.getByLabel('Đến ngày',{exact:true}).fill('2026-10-28');await page.getByText('Khoảng ngày đã đổi.',{exact:false}).waitFor();assert.equal(await page.locator('.report-result').count(),0);
reportMode='empty';await load.click();await page.getByText('Chưa có hóa đơn đã thanh toán trong khoảng ngày này.',{exact:true}).waitFor();
reportMode='missing';await load.click();await page.getByText('Database chưa có báo cáo doanh thu.',{exact:false}).waitFor();assert.equal(await page.locator('.report-result').count(),0);
reportMode='fail';await load.click();await page.getByText('Không tải được báo cáo.',{exact:false}).waitFor();
await page.getByLabel('Từ ngày',{exact:true}).fill('2026-11-01');assert.equal(await load.isDisabled(),true);
reportMode='ok';await page.getByRole('button',{name:'Tháng này',exact:true}).click();assert.match(await page.getByLabel('Từ ngày',{exact:true}).inputValue(),/-01$/);assert.equal(await load.isDisabled(),false);
await load.click();await page.locator('.report-result').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
role='phuc_vu';await page.reload();await page.getByRole('button',{name:/^Bàn 1 /}).waitFor();assert.equal(await page.getByRole('button',{name:'Báo cáo doanh thu',exact:true}).count(),0);
assert.deepEqual(errors,[]);console.log('PASS: revenue dates, totals, daily/products, stale result hiding, empty/error/missing migration, date validation, month shortcut, mobile width and service role. Mock Supabase only.');
}finally{await browser.close();}
