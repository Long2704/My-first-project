import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
const context=await browser.newContext({viewport:{width:390,height:844}});
const items=[{id:'food',name:'Bún riêu truyền thống',price:58000,category:'bun',is_out:false},{id:'drink',name:'Trà đá',price:3000,category:'do_uong',is_out:false}];
let orders=[],lostResponse=false,attempts=[],cancelAttempts=[],audit=[];
await context.route('https://uiwzinyckukaqlbznnam.supabase.co/**',async route=>{
 const req=route.request(),u=new URL(req.url());let body;
 if(u.pathname==='/auth/v1/token')body={access_token:'test-access-token',refresh_token:'test-refresh-token',token_type:'bearer',expires_in:3600,user:{id:'test-user',email:'test@example.com',aud:'authenticated',role:'authenticated'}};
 else if(u.pathname==='/auth/v1/user')body={id:'test-user',email:'test@example.com'};
 else if(u.pathname==='/rest/v1/profiles')body={name:'Chủ quán kiểm thử',role:'chu'};
 else if(u.pathname==='/rest/v1/menu_items')body=items;
 else if(u.pathname==='/rest/v1/restaurant_tables')body=Array.from({length:12},(_,i)=>({id:i+1,name:`Bàn ${i+1}`}));
 else if(u.pathname==='/rest/v1/table_sessions')body=orders.length?[{id:'session1',table_id:1,orders:orders.map(o=>({...o,order_items:o.order_items.map(i=>cancelAttempts.length===1?{...i,cancelled_at:null,cancel_reason:null}:i)}))}]:[];
 else if(u.pathname==='/rest/v1/orders')body=orders.filter(o=>o.status==='cooking').map(o=>({...o,table_sessions:{table_id:1,closed_at:null}}));
 else if(u.pathname==='/rest/v1/audit_log')body=audit;
 else if(u.pathname==='/rest/v1/rpc/cancel_order_item'){
  const p=req.postDataJSON();cancelAttempts.push(p);
  const o=orders.find(o=>o.order_items.some(i=>i.id===p.p_item_id));const item=o.order_items.find(i=>i.id===p.p_item_id);
  if(!item.cancelled_at){item.cancelled_at=new Date().toISOString();item.cancel_reason=p.p_reason;audit.push({id:'audit1',type:'cancel_item',table_no:1,user_id:'test-user',created_at:item.cancelled_at,extra:{name:item.name,qty:item.qty,reason:p.p_reason}});}
  if(!o.order_items.some(i=>i.category!=='do_uong'&&!i.cancelled_at)){o.status='done';o.kitchen_relevant=false;}
  if(cancelAttempts.length===1)return route.fulfill({status:503,json:{message:'Lost cancellation response'}});
  body=null;
 }
 else if(u.pathname==='/rest/v1/rpc/submit_order'){
  const p=req.postDataJSON();attempts.push(p.p_request_id);
  if(!orders.some(o=>o.request_id===p.p_request_id))orders.push({id:`order${orders.length}`,request_id:p.p_request_id,session_id:'session1',status:p.p_items.some(i=>i.menu_item_id==='food')?'cooking':'done',kitchen_relevant:p.p_items.some(i=>i.menu_item_id==='food'),created_at:new Date().toISOString(),order_items:p.p_items.map((i,n)=>({...items.find(m=>m.id===i.menu_item_id),id:`line${orders.length}-${n}`,qty:i.qty,note:i.note,paid:false}))});
  if(lostResponse){lostResponse=false;return route.fulfill({status:503,json:{message:'Simulated lost acknowledgement'}});}
  body=orders.find(o=>o.request_id===p.p_request_id).id;
 }
 else if(u.pathname==='/rest/v1/rpc/complete_kitchen_order'){orders.find(o=>o.id===req.postDataJSON().p_order_id).status='done';body=null;}
 else throw new Error('Unexpected network '+u.pathname);
 await route.fulfill({status:200,json:body});
});
const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));

async function management(name){const control=page.locator('.management-menu');if(!await control.evaluate(e=>e.open))await control.locator('summary').click();await page.getByRole('button',{name,exact:true}).click();}
async function tableActions(){const control=page.locator('.table-operations');if(!await control.evaluate(e=>e.open))await control.locator('summary').click();}
await page.goto('http://localhost:5173');
await page.getByLabel('Email',{exact:true}).fill('test@example.com');await page.getByLabel('Mật khẩu',{exact:true}).fill('fake-password-for-mock-only');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
await page.getByRole('button',{name:/^Bàn 1 /}).waitFor();
assert.equal(await page.locator('.table-card').count(),12);
await page.getByRole('button',{name:/^Bàn 1 /}).click();
await page.getByRole('button',{name:'Thêm Bún riêu truyền thống',exact:true}).click();
await page.getByLabel('Ghi chú món').fill('Không hành');
await page.getByRole('button',{name:'Nước giải khát',exact:true}).click();await page.getByRole('button',{name:'Thêm Trà đá',exact:true}).click();
assert.match(await page.locator('footer').innerText(),/61\.000đ/);
await page.getByRole('button',{name:'Gửi bếp',exact:true}).click();
await page.getByText('Đã lưu đơn Bàn 1.',{exact:false}).waitFor();
await page.getByRole('button',{name:'Hủy Bún riêu truyền thống',exact:true}).click();
const confirm=page.getByRole('button',{name:'Xác nhận hủy món',exact:true});
assert.equal(await confirm.isDisabled(),false);assert.equal(await page.getByLabel('Lý do hủy',{exact:true}).count(),0);await page.getByRole('dialog').getByRole('button',{name:'Quay lại',exact:true}).click();assert.equal(cancelAttempts.length,0);await page.getByRole('button',{name:'Hủy Bún riêu truyền thống',exact:true}).click();
await confirm.click();
await page.getByText('Chưa xác nhận hủy:',{exact:false}).waitFor();
await confirm.click();
await page.getByText('Đã hủy',{exact:true}).waitFor();
assert.equal(cancelAttempts.length,2);assert.equal(cancelAttempts[0].p_item_id,cancelAttempts[1].p_item_id);
assert.match(await page.getByRole('heading',{name:/Đơn đã lưu/}).innerText(),/3\.000đ/);
await management('Nhật ký hoạt động');
await page.locator('.management-page:not([hidden])').getByText('1 × Bún riêu truyền thống',{exact:false}).waitFor();
await page.getByLabel('Loại hoạt động',{exact:true}).selectOption('cancel_item');
assert.equal(audit.length,1);
await page.getByRole('button',{name:/^Bếp \(/}).click();
await page.getByText('Chưa có món đang làm.',{exact:true}).waitFor();
assert.equal(errors.length,0,errors.join('\n'));
console.log('PASS: mobile modal cancellation without reason, dismiss before sending, lost response retry same item, remaining total, removed kitchen item and audit filter. Mock Supabase only.');
}finally{await browser.close();}
