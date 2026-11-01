import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {mockAccess} from './support/access.mjs';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const base=process.env.POS_TEST_URL||'http://localhost:5174';
const image=readFileSync(new URL('../public/brand/goc-pho-logo.webp',import.meta.url));
const created=n=>new Date(Date.now()-n*60000).toISOString();
const normal={id:'regular',request_id:'request-normal',session_id:'session',status:'cooking',kitchen_relevant:true,created_at:created(25),order_items:[{id:'line',name:'Bún riêu thường',price:58000,qty:1,category:'bun',note:'Ít bún',paid:false,bill_no:1,cancelled_at:null}],table_sessions:{table_id:1,closed_at:null}};
function ticket(n){return {id:'image'+n,request_id:'request-image'+n,image_path:`owner/${n}/image.webp`,preview_path:`owner/${n}/preview.webp`,status:'cooking',created_at:created(20-n),created_by:'owner',completed_at:null,completed_by:null,width:256,height:256};}
try{
 for(const role of ['chu','bep','phuc_vu']){
  const context=await browser.newContext({viewport:{width:390,height:844}});const errors=[];
  let tickets=[ticket(1),ticket(2)],downloads=0,metadata=0,failRead=false,failComplete=false,uploads=0,lostUpload=true;const completions=[],uploadIds=[],downloadPaths=[],extraOrders=[];
  const user=role+'-user';
  await context.route('https://uiwzinyckukaqlbznnam.supabase.co/**',async route=>{
   const req=route.request(),url=new URL(req.url());let body;
   if(url.pathname==='/auth/v1/token')body={access_token:'mock-access',refresh_token:'mock-refresh',token_type:'bearer',expires_in:3600,user:{id:user,email:'test@example.test',aud:'authenticated',role:'authenticated'}};
   else if(url.pathname==='/auth/v1/user')body={id:user};
   else if(url.pathname==='/auth/v1/logout')body={};
   else if(url.pathname==='/rest/v1/rpc/get_my_access'){
    body=mockAccess({name:'Thử ảnh',role});if(role==='chu')body.permissions.push('kitchen_images.read','kitchen_images.upload');if(role==='bep')body.permissions.push('kitchen_images.read');
   }
   else if(url.pathname==='/rest/v1/menu_items')body=[];
   else if(url.pathname==='/rest/v1/restaurant_tables')body=[{id:1,name:'Bàn 1'}];
   else if(url.pathname==='/rest/v1/table_sessions')body=[];
   else if(url.pathname==='/rest/v1/orders')body=[normal,...extraOrders];
   else if(url.pathname==='/rest/v1/kitchen_image_tickets'){
    metadata++;assert.notEqual(role,'phuc_vu');if(failRead)return route.fulfill({status:503,json:{message:'read failed'}});
    const status=url.searchParams.get('status').slice(3);body=tickets.filter(t=>t.status===status).sort((a,b)=>status==='cooking'?a.created_at.localeCompare(b.created_at):b.completed_at.localeCompare(a.completed_at));
   }
   else if(url.pathname.includes('/storage/v1/object/')){downloads++;downloadPaths.push(url.pathname);assert.notEqual(role,'phuc_vu');assert.match(req.headers().authorization,/Bearer/);return route.fulfill({contentType:'image/webp',body:image,headers:{'cache-control':'no-store'}});}
   else if(url.pathname==='/rest/v1/rpc/complete_kitchen_image_ticket'){
    const id=req.postDataJSON().p_ticket_id;completions.push(id);if(failComplete)return route.fulfill({status:503,json:{message:'ACK lost'}});
    const t=tickets.find(t=>t.id===id);t.status='done';t.completed_at=new Date().toISOString();t.completed_by=user;body=t;
   }
   else if(url.pathname==='/functions/v1/kitchen-image-upload'){
    const raw=req.postDataBuffer().toString();const requestId=raw.match(/name="request_id"\r\n\r\n([^\r]+)/)?.[1];assert.ok(requestId);uploadIds.push(requestId);uploads++;
    if(!tickets.some(t=>t.request_id===requestId))tickets.push({...ticket(10+uploads),request_id:requestId,created_at:new Date().toISOString()});
    if(lostUpload){lostUpload=false;return route.fulfill({status:503,json:{error:'ACK lost'}});}body={ticket:tickets.find(t=>t.request_id===requestId)};
   }
   else throw new Error('Unexpected API '+url.pathname);
   return route.fulfill({json:body});
  });
  const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);await page.getByLabel('Tên đăng nhập',{exact:true}).fill('test@example.test');await page.getByLabel('Mật khẩu',{exact:true}).fill('testing-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
  await page.getByRole('button',{name:/^Bếp \(/}).click();await page.locator('.kitchen-card').first().waitFor();
  if(role==='phuc_vu'){
   assert.equal(await page.getByRole('button',{name:'Tải ảnh lên',exact:true}).count(),0);assert.equal(await page.locator('.kitchen-image-ticket').count(),0);assert.equal(metadata,0);assert.equal(downloads,0);await context.close();continue;
  }
  await page.locator('.kitchen-image-ticket').nth(1).waitFor();await page.locator('.kitchen-image-ticket img').first().waitFor();
  assert.match(await page.locator('.kitchen-card').first().innerText(),/Bún riêu thường/);assert.equal(await page.getByRole('button',{name:'Tải ảnh lên',exact:true}).count(),role==='chu'?1:0);
  extraOrders.push({...normal,id:'new-order',request_id:'new-order-request',created_at:new Date().toISOString(),table_sessions:{table_id:2,closed_at:null}});
  await page.getByRole('button',{name:'Đồng bộ',exact:true}).click();await page.getByRole('heading',{name:'Bàn 2',exact:true}).waitFor();
  const activeTitles=await page.locator('.kitchen-card .order-heading h2').allTextContents();
  assert.deepEqual(activeTitles,['Bàn 1','Phiếu ảnh','Phiếu ảnh','Bàn 2'],'new normal order must stay after older images');
  if(role==='chu'){
   const historyBox=await page.getByRole('button',{name:'Lịch sử',exact:true}).boundingBox(),uploadBox=await page.getByRole('button',{name:'Tải ảnh lên',exact:true}).boundingBox();
   assert.ok(Math.abs(historyBox.y-uploadBox.y)<3);assert.ok(uploadBox.x>=historyBox.x+historyBox.width);
   assert.equal(await page.getByText('Phiếu ảnh cho bếp',{exact:true}).count(),0);assert.equal(await page.getByText('Ảnh tải dở',{exact:true}).count(),0);
  }
  const beforeDownloads=downloads;await page.waitForTimeout(5500);assert.ok(metadata>=2);assert.equal(downloads,beforeDownloads,'poll must not redownload images');
  const card=page.locator('.kitchen-image-ticket').first();await card.getByRole('button',{name:'Phóng to phiếu ảnh',exact:true}).click();await page.getByRole('dialog',{name:'Xem phiếu ảnh'}).waitFor();await page.getByRole('dialog').locator('img').waitFor();assert.equal(completions.length,0);await page.getByRole('button',{name:'Đóng ảnh'}).click();
  assert.equal(downloadPaths.filter(p=>p.endsWith('/1/image.webp')).length,1);
  // A short drag must neither complete nor zoom; scrolling vertically must not complete.
  for(const [dx,dy] of [[30,0],[0,70]]){const box=await card.locator('.kitchen-image-tap').boundingBox();await page.mouse.move(box.x+100,box.y+50);await page.mouse.down();await page.mouse.move(box.x+100+dx,box.y+50+dy,{steps:6});await page.mouse.up();assert.equal(completions.length,0);assert.equal(await page.getByRole('dialog').count(),0);}
  failComplete=true;await card.getByRole('button',{name:'Xong',exact:true}).click();await page.getByRole('alert').filter({hasText:'Chưa xác nhận hoàn thành'}).waitFor();assert.equal(await page.locator('.kitchen-image-ticket').count(),2);
  failComplete=false;await page.getByRole('button',{name:'Thử đồng bộ ảnh'}).click();await page.getByRole('alert').filter({hasText:'Chưa xác nhận hoàn thành'}).waitFor({state:'hidden'});
  const box=await card.locator('.kitchen-image-tap').boundingBox();await page.mouse.move(box.x+40,box.y+50);await page.mouse.down();await page.mouse.move(box.x+200,box.y+50,{steps:10});await page.mouse.up();
  await page.waitForFunction(()=>document.querySelectorAll('.kitchen-image-ticket').length===1);assert.equal(await page.getByRole('dialog').count(),0);assert.equal(tickets[0].status,'done');
  await page.getByRole('button',{name:'Lịch sử',exact:true}).click();await page.getByText('Đã xong ·',{exact:false}).waitFor();assert.equal(await page.locator('.kitchen-image-ticket').count(),1); // no open table sessions
  await page.reload();await page.getByRole('button',{name:/^Bếp \(/}).click();await page.getByRole('button',{name:'Lịch sử',exact:true}).click();await page.getByText('Đã xong ·',{exact:false}).waitFor();
  if(role==='bep'){
   await page.getByRole('dialog').waitFor({state:'hidden'});await page.locator('.kitchen-image-ticket img').first().waitFor();
   const oldBlob=await page.locator('.kitchen-image-ticket img').first().getAttribute('src');
   await page.getByRole('button',{name:'Đăng xuất',exact:true}).click();await page.getByRole('button',{name:'Đăng nhập',exact:true}).waitFor();
   assert.equal(await page.evaluate(async url=>{try{const response=await fetch(url);return response.ok;}catch{return false;}},oldBlob),false,'logout revokes private Blob URLs');
   await page.getByLabel('Tên đăng nhập',{exact:true}).fill('test@example.test');await page.getByLabel('Mật khẩu',{exact:true}).fill('testing-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.getByRole('button',{name:/^Bếp \(/}).click();await page.getByRole('button',{name:'Lịch sử',exact:true}).click();await page.getByText('Đã xong ·',{exact:false}).waitFor();
  }
  await page.getByRole('button',{name:/^Đang làm/}).click();
  if(role==='chu'){
   const files=[1,2,3].map(n=>({name:`photo${n}.webp`,mimeType:'image/webp',buffer:Buffer.concat([image,Buffer.from([n])])}));
   await page.locator('input[type=file]').setInputFiles(files);
   await page.waitForFunction(()=>document.querySelector('.kitchen-upload-button')?.getAttribute('aria-busy')==='false');
   assert.equal(uploads,3);assert.equal(new Set(uploadIds).size,3);assert.equal(tickets.filter(t=>uploadIds.includes(t.request_id)).length,3);
   assert.equal(await page.getByRole('button',{name:'Gửi ảnh',exact:true}).count(),0);assert.equal(await page.getByRole('dialog').count(),0);
   await page.locator('.image-upload-errors').getByText('photo1.webp',{exact:true}).waitFor();
   const originalId=uploadIds[0];await page.reload();await page.getByRole('button',{name:/^Bếp \(/}).click();
   await page.locator('input[type=file]').setInputFiles([files[0]]);
   await page.waitForFunction(()=>document.querySelector('.kitchen-upload-button')?.getAttribute('aria-busy')==='false');
   assert.equal(uploadIds[3],originalId);assert.equal(uploads,4);assert.equal(new Set(uploadIds).size,3);assert.equal(tickets.filter(t=>uploadIds.includes(t.request_id)).length,3);
   await page.waitForFunction(()=>document.querySelectorAll('.kitchen-image-ticket').length===4);
   const mixedTitles=await page.locator('.kitchen-card .order-heading h2').allTextContents();
   assert.deepEqual(mixedTitles,['Bàn 1','Phiếu ảnh','Bàn 2','Phiếu ảnh','Phiếu ảnh','Phiếu ảnh']);
   mkdirSync('/tmp/kitchen-timeline-evidence',{recursive:true});
   await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'/tmp/kitchen-timeline-evidence/owner-desktop.png',fullPage:true});
   await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/kitchen-timeline-evidence/owner-mobile.png',fullPage:true});
   await page.locator('input[type=file]').setInputFiles([{name:'bad.txt',mimeType:'text/plain',buffer:Buffer.from('not an image')}]);
   await page.locator('.image-upload-errors').getByText('bad.txt',{exact:true}).waitFor();assert.equal(uploads,4);

  }
  failRead=true;await page.waitForTimeout(5500);await page.getByRole('alert').filter({hasText:'Chưa đồng bộ được phiếu ảnh'}).waitFor();assert.match(await page.locator('.kitchen-card').first().innerText(),/Bún riêu thường/);
  await context.setOffline(true);assert.ok(await page.locator('.kitchen-image-ticket button.primary').first().isDisabled());
  failRead=false;await context.setOffline(false);await page.getByRole('alert').filter({hasText:'Chưa đồng bộ được phiếu ảnh'}).waitFor({state:'hidden'});
  mkdirSync('/tmp/kitchen-image-evidence',{recursive:true});await page.screenshot({path:`/tmp/kitchen-image-evidence/${role}-mobile.png`,fullPage:true});
  for(const width of [375,768,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow '+width);}
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('PASS UI mocked: Owner/Kitchen/Waiter, mixed chronological FIFO, compact upload beside History, auto-upload without confirmation, private images/cache, zoom vs drag/swipe, failed completion kept, history independent of open tables/reload, 3 uploads, lost ACK/reload same UUID, offline and image-read isolation.');
}finally{await browser.close();}
