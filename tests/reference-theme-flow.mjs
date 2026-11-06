import {chromium,webkit} from 'playwright';
import {mockAccess} from './support/access.mjs';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const out=process.env.POS_SCREENSHOT_DIR||'/tmp/pos-reference-theme';mkdirSync(out,{recursive:true});
const browser=process.env.POS_BROWSER==='webkit'?await webkit.launch({headless:true,...(process.env.POS_WEBKIT_PATH?{executablePath:process.env.POS_WEBKIT_PATH}:{})}):await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{
 for(const role of ['chu','phuc_vu','bep']){
  const c=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});await c.addInitScript(()=>sessionStorage.setItem('goc-pho-install-dismissed','1'));
  const tables=[{id:15,name:'Mang về'},...Array.from({length:14},(_,i)=>({id:i+1,name:'Bàn '+(i+1)}))];
  const prices={1:125000,3:85000,4:220000,6:65000,8:142000,10:95000};
  const sessions=Object.entries(prices).map(([id,price])=>({id:'s'+id,table_id:Number(id),orders:[{id:'o'+id,session_id:'s'+id,request_id:'request-'+id,status:'cooking',kitchen_relevant:true,created_at:new Date(Date.now()-(id==='3'?1200000:60000)).toISOString(),order_items:[{id:'line'+id,menu_item_id:'food',name:'Bún riêu truyền thống',price,qty:1,category:'bun',note:'Không hành',paid:false,bill_no:1,cancelled_at:null}]}]}));let reportReads=0;
  await c.route('https://uiwzinyckukaqlbznnam.supabase.co/**',async route=>{const path=new URL(route.request().url()).pathname;let body;
   if(path==='/auth/v1/token')body={access_token:'fake',refresh_token:'fake-refresh',expires_in:3600,token_type:'bearer',user:{id:'theme-'+role,email:role+'@example.test',aud:'authenticated',role:'authenticated'}};
   else if(path==='/auth/v1/user')body={id:'theme-'+role,email:role+'@example.test'};
   else if(path.endsWith('/get_my_access'))body={...mockAccess({name:'Nhân viên minh họa',role}),data_epoch:0};
   else if(path==='/rest/v1/restaurant_tables')body=tables;
   else if(path==='/rest/v1/menu_items')body=[{id:'food',name:'Bún riêu truyền thống',price:58000,category:'bun',is_out:false}];
   else if(path==='/rest/v1/table_sessions')body=sessions;
   else if(path==='/rest/v1/orders')body=sessions.flatMap(s=>s.orders.map(o=>({...o,table_sessions:{table_id:s.table_id,closed_at:null}})));
   else if(path==='/rest/v1/kitchen_image_tickets')body=[];
   else if(path.endsWith('/get_sales_retention_status'))body={retention_days:7,enabled:false,scheduled:false,eligible:{sessions:0,orders:0,invoices:0},last_run:null,next_run:new Date().toISOString()};
   else if(path.endsWith('/revenue_report_window')){reportReads++;body={};}
   else throw Error('Unexpected request '+path);
   await route.fulfill({json:body});
  });
  const p=await c.newPage();p.setDefaultTimeout(12000);const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(process.env.POS_TEST_URL||'http://127.0.0.1:5183');await p.getByLabel('Tên đăng nhập',{exact:true}).fill(role+'@example.test');await p.getByLabel('Mật khẩu',{exact:true}).fill('fake-password');await p.getByRole('button',{name:'Đăng nhập',exact:true}).click();await p.getByRole('button',{name:'Phục vụ',exact:true}).click();await p.locator('.table-card').first().waitFor();
  assert.equal(await p.locator('.table-card').count(),15);
  assert.deepEqual((await p.locator('.table-overview strong').allTextContents()).map(x=>x.trim()),['15','6','9']);assert.equal(await p.locator('.table-card.is-priority').count(),1);assert.match(await p.locator('.table-card.is-priority').innerText(),/Bàn 3/);assert.match(await p.getByRole('button',{name:/^Bàn 1 /}).innerText(),/125\.000đ/);
  await p.getByRole('button',{name:/^Có khách /}).click();assert.equal(await p.locator('.table-card').count(),6);await p.getByRole('button',{name:/^Trống /}).click();assert.equal(await p.locator('.table-card').count(),9);await p.getByRole('button',{name:/^Tất cả /}).click();await p.getByLabel('Tìm bàn',{exact:true}).fill('Bàn 10');assert.equal(await p.locator('.table-card').count(),1);await p.getByLabel('Tìm bàn',{exact:true}).fill('');
  for(const width of [320,375,390,414,768,1024,1280,1440]){
   await p.setViewportSize({width,height:900});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow '+role+' '+width);
   const cols=await p.locator('.table-grid').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length);assert.equal(cols,width<768?2:width<1241?3:4);
   const nav=await p.locator('.app-navigation').boundingBox();assert.ok(nav&&nav.width>100);
   if(width<1024)assert.ok(nav.y+nav.height<=901&&nav.y>700,'bottom navigation '+width);
   else assert.ok(nav.x<100&&nav.width<230,'sidebar '+width);
  }
  if(role==='chu'){
   await p.setViewportSize({width:390,height:844});await p.screenshot({path:out+'/reference-mobile.png',fullPage:true});await p.screenshot({path:out+'/reference-mobile-viewport.png'});
   await p.locator('.management-menu summary').click();await p.getByRole('button',{name:'Báo cáo doanh thu',exact:true}).waitFor();await p.locator('.management-menu summary').click();
   await p.setViewportSize({width:1440,height:1000});await p.screenshot({path:out+'/reference-desktop.png'});await p.getByRole('button',{name:'Báo cáo doanh thu',exact:true}).click();await p.getByRole('heading',{name:'Báo cáo doanh thu',exact:true}).waitFor();assert.equal(reportReads,0);await p.getByRole('button',{name:'Phục vụ',exact:true}).click();
  }else assert.equal(await p.getByRole('button',{name:'Báo cáo doanh thu',exact:true}).count(),0);
  await p.getByRole('button',{name:/^Bàn 1 /}).click();await p.getByRole('button',{name:'Thanh toán',exact:true}).waitFor();assert.equal(await p.locator('.app-navigation').isVisible(),false);await p.getByRole('button',{name:'Quay lại danh sách bàn',exact:true}).click();assert.equal(await p.locator('.app-navigation').isVisible(),true);
  await p.getByRole('button',{name:/^Bếp \(/}).click();await p.getByRole('heading',{name:'Khu vực bếp',exact:true}).waitFor();assert.equal(await p.locator('.kitchen-card').count(),6);assert.equal(await p.getByRole('button',{name:'Xong',exact:true}).count(),role==='phuc_vu'?0:6);
  assert.deepEqual(errors,[]);await c.close();
 }
 console.log('PASS reference theme: 3 roles, real counts/money/priority, filters/search, 320–1440 layouts, mobile nav/desktop sidebar/management permissions, workspace navigation, kitchen gates; API mock only.');
}finally{await browser.close();}
