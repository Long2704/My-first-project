import {mockAccess} from './support/access.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const menu=[{id:'food',name:'Bún riêu',price:58000,category:'bun',is_out:false},{id:'drink',name:'Trà đá',price:3000,category:'do_uong',is_out:false}];
 const tables=Array.from({length:13},(_,i)=>({id:i+1,name:i===12?'Mang về':`Bàn ${i+1}`,active:true})),sessions=[],bills=[],orderCalls=[],payCalls=[];
 let role='chu',lostPay=true;
 await context.route('https://uiwzinyckukaqlbznnam.supabase.co/**',async route=>{
  const req=route.request(),u=new URL(req.url());let body;
  if(u.pathname==='/auth/v1/token')body={access_token:'test-access-token',refresh_token:'test-refresh-token',token_type:'bearer',expires_in:3600,user:{id:'test-user',email:'test@example.com',aud:'authenticated',role:'authenticated'}};
  else if(u.pathname==='/auth/v1/user')body={id:'test-user',email:'test@example.com'};
  else if(u.pathname==='/rest/v1/rpc/get_my_access')body=mockAccess({name:'Chủ quán',role});
  else if(u.pathname==='/rest/v1/menu_items')body=menu;
  else if(u.pathname==='/rest/v1/restaurant_tables')body=tables.filter(t=>t.active);
  else if(u.pathname==='/rest/v1/table_sessions')body=sessions.filter(s=>!s.closed);
  else if(u.pathname==='/rest/v1/orders')body=sessions.flatMap(s=>s.orders.filter(o=>o.status==='cooking'&&o.kitchen_relevant).map(o=>({...o,table_sessions:{table_id:s.table_id,closed_at:s.closed?'2026-10-28':null,table_path:[s.table_id]}})));
  else if(u.pathname==='/rest/v1/rpc/submit_order'){
   const p=req.postDataJSON();if(p.p_table_id<0)return route.fulfill({status:400,json:{code:'P0001',message:'Bàn không hoạt động.'}});orderCalls.push(p);let s=sessions.find(s=>s.table_id===p.p_table_id&&!s.closed);if(!s){s={id:'session'+sessions.length,table_id:p.p_table_id,table_path:[p.p_table_id],orders:[]};sessions.push(s);}let o=s.orders.find(o=>o.request_id===p.p_request_id);
   if(!o){o={id:'order'+orderCalls.length,session_id:s.id,request_id:p.p_request_id,service_label:'',status:'cooking',kitchen_relevant:true,created_at:new Date().toISOString(),order_items:p.p_items.map((i,n)=>({...menu.find(m=>m.id===i.menu_item_id),id:`line${orderCalls.length}-${n}`,qty:i.qty,note:i.note,paid:false,bill_no:1}))};s.orders.push(o);}body=o.id;
  }
  else if(u.pathname==='/rest/v1/rpc/pay_bill'){
   const p=req.postDataJSON();payCalls.push(p);let b=bills.find(b=>b.request_id===p.p_request_id);
   if(!b){const s=sessions.find(s=>s.id===p.p_session_id),items=s.orders.flatMap(o=>o.order_items);assert.deepEqual(p.p_expected_item_ids.sort(),items.map(i=>i.id).sort());const total=items.reduce((n,i)=>n+i.qty*i.price,0);b={id:'bill'+bills.length,request_id:p.p_request_id,invoice_no:bills.length+1,table_no:s.table_id,service_label:tables.find(t=>t.id===s.table_id).name,bill_no:1,gross:total,discount:0,total,method:p.p_method,cash_received:total,change_due:0,paid_at:new Date().toISOString(),bill_items:structuredClone(items)};items.forEach(i=>i.paid=true);s.closed=true;bills.push(b);}
   body=b.id;if(lostPay){lostPay=false;return route.fulfill({status:503,json:{message:'Lost pay reply'}});}
  }
  else if(u.pathname==='/rest/v1/bills')body=u.searchParams.has('id')?bills.find(b=>'eq.'+b.id===u.searchParams.get('id')):bills;
  else if(u.pathname==='/rest/v1/rpc/complete_kitchen_order'){const p=req.postDataJSON();sessions.flatMap(s=>s.orders).find(o=>o.id===p.p_order_id).status='done';body=null;}
  else if(u.pathname==='/rest/v1/rpc/cancel_table_session'){const p=req.postDataJSON(),s=sessions.find(s=>s.id===p.p_session_id);s.closed=true;s.orders.forEach(o=>{o.kitchen_relevant=false;o.order_items.forEach(i=>i.cancelled_at=new Date().toISOString());});body=null;}
  else throw new Error('Unexpected '+u.pathname);
  await route.fulfill({status:200,json:body});
 });
 const page=await context.newPage();page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:5173');await page.getByLabel('Email',{exact:true}).fill('test@example.com');await page.getByLabel('Mật khẩu',{exact:true}).fill('fake-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();

 await page.getByRole('button',{name:/^Bàn 1 /}).waitFor();assert.equal(await page.locator('.table-card:visible').count(),13);
 await page.evaluate(()=>localStorage.setItem('goc-pho-pending-v1:test-user',JSON.stringify({requestId:'old-pending',tableId:-99,items:[{menu_item_id:'food',qty:1,note:'Không hành',expected_price:58000}]})));await page.reload();await page.getByRole('button',{name:'Thử gửi lại đơn này',exact:true}).click();await page.getByRole('alert').filter({hasText:'Đơn chưa được gửi vì bàn cũ đã ngừng hoạt động.'}).waitFor();assert.equal(await page.evaluate(()=>localStorage.getItem('goc-pho-pending-v1:test-user')),null);assert.equal(await page.getByRole('button',{name:'Thử gửi lại đơn này',exact:true}).count(),0);
 assert.equal(await page.getByRole('navigation',{name:'Loại phục vụ'}).count(),0);assert.equal(await page.getByRole('button',{name:'Mang về trống',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Tạo đơn mang về',exact:true}).count(),0);
 await page.getByRole('button',{name:/^Mang về /}).click();await page.getByRole('button',{name:'Thêm Bún riêu',exact:true}).click();await page.getByLabel('Ghi chú món',{exact:true}).fill('Không hành');await page.getByRole('button',{name:'Gửi bếp',exact:true}).click();await page.getByText('Đã lưu đơn Mang về.',{exact:false}).waitFor();assert.equal(orderCalls[0].p_table_id,13);
 await page.getByRole('button',{name:/^Bếp \(/}).click();await page.getByRole('heading',{name:'Mang về',exact:true}).waitFor();assert.match(await page.locator('.kitchen-card').innerText(),/Không hành/);
 await page.getByRole('button',{name:'Phục vụ',exact:true}).click();await page.getByRole('button',{name:'Thanh toán Mang về',exact:true}).click();const receipt=page.locator('.payment-dialog');await receipt.getByRole('button',{name:'Xác nhận thu tiền mặt',exact:true}).click();await receipt.getByRole('button',{name:'Thử lại cùng mã',exact:true}).waitFor();
 await page.reload();await page.getByRole('button',{name:'Thử lại cùng mã',exact:true}).click();await page.getByRole('heading',{name:'Hóa đơn đã thanh toán',exact:true}).waitFor();assert.match(await page.locator('.receipt').innerText(),/Mang về/);assert.equal(payCalls[0].p_request_id,payCalls[1].p_request_id);assert.equal(bills.length,1);await receipt.getByRole('button',{name:'Đóng',exact:true}).click();
 assert.equal(await page.locator('.table-card:visible').count(),13);await page.getByRole('button',{name:/^Mang về /}).click();await page.getByRole('button',{name:'Thêm Bún riêu',exact:true}).click();await page.getByRole('button',{name:'Gửi bếp',exact:true}).click();await page.getByText('Đã lưu đơn Mang về.',{exact:false}).waitFor();assert.equal(sessions.length,2);assert.notEqual(sessions[0].id,sessions[1].id);assert.equal(orderCalls[1].p_table_id,13);
 await page.getByRole('button',{name:'Thao tác bàn',exact:true}).click();await page.getByRole('button',{name:'Hủy cả Mang về',exact:true}).click();await page.getByRole('dialog',{name:'Xác nhận hủy Mang về',exact:true}).getByRole('button',{name:'Xác nhận hủy cả bàn',exact:true}).click();await page.getByText('Đã hủy các món chưa thanh toán của Mang về.',{exact:false}).waitFor();
 await page.getByRole('button',{name:'← Danh sách bàn',exact:true}).click();assert.equal(await page.locator('.table-card:visible').count(),13);assert.match(await page.getByRole('button',{name:/^Mang về /}).innerText(),/Trống/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'/workspace/work/fixed-takeaway-mobile.png',fullPage:true});assert.deepEqual(errors,[]);
 console.log('PASS: one fixed Mang về card among 13 tables; no separate channel/create/empty-card flow; normal sending/kitchen name, payment retry/receipt, next customer reuses same table, cancellation/reuse and mobile. Mock Supabase only.');
}finally{await browser.close();}
