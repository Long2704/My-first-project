import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mockAccess} from './support/access.mjs';
import {groupSavedOrders} from '../src/pos/saved-order-groups.ts';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 for(const role of ['phuc_vu','bep','chu']){
  const context=await browser.newContext({viewport:{width:390,height:844}}),calls=[];let lost=role==='phuc_vu',failSync=role==='bep';
  const menu=[{id:'food',name:'Bún riêu truyền thống',price:58000,category:'bun',is_out:false}];
  const original={id:'old-line',menu_item_id:'food',name:menu[0].name,price:58000,qty:1,category:'bun',note:'Không hành',paid:false,bill_no:1,cancelled_at:null};
  const paid={...original,id:'paid-line',paid:true},cancelled={...original,id:'cancelled-line',cancelled_at:'2026-01-01'};
  const orders=[{id:'old-order',request_id:'original',session_id:'session',status:'done',kitchen_relevant:true,created_at:'2026-01-01T00:00:00Z',order_items:[original,paid,cancelled]}];
  const originalSnapshot=structuredClone(orders[0]);
  await context.route('https://uiwzinyckukaqlbznnam.supabase.co/**',async route=>{
   const request=route.request(),url=new URL(request.url()),path=url.pathname;let body;
   if(path==='/auth/v1/token')body={access_token:'mock',refresh_token:'refresh',token_type:'bearer',expires_in:3600,user:{id:'staff',email:'staff@example.test',aud:'authenticated',role:'authenticated'}};
   else if(path==='/auth/v1/user')body={id:'staff',email:'staff@example.test'};
   else if(path.endsWith('/get_my_access'))body=mockAccess({name:'Nhân viên',role});
   else if(path==='/rest/v1/menu_items')body=menu;
   else if(path==='/rest/v1/restaurant_tables')body=[{id:1,name:'Bàn 1'}];
   else if(path==='/rest/v1/table_sessions'){if(failSync&&orders.length===2){return route.fulfill({status:503,json:{message:'Sync reply lost after accepted submit'}});}assert.ok(url.searchParams.get('select').includes('menu_item_id'));body=[{id:'session',table_id:1,orders}];}
   else if(path==='/rest/v1/orders')body=orders.filter(order=>order.status==='cooking').map(order=>({...order,table_sessions:{table_id:1,closed_at:null}}));
   else if(path.endsWith('/submit_order')){
    const payload=request.postDataJSON();calls.push(payload);if(role==='bep'&&calls.length>1)failSync=false;assert.equal(payload.p_items.length,1);assert.equal(payload.p_items[0].qty,1);assert.equal(payload.p_items[0].menu_item_id,'food');
    let order=orders.find(order=>order.request_id===payload.p_request_id);
    if(!order){order={id:'new-'+orders.length,request_id:payload.p_request_id,session_id:'session',status:'cooking',kitchen_relevant:true,created_at:'2026-01-01T00:00:0'+orders.length+'Z',order_items:payload.p_items.map(item=>({id:'new-line-'+orders.length,menu_item_id:item.menu_item_id,name:menu[0].name,price:menu[0].price,qty:item.qty,note:item.note,category:'bun',paid:false,bill_no:1,cancelled_at:null}))};orders.push(order);}
    if(lost){lost=false;return route.fulfill({status:503,json:{message:'Lost response'}});}body=order.id;
   }else throw Error('Unexpected endpoint '+path);
   await route.fulfill({json:body});
  });
  const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://localhost:5173');await page.getByLabel('Tên đăng nhập',{exact:true}).fill('staff@example.test');await page.getByLabel('Mật khẩu',{exact:true}).fill('mock-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.getByRole('button',{name:'Phục vụ',exact:true}).click();await page.getByRole('button',{name:/^Bàn 1 /}).click();
  const row=page.locator('.pos-saved-line[data-product-id="food"]'),plus=row.getByRole('button',{name:'Thêm Bún riêu truyền thống',exact:true}),minus=row.getByRole('button',{name:'Bớt Bún riêu truyền thống',exact:true}),qty=row.locator('output');
  await row.waitFor();assert.equal(await qty.innerText(),'1');assert.equal(await minus.isDisabled(),true);assert.equal(await page.locator('.is-cancelled .pos-quantity-control').count(),0);
  await plus.click();assert.equal(await qty.innerText(),'2');await page.getByRole('button',{name:'Gửi bếp',exact:true}).waitFor();assert.match(await page.locator('.pos-total-line').innerText(),/116\.000đ/);
  await minus.click();assert.equal(await qty.innerText(),'1');assert.equal(await minus.isDisabled(),true);assert.equal(await page.getByRole('dialog',{name:'Xóa món khỏi đơn?',exact:true}).count(),0);assert.equal(calls.length,0);await page.getByRole('button',{name:'Thanh toán',exact:true}).waitFor();
  await plus.click();await row.getByLabel('Ghi chú món thêm',{exact:true}).fill('Ít bún');assert.equal(await page.locator('.pos-draft-row').count(),0);if(role==='phuc_vu')await page.screenshot({path:'/workspace/artifacts/reorder-extra-390.png'});await page.getByRole('button',{name:'Gửi bếp',exact:true}).click();
  if(role==='phuc_vu'){
   await page.locator('.pos-workspace-feedback').getByRole('alert').filter({hasText:'Chưa xác nhận'}).waitFor();await page.getByRole('button',{name:'Quay lại danh sách bàn',exact:true}).click();await page.getByRole('button',{name:'Đồng bộ',exact:true}).click();await page.getByRole('button',{name:/^Bàn 1 /}).click();assert.equal(await qty.innerText(),'2');assert.match(await page.locator('.pos-total-line').innerText(),/116\.000đ/);assert.equal(await plus.isDisabled(),true);await page.reload();await page.getByRole('button',{name:'Thử gửi lại đơn này',exact:true}).click();await page.getByRole('status').filter({hasText:'Đã lưu đơn'}).waitFor();await page.getByRole('button',{name:/^Bàn 1 /}).click();assert.equal(calls[0].p_request_id,calls[1].p_request_id);
  }else if(role==='bep'){await page.locator('.pos-workspace-feedback').getByRole('alert').filter({hasText:'Đơn đã được lưu nhưng chưa đồng bộ'}).waitFor();assert.equal(await qty.innerText(),'2');await page.getByRole('button',{name:'Thử gửi lại',exact:true}).click();await page.locator('.pos-workspace-feedback').getByRole('status').filter({hasText:'Đã lưu đơn'}).waitFor();assert.equal(calls[0].p_request_id,calls[1].p_request_id);}else await page.locator('.pos-workspace-feedback').getByRole('status').filter({hasText:'Đã lưu đơn'}).waitFor();
  assert.equal(orders.length,2);assert.equal(await row.count(),1);assert.equal(await qty.innerText(),'2');assert.equal(await minus.isDisabled(),true);assert.equal(calls[0].p_items[0].note,'Ít bún');assert.deepEqual(orders[0],originalSnapshot);
  await row.getByRole('button',{name:'Chi tiết lượt gọi Bún riêu truyền thống',exact:true}).click();assert.equal(await row.locator('.pos-saved-source').count(),2);assert.equal(await row.locator('.cancel-line-button').count(),role==='chu'?2:0);await row.getByRole('button',{name:'Chi tiết lượt gọi Bún riêu truyền thống',exact:true}).click();
  menu[0].price=65000;await page.getByRole('button',{name:'Quay lại danh sách bàn',exact:true}).click();await page.getByRole('button',{name:'Đồng bộ',exact:true}).click();await page.getByRole('button',{name:/^Bàn 1 /}).click();await plus.click();assert.equal(await qty.innerText(),'3');assert.match(await page.locator('.pos-total-line').innerText(),/181\.000đ/);await page.getByRole('button',{name:'Gửi bếp',exact:true}).click();await page.locator('.pos-workspace-feedback').getByRole('status').filter({hasText:'Đã lưu đơn'}).waitFor();assert.equal(calls.at(-1).p_items[0].expected_price,65000);assert.equal(orders.length,3);assert.equal(await qty.innerText(),'3');assert.deepEqual(orders[0],originalSnapshot);
  await plus.click();menu[0].is_out=true;await page.getByRole('button',{name:'Quay lại danh sách bàn',exact:true}).click();await page.getByRole('button',{name:'Đồng bộ',exact:true}).click();await page.getByRole('button',{name:/^Bàn 1 /}).click();assert.equal(await plus.isDisabled(),true);assert.equal(await minus.isEnabled(),true);await minus.click();assert.equal(await qty.innerText(),'3');assert.equal(await minus.isDisabled(),true);
  for(const width of [375,390,414,1440]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await page.setViewportSize({width:390,height:844});if(role==='phuc_vu')await page.screenshot({path:'/workspace/artifacts/reorder-saved-390.png'});
  await page.getByRole('button',{name:'Quay lại danh sách bàn',exact:true}).click();await page.getByRole('button',{name:/^Bếp \(/}).click();assert.equal(await page.locator('.kitchen-card').count(),2);for(const card of await page.locator('.kitchen-card').all())assert.match(await card.innerText(),/1 × Bún riêu truyền thống/);assert.deepEqual(errors,[]);await context.close();
 }
 const a={id:'1',menu_item_id:'a',name:'Cùng tên',price:100,qty:1,category:'bun',note:'',paid:false,bill_no:1};
 const grouped=groupSavedOrders([{id:'x',request_id:'x',session_id:'s',status:'done',kitchen_relevant:true,created_at:'now',order_items:[a,{...a,id:'2',menu_item_id:'b'},{...a,id:'3',menu_item_id:null},{...a,id:'4',menu_item_id:null}]}]);assert.equal(grouped.groups.length,4,'Never match products by name or attach missing catalog IDs');
 console.log('ĐẠT gọi thêm từ món đã gửi: 3 vai trò, − chỉ bỏ phần thêm, gộp đúng menu ID, ghi chú mới riêng, bếp chỉ nhận delta=1, retry/reload/ACK không cộng trùng, giá mới/giá cũ, hết món, lịch sử paid/cancel, quyền hủy, 375/390/414/desktop. API giả.');
}finally{await browser.close();}
