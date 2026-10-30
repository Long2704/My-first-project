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
  const update=(id=2,version=1,role='phuc_vu',active=false,request=crypto.randomUUID(),name='Phục vụ đổi tên',code='TEST-W01')=>one('select public.update_employee($1,$2,$3,$4,$5,$6,$7) result',[request,uid(id),version,name,code,role,active]);
  for(const actor of [2,3,4,5]){await asUser(actor);await assert.rejects(update(),/Chỉ Owner/);}
  await asUser(1);
  const directory=await one("select public.list_employees() result");assert.ok(directory.result.items.every(p=>p.staff_version===1));
  await assert.rejects(update(1,1,'phuc_vu',false,crypto.randomUUID(),'Owner','OWN01'),/Không được sửa/);
  await assert.rejects(update(2,1,'chu'),/không hợp lệ/);
  const request=crypto.randomUUID();const first=await update(2,1,'phuc_vu',false,request);assert.equal(first.result.staff_version,2);
  assert.deepEqual((await update(2,1,'phuc_vu',false,request)).result,first.result);
  await assert.rejects(update(2,1,'bep',true),/đã thay đổi/);
  await assert.rejects(update(2,2,'bep',true,request),/thông tin khác/);
  await asUser(2);assert.equal(await permission('payments.collect'),false);assert.equal(await permission('orders.create'),false);await assert.rejects(submit(),/quyền gửi đơn/);
  await asUser(1);await update(2,2,'bep',true);
  await asUser(2);assert.equal(await permission('payments.collect'),true);assert.equal(await permission('kitchen.complete'),true);assert.equal(await permission('employees.manage'),false);
  await asUser(1);await update(2,3,'phuc_vu',true);
  await asUser(2);assert.equal(await permission('kitchen.complete'),false);
  await asUser(1);await assert.rejects(update(3,1,'bep',true,crypto.randomUUID(),'Bếp','TEST-W01'),/duplicate key/);
  // Cờ bắt đổi mật khẩu không bị thao tác mở khóa/đổi vai trò tự xóa.
  await db.exec('reset role');await db.query('update public.profiles set must_change_password=true where id=$1',[uid(3)]);
  await asUser(1);await update(3,2,'bep',true,crypto.randomUUID(),'Bếp đổi tên','KITCHEN03');
  await asUser(3);assert.equal(await permission('payments.collect'),false);
  await db.exec('reset role');
  assert.equal((await one("select count(*)::int n from public.audit_log where type in ('employee_locked','employee_unlocked','employee_updated')")).n,4);
  assert.deepEqual(await one('select * from public.bills where id=$1',[bill.id]),beforeBill);
  // Owner bị khóa với JWT cũ không được replay yêu cầu đã thành công.
  await db.query("insert into public.profiles(id,name,role) values($1,'Owner hai','chu')",[uid(5)]);
  await asUser(5);const request2=crypto.randomUUID();await update(2,4,'phuc_vu',true,request2,'Tên mới');
  await db.exec('reset role');await db.query('update public.profiles set is_active=false where id=$1',[uid(5)]);
  await asUser(5);await assert.rejects(update(2,4,'phuc_vu',true,request2,'Tên mới'),/Chỉ Owner/);
  await db.exec('reset role');await db.exec(readFileSync(new URL('../supabase/rollbacks/028_employee_management.sql',import.meta.url),'utf8'));
  await asUser(1);await assert.rejects(update(2,5),/permission denied/);
  console.log('ĐẠT SQL 028: Owner sửa/khóa/mở, đổi Waiter-Kitchen, chặn Owner/vai trò cũ/nâng quyền/tự sửa; idempotency, stale version, JWT cũ sau khóa, giữ cờ đổi mật khẩu/hóa đơn và rollback. PGlite/Auth giả lập.');
}finally{await db.close();}
