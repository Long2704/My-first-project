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
  const rows=(await db.query('select * from public.profiles order by id')).rows;
  assert.ok(rows.every(p=>p.must_change_password===false));
  assert.deepEqual(rows.map(({must_change_password,...p})=>p),beforeProfile);
  await assert.rejects(db.query('update public.profiles set must_change_password=true where id=$1',[uid(1)]),/profiles_owner_password_ready/);
  assert.equal((await one('select is_active from public.profiles where id=$1',[uid(1)])).is_active,true);
  const authHash=async n=>(await one('select encrypted_password from auth.users where id=$1',[uid(n)])).encrypted_password;
  for(const n of [2,3]){
    await db.exec('reset role');await db.query('update public.profiles set must_change_password=true where id=$1',[uid(n)]);
    const hashBefore=await authHash(n);
    await asUser(n);
    const access=(await one('select public.get_my_access() data')).data;
    assert.equal(access.must_change_password,true);assert.deepEqual(access.permissions,[]);
    assert.equal((await one('select public.current_staff_role() role')).role,null);
    await assert.rejects(submit(),/không có quyền gửi đơn/);
    await assert.rejects(db.query("select public.pay_bill(gen_random_uuid(),gen_random_uuid(),'cash',array[]::uuid[])"),/không có quyền thanh toán/);
    await assert.rejects(db.query('select public.complete_kitchen_order($1)',[order.id]),/không có quyền/);
    await assert.rejects(db.query('update public.profiles set must_change_password=false where id=$1',[uid(n)]),/permission denied/);
    await assert.rejects(db.query("update auth.users set encrypted_password='fake' where id=$1",[uid(n)]),/permission denied/);
    assert.equal((await one('select count(*)::int n from public.orders')).n,0);
    // Metadata tự khai, giữ nguyên hash hoặc xóa hash không được mở quyền POS.
    await db.exec('reset role;set role supabase_auth_admin');
    await db.query("update auth.users set raw_user_meta_data='{"+String.raw`"must_change_password":false,"role":"chu"`+"}' where id=$1",[uid(n)]);
    await db.query('update auth.users set encrypted_password=encrypted_password where id=$1',[uid(n)]);
    await db.exec('reset role');
    assert.equal((await one('select must_change_password from public.profiles where id=$1',[uid(n)])).must_change_password,true);
    await db.exec('set role supabase_auth_admin');
    await db.query("update auth.users set encrypted_password='' where id=$1",[uid(n)]);
    await db.exec('reset role');
    assert.equal((await one('select must_change_password from public.profiles where id=$1',[uid(n)])).must_change_password,true);
    // Auth server đổi hash thực sự: trigger chạy với quyền hẹp và mở quyền đúng hồ sơ.
    await db.exec('set role supabase_auth_admin');
    await db.query('update auth.users set encrypted_password=$1 where id=$2',['test-hash-new-'+n,uid(n)]);
    await db.exec('reset role');
    assert.notEqual(await authHash(n),hashBefore);
    assert.equal((await one('select must_change_password from public.profiles where id=$1',[uid(n)])).must_change_password,false);
    await asUser(n);assert.equal(await permission('orders.create'),true);await submit();
  }
  console.log('ĐẠT: mật khẩu tạm chặn tạo đơn/thanh toán/đọc đơn, frontend không tự mở cờ; metadata và hash không đổi/rỗng không mở quyền; Auth server đổi hash mở đúng Waiter/Kitchen.');
  await db.exec('reset role');
  await db.query('update public.profiles set is_active=false,must_change_password=true where id=$1',[uid(3)]);
  await db.exec('set role supabase_auth_admin');await db.query("update auth.users set encrypted_password='test-hash-next' where id=$1",[uid(3)]);
  await db.exec('reset role');
  assert.equal((await one('select is_active from public.profiles where id=$1',[uid(3)])).is_active,false);
  await asUser(3);assert.equal(await permission('orders.create'),false);
  await db.exec('reset role');
  // Rollback không được mở quyền cho tài khoản còn mật khẩu tạm.
  await db.query('update public.profiles set must_change_password=true where id=$1',[uid(2)]);
  await assert.rejects(db.exec(readFileSync(new URL('../supabase/rollbacks/026_initial_password_gate.sql',import.meta.url),'utf8')),/Không thể gỡ lớp bảo vệ/);
  await db.exec('rollback');
  assert.equal((await one("select count(*)::int n from information_schema.columns where table_name='profiles' and column_name='must_change_password'")).n,1);
  await db.exec('set role supabase_auth_admin');await db.query("update auth.users set encrypted_password='test-hash-final' where id=$1",[uid(2)]);await db.exec('reset role');
  await db.exec(readFileSync(new URL('../supabase/rollbacks/026_initial_password_gate.sql',import.meta.url),'utf8'));
  assert.equal((await one("select count(*)::int n from information_schema.columns where table_name='profiles' and column_name='must_change_password'")).n,0);
  assert.deepEqual(await one('select * from public.bills where id=$1',[bill.id]),beforeBill);
  await db.exec(migration('026_initial_password_gate.sql'));
  assert.deepEqual(await one('select * from public.bills where id=$1',[bill.id]),beforeBill);
  console.log('ĐẠT: không đổi tài khoản cũ hoặc khóa Owner, đổi mật khẩu không mở khóa tài khoản; rollback bị chặn khi còn pending, giữ hóa đơn khi rollback/apply. PGlite/Auth giả lập, không gọi Supabase thật.');
} finally { await db.close(); }
