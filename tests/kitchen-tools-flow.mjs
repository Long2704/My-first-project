import {mockAccess} from './support/access.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
const context=await browser.newContext({viewport:{width:390,height:844}});
const menu=[{id:'food',name:'Bún riêu truyền thống',price:58000,category:'bun',is_out:false},{id:'drink',name:'Trà đá',price:3000,category:'do_uong',is_out:false}];
const order=(table,id)=>({id:'order'+id,session_id:'s'+table,request_id:'req'+id,status:'cooking',kitchen_relevant:true,created_at:new Date().toISOString(),order_items:menu.map((m,n)=>({...m,id:`line${id}-${n}`,qty:1,note:n?'':'Không hành',paid:false,bill_no:1}))});
let sessions=[{id:'s1',table_id:1,orders:[order(1,1)]},{id:'s2',table_id:2,orders:[order(2,2)]},{id:'s3',table_id:3,orders:[order(3,3)]}];
let bills=[],attempts=[],lostResponse=true,receiptUnavailable=false,role='bep',stale=false;
sessions=sessions.slice(0,1);
await context.route('https://uiwzinyckukaqlbznnam.supabase.co/**',async route=>{
 const req=route.request(),u=new URL(req.url());let body;
 if(u.pathname==='/auth/v1/token')body={access_token:'test-access-token',refresh_token:'test-refresh-token',token_type:'bearer',expires_in:3600,user:{id:'payment-test-user',email:'test@example.com',aud:'authenticated',role:'authenticated'}};
 else if(u.pathname==='/auth/v1/user')body={id:'payment-test-user',email:'test@example.com'};
 else if(u.pathname==='/rest/v1/rpc/get_my_access')body=mockAccess({name:'Bếp thử nghiệm',role});
 else if(u.pathname==='/rest/v1/menu_items')body=menu;
 else if(u.pathname==='/rest/v1/restaurant_tables')body=Array.from({length:12},(_,i)=>({id:i+1,name:`Bàn ${i+1}`}));
 else if(u.pathname==='/rest/v1/table_sessions')body=sessions.filter(s=>!s.closed);
 else if(u.pathname==='/rest/v1/orders')body=sessions.flatMap(s=>s.orders.filter(o=>o.status==='cooking').map(o=>({...o,table_sessions:{table_id:s.table_id,closed_at:s.closed?'2026-10-27':null}})));
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
await context.addInitScript(()=>{
 if(localStorage.getItem('test-unsupported')){Object.defineProperty(window,'AudioContext',{value:undefined,configurable:true});Object.defineProperty(window,'webkitAudioContext',{value:undefined,configurable:true});Object.defineProperty(navigator,'wakeLock',{value:undefined,configurable:true});return;}
 window.deviceCalls={notes:0,resumes:0,closes:0,wakeRequests:0,releases:0};window.leases=[];window.rejectWake=false;window.holdWake=false;
 class TestAudio{
  state='suspended';currentTime=0;destination={};
  async resume(){if(window.rejectAudio)throw new Error('Audio unavailable');this.state='running';window.deviceCalls.resumes++;}
  async suspend(){this.state='suspended';}
  async close(){this.state='closed';window.deviceCalls.closes++;}
  createOscillator(){return {frequency:{value:0},connect(){},disconnect(){},start(){window.deviceCalls.notes++;},stop(){},onended:null};}
  createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
 }
 Object.defineProperty(window,'AudioContext',{value:TestAudio,configurable:true});
 Object.defineProperty(navigator,'wakeLock',{configurable:true,value:{async request(){window.deviceCalls.wakeRequests++;throw new Error('Must not request wake lock');}}});
 let visibility='visible';Object.defineProperty(document,'visibilityState',{get:()=>visibility,configurable:true});window.setTestVisibility=v=>{visibility=v;document.dispatchEvent(new Event('visibilitychange'));};
});
const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));

