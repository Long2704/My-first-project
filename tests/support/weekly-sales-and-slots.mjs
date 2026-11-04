import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
export async function checkWeeklySalesAndSlots(db,owner){
 const sql=p=>readFileSync(new URL('../../supabase/'+p,import.meta.url),'utf8');
 const one=async(q,p=[])=>(await db.query(q,p)).rows[0];
 const as=async(id=owner)=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
 await db.exec('reset role');
 const snapshot=async names=>{const r={};for(const n of names)r[n]=(await db.query('select to_jsonb(t) r from public.'+n+' t order by to_jsonb(t)::text')).rows;return r;};
 const financial=['orders','order_items','bills','bill_items','bill_orders','table_sessions','audit_log'];
 const before=await snapshot(financial);
 await db.exec(sql('migrations/036_revenue_time_filter.sql'));await db.exec(sql('migrations/037_revenue_time_slots.sql'));await db.exec(sql('migrations/038_weekly_sales_retention.sql'));
 assert.deepEqual(await snapshot(financial),before,'install never deletes sales');
 assert.equal((await one('select enabled from public.sales_retention_settings')).enabled,false);
 await db.exec('begin');
 const rejected=async(fn,re)=>{await db.exec('savepoint expected_failure');try{await assert.rejects(fn,re);}finally{await db.exec('rollback to savepoint expected_failure;release savepoint expected_failure');}};
 try{
  const protectedBefore=await snapshot(['menu_items','restaurant_tables','profiles','kitchen_image_tickets','kitchen_image_uploads']);
  const food=await one("select * from public.menu_items where category='bun' and is_active and not is_out limit 1");
  async function sale({age=35,done=true,table=1}={}){
   await as();const request=crypto.randomUUID(),order=(await one('select public.submit_order($1,$2,$3::jsonb) id',[table,request,JSON.stringify([{menu_item_id:food.id,qty:1,expected_price:food.price}])])).id;
   const session=(await one('select session_id from public.orders where id=$1',[order])).session_id;
   if(done)await one('select public.complete_kitchen_order($1)',[order]);
   const items=(await db.query('select id from public.order_items where order_id=$1',[order])).rows.map(x=>x.id);
   const bill=(await one("select public.pay_bill($1,gen_random_uuid(),'cash',$2::uuid[],1,'amount',0,null) id",[session,items])).id;
   await db.exec('reset role');await db.query("update public.orders set created_at=statement_timestamp()-$1*interval '1 day',done_at=case when status='done' then statement_timestamp()-$1*interval '1 day' else null end where id=$2",[age,order]);
   await db.query("update public.table_sessions set opened_at=statement_timestamp()-$1*interval '1 day',closed_at=statement_timestamp()-$1*interval '1 day' where id=$2",[age,session]);
   await db.query("update public.bills set paid_at=statement_timestamp()-$1*interval '1 day' where id=$2",[age,bill]);
   await db.query("update public.audit_log set created_at=statement_timestamp()-$1*interval '1 day' where session_id=$2",[age,session]);
   return {request,order,session,bill,items};
  }
  // Every exact boundary is assigned once, including final microseconds before the next band.
  const at=['05:59:59.999999','06:00:00','08:59:59.999999','09:00:00','10:59:59.999999','11:00:00','12:59:59.999999','13:00:00','14:59:59.999999','15:00:00','16:59:59.999999','17:00:00','21:59:59.999999','22:00:00'];
  for(const time of at){const s=await sale({age:0});await db.query("update public.bills set paid_at=($1::timestamp at time zone 'Asia/Ho_Chi_Minh') where id=$2",['2088-02-04T'+time,s.bill]);}
  await as();const report=(await one("select public.revenue_report_window('2088-02-04 00:00:00','2088-02-04 23:59:59') r")).r;
  assert.equal(report.slots_complete,true);assert.equal(report.slots.length,7);assert.equal(report.invoices,14);
  assert.deepEqual(report.slots.map(s=>s.invoices),[2,2,2,2,2,2,2]);
  for(const key of ['invoices','gross','discount','total','cash','transfer'])assert.equal(report.slots.reduce((n,s)=>n+s[key],0),report[key]);
  const partial=(await one("select public.revenue_report_window('2088-02-04 09:00:00','2088-02-04 09:00:00') r")).r;assert.equal(partial.invoices,1);assert.equal(partial.slots[1].invoices,1);
  const across=(await one("select public.revenue_report_window('2088-02-04 21:59:59','2088-02-05 06:00:00') r")).r;assert.equal(across.slots.length,14);assert.equal(across.invoices,2);
  await db.exec('reset role');
  const old=await sale(),recent=await sale({age:2}),unfinished=await sale({done:false});
  const recentPaid=await sale();await db.query("update public.bills set paid_at=statement_timestamp()-interval '2 days' where id=$1",[recentPaid.bill]);
  const recentDone=await sale();await db.query("update public.orders set done_at=statement_timestamp()-interval '2 days' where id=$1",[recentDone.order]);
  const linkedOld=await sale(),linkedRecent=await sale({age:3});
  await db.query('insert into public.bill_orders(bill_id,order_id) values($1,$2)',[linkedOld.bill,linkedRecent.order]);
  const pairA=await sale(),pairB=await sale({table:2});
  await db.query("insert into public.table_transfers(request_id,session_id,target_session_id,from_table,to_table,user_id,reason,created_at) values(gen_random_uuid(),$1,$2,1,2,$3,'Fixture',statement_timestamp()-interval '35 days')",[pairA.session,pairB.session,owner]);
  await as();const openOrder=(await one('select public.submit_order(2,gen_random_uuid(),$1::jsonb) id',[JSON.stringify([{menu_item_id:food.id,qty:1}])])).id;
  await db.exec('reset role');const open=(await one('select session_id from public.orders where id=$1',[openOrder])).session_id;
  await db.query("update public.orders set created_at=statement_timestamp()-interval '40 days' where id=$1",[openOrder]);await db.query("update public.table_sessions set opened_at=statement_timestamp()-interval '40 days' where id=$1",[open]);
  await as();const cancelRequest=crypto.randomUUID(),cancelOrder=(await one('select public.submit_order(1,$1,$2::jsonb) id',[cancelRequest,JSON.stringify([{menu_item_id:food.id,qty:1}])])).id;
  const cancelled=(await one('select session_id from public.orders where id=$1',[cancelOrder])).session_id;
  const cancelItems=(await db.query('select id from public.order_items where order_id=$1',[cancelOrder])).rows.map(x=>x.id);await one('select public.cancel_table_session($1,gen_random_uuid(),$2::uuid[])',[cancelled,cancelItems]);
  await db.exec('reset role');await db.query("update public.table_sessions set opened_at=statement_timestamp()-interval '40 days',closed_at=statement_timestamp()-interval '40 days' where id=$1",[cancelled]);await db.query("update public.orders set created_at=statement_timestamp()-interval '40 days',done_at=statement_timestamp()-interval '40 days' where id=$1",[cancelOrder]);await db.query("update public.order_items set cancelled_at=statement_timestamp()-interval '40 days' where order_id=$1",[cancelOrder]);await db.query("update public.table_cancellations set created_at=statement_timestamp()-interval '40 days' where session_id=$1",[cancelled]);await db.query("update public.audit_log set created_at=statement_timestamp()-interval '40 days' where session_id=$1",[cancelled]);
  const candidates=(await db.query('select id from public.sales_retention_candidates()')).rows.map(x=>x.id);
  assert.ok(candidates.includes(cancelled));
  for(const s of [old,pairA,pairB])assert.ok(candidates.includes(s.session));
  for(const s of [recent,unfinished,recentPaid,recentDone,linkedOld,linkedRecent,{session:open}])assert.ok(!candidates.includes(s.session));
  assert.deepEqual((await one('select public.run_weekly_sales_cleanup() r')).r,{skipped:'paused'});
  for(const n of [2,3,4,5]){await as(`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`);await rejected(()=>one('select public.get_sales_retention_status()'),/Chỉ Owner/);await rejected(()=>one('select public.set_sales_retention_enabled(true)'),/Chỉ Owner/);await rejected(()=>one('select public.run_weekly_sales_cleanup()'),/permission denied/);}
  await db.exec('reset role;set role anon');await rejected(()=>one('select public.get_sales_retention_status()'),/permission denied/);
  await as();const status=(await one('select public.get_sales_retention_status() r')).r;assert.equal(status.scheduled,false);assert.equal(status.eligible.sessions,candidates.length);await one('select public.set_sales_retention_enabled(true)');await rejected(()=>one('select public.run_weekly_sales_cleanup()'),/permission denied/);
  await db.exec('reset role');
  // Unknown FK causes an atomic failure, not a CASCADE or half-deleted set of invoices.
  await db.exec('create table public.retention_test_guard(session_id uuid references public.table_sessions(id))');await db.query('insert into public.retention_test_guard values($1)',[old.session]);
  const beforeFailed=await snapshot(financial);
  await rejected(()=>one('select public.run_weekly_sales_cleanup()'),/foreign key/);assert.deepEqual(await snapshot(financial),beforeFailed);assert.equal((await one('select count(*)::int n from public.retired_order_requests')).n,0);
  await db.exec('drop table public.retention_test_guard');
  const maxNo=(await one('select max(invoice_no) n from public.bills')).n;
  const result=(await one('select public.run_weekly_sales_cleanup() r')).r;assert.equal(result.sessions,candidates.length);assert.ok(result.invoices>=3);
  for(const s of [old,pairA,pairB])assert.equal((await one('select count(*)::int n from public.table_sessions where id=$1',[s.session])).n,0);
  for(const s of [recent,unfinished,recentPaid,recentDone,linkedOld,linkedRecent,{session:open}])assert.equal((await one('select count(*)::int n from public.table_sessions where id=$1',[s.session])).n,1);
  assert.deepEqual(await snapshot(['menu_items','restaurant_tables','profiles','kitchen_image_tickets','kitchen_image_uploads']),protectedBefore);
  await as();const countBefore=(await one('select count(*)::int n from public.orders')).n;
  await rejected(()=>one('select public.submit_order(1,$1,$2::jsonb)',[old.request,JSON.stringify([{menu_item_id:food.id,qty:1}])]),/Mã đơn đã hết thời gian lưu/);assert.equal((await one('select count(*)::int n from public.orders')).n,countBefore);
  const next=await sale({age:0});assert.ok(Number((await one('select invoice_no n from public.bills where id=$1',[next.bill])).n)>Number(maxNo));
  assert.equal((await one('select public.run_weekly_sales_cleanup() r')).r.invoices,0,'repeat does not delete retained sales');
  await as();await one('select public.set_sales_retention_enabled(false)');await db.exec('reset role');assert.deepEqual((await one('select public.run_weekly_sales_cleanup() r')).r,{skipped:'paused'});
  // Scheduler SQL is exercised against a small pg_cron API fixture, not a hosted scheduler.
  await db.exec('create schema cron;create table cron.job(jobid bigint generated always as identity primary key,jobname text unique,schedule text,command text,active boolean default true)');
  await db.exec(`create function cron.schedule(p_name text,p_schedule text,p_command text) returns bigint language plpgsql as $$declare v_id bigint;begin insert into cron.job(jobname,schedule,command) values(p_name,p_schedule,p_command) on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command,active=true returning jobid into v_id;return v_id;end$$`);
  const activation=readFileSync(new URL('../../releases/038_enable_weekly_sales_cleanup.sql',import.meta.url),'utf8').split('\n').filter(line=>!['begin;','commit;','create extension if not exists pg_cron;'].includes(line)).join('\n');
  await db.exec(activation);await db.exec(activation);assert.equal((await one('select count(*)::int n from cron.job')).n,1);
  const job=await one('select * from cron.job');assert.equal(job.schedule,'0 20 * * 0');assert.equal(job.command,'select public.run_weekly_sales_cleanup();');assert.equal(job.active,true);
  await as();const scheduled=(await one('select public.get_sales_retention_status() r')).r;assert.equal(scheduled.scheduled,true);assert.equal(scheduled.enabled,true);
  const localNext=(await one("select extract(isodow from $1::timestamptz at time zone 'Asia/Ho_Chi_Minh') d,extract(hour from $1::timestamptz at time zone 'Asia/Ho_Chi_Minh') h",[scheduled.next_run]));assert.equal(localNext.d,'1');assert.equal(localNext.h,'3');
  await db.exec('reset role');
  console.log('PASS 037/038 full business fixture: every hour boundary/microsecond once, partial and multi-day sums; weekly 30-day cutoff, recent/open/unfinished/merged-session protection, FK atomic rollback, anti-replay, Owner/anon/role gates, pause/repeat and invoice number continuity; install never deletes.');
 }finally{await db.exec('rollback;reset role');}
 assert.deepEqual(await snapshot(financial),before);
}
