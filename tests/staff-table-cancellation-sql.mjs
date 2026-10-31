import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
const migration = name => readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8');
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const food = '10000000-0000-0000-0000-000000000001';
const drink = '10000000-0000-0000-0000-000000000002';
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const asUser = async n => {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [n ? uid(n) : '']);
  await db.exec('set role authenticated');
};
const submit = (request = crypto.randomUUID(), items = [{menu_item_id: food, qty: 2, expected_price: 58000, price: 1}]) =>
  one('select public.submit_order(1,$1,$2::jsonb) id', [request, JSON.stringify(items)]);
const permission = async key => (await one('select public.has_permission($1) allowed', [key])).allowed;

try {
  // Giả lập schema nền chưa được lưu trong repository và auth.uid(), không dùng Auth thật.
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    create table public.profiles(
      id uuid primary key references auth.users(id) on delete cascade,
      name text not null,
      role text not null default 'phuc_vu' check(role in ('chu','phuc_vu','bep','thu_ngan')),
      created_at timestamptz not null default now()
    );
    create function public.current_staff_role() returns text language sql stable
      security definer set search_path='' as
      $$ select role from public.profiles where id=auth.uid() $$;
    alter table public.profiles enable row level security;
    grant select on public.profiles to authenticated;
    create policy profiles_read on public.profiles for select to authenticated
      using(id=(select auth.uid()) or (select public.current_staff_role())='chu');
    create table public.menu_items(
      id uuid primary key default gen_random_uuid(), name text not null,
      price integer not null, category text not null,
      is_active boolean default true, is_out boolean default false, sort integer default 0
    );
    create table public.restaurant_tables(id integer primary key, name text not null, is_active boolean default true);
    grant select on public.menu_items, public.restaurant_tables to authenticated;
    insert into public.restaurant_tables values(1,'Bàn thử 1',true),(2,'Bàn thử 2',true);
    insert into public.menu_items(id,name,price,category) values
      ('${food}','Bún riêu thử',58000,'bun'),('${drink}','Trà thử',3000,'do_uong');
  `);
  for (let n = 1; n <= 5; n++) await db.query('insert into auth.users values($1)', [uid(n)]);
  for (const [n, role] of [[1,'chu'],[2,'phuc_vu'],[3,'bep'],[4,'thu_ngan']]) {
    await db.query('insert into public.profiles(id,name,role) values($1,$2,$3)', [uid(n), role, role]);
  }
  const files = readdirSync(new URL('../supabase/migrations/', import.meta.url))
    .filter(f => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0,3)) <= 20).sort();
  for (const file of files) {
    if (file.startsWith('019_')) {
      // Tái hiện quyền mặc định quá rộng đã phát hiện trên project thử nghiệm.
      await db.exec('grant all on all tables in schema public to anon, authenticated');
    }
    await db.exec(migration(file));
  }
  await db.query("update public.profiles set staff_code='TEST-W01' where id=$1", [uid(2)]);
  await assert.rejects(db.query("update public.profiles set staff_code=' test-w01 ' where id=$1",[uid(3)]), /duplicate key/);
  await assert.rejects(db.query('update public.profiles set is_active=false where id=$1',[uid(1)]), /Owner hoạt động cuối cùng/);
  await assert.rejects(db.query("update public.profiles set role='phuc_vu' where id=$1",[uid(1)]), /Owner hoạt động cuối cùng/);
  await assert.rejects(db.query('delete from public.profiles where id=$1',[uid(1)]), /Owner hoạt động cuối cùng/);


  // Giả lập các cột Auth được trigger dùng, không đọc password/hash thật.
  await db.exec(`alter table auth.users add column encrypted_password text,add column raw_user_meta_data jsonb not null default '{}';
    create role supabase_auth_admin;
    grant usage on schema auth to supabase_auth_admin;
    grant select,update(encrypted_password,raw_user_meta_data) on auth.users to supabase_auth_admin;
    update auth.users set encrypted_password='test-hash-before';`);
  for(const file of ['021_central_permissions.sql','022_payment_permissions.sql','023_kitchen_service_access.sql','024_management_reports_audit.sql','025_employee_directory.sql'])await db.exec(migration(file));
  await asUser(1);const order=await submit();
  const session=(await one('select session_id from public.orders where id=$1',[order.id])).session_id;
  const ids=(await db.query('select id from public.order_items where order_id=$1',[order.id])).rows.map(r=>r.id);
  const bill=await one("select public.pay_bill($1,gen_random_uuid(),'cash',$2::uuid[]) id",[session,ids]);
  await db.exec('reset role');
  const beforeProfile=(await db.query('select * from public.profiles order by id')).rows;
  const beforeBill=await one('select * from public.bills where id=$1',[bill.id]);
  await db.exec(migration('026_initial_password_gate.sql'));

  await db.exec("alter table auth.users add column email text unique, add column raw_app_meta_data jsonb not null default '{}'; create role service_role;");
  await db.exec(migration('027_employee_creation.sql'));

  await db.exec(migration('028_employee_management.sql'));
  await db.query("update auth.users set email='owner@example.test' where id=$1",[uid(1)]);

  await db.exec(migration('029_username_accounts.sql'));
  await db.exec(`create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),created_at timestamptz not null default now());
   create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',current_setting('request.jwt.claim.session_id',true))$$;`);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[uid(101),uid(2)]);
  const beforeAuth=(await db.query('select * from auth.users order by id')).rows;
  await db.exec(migration('030_employee_password_reset.sql'));
  assert.deepEqual((await db.query('select * from auth.users order by id')).rows,beforeAuth);


  await db.exec(migration('031_auth_profile_provisioning.sql'));
  await db.exec('alter table auth.users add column deleted_at timestamptz');
  await db.exec(migration('032_employee_deletion.sql'));

  await db.exec('reset role');
  const snapshot=async table=>(await db.query('select * from public.'+table+' order by id')).rows;
  const oldBills=await snapshot('bills'),oldItems=await snapshot('bill_items'),oldOrders=await snapshot('orders'),oldLines=await snapshot('order_items');
  await db.exec(migration('033_staff_table_cancellation.sql'));
  assert.deepEqual(await snapshot('bills'),oldBills);assert.deepEqual(await snapshot('bill_items'),oldItems);assert.deepEqual(await snapshot('orders'),oldOrders);assert.deepEqual(await snapshot('order_items'),oldLines);
  const cancel=(sessionId,requestId,ids)=>one('select public.cancel_table_session($1,$2,$3::uuid[])',[sessionId,requestId,ids]);
  for(const n of [1,2,3]){await asUser(n);assert.equal(await permission('tables.cancel'),true);const access=(await one('select public.get_my_access() result')).result;assert.ok(access.permissions.includes('tables.cancel'));if(n!==1){assert.equal(await permission('orders.cancel'),false);assert.equal(await permission('payments.discount'),false);assert.equal(await permission('reports.read'),false);await assert.rejects(one("select public.cancel_order_item($1,'')",[ids[0]]),/không có quyền/);}}
  for(const n of [4,5]){await asUser(n);assert.equal(await permission('tables.cancel'),false);await assert.rejects(cancel(session,crypto.randomUUID(),ids),/không có quyền hủy bàn/);}
  await db.exec('reset role');assert.equal((await one("select has_function_privilege('anon','public.cancel_table_session(uuid,uuid,uuid[])','execute') ok")).ok,false);
  await asUser(2);const placed=await submit(crypto.randomUUID(),[{menu_item_id:food,qty:2},{menu_item_id:drink,qty:1}]);
  const active=(await one('select session_id from public.orders where id=$1',[placed.id])).session_id;
  const lines=(await db.query('select id,category from public.order_items where order_id=$1 order by id',[placed.id])).rows;
  const drinkId=lines.find(i=>i.category==='do_uong').id,foodId=lines.find(i=>i.category!=='do_uong').id;
  await db.exec('reset role');await db.query('update public.order_items set bill_no=2 where id=$1',[drinkId]);
  await asUser(2);await one("select public.pay_bill($1,$2,'cash',$3::uuid[],2,'amount',0,3000) id",[active,crypto.randomUUID(),[drinkId]]);
  await db.exec('reset role');const paidBills=await snapshot('bills'),paidBillItems=await snapshot('bill_items');
  await asUser(2);await assert.rejects(cancel(active,crypto.randomUUID(),lines.map(i=>i.id)),/Danh sách món đã thay đổi/);
  const request=crypto.randomUUID();await cancel(active,request,[foodId]);await cancel(active,request,[foodId]);
  await assert.rejects(cancel(active,request,[drinkId]),/Mã hủy bàn đã được sử dụng/);
  await assert.rejects(cancel(active,crypto.randomUUID(),[foodId]),/Phiên bàn không còn mở/);
  await asUser(3);await assert.rejects(cancel(active,request,[foodId]),/Mã hủy bàn đã được sử dụng/);
  await db.exec('reset role');assert.deepEqual(await snapshot('bills'),paidBills);assert.deepEqual(await snapshot('bill_items'),paidBillItems);
  assert.equal((await one('select cancelled_by from public.order_items where id=$1',[foodId])).cancelled_by,uid(2));assert.equal((await one('select cancelled_at from public.order_items where id=$1',[drinkId])).cancelled_at,null);
  const audit=(await db.query("select * from public.audit_log where type='cancel_table' and session_id=$1",[active])).rows;assert.equal(audit.length,1);assert.equal(audit[0].user_id,uid(2));assert.ok((await one('select closed_at from public.table_sessions where id=$1',[active])).closed_at);
  for(const n of [3,1]){await asUser(n);const order=await submit();const current=(await one('select session_id from public.orders where id=$1',[order.id])).session_id;const itemIds=(await db.query('select id from public.order_items where order_id=$1',[order.id])).rows.map(i=>i.id);await cancel(current,crypto.randomUUID(),itemIds);}
  await db.exec('reset role');await db.query('update public.profiles set is_active=false where id=$1',[uid(2)]);await asUser(2);assert.equal(await permission('tables.cancel'),false);await assert.rejects(cancel(active,request,[foodId]),/không có quyền/);
  await db.exec('reset role');await db.query('update public.profiles set is_active=true,must_change_password=true where id=$1',[uid(2)]);await asUser(2);assert.equal(await permission('tables.cancel'),false);await assert.rejects(cancel(active,request,[foodId]),/không có quyền/);
  await db.exec('reset role');await db.query('update public.profiles set must_change_password=false,staff_sessions_revoked_before=clock_timestamp() where id=$1',[uid(2)]);await asUser(2);assert.equal(await permission('tables.cancel'),false);await assert.rejects(cancel(active,request,[foodId]),/không có quyền/);
  await db.exec('reset role');await db.query('update public.profiles set staff_sessions_revoked_before=null,is_active=false,deleted_at=clock_timestamp() where id=$1',[uid(2)]);await asUser(2);assert.equal(await permission('tables.cancel'),false);
  await db.exec('reset role');const ledger=(await db.query('select * from public.table_cancellations order by request_id')).rows;
  await db.exec(readFileSync(new URL('../supabase/rollbacks/033_staff_table_cancellation.sql',import.meta.url),'utf8'));
  for(const n of [2,3]){await asUser(n);assert.equal(await permission('tables.cancel'),false);await assert.rejects(cancel(active,request,[foodId]),/không có quyền hủy bàn/);}
  await db.exec('reset role');assert.deepEqual((await db.query('select * from public.table_cancellations order by request_id')).rows,ledger);assert.deepEqual(await snapshot('bills'),paidBills);assert.deepEqual(await snapshot('bill_items'),paidBillItems);
  console.log('ĐẠT SQL 033: quyền riêng Owner/Waiter/Kitchen, API chặn anon/legacy/khóa/đổi mật khẩu/phiên cũ, không cấp hủy từng món/tài chính, chỉ hủy món chưa trả, giữ bill/item đã trả, snapshot/idempotency/actor/audit, không đổi dữ liệu khi migration và rollback giữ lịch sử.');
}finally{await db.close();}