async function management(name){const control=page.locator('.management-menu');if(!await control.evaluate(e=>e.open))await control.locator('summary').click();await page.getByRole('button',{name,exact:true}).click();}
async function tableActions(){const control=page.locator('.table-operations');if(!await control.evaluate(e=>e.open))await control.locator('summary').click();}
await page.goto('http://localhost:5173');await page.getByLabel('Tên đăng nhập',{exact:true}).fill('test@example.com');await page.getByLabel('Mật khẩu',{exact:true}).fill('fake-test-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
await page.getByRole('button',{name:/^Bếp \(/}).click();await page.getByRole('heading',{name:'Bàn 1',exact:true}).waitFor();
assert.equal(await page.locator('.new-order-badge').count(),0);assert.equal(await page.evaluate(()=>window.deviceCalls.notes),0);
await page.getByRole('button',{name:'Bật chuông đơn mới',exact:true}).click();await page.getByRole('button',{name:'Tắt chuông đơn mới',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.deviceCalls.notes),2);
const bell=page.getByRole('button',{name:'Tắt chuông đơn mới',exact:true});
assert.equal(await bell.getAttribute('aria-pressed'),'true');
assert.equal(await bell.locator('svg').count(),1);
assert.equal(await bell.innerText(),'');
assert.equal(await page.getByRole('heading',{name:'Theo dõi đơn bếp',exact:true}).count(),0);
assert.equal(await page.getByText('Giữ trang Bếp mở để nhận cập nhật mỗi 5 giây.',{exact:false}).count(),0);
const bellBox=await bell.boundingBox(),headingBox=await page.getByRole('heading',{name:'Khu vực bếp',exact:true}).boundingBox();
assert.ok(bellBox.width<=40&&bellBox.height<=40);
assert.ok(bellBox.x>=headingBox.x+headingBox.width&&bellBox.x-headingBox.x-headingBox.width<=14);
assert.ok(Math.abs(bellBox.y+bellBox.height/2-headingBox.y-headingBox.height/2)<5);
assert.ok((await page.locator('.kitchen-card').first().boundingBox()).y<340);
if(process.env.POS_SCREENSHOT_DIR){
 await page.screenshot({path:process.env.POS_SCREENSHOT_DIR+'/kitchen-compact-mobile.png',fullPage:true});
 await page.setViewportSize({width:1440,height:900});
 await page.screenshot({path:process.env.POS_SCREENSHOT_DIR+'/kitchen-compact-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
}

// Cùng id cập nhật/đổi bàn không báo lại.
sessions[0].table_id=4;await page.getByRole('button',{name:'Đồng bộ',exact:true}).click();await page.getByRole('heading',{name:'Bàn 4',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.deviceCalls.notes),2);
sessions[0].orders.push(order(4,4));await page.getByRole('button',{name:'Đồng bộ',exact:true}).click();await page.getByRole('button',{name:'Có 1 đơn bếp mới chưa xem',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.deviceCalls.notes),4);assert.equal(await page.locator('.new-kitchen-order').count(),1);
await page.getByRole('button',{name:'Đồng bộ',exact:true}).click();assert.equal(await page.evaluate(()=>window.deviceCalls.notes),4);
await page.getByRole('button',{name:'Lịch sử',exact:true}).click();await page.getByRole('button',{name:'Có 1 đơn bếp mới chưa xem',exact:true}).click();await page.locator('.new-kitchen-order').waitFor();
await page.getByRole('button',{name:'Đánh dấu đã xem',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.new-order-badge'));assert.equal(sessions[0].orders[1].status,'cooking');
await page.getByRole('button',{name:'Tắt chuông đơn mới',exact:true}).click();sessions[0].orders.push(order(4,5));await page.getByRole('button',{name:'Đồng bộ',exact:true}).click();await page.getByRole('button',{name:'Có 1 đơn bếp mới chưa xem',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.deviceCalls.notes),4);
// Hoàn thành/hủy hết đơn sẽ xóa đánh dấu mới khỏi danh sách.
sessions[0].orders[2].status='done';await page.getByRole('button',{name:'Đồng bộ',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.new-kitchen-alert'));
assert.equal(await page.getByRole('button',{name:'Giữ màn hình bếp sáng',exact:true}).count(),0);
await page.evaluate(()=>window.setTestVisibility('hidden'));await page.evaluate(()=>window.setTestVisibility('visible'));
await page.getByRole('button',{name:'Phục vụ',exact:true}).click();assert.equal(await page.evaluate(()=>window.deviceCalls.closes),1);assert.equal(await page.evaluate(()=>window.deviceCalls.wakeRequests),0);
await page.getByRole('button',{name:/^Bếp \(/}).click();await page.getByRole('button',{name:'Bật chuông đơn mới',exact:true}).waitFor();assert.equal(await page.locator('.new-order-badge').count(),0);
// Bàn phím vẫn bật/tắt được nút icon; lỗi âm thanh có thể thử lại.
const keyboardBell=page.getByRole('button',{name:'Bật chuông đơn mới',exact:true});
await keyboardBell.focus();await keyboardBell.press('Space');
await page.getByRole('button',{name:'Tắt chuông đơn mới',exact:true}).waitFor();
await page.getByRole('button',{name:'Tắt chuông đơn mới',exact:true}).press('Space');
await page.getByRole('button',{name:'Bật chuông đơn mới',exact:true}).waitFor();
await page.evaluate(()=>window.rejectAudio=true);
await page.getByRole('button',{name:'Bật chuông đơn mới',exact:true}).click();
await page.getByRole('alert').filter({hasText:'Chưa bật được chuông.'}).waitFor();
assert.equal(await page.getByRole('button',{name:'Bật chuông đơn mới',exact:true}).getAttribute('aria-pressed'),'false');
await page.evaluate(()=>window.rejectAudio=false);
await page.getByRole('button',{name:'Bật chuông đơn mới',exact:true}).click();
await page.getByRole('button',{name:'Tắt chuông đơn mới',exact:true}).waitFor();
await page.setViewportSize({width:320,height:740});
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
await page.setViewportSize({width:390,height:844});
await page.evaluate(()=>localStorage.setItem('test-unsupported','true'));await page.reload();await page.getByRole('button',{name:/^Bếp \(/}).click();assert.equal(await page.getByRole('button',{name:'Bật chuông đơn mới',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Giữ màn hình bếp sáng',exact:true}).count(),0);
assert.deepEqual(errors,[]);console.log('PASS: compact bell beside title, no large help panel, first order above fold, keyboard toggle/error recovery, no backlog alarm, enabled/muted new-order chimes, deduplication and table transfer, highlight/acknowledgment, history navigation, no wake lock controls or requests, audio cleanup, unsupported devices and mobile. Device APIs and Supabase mocked.');
}finally{await browser.close();}
