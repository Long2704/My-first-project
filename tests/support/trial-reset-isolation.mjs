import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export async function checkTrialReset(db,owner,food){
 const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
 const reset=read('releases/035_reset_trial_data.sql').replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');
 const cleared=['table_sessions','orders','order_items','bills','bill_items','bill_orders','table_transfers','bill_moves','table_cancellations','takeaway_requests','kitchen_image_tickets','kitchen_image_uploads'];
 const snapshot=async schema=>(await db.query('select to_jsonb(t) v from '+schema+' t order by to_jsonb(t)::text')).rows;
 const protectedTables=['profiles','menu_items','restaurant_tables','menu_changes','table_changes','table_order_changes','employee_creation_requests','employee_update_requests','employee_password_resets','employee_password_attempts','employee_account_deletions'];
 const before=new Map();for(const t of [...cleared,...protectedTables,'audit_log'])before.set(t,await snapshot('public.'+t));before.set('auth.users',await snapshot('auth.users'));
 const backup=(await db.query(read('releases/035_trial_data_backup.sql'))).rows;assert.equal(backup.length,14);assert.ok(backup.find(r=>r.source==='orders').records.length>0);
 async function rewind(){
  for(const table of cleared){const columns=(await db.query("select column_name from information_schema.columns where table_schema='public' and table_name=$1 and column_name=any($2::text[])",[table,['created_at','opened_at','closed_at','done_at','completed_at','paid_at']])).rows;
   for(const {column_name} of columns)await db.exec(`update public.${table} set ${column_name}='2026-11-01 15:00:00+00' where ${column_name} is not null`);
  }
 }
 await db.exec('begin');await db.exec("update public.orders set created_at='2099-01-01'");await assert.rejects(db.exec(reset),/dữ liệu mới/);await db.exec('rollback');
 await db.exec('begin');await rewind();await db.exec("insert into storage.objects(bucket_id,name) values('kitchen-ticket-images','must-delete-through-storage-api')");await assert.rejects(db.exec(reset),/Bucket ảnh chưa trống/);await db.exec('rollback');
 await db.exec('begin');await rewind();await db.exec(reset);
 for(const t of cleared)assert.equal((await db.query('select count(*) n from public.'+t)).rows[0].n,0,t+' cleared');
 for(const t of protectedTables)assert.deepEqual(await snapshot('public.'+t),before.get(t),t+' preserved');assert.deepEqual(await snapshot('auth.users'),before.get('auth.users'));
 const runtime=(await db.query('select * from public.pos_runtime_settings')).rows[0];assert.equal(runtime.data_epoch,1);assert.equal(runtime.trial_reset_done,true);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');
 const order=(await db.query('select public.submit_order(1,gen_random_uuid(),$1::jsonb) id',[JSON.stringify([{menu_item_id:food,qty:1,expected_price:58000}])])).rows[0].id;
 const session=(await db.query('select session_id from orders where id=$1',[order])).rows[0].session_id;
 const items=(await db.query('select id from order_items where order_id=$1',[order])).rows.map(r=>r.id);
 const bill=(await db.query("select public.pay_bill($1,gen_random_uuid(),'cash',$2::uuid[]) id",[session,items])).rows[0].id;
 assert.equal((await db.query('select invoice_no from bills where id=$1',[bill])).rows[0].invoice_no,1);
 await db.exec('reset role;savepoint after_new_sale');await assert.rejects(db.exec(reset),/đã được đặt lại/);await db.exec('rollback to savepoint after_new_sale');assert.equal((await db.query('select count(*) n from bills')).rows[0].n,1);
 await db.exec('rollback');for(const t of [...cleared,...protectedTables,'audit_log'])assert.deepEqual(await snapshot('public.'+t),before.get(t));
 console.log('PASS one-off trial reset: read-only backup export, refuses newer transactions/nonempty bucket/repeat reset, clears exact sales/image allowlist, preserves auth/staff/menu/table settings, new invoice starts at 1 and survives repeat-reset refusal. All destructive test effects rolled back.');
}
