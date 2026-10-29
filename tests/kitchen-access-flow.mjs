import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mockAccess} from './support/access.mjs';

const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try {
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const menu=[{id:'food',name:'Bún riêu thử',price:10000,category:'bun',is_out:false},{id:'drink',name:'Trà thử',price:3000,category:'do_uong',is_out:false}];
 const tables=[{id:1,name:'Bàn thử 1'},{id:2,name:'Bàn thử 2'}];
 const orders=[],bills=[],payments=[],completions=[];
 let active=true,role='bep',lostPayment=true,closed=false;
 const user='kitchen-test-user';
 const errors=[];
 await context.route('https://uiwzinyckukaqlbznnam.supabase.co/**',async route=>{
  const req=route.request(),u=new URL(req.url());let body;
  if(u.pathname==='/auth/v1/token')body={access_token:'mock-access',refresh_token:'mock-refresh',token_type:'bearer',expires_in:3600,user:{id:user,email:'kitchen@example.test',aud:'authenticated',role:'authenticated'}};
  else if(u.pathname==='/auth/v1/user')body={id:user,email:'kitchen@example.test'};
  else if(u.pathname==='/rest/v1/rpc/get_my_access')body=mockAccess({name:'Bếp thử nghiệm',role,is_active:active});
  else if(u.pathname==='/rest/v1/menu_items')body=active?menu:[];
  else if(u.pathname==='/rest/v1/restaurant_tables')body=active?tables:[];
  else if(u.pathname==='/rest/v1/table_sessions')body=active&&!closed&&orders.length?[{id:'session1',table_id:1,orders}]:[];
  else if(u.pathname==='/rest/v1/orders')body=active?orders.filter(o=>o.status==='cooking').map(o=>({...o,table_sessions:{table_id:1,closed_at:closed?new Date().toISOString():null}})):[];
  else if(u.pathname==='/rest/v1/rpc/submit_order'){
   assert.equal(active,true);const p=req.postDataJSON();
   let order=orders.find(o=>o.request_id===p.p_request_id);
   if(!order){order={id:'order1',request_id:p.p_request_id,session_id:'session1',status:'cooking',kitchen_relevant:true,created_at:new Date().toISOString(),order_items:p.p_items.map((i,n)=>({...menu.find(m=>m.id===i.menu_item_id),id:'line'+n,qty:i.qty,note:i.note,paid:false,bill_no:1,cancelled_at:null}))};orders.push(order);}
   body=order.id;
  }
  else if(u.pathname==='/rest/v1/rpc/pay_bill'){
   assert.equal(active,true);const p=req.postDataJSON();payments.push(p);
   assert.equal(p.p_discount_value,0);assert.equal(p.p_method,'cash');
   let bill=bills.find(b=>b.request_id===p.p_request_id);
   if(!bill){
    const lines=orders.flatMap(o=>o.order_items);
    assert.deepEqual([...p.p_expected_item_ids].sort(),lines.map(i=>i.id).sort());
    const total=lines.reduce((s,i)=>s+i.price*i.qty,0);
    bill={id:'bill1',invoice_no:1,request_id:p.p_request_id,table_no:1,bill_no:1,gross:total,discount:0,total,method:p.p_method,cash_received:p.p_cash_received,change_due:p.p_cash_received-total,paid_at:new Date().toISOString(),bill_items:structuredClone(lines)};
    bills.push(bill);closed=true;lines.forEach(i=>i.paid=true);
   }
   if(lostPayment){lostPayment=false;return route.fulfill({status:503,json:{message:'Mất phản hồi giả lập'}});}
   body=bill.id;
  }
  else if(u.pathname==='/rest/v1/bills')body=u.searchParams.has('id')?bills.find(b=>'eq.'+b.id===u.searchParams.get('id')):bills;
  else if(u.pathname==='/rest/v1/rpc/complete_kitchen_order'){
   assert.equal(active,true);const id=req.postDataJSON().p_order_id;completions.push(id);orders.find(o=>o.id===id).status='done';body=null;
  }
  else throw new Error('Unexpected mock request '+u.pathname);
  await route.fulfill({status:200,json:body});
 });
 const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:5173');
 await page.getByLabel('Email',{exact:true}).fill('kitchen@example.test');await page.getByLabel('Mật khẩu',{exact:true}).fill('fake-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
 await page.getByRole('heading',{name:'Khu vực bếp',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Báo cáo doanh thu',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Quản lý thực đơn',exact:true}).count(),0);
 assert.equal(await page.locator('.management-menu').count(),0);
 await page.getByRole('button',{name:'Phục vụ',exact:true}).click();
 await page.getByRole('button',{name:/^Bàn thử 1 /}).click();
 await page.getByRole('button',{name:'Thêm Bún riêu thử',exact:true}).click();
 await page.getByRole('button',{name:'Nước giải khát',exact:true}).click();
 await page.getByRole('button',{name:'Thêm Trà thử',exact:true}).click();
 await page.getByRole('button',{name:'Gửi bếp',exact:true}).click();
 await page.getByText('Đã lưu đơn Bàn thử 1.',{exact:false}).waitFor();
 assert.equal(orders.length,1);assert.equal(orders[0].order_items.length,2);
 await page.getByRole('button',{name:'Thao tác bàn',exact:true}).click();
 await page.getByRole('button',{name:'Chuyển Bàn thử 1',exact:true}).waitFor();
 await page.getByRole('button',{name:'Tách/gộp bill Bàn thử 1',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Hủy cả bàn',exact:true}).count(),0);
 await page.getByRole('button',{name:'Đóng thao tác bàn',exact:true}).click();
 if(process.env.POS_SCREENSHOT_DIR)await page.screenshot({path:process.env.POS_SCREENSHOT_DIR+'/kitchen-service-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Thanh toán Bàn thử 1',exact:true}).click();
 const dialog=page.locator('.payment-dialog');
 assert.equal(await dialog.getByLabel('Giảm giá',{exact:true}).count(),0);
 await dialog.getByLabel('Tiền khách đưa',{exact:true}).fill('20000');
 await dialog.getByRole('button',{name:'Xác nhận thu tiền mặt',exact:true}).click();
 await dialog.getByRole('button',{name:'Thử lại cùng mã',exact:true}).waitFor();
 assert.equal(bills.length,1);
 await dialog.getByRole('button',{name:'Đóng',exact:true}).click();
 active=false;await page.getByRole('button',{name:'Đồng bộ',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'Tài khoản đã bị khóa.'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Phục vụ',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Đăng xuất',exact:true}).isEnabled(),true);
 assert.ok(await page.evaluate(()=>localStorage.getItem('goc-pho-payment-v1:kitchen-test-user')));
 active=true;await page.getByRole('button',{name:'Thử tải lại',exact:true}).click();
 await page.getByRole('button',{name:'Phục vụ',exact:true}).click();
 await page.getByRole('button',{name:'Thử lại cùng mã',exact:true}).click();
 await dialog.getByRole('heading',{name:'Hóa đơn đã thanh toán',exact:true}).waitFor();
 assert.equal(payments.length,2);assert.equal(payments[0].p_request_id,payments[1].p_request_id);assert.equal(bills.length,1);
 assert.match(await dialog.innerText(),/13\.000đ/);assert.match(await dialog.innerText(),/7\.000đ/);
 assert.equal(await page.evaluate(()=>localStorage.getItem('goc-pho-payment-v1:kitchen-test-user')),null);
 await dialog.getByRole('button',{name:'Đóng',exact:true}).click();
 await page.getByRole('button',{name:/^Bếp \(/}).click();
 const card=page.locator('.kitchen-card').first();await card.waitFor();
 assert.match(await card.innerText(),/Bún riêu thử/);assert.doesNotMatch(await card.innerText(),/Trà thử/);
 const box=await card.boundingBox();const x=box.x+30,y=box.y+35;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+160,y,{steps:10});await page.mouse.up();
 await page.getByText('Chưa có món đang làm.',{exact:true}).waitFor();assert.equal(completions.length,1);
 await page.getByRole('button',{name:'Hóa đơn của tôi',exact:true}).click();
 await page.getByRole('heading',{name:'30 hóa đơn gần nhất của tôi',exact:true}).waitFor();
 await page.getByRole('button',{name:/^#1 /}).click();
 await dialog.getByRole('heading',{name:'Hóa đơn đã thanh toán',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);
 console.log('ĐẠT UI: Kitchen mở Phục vụ, gọi món/nước, thao tác bàn, thanh toán không giảm giá, mất phản hồi/khóa/mở khóa giữ mã cũ, hóa đơn riêng và vuốt bếp. Mạng giả lập, không gọi Supabase thật.');
} finally { await browser.close(); }
