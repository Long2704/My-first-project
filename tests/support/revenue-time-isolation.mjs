import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
export async function checkRevenueTime(db,owner){
 const sql=p=>readFileSync(new URL('../../supabase/'+p,import.meta.url),'utf8');
 const one=async(q,p=[])=>(await db.query(q,p)).rows[0];
 const as=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec('set role authenticated');};
 const snapshot=async()=>{const result={};for(const t of ['bills','bill_items','orders','order_items','table_sessions','profiles','audit_log','restaurant_tables','menu_items'])result[t]=(await db.query('select to_jsonb(t) r from public.'+t+' t order by to_jsonb(t)::text')).rows;return result;};
 const query=async(a,b)=>(await one('select public.revenue_report_window($1::timestamp,$2::timestamp) r',[a,b])).r;
 const legacy=async()=>(await one("select public.revenue_report('2026-11-03','2026-11-03') r")).r;
 await db.exec('reset role');const before=await snapshot();await as(owner);const oldReport=await legacy();await db.exec('reset role');
 await db.exec(sql('migrations/036_revenue_time_filter.sql'));assert.deepEqual(await snapshot(),before);
 await db.exec('begin');
 const rejected=async(fn,pattern)=>{await db.exec('savepoint rejected_report');try{await assert.rejects(fn,pattern);}finally{await db.exec('rollback to savepoint rejected_report');await db.exec('release savepoint rejected_report');}};
 try{
  const food=(await one("select * from public.menu_items where category='bun' and is_active and not is_out limit 1"));
  const drink=(await one("select * from public.menu_items where category='do_uong' and is_active and not is_out limit 1"));
  const ids=[];
  async function paid(m,at,method='cash',discount=0){
   await as(owner);const order=(await one('select public.submit_order(1,gen_random_uuid(),$1::jsonb) id',[JSON.stringify([{menu_item_id:m.id,qty:1,expected_price:m.price}])])).id;
   const session=(await one('select session_id from public.orders where id=$1',[order])).session_id;
   const lines=(await db.query('select id from public.order_items where order_id=$1',[order])).rows.map(x=>x.id);
   const bill=(await one("select public.pay_bill($1,gen_random_uuid(),$2,$3::uuid[],1,'amount',$4,null) id",[session,method,lines,discount])).id;
   await db.exec('reset role');await db.query('update public.bills set paid_at=$1 where id=$2',[at,bill]);ids.push(bill);return bill;
  }
  await paid(food,'2026-11-03T01:29:59.999999Z'); // outside start
  await paid(food,'2026-11-03T01:30:00Z','cash',1000); // first selected instant
  await paid(drink,'2026-11-03T01:30:00.500000Z','transfer');
  await paid(food,'2026-11-03T03:00:05.999999Z','transfer'); // final selected second, fraction included
  await paid(food,'2026-11-03T03:00:06Z'); // first excluded instant
  await paid(drink,'2026-11-03T16:59:59.999999Z');
  await paid(food,'2026-11-03T17:00:00Z');
  // Add an unpaid order to prove the report only reads paid snapshots.
  await as(owner);await one('select public.submit_order(2,gen_random_uuid(),$1::jsonb)',[JSON.stringify([{menu_item_id:food.id,qty:2}])]);
  await db.exec('reset role');const businessBefore=await snapshot();
  await as(owner);const r=await query('2026-11-03T08:30:00','2026-11-03T10:00:05');
  assert.equal(r.invoices,3);assert.equal(r.gross,food.price*2+drink.price);assert.equal(r.discount,1000);assert.equal(r.total,r.gross-1000);
  assert.equal(r.cash,food.price-1000);assert.equal(r.transfer,food.price+drink.price);assert.equal(r.products_complete,true);assert.equal(r.time_filter,true);
  assert.equal(r.from,'2026-11-03T08:30:00');assert.equal(r.to,'2026-11-03T10:00:05');assert.equal(r.days.length,1);assert.equal(r.days[0].day,'2026-11-03');assert.equal(r.days[0].total,r.total);
  assert.deepEqual(r.products.find(x=>x.name===food.name),{name:food.name,qty:2,gross:food.price*2});assert.equal(r.products.reduce((n,x)=>n+x.gross,0),r.gross);
  assert.equal((await query('2026-11-03T08:30:00','2026-11-03T08:30:00')).invoices,2,'equal bounds select the whole second');
  const cross=await query('2026-11-03T23:59:59','2026-11-04T00:00:00');assert.equal(cross.invoices,2);assert.equal(cross.days.length,2);
  const full=await query('2026-11-03T00:00:00','2026-11-03T23:59:59');const old=await legacy();
  for(const key of ['invoices','gross','discount','total','cash','transfer','days','products','products_complete'])assert.deepEqual(full[key],old[key],'legacy whole-day '+key);
  await db.exec("set time zone 'America/Los_Angeles'");const tz=await query(r.from,r.to);for(const key of ['from','to','invoices','total','days','products'])assert.deepEqual(tz[key],r[key]);await db.exec("set time zone 'UTC'");
  const empty=await query('2020-01-01T06:00:00','2020-01-01T06:00:01');assert.equal(empty.total,0);assert.deepEqual(empty.days,[]);assert.deepEqual(empty.products,[]);
  for(const [a,b] of [[null,r.to],[r.from,null],['infinity','infinity'],['-infinity',r.to],[r.to,r.from],['2024-01-01T00:00:00','2025-01-01T00:00:00'],[r.from,'2026-11-03T10:00:05.1'],['0999-01-01','1000-01-01']])await rejected(()=>query(a,b),/khoảng ngày giờ/);
  assert.equal((await query('2024-01-01T00:00:00','2024-12-31T23:59:59')).invoices,0);
  for(const n of [2,3,4,5]){await as(`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`);await rejected(()=>query(r.from,r.to),/không có quyền/);}
  await as('');await rejected(()=>query(r.from,r.to),/không có quyền/);
  await db.exec('reset role;set role anon');await rejected(()=>query(r.from,r.to),/permission denied/);
  await db.exec('reset role');assert.deepEqual(await snapshot(),businessBefore,'report reads never change business rows');
  await rejected(()=>db.query('update public.profiles set must_change_password=true where id=$1',[owner]),/profiles_owner_password_ready/);
  // A second active Owner permits testing an inactive Owner without bypassing the last-Owner guard.
  const secondOwner=crypto.randomUUID();
  await db.query("insert into auth.users(id,email,encrypted_password) values($1,'owner-time@example.test','fixture-hash')",[secondOwner]);
  await db.query("insert into public.profiles(id,name,role,username,is_active) values($1,'Second Owner fixture','chu','owner-time',true)",[secondOwner]);
  await db.query('update public.profiles set is_active=false where id=$1',[owner]);await as(owner);await rejected(()=>query(r.from,r.to),/không có quyền/);
  await db.exec('reset role');await db.query('update public.profiles set is_active=true,staff_sessions_revoked_before=clock_timestamp() where id=$1',[owner]);await as(owner);await rejected(()=>query(r.from,r.to),/không có quyền/);
 }finally{await db.exec('rollback;reset role');}
 assert.deepEqual(await snapshot(),before);await as(owner);const afterReport=await legacy();assert.deepEqual({...afterReport,generated_at:null},{...oldReport,generated_at:null});
 await db.exec('reset role');await db.exec(sql('rollbacks/036_revenue_time_filter.sql'));assert.deepEqual(await snapshot(),before);
 assert.equal((await one("select to_regprocedure('public.revenue_report_window(timestamp,timestamp)') r")).r,null);
 console.log('PASS SQL 036 on full business fixture: VN second/microsecond edges, equal/end/midnight bounds, host timezone independence, all snapshot totals/products, unpaid isolation, 366-day validation, role/password/session gates, read-only migration/report/rollback, legacy whole-day compatibility.');
}
