import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mockAccess} from './support/access.mjs';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 for(const scenario of ['owner-ui','waiter-ui','kitchen-ui','split-ui','legacy-owner','legacy-waiter']){
  const role=scenario.includes('waiter')?'phuc_vu':scenario.includes('kitchen')?'bep':'chu';
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const raw=[['a','Bún riêu truyền thống',58000,2,'1 ít bún, 1 nhiều bún'],['b','Bún riêu đầy đủ',65000,1,'không ngò'],['c','Bún riêu góc phố',80000,1,''],['d','Trà đá',3000,1,''],['e','Sữa đậu nành',15000,1,''],['f','Chả ốc',12000,1,'']];
  const items=raw.map(([id,name,price,qty,note])=>({id,name,price,qty,note,category:id==='d'||id==='e'?'do_uong':'bun',paid:false,bill_no:1,cancelled_at:null}));
  if(scenario==='split-ui')items[0].bill_no=2;
  const legacy=scenario.startsWith('legacy');const attempt={requestId:'60000000-0000-0000-0000-000000000034',sessionId:'session',tableId:4,tableName:'Bàn 4',billNo:1,itemIds:items.map(i=>i.id),items,method:'cash',discountType:'percent',discountValue:10,gross:291000,discount:29100,total:261900,cash:300000};
  if(legacy)await context.addInitScript(({attempt})=>localStorage.setItem('goc-pho-payment-v1:payment-ui-test',JSON.stringify(attempt)),{attempt});
  let calls=[],closed=false,releasePayment;
  await context.route('https://uiwzinyckukaqlbznnam.supabase.co/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname;let body;
   if(path==='/auth/v1/token')body={access_token:'mock',refresh_token:'refresh',token_type:'bearer',expires_in:3600,user:{id:'payment-ui-test',email:'owner@example.test',aud:'authenticated',role:'authenticated'}};
   else if(path==='/auth/v1/user')body={id:'payment-ui-test',email:'owner@example.test'};
   else if(path.endsWith('/get_my_access'))body=mockAccess({name:'Nhân viên',role});
   else if(path==='/rest/v1/restaurant_tables')body=[{id:4,name:'Bàn 4'}];
   else if(path==='/rest/v1/menu_items')body=[];
   else if(path==='/rest/v1/table_sessions')body=closed?[]:[{id:'session',table_id:4,orders:[{id:'order',request_id:'order-request',session_id:'session',status:'cooking',kitchen_relevant:true,created_at:new Date().toISOString(),order_items:items}]}];
   else if(path==='/rest/v1/orders')body=[];
   else if(path.endsWith('/pay_bill')){calls.push(req.postDataJSON());assert.equal(scenario,'legacy-owner');assert.equal(calls[0].p_discount_type,'percent');assert.equal(calls[0].p_discount_value,10);await new Promise(resolve=>releasePayment=resolve);closed=true;body='bill';}
   else if(path==='/rest/v1/bills')body={id:'bill',invoice_no:1,table_no:4,bill_no:1,gross:291000,discount:29100,total:261900,method:'cash',cash_received:300000,change_due:38100,paid_at:new Date().toISOString(),bill_items:items};
   else throw Error('Unexpected '+path);
   await route.fulfill({json:body});
  });
  const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://localhost:5173');await page.getByLabel('Tên đăng nhập',{exact:true}).fill('owner@example.test');await page.getByLabel('Mật khẩu',{exact:true}).fill('mock-pass');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
  if(legacy){await page.getByRole('button',{name:'Thử lại cùng mã',exact:true}).click();}
  else{await page.getByRole('button',{name:'Phục vụ',exact:true}).click();await page.getByRole('button',{name:/^Bàn 4 /}).click();await page.getByRole('button',{name:'Thanh toán',exact:true}).click();}
  const dialog=page.locator('.payment-sheet');await dialog.waitFor();assert.equal(await dialog.getByLabel('Giảm giá',{exact:true}).count(),0);
  assert.match(await dialog.locator('.payment-amount').innerText(),legacy?/261\.900đ/:scenario==='split-ui'?/175\.000đ/:/291\.000đ/);
  if(scenario==='legacy-owner'){
   assert.equal(await dialog.getByLabel('Tiền khách đưa',{exact:true}).isDisabled(),true);assert.match(await dialog.locator('.payment-amount').innerText(),/29\.100đ/);while(!releasePayment)await new Promise(resolve=>setTimeout(resolve,20));releasePayment();await page.getByRole('heading',{name:'Hóa đơn đã thanh toán',exact:true}).waitFor();assert.equal(calls.length,1);assert.match(await dialog.innerText(),/Giảm giá: 29\.100đ/);assert.match(await dialog.innerText(),/261\.900đ/);
  }else if(scenario==='legacy-waiter'){await dialog.getByRole('alert').filter({hasText:'Yêu cầu chờ có giảm giá'}).waitFor();assert.equal(calls.length,0);}
  else if(scenario==='split-ui'){await dialog.getByLabel('Bill thanh toán',{exact:true}).selectOption('2');assert.match(await dialog.locator('.payment-amount').innerText(),/116\.000đ/);assert.equal(await dialog.getByLabel('Tiền khách đưa',{exact:true}).inputValue(),'116000');assert.equal(calls.length,0);}
  else{
   assert.equal(await dialog.getByLabel('Tiền khách đưa',{exact:true}).inputValue(),'291000');
   assert.ok(!(await dialog.innerText()).includes('Tạm tính:'));assert.ok(!(await dialog.innerText()).includes('Để trống nghĩa là'));
   await dialog.getByLabel('Tiền khách đưa',{exact:true}).fill('300000');assert.match(await dialog.locator('.payment-change').innerText(),/9\.000đ/);
   const pay=dialog.getByRole('button',{name:'Xác nhận thu tiền mặt',exact:true});assert.equal(await pay.isEnabled(),true);
   await dialog.getByLabel('Tiền khách đưa',{exact:true}).fill('290000');assert.equal(await pay.isDisabled(),true);await dialog.getByLabel('Tiền khách đưa',{exact:true}).fill('1a');assert.equal(await pay.isDisabled(),true);await dialog.getByLabel('Tiền khách đưa',{exact:true}).fill('300000');
   for(const [width,height] of [[375,667],[390,844],[414,896],[390,480],[1440,900]]){await page.setViewportSize({width,height});const outer=await dialog.boundingBox(),cta=await pay.boundingBox(),amount=await dialog.locator('.payment-amount').boundingBox();assert.ok(outer&&cta&&amount&&outer.y>=0&&outer.y+outer.height<=height+1&&cta.y>=amount.y+amount.height&&cta.y+cta.height<=outer.y+outer.height);assert.ok(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
   await page.setViewportSize({width:390,height:844});if(scenario==='owner-ui')await page.screenshot({path:'/workspace/artifacts/payment-clean-cash-390.png'});
   await dialog.getByText('Chi tiết món',{exact:true}).click();await dialog.getByText('không ngò',{exact:true}).waitFor();assert.equal(await dialog.locator('.payment-items li').count(),6);await dialog.locator('.payment-body').evaluate(element=>element.scrollTop=element.scrollHeight);assert.ok(await pay.isVisible());
   await dialog.locator('.payment-body').evaluate(element=>element.scrollTop=0);await dialog.getByRole('button',{name:'Chuyển khoản',exact:true}).click();assert.equal(await dialog.getByLabel('Tiền khách đưa',{exact:true}).count(),0);await dialog.getByRole('button',{name:'Xác nhận đã nhận chuyển khoản',exact:true}).waitFor();assert.equal(calls.length,0);if(scenario==='owner-ui')await page.screenshot({path:'/workspace/artifacts/payment-clean-transfer-390.png'});
  }
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('ĐẠT thanh toán gọn: 291.000đ nổi bật, không input giảm giá/tạm tính/hướng dẫn dài; cash/change/transfer, footer 375/390/414/keyboard-size/desktop, món/ghi chú thu gọn, 3 vai trò, retry giảm giá cũ giữ nguyên và staff không tự cấp giảm giá. API giả.');
}finally{await browser.close();}
