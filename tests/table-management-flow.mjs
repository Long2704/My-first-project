import {mockAccess} from './support/access.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const menu=[{id:'food',name:'Bún riêu',price:58000,category:'bun',is_out:false},{id:'drink',name:'Trà đá',price:3000,category:'do_uong',is_out:false}];
 const tables=Array.from({length:13},(_,i)=>({id:i+1,name:i===12?'Mang về':`Bàn ${i+1}`,active:true})),sessions=[],bills=[],orderCalls=[],payCalls=[];
 let role='chu',lostPay=true,lostSave=true;const saves=[],saved=new Map();tables.forEach(t=>{t.version=1;t.busy=t.id===1;});
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
  else if(u.pathname==='/rest/v1/rpc/list_table_management')body=tables.map(t=>({id:t.id,name:t.name,is_active:t.active,version:t.version,busy:t.busy}));
  else if(u.pathname==='/rest/v1/rpc/save_restaurant_table'){
   const p=req.postDataJSON();saves.push(p);let id=saved.get(p.p_request_id);
   if(!id){
    const t=tables.find(t=>t.id===p.p_table_id);
    if(t&&t.version!==p.p_expected_version)return route.fulfill({status:400,json:{code:'P0001',message:'Bàn đã được sửa ở nơi khác. Tải lại danh sách và kiểm tra lại.'}});
    if(t){t.name=p.p_name;t.active=p.p_is_active;t.version++;id=t.id;}
    else{id=Math.max(...tables.map(t=>t.id))+1;tables.push({id,name:p.p_name,active:p.p_is_active,version:1,busy:false});}
    saved.set(p.p_request_id,id);
   }
   body=id;if(lostSave){lostSave=false;return route.fulfill({status:503,json:{message:'Lost save response'}});}
  }
  else if(u.pathname==='/rest/v1/bills')body=u.searchParams.has('id')?bills.find(b=>'eq.'+b.id===u.searchParams.get('id')):bills;
  else if(u.pathname==='/rest/v1/rpc/complete_kitchen_order'){const p=req.postDataJSON();sessions.flatMap(s=>s.orders).find(o=>o.id===p.p_order_id).status='done';body=null;}
  else if(u.pathname==='/rest/v1/rpc/cancel_table_session'){const p=req.postDataJSON(),s=sessions.find(s=>s.id===p.p_session_id);s.closed=true;s.orders.forEach(o=>{o.kitchen_relevant=false;o.order_items.forEach(i=>i.cancelled_at=new Date().toISOString());});body=null;}
  else throw new Error('Unexpected '+u.pathname);
  await route.fulfill({status:200,json:body});
 });
 const page=await context.newPage();page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:5173');await page.getByLabel('Email',{exact:true}).fill('test@example.com');await page.getByLabel('Mật khẩu',{exact:true}).fill('fake-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();


 await page.getByRole('button',{name:/^Bàn 1 /}).waitFor();
 async function management(){const nav=page.locator('.management-menu');if(!await nav.evaluate(e=>e.open))await nav.locator('summary').click();await page.getByRole('button',{name:'Quản lý bàn',exact:true}).click();await page.getByRole('button',{name:'Sửa Bàn 1',exact:true}).waitFor();}
 await management();assert.equal(await page.getByRole('button',{name:'Sửa Bàn 1',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Thêm bàn',exact:true}).click();await page.getByLabel('Tên bàn',{exact:true}).fill('Sân trước');await page.getByRole('button',{name:'Lưu bàn',exact:true}).click();await page.getByRole('button',{name:'Thử lại cùng mã cập nhật bàn',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Đăng xuất',exact:true}).isDisabled(),true);
 await page.reload();await page.getByRole('button',{name:'Mở quản lý bàn',exact:true}).click();await page.getByRole('button',{name:'Thử lại cùng mã cập nhật bàn',exact:true}).click();await page.getByText('Đã lưu Sân trước. Danh sách bàn phục vụ đã cập nhật.',{exact:true}).waitFor();assert.deepEqual(saves[0],saves[1]);assert.equal(tables.filter(t=>t.name==='Sân trước').length,1);
 await page.getByRole('button',{name:'Phục vụ',exact:true}).click();await page.getByRole('button',{name:/^Sân trước /}).waitFor();assert.equal(await page.locator('.table-card:visible').count(),14);
 await management();await page.getByRole('button',{name:'Sửa Sân trước',exact:true}).click();await page.getByLabel('Tên bàn',{exact:true}).fill('Sân sau');await page.getByRole('button',{name:'Lưu bàn',exact:true}).click();await page.getByText('Đã lưu Sân sau. Danh sách bàn phục vụ đã cập nhật.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Sửa Sân sau',exact:true}).click();await page.getByLabel('Đang sử dụng',{exact:true}).uncheck();await page.getByRole('button',{name:'Lưu bàn',exact:true}).click();await page.getByRole('button',{name:'Sửa Sân sau',exact:true}).waitFor();await page.getByRole('button',{name:'Phục vụ',exact:true}).click();assert.equal(await page.getByRole('button',{name:/^Sân sau /}).count(),0);
 await management();await page.getByRole('button',{name:'Sửa Sân sau',exact:true}).click();await page.getByLabel('Đang sử dụng',{exact:true}).check();await page.getByRole('button',{name:'Lưu bàn',exact:true}).click();await page.getByText('Đã lưu Sân sau. Danh sách bàn phục vụ đã cập nhật.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Sửa Sân sau',exact:true}).click();tables.find(t=>t.name==='Sân sau').version++;await page.getByLabel('Tên bàn',{exact:true}).fill('Tên cũ');await page.getByRole('button',{name:'Lưu bàn',exact:true}).click();await page.getByRole('alert').filter({hasText:'Bàn đã được sửa ở nơi khác.'}).waitFor();assert.equal(await page.getByRole('button',{name:'Thử lại cùng mã cập nhật bàn',exact:true}).count(),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'/workspace/work/table-management-mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'/workspace/work/table-management-desktop.png',fullPage:true});
 role='phuc_vu';await page.reload();await page.getByRole('button',{name:/^Bàn 1 /}).waitFor();assert.equal(await page.getByRole('button',{name:'Quản lý bàn',exact:true}).count(),0);assert.deepEqual(errors,[]);
 console.log('PASS: owner management menu, busy-table disabled, add lost response/reload same-request retry, no duplicate, immediate service refresh, rename/deactivate/reactivate, stale edit rejection, mobile width and waiter has no table management. Mock Supabase only.');
}finally{await browser.close();}
