import {mockAccess} from './support/access.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
const context=await browser.newContext({viewport:{width:390,height:844}});
const menu=[{id:'food',name:'Bún riêu truyền thống',price:58000,category:'bun',is_out:false},{id:'drink',name:'Trà đá',price:3000,category:'do_uong',is_out:false}];
const order=(table,id)=>({id:'order'+id,session_id:'s'+table,request_id:'req'+id,status:'cooking',kitchen_relevant:true,created_at:new Date().toISOString(),order_items:menu.map((m,n)=>({...m,id:`line${id}-${n}`,qty:1,note:n?'':'Không hành',paid:false,bill_no:1}))});
let sessions=[{id:'s1',table_id:1,orders:[order(1,1)]},{id:'s2',table_id:2,orders:[order(2,2)]},{id:'s3',table_id:3,orders:[order(3,3)]}];
let bills=[],attempts=[],lostResponse=true,receiptUnavailable=false,role='chu',stale=false,moves=[],audit=[],applied=new Map(),rejectMove=false;
sessions[0].orders[0].order_items.push({...menu[0],id:'extra-line',name:'Bún riêu thêm',qty:1,note:'',paid:false,bill_no:1});
await context.route('https://uiwzinyckukaqlbznnam.supabase.co/**',async route=>{
 const req=route.request(),u=new URL(req.url());let body;
 if(u.pathname==='/auth/v1/token')body={access_token:'test-access-token',refresh_token:'test-refresh-token',token_type:'bearer',expires_in:3600,user:{id:'payment-test-user',email:'test@example.com',aud:'authenticated',role:'authenticated'}};
 else if(u.pathname==='/auth/v1/user')body={id:'payment-test-user',email:'test@example.com'};
 else if(u.pathname==='/rest/v1/rpc/get_my_access')body=mockAccess({name:'Chủ quán kiểm thử',role});
 else if(u.pathname==='/rest/v1/menu_items')body=menu;
 else if(u.pathname==='/rest/v1/restaurant_tables')body=Array.from({length:12},(_,i)=>({id:i+1,name:`Bàn ${i+1}`}));
 else if(u.pathname==='/rest/v1/table_sessions')body=sessions.filter(s=>!s.closed);
 else if(u.pathname==='/rest/v1/orders')body=sessions.flatMap(s=>s.orders.filter(o=>o.status==='cooking').map(o=>({...o,table_sessions:{table_id:s.table_id,closed_at:s.closed?'2026-10-27':null}})));
 else if(u.pathname==='/rest/v1/audit_log')body=audit.filter(e=>!['table_order','table_update','takeaway_created','takeaway_discarded','menu_update'].includes(e.type));
 else if(u.pathname==='/rest/v1/rpc/move_bill_items'){
  const p=req.postDataJSON();moves.push(p);
  if(rejectMove){rejectMove=false;return route.fulfill({status:400,json:{code:'P0001',message:'Món hoặc bill đã thay đổi. Đồng bộ và chọn lại.'}});}
  if(!applied.has(p.p_request_id)){
   const s=sessions.find(s=>s.id===p.p_session_id),lines=s.orders.flatMap(o=>o.order_items);
   const target=p.p_to_bill||Math.max(...lines.map(i=>i.bill_no))+1;
   p.p_item_ids.forEach(id=>{const i=lines.find(i=>i.id===id);assert.equal(i.paid,false);assert.equal(i.bill_no,p.p_from_bill);i.bill_no=target;});
   applied.set(p.p_request_id,target);audit.push({id:'audit'+audit.length,type:'bill_move',table_no:s.table_id,user_id:'payment-test-user',created_at:new Date().toISOString(),extra:{from_bill:p.p_from_bill,to_bill:target,reason:p.p_reason}});
  }
  if(moves.length===1)return route.fulfill({status:503,json:{message:'Lost split acknowledgement'}});
  body=applied.get(p.p_request_id);
 }
 else if(u.pathname==='/rest/v1/rpc/pay_bill'){
  const p=req.postDataJSON();attempts.push(p);
  if(stale){stale=false;return route.fulfill({status:400,json:{code:'P0001',message:'Danh sách món đã thay đổi. Đồng bộ và kiểm tra lại trước khi thanh toán.'}});}
  let b=bills.find(b=>b.request_id===p.p_request_id);
  if(!b){
   const s=sessions.find(s=>s.id===p.p_session_id);const lines=s.orders.flatMap(o=>o.order_items).filter(i=>!i.paid&&!i.cancelled_at&&i.bill_no===p.p_bill_no);
   assert.deepEqual([...p.p_expected_item_ids].sort(),lines.map(i=>i.id).sort());
   const gross=lines.reduce((n,i)=>n+i.qty*i.price,0),discount=p.p_discount_type==='percent'?Math.round(gross*p.p_discount_value/100):p.p_discount_value;
   b={id:'bill'+(bills.length+1),invoice_no:bills.length+1,request_id:p.p_request_id,table_no:s.table_id,bill_no:p.p_bill_no,gross,discount,total:gross-discount,method:p.p_method,cash_received:p.p_cash_received,change_due:p.p_method==='cash'?p.p_cash_received-(gross-discount):0,paid_at:new Date().toISOString(),bill_items:structuredClone(lines)};
   bills.push(b);lines.forEach(i=>i.paid=true);s.closed=!s.orders.flatMap(o=>o.order_items).some(i=>!i.paid&&!i.cancelled_at);
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
await page.goto('http://localhost:5173');await page.getByLabel('Tên đăng nhập',{exact:true}).fill('test@example.com');await page.getByLabel('Mật khẩu',{exact:true}).fill('fake-test-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
await page.getByRole('button',{name:/^Bàn 1 /}).click();await tableActions();await page.getByRole('button',{name:'Tách/gộp bill Bàn 1',exact:true}).click();
const confirm=page.getByRole('button',{name:'Xác nhận tách/gộp bill',exact:true});assert.equal(await confirm.isDisabled(),true);
await page.getByRole('checkbox',{name:/Trà đá/}).check();assert.equal(await page.getByLabel('Lý do tách/gộp',{exact:true}).count(),0);await confirm.click();
await page.getByRole('button',{name:'Thử lại cùng mã tách/gộp',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Đăng xuất',exact:true}).isDisabled(),true);
await page.reload();await page.getByRole('button',{name:'Thử lại cùng mã tách/gộp',exact:true}).click();await page.getByText('Đã chuyển 1 dòng món từ Bill 1 sang Bill 2',{exact:false}).waitFor();assert.equal(moves[0].p_request_id,moves[1].p_request_id);assert.equal(audit.length,1);
await page.getByRole('button',{name:'Đóng thao tác bàn',exact:true}).click();await page.getByLabel('Bill thanh toán',{exact:true}).selectOption('2');await page.getByRole('button',{name:'Thanh toán Bàn 1 · Bill 2',exact:true}).click();
let dialog=page.getByRole('dialog');assert.match(await dialog.innerText(),/3\.000đ/);assert.doesNotMatch(await dialog.innerText(),/Bún riêu/);
await dialog.getByRole('button',{name:'Xác nhận thu tiền mặt',exact:true}).click();await dialog.getByRole('button',{name:'Thử lại cùng mã',exact:true}).waitFor();
await page.reload();await page.getByRole('button',{name:'Thử lại cùng mã',exact:true}).click();await page.getByRole('heading',{name:'Hóa đơn đã thanh toán',exact:true}).waitFor();assert.equal(attempts[0].p_bill_no,2);assert.equal(attempts[1].p_bill_no,2);assert.equal(bills.length,1);assert.equal(sessions[0].closed,false);assert.match(await dialog.innerText(),/Bill 2/);
await dialog.getByRole('button',{name:'Đóng',exact:true}).click();await page.getByRole('button',{name:/^Bàn 1 /}).click();assert.match(await page.getByRole('heading',{name:/Đơn đã lưu/}).innerText(),/116\.000đ/);
await tableActions();await page.getByRole('button',{name:'Tách/gộp bill Bàn 1',exact:true}).click();await page.getByRole('checkbox',{name:/Bún riêu thêm/}).check();assert.equal(await page.getByLabel('Lý do tách/gộp',{exact:true}).count(),0);await confirm.click();await page.getByText('Đã chuyển 1 dòng món từ Bill 1 sang Bill 3',{exact:false}).waitFor();
// Gộp toàn bộ Bill 3 vào Bill 1; từ chối thay đổi cũ phải cho chọn lại.
await tableActions();await page.getByRole('button',{name:'Tách/gộp bill Bàn 1',exact:true}).click();await page.getByLabel('Bill nguồn',{exact:true}).selectOption('3');await page.getByRole('button',{name:'Chọn tất cả dòng',exact:true}).click();await page.getByLabel('Chuyển sang',{exact:true}).selectOption('1');assert.equal(await page.getByLabel('Lý do tách/gộp',{exact:true}).count(),0);rejectMove=true;await confirm.click();await page.getByText('Món hoặc bill đã thay đổi.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Thử lại cùng mã tách/gộp',exact:true}).count(),0);
await tableActions();await page.getByRole('button',{name:'Tách/gộp bill Bàn 1',exact:true}).click();await page.getByLabel('Bill nguồn',{exact:true}).selectOption('3');await page.getByRole('button',{name:'Chọn tất cả dòng',exact:true}).click();await page.getByLabel('Chuyển sang',{exact:true}).selectOption('1');assert.equal(await page.getByLabel('Lý do tách/gộp',{exact:true}).count(),0);await confirm.click();await page.getByText('Đã chuyển 1 dòng món từ Bill 3 sang Bill 1',{exact:false}).waitFor();
await page.getByRole('button',{name:'Đóng thao tác bàn',exact:true}).click();await page.getByRole('button',{name:'Thanh toán Bàn 1',exact:true}).click();await dialog.getByRole('button',{name:'Xác nhận thu tiền mặt',exact:true}).click();await page.getByRole('heading',{name:'Hóa đơn đã thanh toán',exact:true}).waitFor();assert.equal(bills.length,2);assert.equal(bills[1].total,116000);assert.equal(sessions[0].closed,true);assert.equal(sessions[0].orders[0].status,'cooking');
await dialog.getByRole('button',{name:'Đóng',exact:true}).click();await page.getByRole('button',{name:'← Danh sách bàn',exact:true}).click();assert.match(await page.getByRole('button',{name:/^Bàn 1 /}).innerText(),/Trống/);
await management('Nhật ký hoạt động');await page.getByText('Bill 1 → Bill 2',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
role='phuc_vu';await page.reload();await page.getByRole('button',{name:/^Bàn 2 /}).click();assert.equal(await page.getByRole('button',{name:'Thao tác bàn',exact:true}).count(),1);
assert.deepEqual(errors,[]);console.log('PASS: split/merge confirmation, durable split retry, separate Bill 2 payment retry with same number, partial table balance, new bill numbering, conflict recovery, merge, final closure, retained kitchen, audit, mobile and service role. Mock Supabase only.');
}finally{await browser.close();}
