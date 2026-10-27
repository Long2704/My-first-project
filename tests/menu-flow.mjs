import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
const context=await browser.newContext({viewport:{width:390,height:844}});
const menu=[{id:'food',name:'Bún riêu truyền thống',price:58000,category:'bun',is_out:false},{id:'drink',name:'Trà đá',price:3000,category:'do_uong',is_out:false}];
const order=(table,id)=>({id:'order'+id,session_id:'s'+table,request_id:'req'+id,status:'cooking',kitchen_relevant:true,created_at:new Date().toISOString(),order_items:menu.map((m,n)=>({...m,id:`line${id}-${n}`,qty:1,note:n?'':'Không hành',paid:false,bill_no:1}))});
let sessions=[{id:'s1',table_id:1,orders:[order(1,1)]},{id:'s2',table_id:2,orders:[order(2,2)]},{id:'s3',table_id:3,orders:[order(3,3)]}];
let bills=[],attempts=[],lostResponse=true,receiptUnavailable=false,role='chu',stale=false,menuSaves=[],applied=new Set(),audit=[],conflict=false,priceRejected=false;
menu.forEach((m,i)=>Object.assign(m,{is_active:true,version:1,sort:i}));
await context.route('https://uiwzinyckukaqlbznnam.supabase.co/**',async route=>{
 const req=route.request(),u=new URL(req.url());let body;
 if(u.pathname==='/auth/v1/token')body={access_token:'test-access-token',refresh_token:'test-refresh-token',token_type:'bearer',expires_in:3600,user:{id:'payment-test-user',email:'test@example.com',aud:'authenticated',role:'authenticated'}};
 else if(u.pathname==='/auth/v1/user')body={id:'payment-test-user',email:'test@example.com'};
 else if(u.pathname==='/rest/v1/profiles')body={name:'Chủ quán kiểm thử',role};
 else if(u.pathname==='/rest/v1/menu_items')body=menu.filter(m=>m.is_active);
 else if(u.pathname==='/rest/v1/restaurant_tables')body=Array.from({length:12},(_,i)=>({id:i+1,name:`Bàn ${i+1}`}));
 else if(u.pathname==='/rest/v1/table_sessions')body=sessions.filter(s=>!s.closed);
 else if(u.pathname==='/rest/v1/orders')body=sessions.flatMap(s=>s.orders.filter(o=>o.status==='cooking').map(o=>({...o,table_sessions:{table_id:s.table_id,closed_at:s.closed?'2026-10-27':null}})));
 else if(u.pathname==='/rest/v1/audit_log')body=audit;
 else if(u.pathname==='/rest/v1/rpc/list_menu_management')body=menu;
 else if(u.pathname==='/rest/v1/rpc/save_menu_item'){
  const p=req.postDataJSON();menuSaves.push(p);
  if(conflict){conflict=false;return route.fulfill({status:400,json:{code:'P0001',message:'Món đã được cập nhật ở nơi khác. Tải lại thực đơn rồi kiểm tra lại.'}});}
  if(!applied.has(p.p_request_id)){
   const old=menu.find(m=>m.id===p.p_item_id);const item={id:p.p_item_id,name:p.p_name,price:p.p_price,category:p.p_category,is_active:p.p_is_active,is_out:p.p_is_out,sort:p.p_sort,version:(old?.version??0)+1};
   if(old)Object.assign(old,item);else menu.push(item);applied.add(p.p_request_id);
   audit.push({id:'audit'+audit.length,type:'menu_update',table_no:null,user_id:'payment-test-user',created_at:new Date().toISOString(),extra:{action:old?'update':'create',after:item}});
  }
  if(menuSaves.length===1)return route.fulfill({status:503,json:{message:'Lost menu acknowledgement'}});
  body=p.p_item_id;
 }
 else if(u.pathname==='/rest/v1/rpc/submit_order'){
  const p=req.postDataJSON();assert.equal(typeof p.p_items[0].expected_price,'number');priceRejected=true;
  return route.fulfill({status:400,json:{code:'P0001',message:'Giá món đã thay đổi. Kiểm tra thực đơn trước khi gửi lại.'}});
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
await page.goto('http://localhost:5173');await page.getByLabel('Email',{exact:true}).fill('test@example.com');await page.getByLabel('Mật khẩu',{exact:true}).fill('fake-test-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
await page.getByRole('button',{name:'Quản lý thực đơn',exact:true}).click();await page.getByRole('button',{name:'Thêm món mới',exact:true}).click();
await page.getByLabel('Tên món',{exact:true}).fill('Nước sâm');await page.getByLabel('Giá bán (đồng)',{exact:true}).fill('-1');
const save=page.getByRole('button',{name:'Lưu thực đơn',exact:true});assert.equal(await save.isDisabled(),true);
await page.getByLabel('Giá bán (đồng)',{exact:true}).fill('15000');await page.getByLabel('Nhóm món',{exact:true}).selectOption('do_uong');await save.click();
await page.getByRole('button',{name:'Thử lại cùng mã cập nhật',exact:true}).waitFor();
assert.equal(await page.getByRole('button',{name:'Đăng xuất',exact:true}).isDisabled(),true);
await page.reload();await page.getByRole('button',{name:'Thử lại cùng mã cập nhật',exact:true}).click();
await page.getByText('Đã lưu thực đơn.',{exact:false}).waitFor();assert.equal(menuSaves.length,2);assert.equal(menuSaves[0].p_request_id,menuSaves[1].p_request_id);assert.equal(menu.filter(m=>m.name==='Nước sâm').length,1);
await page.getByRole('button',{name:'Sửa Bún riêu truyền thống',exact:true}).click();await page.getByLabel('Giá bán (đồng)',{exact:true}).fill('62000');await save.click();
await page.getByText('Đã lưu thực đơn.',{exact:false}).waitFor();assert.equal(menu[0].price,62000);
await page.getByRole('button',{name:'Sửa Bún riêu truyền thống',exact:true}).click();await page.getByLabel('Hết món tạm thời',{exact:true}).check();await save.click();await page.getByText('Đã lưu thực đơn.',{exact:false}).waitFor();
await page.getByRole('button',{name:/^Bàn 1 /}).click();assert.equal(await page.getByRole('button',{name:'Thêm Bún riêu truyền thống',exact:true}).count(),0);
// Giá của đơn đã lưu không đổi sau sửa menu.
assert.match(await page.getByRole('heading',{name:/Đơn đã lưu/}).innerText(),/61\.000đ/);
await page.getByRole('button',{name:'Sửa Bún riêu truyền thống',exact:true}).click();await page.getByLabel('Hết món tạm thời',{exact:true}).uncheck();await page.getByLabel('Đang bán',{exact:true}).uncheck();await save.click();await page.getByText('Đã lưu thực đơn.',{exact:false}).waitFor();assert.equal(menu[0].is_active,false);
await page.getByRole('button',{name:'Sửa Bún riêu truyền thống',exact:true}).click();await page.getByLabel('Đang bán',{exact:true}).check();conflict=true;await save.click();
await page.getByText('Món đã được cập nhật ở nơi khác.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Thử lại cùng mã cập nhật',exact:true}).count(),0);
await page.getByRole('button',{name:'Sửa Bún riêu truyền thống',exact:true}).click();await page.getByLabel('Đang bán',{exact:true}).check();await save.click();await page.getByText('Đã lưu thực đơn.',{exact:false}).waitFor();
await page.getByRole('button',{name:'Thêm Bún riêu truyền thống',exact:true}).click();
await page.getByRole('button',{name:'Gửi bếp',exact:true}).click();await page.getByText('Đơn chưa được lưu:',{exact:false}).waitFor();assert.equal(priceRejected,true);assert.equal(await page.getByRole('button',{name:'Thử gửi lại đơn này',exact:true}).count(),0);
assert.equal(await page.evaluate(()=>localStorage.getItem('goc-pho-pending-v1:payment-test-user')),null);
await page.getByRole('button',{name:'Xóa chọn',exact:true}).click();
// Menu thay đổi ở thiết bị khác: đồng bộ phải khóa giỏ chứa món hết.
await page.getByRole('button',{name:'Thêm Bún riêu truyền thống',exact:true}).click();menu[0].is_out=true;await page.getByRole('button',{name:'Đồng bộ',exact:true}).click();await page.getByText('Có món đang chọn đã hết hoặc ngừng bán.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Gửi bếp',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'Xóa chọn',exact:true}).click();
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
role='thu_ngan';await page.reload();await page.getByRole('button',{name:/^Bàn 1 /}).waitFor();assert.equal(await page.getByRole('button',{name:'Quản lý thực đơn',exact:true}).count(),0);
assert.deepEqual(errors,[]);console.log('PASS: menu create/edit validation, durable retry/reload, price/out/stopped/reactivate, stale update rejection, preserved saved order, stale price rejection/recovery, live menu sync, mobile and owner-only controls. Mock Supabase only.');
}finally{await browser.close();}
