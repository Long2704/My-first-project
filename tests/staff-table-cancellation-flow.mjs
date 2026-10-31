import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mockAccess} from './support/access.mjs';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 for(const role of ['phuc_vu','bep','chu']){
  const context=await browser.newContext({viewport:{width:390,height:844}}),calls=[],applied=new Set(),audits=[];
  let closed=false,stale=role==='phuc_vu',lost=true;
  const paid={id:'paid',name:'Bún đã thanh toán',price:58000,qty:1,category:'bun',note:'',paid:true,bill_no:2,cancelled_at:null};
  const items=[paid,{id:'food',name:'Bún chưa thanh toán',price:58000,qty:1,category:'bun',note:'Không hành',paid:false,bill_no:1,cancelled_at:null},{id:'drink',name:'Trà đá',price:3000,qty:1,category:'do_uong',note:'',paid:false,bill_no:1,cancelled_at:null}];
  const order={id:'order',request_id:'request',session_id:'session',created_at:new Date().toISOString(),status:'cooking',kitchen_relevant:true,order_items:items};
  await context.route('https://uiwzinyckukaqlbznnam.supabase.co/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname;let body;
   if(path==='/auth/v1/token')body={access_token:'mock',refresh_token:'refresh',token_type:'bearer',expires_in:3600,user:{id:'staff',email:'staff@example.test',aud:'authenticated',role:'authenticated'}};
   else if(path==='/auth/v1/user')body={id:'staff',email:'staff@example.test'};
   else if(path.endsWith('/get_my_access'))body=mockAccess({name:'Nhân viên',role});
   else if(path==='/rest/v1/menu_items')body=[{id:'food',name:'Bún chưa thanh toán',price:58000,category:'bun',is_out:false}];
   else if(path==='/rest/v1/restaurant_tables')body=[{id:1,name:'Bàn 1'}];
   else if(path==='/rest/v1/table_sessions')body=closed?[]:[{id:'session',table_id:1,orders:[order]}];
   else if(path==='/rest/v1/orders')body=[{...order,table_sessions:{table_id:1,closed_at:closed?'closed':null}}];
   else if(path.endsWith('/cancel_table_session')){
    const payload=req.postDataJSON();calls.push(payload);assert.ok(!payload.p_expected_item_ids.includes('paid'));
    if(applied.has(payload.p_request_id))body=null;
    else if(stale){stale=false;items.push({...items[1],id:'late',name:'Món gọi thêm'});return route.fulfill({status:400,json:{code:'P0001',message:'Danh sách món đã thay đổi. Đồng bộ và xác nhận hủy bàn lại.'}});}
    else{assert.deepEqual([...payload.p_expected_item_ids].sort(),items.filter(item=>!item.paid&&!item.cancelled_at).map(item=>item.id).sort());items.filter(item=>!item.paid).forEach(item=>item.cancelled_at='cancelled');closed=true;applied.add(payload.p_request_id);audits.push({actor:'staff',role});if(lost){lost=false;return route.fulfill({status:503,json:{message:'Lost response'}});}body=null;}
   }else throw Error('Unexpected endpoint '+path);
   await route.fulfill({json:body});
  });
  const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://localhost:5173');await page.getByLabel('Tên đăng nhập',{exact:true}).fill('staff@example.test');await page.getByLabel('Mật khẩu',{exact:true}).fill('mock-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.getByRole('button',{name:'Phục vụ',exact:true}).click();await page.getByRole('button',{name:/^Bàn 1 /}).click();
  if(role!=='chu')assert.equal(await page.locator('.cancel-line-button').count(),0,'No individual item cancellation granted');
  await page.getByRole('button',{name:'Thêm món',exact:true}).click();await page.getByRole('button',{name:'Thao tác bàn',exact:true}).click();await page.getByRole('button',{name:'Hủy cả Bàn 1',exact:true}).click();
  const confirm=page.getByRole('dialog',{name:'Xác nhận hủy Bàn 1',exact:true});await confirm.waitFor();assert.ok(!(await confirm.locator('ul').innerText()).includes('Bún đã thanh toán'));await confirm.getByRole('button',{name:'Quay lại',exact:true}).click();assert.equal(calls.length,0);
  await page.getByRole('button',{name:'Hủy cả Bàn 1',exact:true}).click();await confirm.getByRole('button',{name:'Xác nhận hủy cả bàn',exact:true}).click();
  if(role==='phuc_vu'){await page.getByRole('alert').filter({hasText:'Danh sách món đã thay đổi.'}).waitFor();assert.equal(applied.size,0);await page.getByRole('button',{name:'Hủy cả Bàn 1',exact:true}).click();await confirm.getByText('Món gọi thêm',{exact:false}).waitFor();await confirm.getByRole('button',{name:'Xác nhận hủy cả bàn',exact:true}).click();}
  await confirm.getByRole('button',{name:'Thử lại cùng mã hủy bàn',exact:true}).waitFor();await page.reload();if(role==='bep')await page.getByRole('button',{name:'Phục vụ',exact:true}).click();await page.getByRole('button',{name:'Kiểm tra yêu cầu hủy bàn',exact:true}).click();await page.getByRole('button',{name:'Thử lại cùng mã hủy bàn',exact:true}).click();await page.locator('.pos-app').getByText('Đã hủy các món chưa thanh toán của Bàn 1.',{exact:false}).first().waitFor();
  assert.deepEqual(calls.at(-1),calls.at(-2));assert.equal(applied.size,1);assert.equal(audits.length,1);assert.equal(paid.cancelled_at,null);assert.equal(paid.paid,true);assert.deepEqual(errors,[]);await context.close();
 }
 console.log('ĐẠT UI 033 Owner/Phục vụ/Bếp: hủy cả bàn từ menu thêm món, xác nhận/thoát, chỉ món chưa trả, không cấp hủy từng món cho staff, snapshot mới, mất phản hồi/reload cùng UUID và audit 1 lần. API giả.');
}finally{await browser.close();}
