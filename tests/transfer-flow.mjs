import {mockAccess} from './support/access.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
const context=await browser.newContext({viewport:{width:390,height:844}});
const menu=[{id:'food',name:'Bún riêu truyền thống',price:58000,category:'bun',is_out:false},{id:'drink',name:'Trà đá',price:3000,category:'do_uong',is_out:false}];
const order=(table,id)=>({id:'order'+id,session_id:'s'+table,request_id:'req'+id,status:'cooking',kitchen_relevant:true,created_at:new Date().toISOString(),order_items:menu.map((m,n)=>({...m,id:`line${id}-${n}`,qty:1,note:n?'':'Không hành',paid:false,bill_no:1}))});
let sessions=[{id:'s1',table_id:1,orders:[order(1,1)]},{id:'s2',table_id:2,orders:[order(2,2)]},{id:'s3',table_id:3,orders:[order(3,3)]}];
let bills=[],attempts=[],lostResponse=true,receiptUnavailable=false,role='chu',stale=false,moves=[],audit=[],rejectMove=false;
await context.route('https://uiwzinyckukaqlbznnam.supabase.co/**',async route=>{
 const req=route.request(),u=new URL(req.url());let body;
 if(u.pathname==='/auth/v1/token')body={access_token:'test-access-token',refresh_token:'test-refresh-token',token_type:'bearer',expires_in:3600,user:{id:'payment-test-user',email:'test@example.com',aud:'authenticated',role:'authenticated'}};
 else if(u.pathname==='/auth/v1/user')body={id:'payment-test-user',email:'test@example.com'};
 else if(u.pathname==='/rest/v1/rpc/get_my_access')body=mockAccess({name:'Chủ quán kiểm thử',role});
 else if(u.pathname==='/rest/v1/menu_items')body=menu;
 else if(u.pathname==='/rest/v1/restaurant_tables')body=Array.from({length:12},(_,i)=>({id:i+1,name:`Bàn ${i+1}`}));
 else if(u.pathname==='/rest/v1/table_sessions')body=sessions.filter(s=>!s.closed);
 else if(u.pathname==='/rest/v1/orders')body=sessions.flatMap(s=>s.orders.filter(o=>o.status==='cooking').map(o=>({...o,table_sessions:{table_id:s.table_id,closed_at:s.closed?'2026-10-27':null}})));
 else if(u.pathname==='/rest/v1/audit_log')body=audit;
 else if(u.pathname==='/rest/v1/rpc/transfer_table'){
  const p=req.postDataJSON();moves.push(p);
  if(rejectMove)return route.fulfill({status:400,json:{code:'P0001',message:'Bàn đích đã thay đổi. Đồng bộ và chọn lại bàn đích.'}});
  if(!audit.some(a=>a.extra.request_id===p.p_request_id)){
   const s=sessions.find(s=>s.id===p.p_session_id);assert.equal(s.table_id,p.p_from_table);s.table_id=p.p_to_table;
   audit.push({id:'move1',type:'table_transfer',table_no:p.p_to_table,user_id:'payment-test-user',created_at:new Date().toISOString(),extra:{from_table:p.p_from_table,to_table:p.p_to_table,reason:p.p_reason,request_id:p.p_request_id}});
  }
  if(moves.length===1)return route.fulfill({status:503,json:{message:'Lost move acknowledgement'}});
  body=p.p_session_id;
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

async function management(name){
 if(await page.getByRole('button',{name:'Đóng thao tác bàn',exact:true}).isVisible())await page.getByRole('button',{name:'Đóng thao tác bàn',exact:true}).click();const control=page.locator('.management-menu');if(!await control.evaluate(e=>e.open))await control.locator('summary').click();await page.getByRole('button',{name,exact:true}).click();}
async function tableActions(){if(!await page.locator('.table-actions-dialog').evaluate(e=>e.open))await page.getByRole('button',{name:'Thao tác bàn',exact:true}).click();}
async function openOrderMenu(){const add=page.getByRole('button',{name:'Thêm món',exact:true});if(await add.isVisible())await add.click();}
await page.goto('http://localhost:5173');await page.getByLabel('Email',{exact:true}).fill('test@example.com');await page.getByLabel('Mật khẩu',{exact:true}).fill('fake-test-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
await page.getByRole('button',{name:/^Bàn 1 /}).click();
// Không chuyển khi có giỏ món chưa gửi.
await openOrderMenu();await page.getByRole('button',{name:'Thêm Bún riêu truyền thống',exact:true}).click();
await tableActions();assert.equal(await page.getByRole('button',{name:'Chuyển Bàn 1',exact:true}).isDisabled(),true);
await page.getByRole('button',{name:'Đóng thao tác bàn',exact:true}).click();await page.getByRole('button',{name:'Xóa chọn',exact:true}).click();
await tableActions();await page.getByRole('button',{name:'Chuyển Bàn 1',exact:true}).click();
const target=page.getByLabel('Bàn đích',{exact:true});
assert.equal(await target.locator('option[value="2"]').count(),1);assert.equal(await target.locator('option[value="1"]').count(),0);
await target.selectOption('4');const confirm=page.getByRole('button',{name:'Xác nhận chuyển bàn',exact:true});assert.equal(await confirm.isDisabled(),false);assert.equal(await page.getByLabel('Lý do chuyển bàn',{exact:true}).count(),0);
await confirm.click();
await page.getByRole('button',{name:'Thử lại cùng mã chuyển bàn',exact:true}).waitFor();
assert.equal(await page.getByRole('button',{name:'Đăng xuất',exact:true}).isDisabled(),true);
await page.reload();await page.getByRole('button',{name:'Thử lại cùng mã chuyển bàn',exact:true}).click();
await page.getByText('Đã chuyển Bàn 1 sang Bàn 4.',{exact:false}).waitFor();
assert.equal(moves.length,2);assert.equal(moves[0].p_request_id,moves[1].p_request_id);assert.equal(audit.length,1);
assert.match(await page.getByRole('heading',{name:/Đơn đã lưu/}).innerText(),/61\.000đ/);
if(await page.getByRole('button',{name:'Đóng thao tác bàn',exact:true}).isVisible())await page.getByRole('button',{name:'Đóng thao tác bàn',exact:true}).click();await page.getByRole('button',{name:'← Danh sách bàn',exact:true}).click();
assert.match(await page.getByRole('button',{name:/^Bàn 1 /}).innerText(),/Trống/);
assert.match(await page.getByRole('button',{name:/^Bàn 4 /}).innerText(),/61\.000đ/);
if(await page.getByRole('button',{name:'Đóng thao tác bàn',exact:true}).isVisible())await page.getByRole('button',{name:'Đóng thao tác bàn',exact:true}).click();await page.getByRole('button',{name:/^Bếp \(/}).click();await page.getByRole('heading',{name:'Bàn 4',exact:true}).waitFor();
await page.getByRole('button',{name:'Phục vụ',exact:true}).click();await page.getByRole('button',{name:/^Bàn 4 /}).click();
await tableActions();await page.getByRole('button',{name:'Chuyển Bàn 4',exact:true}).click();await target.selectOption('5');rejectMove=true;await confirm.click();
await page.getByText('Bàn đích đã thay đổi. Đồng bộ và chọn lại bàn đích.',{exact:true}).waitFor();
assert.equal(await page.getByRole('button',{name:'Thử lại cùng mã chuyển bàn',exact:true}).count(),0);
assert.equal(await page.evaluate(()=>localStorage.getItem('goc-pho-transfer-v1:payment-test-user')),null);
await management('Nhật ký hoạt động');await page.getByText('Bàn 1 → Bàn 4',{exact:true}).waitFor();
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
role='phuc_vu';await page.reload();await page.getByRole('button',{name:/^Bàn 4 /}).click();assert.equal(await page.getByRole('button',{name:'Thao tác bàn',exact:true}).count(),1);
assert.deepEqual(errors,[]);console.log('PASS: transfer without reason, draft blocking, occupied targets selectable, durable retry/reload, moved totals/kitchen, target conflict rejection, audit, mobile and service role. Mock Supabase only.');
}finally{await browser.close();}
