import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mockAccess} from './support/access.mjs';

const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try {
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const created='2026-10-28T18:00:00Z';
 const employees=[
  {id:'owner',name:'Owner thử nghiệm',staff_code:null,role:'chu',is_active:true,created_at:created},
  {id:'waiter',name:'Phục vụ thử nghiệm',staff_code:'TEST-W01',role:'phuc_vu',is_active:true,created_at:created},
  {id:'kitchen',name:'Bếp thử nghiệm',staff_code:'TEST-K01',role:'bep',is_active:false,created_at:created},
  {id:'legacy',name:'Tài khoản cũ',staff_code:'OLD01',role:'thu_ngan',is_active:true,created_at:created},
  ...Array.from({length:21},(_,i)=>({id:'employee'+i,name:i===0?'<img src=x onerror=alert(1)>':`Nhân viên ${i+1}`,staff_code:'NV'+String(i+1).padStart(2,'0'),role:i%2?'phuc_vu':'bep',is_active:true,created_at:created}))
 ];
 let role='chu',active=true,mode='ok',holdNext=false,releaseOld;
 let startedResolve;const holdStarted=new Promise(resolve=>startedResolve=resolve);
 const calls=[],requests=[],errors=[];
 await context.route('https://uiwzinyckukaqlbznnam.supabase.co/**',async route=>{
  const req=route.request(),u=new URL(req.url());requests.push({path:u.pathname,method:req.method()});let body;
  if(u.pathname==='/auth/v1/token')body={access_token:'mock-owner-access',refresh_token:'mock-refresh',token_type:'bearer',expires_in:3600,user:{id:'owner',email:'owner@example.test',aud:'authenticated',role:'authenticated'}};
  else if(u.pathname==='/auth/v1/user')body={id:'owner',email:'owner@example.test'};
  else if(u.pathname==='/rest/v1/rpc/get_my_access')body=mockAccess({name:'Owner thử nghiệm',role,is_active:active});
  else if(u.pathname==='/rest/v1/menu_items')body=[];
  else if(u.pathname==='/rest/v1/restaurant_tables')body=[{id:1,name:'Bàn thử 1'}];
  else if(u.pathname==='/rest/v1/table_sessions'||u.pathname==='/rest/v1/orders')body=[];
  else if(u.pathname==='/rest/v1/rpc/list_employees'){
   const p=req.postDataJSON();calls.push(p);
   if(!active||role!=='chu')return route.fulfill({status:400,json:{code:'P0001',message:'Chỉ Owner đang hoạt động được xem danh sách nhân viên.'}});
   if(mode==='missing')return route.fulfill({status:404,json:{code:'PGRST202',message:'missing RPC'}});
   if(mode==='fail')return route.fulfill({status:503,json:{message:'offline'}});
   if(mode==='denied')return route.fulfill({status:400,json:{code:'P0001',message:'Chỉ Owner đang hoạt động được xem danh sách nhân viên.'}});
   const q=p.p_search.toLowerCase();
   const selected=(mode==='preview'?employees.slice(0,3):employees).filter(e=>(!p.p_role||e.role===p.p_role)&&(p.p_active===null||e.is_active===p.p_active)&&(!q||e.name.toLowerCase().includes(q)||(e.staff_code||'').toLowerCase().includes(q)));
   body={items:selected.slice((p.p_page-1)*p.p_page_size,p.p_page*p.p_page_size),total:selected.length,page:p.p_page,page_size:p.p_page_size};
   if(holdNext){
    holdNext=false;body=structuredClone(body);body.items[0].name='Kết quả cũ';
    const gate=new Promise(resolve=>releaseOld=resolve);startedResolve();await gate;
   }
  }
  else throw new Error('Unexpected endpoint '+u.pathname);
  await route.fulfill({status:200,json:body});
 });
 const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:5173');
 await page.getByLabel('Email',{exact:true}).fill('owner@example.test');await page.getByLabel('Mật khẩu',{exact:true}).fill('fake-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
 await page.getByRole('button',{name:/^Bàn thử 1 /}).waitFor();assert.equal(calls.length,0);
 async function openEmployees(){
  const nav=page.locator('.management-menu');if(!await nav.evaluate(el=>el.open))await nav.locator('summary').click();
  await page.getByRole('button',{name:'Quản lý nhân viên',exact:true}).click();
 }
 await openEmployees();await page.getByRole('heading',{name:'Owner thử nghiệm',exact:true}).waitFor();
 assert.equal(calls.length,1);assert.equal(calls[0].p_page_size,20);
 assert.equal(await page.locator('.employee-list article').count(),20);
 assert.equal(await page.getByRole('button',{name:'Thêm nhân viên',exact:true}).count(),1);
 assert.equal(await page.getByRole('button',{name:'Khóa tài khoản',exact:true}).count(),0);
 assert.equal(await page.getByText('Chưa có mã',{exact:true}).count(),1);
 assert.equal(await page.getByText('Thu ngân (cũ)',{exact:true}).count(),1);
 assert.equal(await page.locator('.employee-status.is-locked').count(),1);
 assert.equal(await page.locator('.employee-list img').count(),0);
 assert.equal(await page.locator('.employee-list time').first().innerText(),'29/10/2026');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 if(process.env.POS_SCREENSHOT_DIR){
  mode='preview';await page.getByRole('button',{name:'Tải lại nhân viên',exact:true}).click();await page.getByText('3 nhân viên',{exact:true}).waitFor();
  await page.screenshot({path:process.env.POS_SCREENSHOT_DIR+'/employees-mobile.png'});
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:process.env.POS_SCREENSHOT_DIR+'/employees-desktop.png'});await page.setViewportSize({width:390,height:844});
  mode='ok';await page.getByRole('button',{name:'Tải lại nhân viên',exact:true}).click();await page.getByText('25 nhân viên',{exact:true}).waitFor();
 }
 await page.getByRole('button',{name:'Trang sau',exact:true}).click();
 await page.getByText('Trang 2 / 2',{exact:true}).waitFor();assert.equal(await page.locator('.employee-list article').count(),5);assert.equal(calls.at(-1).p_page,2);
 await page.getByLabel('Tên hoặc mã nhân viên',{exact:true}).fill(' test-w01 ');await page.getByRole('button',{name:'Tìm',exact:true}).click();
 await page.getByRole('heading',{name:'Phục vụ thử nghiệm',exact:true}).waitFor();assert.equal(await page.locator('.employee-list article').count(),1);assert.equal(calls.at(-1).p_page,1);assert.equal(calls.at(-1).p_search,'test-w01');
 await page.getByLabel('Tên hoặc mã nhân viên',{exact:true}).fill('');await page.getByLabel('Vai trò',{exact:true}).selectOption('bep');await page.getByLabel('Trạng thái',{exact:true}).selectOption('locked');await page.getByRole('button',{name:'Tìm',exact:true}).click();
 await page.getByRole('heading',{name:'Bếp thử nghiệm',exact:true}).waitFor();assert.equal(await page.locator('.employee-list article').count(),1);assert.equal(calls.at(-1).p_role,'bep');assert.equal(calls.at(-1).p_active,false);
 await page.getByLabel('Tên hoặc mã nhân viên',{exact:true}).fill('không tồn tại');await page.getByRole('button',{name:'Tìm',exact:true}).click();await page.getByText('Không có nhân viên phù hợp',{exact:true}).waitFor();
 await page.getByLabel('Tên hoặc mã nhân viên',{exact:true}).fill('');await page.getByLabel('Vai trò',{exact:true}).selectOption('');await page.getByLabel('Trạng thái',{exact:true}).selectOption('');await page.getByRole('button',{name:'Tìm',exact:true}).click();await page.getByRole('heading',{name:'Owner thử nghiệm',exact:true}).waitFor();
 for(const [nextMode,expected] of [['missing','Cần chạy SQL 025'],['fail','Không tải được danh sách nhân viên'],['denied','Chỉ Owner đang hoạt động']]){
  mode=nextMode;await page.getByRole('button',{name:'Tải lại nhân viên',exact:true}).click();await page.getByRole('alert').filter({hasText:expected}).waitFor();assert.equal(await page.locator('.employee-list article').count(),0);
  mode='ok';await page.getByRole('button',{name:'Tải lại nhân viên',exact:true}).click();await page.getByRole('heading',{name:'Owner thử nghiệm',exact:true}).waitFor();
 }
 // Rời trang rồi mở lại khi request cũ chưa về: kết quả cũ không được ghi đè.
 holdNext=true;await page.getByRole('button',{name:'Tải lại nhân viên',exact:true}).click();await holdStarted;
 await page.getByRole('button',{name:'Phục vụ',exact:true}).click();await openEmployees();await page.getByRole('heading',{name:'Owner thử nghiệm',exact:true}).waitFor();
 releaseOld();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(await page.getByRole('heading',{name:'Kết quả cũ',exact:true}).count(),0);
 active=false;await page.getByRole('button',{name:'Đồng bộ',exact:true}).click();await page.getByRole('alert').filter({hasText:'Tài khoản đã bị khóa.'}).waitFor();assert.equal(await page.locator('.employee-list').count(),0);
 active=true;role='phuc_vu';await page.getByRole('button',{name:'Thử tải lại',exact:true}).click();await page.getByRole('button',{name:/^Bàn thử 1 /}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Quản lý nhân viên',exact:true}).count(),0);
 const beforeKitchen=calls.length;
 role='bep';await page.reload();await page.getByRole('heading',{name:'Khu vực bếp',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Quản lý nhân viên',exact:true}).count(),0);assert.equal(calls.length,beforeKitchen);
 assert.ok(!requests.some(r=>r.path.includes('/admin/')||r.path==='/rest/v1/profiles'));
 assert.deepEqual(errors,[]);
 console.log('ĐẠT UI: Owner mở/tìm/lọc/phân trang, ngày VN, trạng thái khóa, lỗi/thiếu SQL/không quyền, bỏ kết quả cũ, khóa Owner xóa dữ liệu khỏi UI; Waiter/Kitchen không thấy mục nhân viên. API giả lập, không đổi dữ liệu thật.');
} finally { await browser.close(); }
