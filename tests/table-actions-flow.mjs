import {mockAccess} from './support/access.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
const context=await browser.newContext({viewport:{width:390,height:844}});
const menu=[{id:'food',name:'Bún riêu truyền thống',price:58000,category:'bun',is_out:false},{id:'drink',name:'Trà đá',price:3000,category:'do_uong',is_out:false}];
const order=(table,id)=>({id:'order'+id,session_id:'s'+table,request_id:'req'+id,status:'cooking',kitchen_relevant:true,created_at:new Date().toISOString(),order_items:menu.map((m,n)=>({...m,id:`line${id}-${n}`,qty:1,note:n?'':'Không hành',paid:false,bill_no:1}))});
let sessions=[{id:'s1',table_id:1,orders:[order(1,1)]},{id:'s2',table_id:2,orders:[order(2,2)]},{id:'s3',table_id:3,orders:[order(3,3)]}];
let bills=[],attempts=[],lostResponse=true,receiptUnavailable=false,role='chu',stale=false,completeCalls=[],cancelCalls=[],applied=new Set(),audit=[],staleCancel=true;
sessions=sessions.slice(0,2);sessions.forEach(s=>{s.table_path=[s.table_id];s.orders.forEach(o=>o.table_path=[s.table_id]);});let mergeRequests=[],billRequests=[],lostMerge=true;
await context.route('https://uiwzinyckukaqlbznnam.supabase.co/**',async route=>{
 const req=route.request(),u=new URL(req.url());let body;
 if(u.pathname==='/auth/v1/token')body={access_token:'test-access-token',refresh_token:'test-refresh-token',token_type:'bearer',expires_in:3600,user:{id:'payment-test-user',email:'test@example.com',aud:'authenticated',role:'authenticated'}};
 else if(u.pathname==='/auth/v1/user')body={id:'payment-test-user',email:'test@example.com'};
 else if(u.pathname==='/rest/v1/rpc/get_my_access')body=mockAccess({name:'Chủ quán kiểm thử',role});
 else if(u.pathname==='/rest/v1/menu_items')body=menu;
 else if(u.pathname==='/rest/v1/restaurant_tables')body=Array.from({length:12},(_,i)=>({id:i+1,name:`Bàn ${i+1}`}));
 else if(u.pathname==='/rest/v1/table_sessions')body=sessions.filter(s=>!s.closed);
 else if(u.pathname==='/rest/v1/orders')body=sessions.flatMap(s=>s.orders.filter(o=>o.status==='cooking').map(o=>({...o,table_sessions:{table_id:s.table_id,closed_at:s.closed?'2026-10-27':null,table_path:s.table_path}})));
 else if(u.pathname==='/rest/v1/audit_log')body=audit.filter(e=>!['table_order','table_update','takeaway_created','takeaway_discarded','menu_update'].includes(e.type));
 else if(u.pathname==='/rest/v1/rpc/transfer_table'){
  const p=req.postDataJSON();assert.equal(p.p_reason,'');mergeRequests.push(p);
  if(mergeRequests.length===1){
   assert.equal(p.p_expected_target_session,'s2');
   const source=sessions.find(s=>s.id===p.p_session_id),target=sessions.find(s=>s.id===p.p_expected_target_session);
   source.orders.forEach(o=>{o.session_id=target.id;o.table_path.push(p.p_to_table);o.order_items.forEach(i=>i.bill_no=2);});target.orders.push(...source.orders);source.orders=[];source.closed=true;
   return route.fulfill({status:503,json:{message:'Lost merge response'}});
  }body='s2';
 }
 else if(u.pathname==='/rest/v1/rpc/move_bill_items'){
  const p=req.postDataJSON();billRequests.push(p);assert.equal(p.p_reason,'');const current=sessions.find(s=>s.id===p.p_session_id);current.orders.flatMap(o=>o.order_items).filter(i=>p.p_item_ids.includes(i.id)).forEach(i=>i.bill_no=3);body=3;
 }
 else if(u.pathname==='/rest/v1/rpc/complete_kitchen_order'){
  const p=req.postDataJSON();completeCalls.push(p);sessions.flatMap(s=>s.orders).find(o=>o.id===p.p_order_id).status='done';body=null;
 }
 else if(u.pathname==='/rest/v1/rpc/cancel_table_session'){
  const p=req.postDataJSON();cancelCalls.push(p);
  if(applied.has(p.p_request_id))body=null;
  else{
   const s=sessions.find(s=>s.id===p.p_session_id);
   if(staleCancel){staleCancel=false;s.orders[0].order_items.push({...menu[0],id:'late-line',qty:1,note:'Món mới',paid:false,bill_no:1});return route.fulfill({status:400,json:{code:'P0001',message:'Danh sách món đã thay đổi. Đồng bộ và xác nhận hủy bàn lại.'}});}
   const items=s.orders.flatMap(o=>o.order_items).filter(i=>!i.paid&&!i.cancelled_at);assert.deepEqual([...p.p_expected_item_ids].sort(),items.map(i=>i.id).sort());items.forEach(i=>{i.cancelled_at=new Date().toISOString();i.cancel_reason='';});s.orders.forEach(o=>{o.status='done';o.kitchen_relevant=false;});s.closed=true;applied.add(p.p_request_id);audit.push({id:'cancel1',type:'cancel_table',table_no:s.table_id,user_id:'payment-test-user',created_at:new Date().toISOString(),extra:{count:items.length}});
   return route.fulfill({status:503,json:{message:'Lost cancel response'}});
  }
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
async function tableActions(){if(!await page.locator('.table-actions-dialog').evaluate(e=>e.open))await page.getByRole('button',{name:'Thao tác bàn',exact:true}).click();}
async function swipe(card,dx,dy=0){await card.scrollIntoViewIfNeeded();const b=await card.boundingBox(),x=b.x+b.width/2,y=b.y+48;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:8});await page.mouse.up();}
await page.goto('http://localhost:5173');await page.getByLabel('Email',{exact:true}).fill('test@example.com');await page.getByLabel('Mật khẩu',{exact:true}).fill('fake-test-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();

await page.getByRole('button',{name:/^Bàn 1 /}).click();
assert.equal(await page.getByRole('button',{name:'Chuyển Bàn 1',exact:true}).count(),0);
await tableActions();await page.getByRole('dialog',{name:'Thao tác bàn · Bàn 1',exact:true}).waitFor();
await page.getByRole('button',{name:'Chuyển Bàn 1',exact:true}).click();
assert.match(await page.getByLabel('Bàn đích',{exact:true}).locator('option[value="2"]').innerText(),/Đang có đơn/);
await page.getByLabel('Bàn đích',{exact:true}).selectOption('2');await page.getByRole('button',{name:'Xác nhận chuyển bàn',exact:true}).click();
await page.getByRole('button',{name:'Thử lại cùng mã chuyển bàn',exact:true}).waitFor();
await page.reload();await page.getByRole('button',{name:'Thử lại cùng mã chuyển bàn',exact:true}).click();await page.getByText('Đã chuyển Bàn 1 sang Bàn 2.',{exact:false}).waitFor();
assert.equal(mergeRequests.length,2);assert.deepEqual(mergeRequests[0],mergeRequests[1]);
await page.getByRole('button',{name:'Tách/gộp bill Bàn 2',exact:true}).click();assert.equal(await page.getByLabel('Lý do tách/gộp',{exact:true}).count(),0);
await page.getByRole('button',{name:'Chọn tất cả dòng',exact:true}).click();await page.getByRole('button',{name:'Xác nhận tách/gộp bill',exact:true}).click();await page.getByText('Đã chuyển 2 dòng món từ Bill 1 sang Bill 3',{exact:false}).waitFor();assert.equal(billRequests.length,1);
await page.screenshot({path:'/workspace/work/table-actions-mobile.png'});
assert.equal(await page.locator('.table-actions-dialog').evaluate(e=>e.scrollWidth<=e.clientWidth),true);
await page.getByRole('button',{name:'Đóng thao tác bàn',exact:true}).click();await page.getByRole('button',{name:/^Bếp \(/}).click();
await page.getByRole('heading',{name:'Bàn 1 → Bàn 2',exact:true}).waitFor();await page.getByRole('heading',{name:'Bàn 2',exact:true}).waitFor();
await page.getByRole('button',{name:'Phục vụ',exact:true}).click();await tableActions();await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'/workspace/work/table-actions-desktop.png'});
await page.keyboard.press('Escape');assert.equal(await page.locator('.table-actions-dialog').evaluate(e=>e.open),false);
assert.deepEqual(errors,[]);console.log('PASS: icon opens table-actions modal, occupied target labeled/selectable, merge request snapshot, lost-response reload retry, bill split without reason, distinct kitchen routes, mobile overflow and Escape dismissal. Mock Supabase only.');
}finally{await browser.close();}
