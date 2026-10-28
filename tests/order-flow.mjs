import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
const context=await browser.newContext({viewport:{width:390,height:844}});
const items=[{id:'food',name:'Bún riêu truyền thống',price:58000,category:'bun',is_out:false},{id:'drink',name:'Trà đá',price:3000,category:'do_uong',is_out:false}];
let orders=[],lostResponse=true,attempts=[];
await context.route('https://uiwzinyckukaqlbznnam.supabase.co/**',async route=>{
 const req=route.request(),u=new URL(req.url());let body;
 if(u.pathname==='/auth/v1/token')body={access_token:'test-access-token',refresh_token:'test-refresh-token',token_type:'bearer',expires_in:3600,user:{id:'test-user',email:'test@example.com',aud:'authenticated',role:'authenticated'}};
 else if(u.pathname==='/auth/v1/user')body={id:'test-user',email:'test@example.com'};
 else if(u.pathname==='/rest/v1/profiles')body={name:'Chủ quán kiểm thử',role:'chu'};
 else if(u.pathname==='/rest/v1/menu_items')body=items;
 else if(u.pathname==='/rest/v1/restaurant_tables')body=Array.from({length:12},(_,i)=>({id:i+1,name:`Bàn ${i+1}`}));
 else if(u.pathname==='/rest/v1/table_sessions')body=orders.length?[{id:'session1',table_id:1,orders}]:[];
 else if(u.pathname==='/rest/v1/orders')body=orders.filter(o=>o.status==='cooking').map(o=>({...o,table_sessions:{table_id:1,closed_at:null}}));
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
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));

async function management(name){const control=page.locator('.management-menu');if(!await control.evaluate(e=>e.open))await control.locator('summary').click();await page.getByRole('button',{name,exact:true}).click();}
async function tableActions(){const control=page.locator('.table-operations');if(!await control.evaluate(e=>e.open))await control.locator('summary').click();}
async function openOrderMenu(){const add=page.getByRole('button',{name:'Thêm món',exact:true});if(await add.isVisible())await add.click();}
await page.goto('http://localhost:5173');
await page.getByLabel('Email',{exact:true}).fill('test@example.com');await page.getByLabel('Mật khẩu',{exact:true}).fill('fake-password-for-mock-only');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
await page.getByRole('button',{name:/^Bàn 1 /}).waitFor();
assert.equal(await page.locator('.table-card').count(),12);
await page.getByRole('button',{name:/^Bàn 1 /}).click();
await openOrderMenu();await page.getByRole('button',{name:'Thêm Bún riêu truyền thống',exact:true}).click();
await page.getByLabel('Ghi chú món').fill('Không hành');
await openOrderMenu();await page.getByRole('button',{name:'Nước giải khát',exact:true}).click();await openOrderMenu();await page.getByRole('button',{name:'Thêm Trà đá',exact:true}).click();
assert.match(await page.locator('footer').innerText(),/61\.000đ/);
await page.getByRole('button',{name:'Gửi bếp',exact:true}).click();
await page.getByRole('button',{name:'Thử gửi lại đơn này',exact:true}).waitFor();
await page.reload();
await page.getByRole('button',{name:'Thử gửi lại đơn này',exact:true}).waitFor();
assert.match(await page.getByRole('button',{name:/^Bàn 1 /}).innerText(),/61\.000đ/);
await page.getByRole('button',{name:'Thử gửi lại đơn này',exact:true}).click();
await page.getByText('Đã lưu đơn Bàn 1.',{exact:false}).waitFor();
assert.equal(orders.length,1);assert.equal(attempts.length,2);assert.equal(attempts[0],attempts[1]);
await page.getByRole('button',{name:/^Bàn 1 /}).waitFor();assert.match(await page.getByRole('button',{name:/^Bàn 1 /}).innerText(),/61\.000đ/);
await page.getByRole('button',{name:/^Bếp \(/}).click();
await page.locator('.kitchen-card').waitFor();assert.match(await page.locator('.kitchen-card').innerText(),/Không hành/);assert.doesNotMatch(await page.locator('.kitchen-card').innerText(),/Trà đá/);
await page.getByRole('button',{name:'Xong',exact:true}).click();await page.getByText('Chưa có món đang làm.',{exact:true}).waitFor();
await page.getByRole('button',{name:'Lịch sử',exact:true}).click();await page.locator('.kitchen-card').waitFor();
await page.getByRole('button',{name:'Phục vụ',exact:true}).click();
await page.getByRole('button',{name:/^Bàn 2 /}).click();assert.match(await page.locator('footer').innerText(),/0đ/);
await page.getByRole('button',{name:'← Danh sách bàn',exact:true}).click();
await page.getByRole('button',{name:/^Bàn 1 /}).click();
await openOrderMenu();await page.getByRole('button',{name:'Nước giải khát',exact:true}).click();await openOrderMenu();await page.getByRole('button',{name:'Thêm Trà đá',exact:true}).click();
await page.getByRole('button',{name:'Gửi bếp',exact:true}).click();
await page.getByText('Đã lưu đơn Bàn 1.',{exact:false}).waitFor();
assert.equal(orders.length,2);assert.equal(orders[1].kitchen_relevant,false);assert.equal(orders[1].status,'done');
await page.getByRole('button',{name:'← Danh sách bàn',exact:true}).click();
assert.match(await page.getByRole('button',{name:/^Bàn 1 /}).innerText(),/64\.000đ/);
await page.getByRole('button',{name:/^Bếp \(/}).click();
await page.getByRole('button',{name:'Đang làm (0)',exact:true}).click();await page.getByText('Chưa có món đang làm.',{exact:true}).waitFor();
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
assert.deepEqual(errors,[]);
console.log('PASS: login, 12 tables, 61,000 total, notes, persisted retry after lost response/reload, no duplicate order, kitchen excludes drinks, complete/history, mobile overflow. All Supabase traffic mocked; no live orders created.');
}finally{await browser.close();}
