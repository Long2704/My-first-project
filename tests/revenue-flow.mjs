import {mockAccess} from './support/access.mjs';
import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const browser=process.env.POS_BROWSER==='webkit'?await webkit.launch({headless:true,...(process.env.POS_WEBKIT_PATH?{executablePath:process.env.POS_WEBKIT_PATH}:{})}):await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'America/Los_Angeles'});
const menu=[{id:'food',name:'Bún riêu truyền thống',price:58000,category:'bun',is_out:false},{id:'drink',name:'Trà đá',price:3000,category:'do_uong',is_out:false}];
const order=(table,id)=>({id:'order'+id,session_id:'s'+table,request_id:'req'+id,status:'cooking',kitchen_relevant:true,created_at:new Date().toISOString(),order_items:menu.map((m,n)=>({...m,id:`line${id}-${n}`,qty:1,note:n?'':'Không hành',paid:false,bill_no:1}))});
let sessions=[{id:'s1',table_id:1,orders:[order(1,1)]},{id:'s2',table_id:2,orders:[order(2,2)]},{id:'s3',table_id:3,orders:[order(3,3)]}];
let bills=[],attempts=[],lostResponse=true,receiptUnavailable=false,role='chu',stale=false,reportMode='ok',reportCalls=[];
await context.route('https://uiwzinyckukaqlbznnam.supabase.co/**',async route=>{
 const req=route.request(),u=new URL(req.url());let body;
 if(u.pathname==='/auth/v1/token')body={access_token:'test-access-token',refresh_token:'test-refresh-token',token_type:'bearer',expires_in:3600,user:{id:'payment-test-user',email:'test@example.com',aud:'authenticated',role:'authenticated'}};
 else if(u.pathname==='/auth/v1/user')body={id:'payment-test-user',email:'test@example.com'};
 else if(u.pathname==='/rest/v1/rpc/get_my_access')body=mockAccess({name:'Chủ quán kiểm thử',role});
 else if(u.pathname==='/rest/v1/menu_items')body=menu;
 else if(u.pathname==='/rest/v1/restaurant_tables')body=Array.from({length:12},(_,i)=>({id:i+1,name:`Bàn ${i+1}`}));
 else if(u.pathname==='/rest/v1/table_sessions')body=sessions.filter(s=>!s.closed);
 else if(u.pathname==='/rest/v1/orders')body=sessions.flatMap(s=>s.orders.filter(o=>o.status==='cooking').map(o=>({...o,table_sessions:{table_id:s.table_id,closed_at:s.closed?'2026-10-27':null}})));
 else if(u.pathname==='/rest/v1/rpc/get_sales_retention_status')body={enabled:true,scheduled:true,next_run:'2026-11-08T20:00:00Z',eligible:{sessions:2,orders:3,invoices:2},last_run:null};
 else if(u.pathname==='/rest/v1/rpc/set_sales_retention_enabled')body=null;
 else if(u.pathname==='/rest/v1/rpc/revenue_report_window'){
  const p=req.postDataJSON();reportCalls.push(p);
  if(reportMode==='missing')return route.fulfill({status:404,json:{code:'PGRST202',message:'missing RPC'}});
  if(reportMode==='fail')return route.fulfill({status:400,json:{code:'P0001',message:'denied'}});
  const empty=reportMode==='empty';body={products_complete:true,time_filter:reportMode!=='legacy',slots_complete:reportMode!=='legacy',from:reportMode==='wrong-window'?p.p_from_local.slice(0,10):p.p_from_local,to:p.p_to_local,generated_at:'2026-10-27T17:00:00Z',invoices:empty?0:2,gross:empty?0:232000,discount:empty?0:22000,total:empty?0:210000,cash:empty?0:100000,transfer:empty?0:110000,days:empty?[]:[{day:p.p_from_local.slice(0,10),invoices:2,gross:232000,discount:22000,total:210000,cash:100000,transfer:110000}],products:empty?[]:[{name:'Bún riêu',qty:4,gross:100000},...Array.from({length:24},(_,i)=>({name:(i%2?'Nước ':'Món phụ ')+String(i+1).padStart(2,'0'),qty:1,gross:5500}))]};
   body.slots=Array.from({length:7},(_,i)=>({day:p.p_from_local.slice(0,10),slot_index:i+1,slot:['06–09','09–11','11–13','13–15','15–17','17–22','Ngoài khung'][i],...Object.fromEntries(['invoices','gross','discount','total','cash','transfer'].map(k=>[k,i===0?body[k]:0]))}));
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

async function management(name){const control=page.locator('.management-menu');if(!await control.evaluate(e=>e.open))await control.locator('summary').click();await page.getByRole('button',{name,exact:true}).click();}
async function setClock(label,value){const parts=value.split(':');for(const [i,name] of ['giờ','phút','giây'].entries())await page.getByLabel(`${label} · ${name}`,{exact:true}).selectOption(parts[i]||'00');}
async function clockValue(label){return (await Promise.all(['giờ','phút','giây'].map(name=>page.getByLabel(`${label} · ${name}`,{exact:true}).inputValue()))).join(':');}
async function tableActions(){const control=page.locator('.table-operations');if(!await control.evaluate(e=>e.open))await control.locator('summary').click();}
await page.goto(process.env.POS_TEST_URL||'http://localhost:5173');await page.getByLabel('Tên đăng nhập',{exact:true}).fill('test@example.com');await page.getByLabel('Mật khẩu',{exact:true}).fill('fake-test-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
await management('Báo cáo doanh thu');
await page.getByLabel('Từ ngày',{exact:true}).fill('2026-10-27');await page.getByLabel('Đến ngày',{exact:true}).fill('2026-10-27');
const load=page.getByRole('button',{name:'Xem báo cáo',exact:true});await load.click();
await page.getByText('210.000đ',{exact:true}).first().waitFor();assert.equal(reportCalls.length,1);assert.equal(reportCalls[0].p_from_local,'2026-10-27T00:00:00');assert.equal(reportCalls[0].p_to_local,'2026-10-27T23:59:59');assert.equal(await page.locator('input[type=time]').count(),0);assert.equal(await page.getByLabel('Từ giờ · giây',{exact:true}).locator('option').count(),60);
assert.match(await page.locator('.report-result').innerText(),/110\.000đ/);assert.match(await page.locator('.report-result').innerText(),/Bún riêu/);
const exportDaily=page.getByRole('button',{name:'Xuất doanh thu CSV',exact:true});
assert.equal(await page.getByRole('button',{name:'Xuất 20 món CSV',exact:true}).count(),0);
assert.equal(await page.locator('.report-products tbody tr').count(),25);
assert.equal(await page.getByRole('heading',{name:'Món ăn',exact:true}).count(),1);
assert.equal(await page.getByRole('heading',{name:'20 món bán nhiều nhất',exact:true}).count(),0);
if(process.env.POS_SCREENSHOT_DIR)await page.screenshot({path:process.env.POS_SCREENSHOT_DIR+'/revenue-compact-mobile.png',fullPage:true});
let downloadPromise=page.waitForEvent('download');await exportDaily.click();let download=await downloadPromise;
assert.equal(download.suggestedFilename(),'goc-pho-doanh-thu_2026-10-27T00-00-00_2026-10-27T23-59-59.csv');
const data=readFileSync(await download.path());assert.deepEqual([...data.subarray(0,3)],[239,187,191]);const contents=data.toString('utf8');assert.match(contents,/"232000","22000","210000","100000","110000"/);assert.match(contents,/Tổng cộng/);
assert.equal(reportCalls.length,1);
const excelPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Xuất Excel theo khung giờ',exact:true}).click();const excel=await excelPromise;assert.ok(excel.suggestedFilename().endsWith('.xlsx'));const bytes=readFileSync(await excel.path());assert.equal(bytes.readUInt32LE(0),0x04034b50);if(process.env.POS_SCREENSHOT_DIR)await excel.saveAs(process.env.POS_SCREENSHOT_DIR+'/revenue-slots.xlsx');
assert.match(contents,/2026-10-27T00:00:00/);assert.match(contents,/2026-10-27T23:59:59/);
await setClock('Từ giờ','08:30:15');await page.getByText('Khoảng thời gian đã đổi.',{exact:false}).waitFor();assert.equal(await page.locator('.report-result').count(),0);assert.equal(await exportDaily.count(),0);
await setClock('Đến giờ','15:45:30');await load.click();await page.locator('.report-result').waitFor();
assert.equal(reportCalls.at(-1).p_from_local,'2026-10-27T08:30:15');assert.equal(reportCalls.at(-1).p_to_local,'2026-10-27T15:45:30');assert.match(await page.locator('.report-period').innerText(),/27\/10\/2026 08:30:15/);assert.match(await page.locator('.report-period').innerText(),/15:45:30 · Giờ Việt Nam/);
for(const width of [375,390,768,1024,1440]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'report viewport '+width);for(const input of await page.locator('.report-form input').all())assert.ok(await input.evaluate(e=>e.getBoundingClientRect().width>75));}
if(process.env.POS_SCREENSHOT_DIR){await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:process.env.POS_SCREENSHOT_DIR+'/revenue-time-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:process.env.POS_SCREENSHOT_DIR+'/revenue-time-mobile.png',fullPage:true});}
await setClock('Từ giờ','16:00:00');assert.equal(await load.isDisabled(),true);await setClock('Từ giờ','15:45:30');assert.equal(await load.isDisabled(),false);await setClock('Đến giờ','15:45:29');assert.equal(await load.isDisabled(),true);
await page.getByRole('button',{name:'Hôm nay',exact:true}).click();assert.equal(await clockValue('Từ giờ'),'00:00:00');assert.equal(await clockValue('Đến giờ'),'23:59:59');
await page.getByLabel('Từ ngày',{exact:true}).fill('2026-10-27');await page.getByLabel('Đến ngày',{exact:true}).fill('2026-10-27');await setClock('Từ giờ','08:30');await load.click();await page.locator('.report-result').waitFor();assert.equal(reportCalls.at(-1).p_from_local,'2026-10-27T08:30:00');
await page.getByLabel('Đến ngày',{exact:true}).fill('2026-10-28');await page.getByText('Khoảng thời gian đã đổi.',{exact:false}).waitFor();assert.equal(await page.locator('.report-result').count(),0);assert.equal(await exportDaily.count(),0);
reportMode='empty';await load.click();await page.getByText('Chưa có hóa đơn đã thanh toán trong khoảng thời gian này.',{exact:true}).waitFor();
assert.equal(await page.getByRole('button',{name:'Xuất 20 món CSV',exact:true}).count(),0);downloadPromise=page.waitForEvent('download');await exportDaily.click();download=await downloadPromise;assert.match(readFileSync(await download.path(),'utf8'),/"Tổng cộng","","0","0","0","0","0","0"/);
reportMode='legacy';await load.click();await page.getByText('Chưa xác nhận được khoảng thời gian báo cáo. Kiểm tra SQL 037 rồi thử lại.',{exact:true}).waitFor();assert.equal(await page.locator('.report-result').count(),0);
reportMode='wrong-window';await load.click();await page.getByRole('alert').filter({hasText:'Chưa xác nhận được khoảng thời gian'}).waitFor();assert.equal(await exportDaily.count(),0);
reportMode='missing';await load.click();await page.getByText('Cần cập nhật SQL 037',{exact:false}).waitFor();assert.equal(await page.locator('.report-result').count(),0);assert.equal(await exportDaily.count(),0);
reportMode='fail';await load.click();await page.getByText('Không tải được báo cáo.',{exact:false}).waitFor();
await page.getByLabel('Từ ngày',{exact:true}).fill('2026-11-01');assert.equal(await load.isDisabled(),true);
reportMode='ok';await page.getByRole('button',{name:'Tháng này',exact:true}).click();assert.match(await page.getByLabel('Từ ngày',{exact:true}).inputValue(),/-01$/);assert.equal(await load.isDisabled(),false);assert.equal(await clockValue('Từ giờ'),'00:00:00');assert.equal(await clockValue('Đến giờ'),'23:59:59');
await load.click();await page.locator('.report-result').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
role='phuc_vu';await page.reload();await page.getByRole('button',{name:/^Bàn 1 /}).waitFor();assert.equal(await page.getByRole('button',{name:'Báo cáo doanh thu',exact:true}).count(),0);assert.equal(await exportDaily.count(),0);
assert.deepEqual(errors,[]);console.log('PASS revenue time UI: HH:mm:ss/default/presets/endpoints under non-VN browser timezone, second-only stale and export guards, equal/reversed/missing-time validation, desktop/mobile layouts, CSV downloads/BOM/amounts/range filenames, no extra RPC, empty export, stale/error/role export protection, revenue dates, totals, daily/all products beyond 20 and missing-024 guard, stale result hiding, empty/error/missing migration, date validation, month shortcut, mobile width and service role. Mock Supabase only.');
}finally{await browser.close();}
