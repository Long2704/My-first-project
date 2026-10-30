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

  const oldPay = (await one("select pg_get_functiondef('public.pay_bill(uuid,uuid,text,uuid[],integer,text,bigint,bigint)'::regprocedure) definition")).definition;
  await asUser(2);
  const historical = await submit();
  await db.exec('reset role');
  const beforeOrder = await one('select * from public.orders where id=$1',[historical.id]);
  const beforeItems = (await db.query('select * from public.order_items where order_id=$1 order by id',[historical.id])).rows;
  await db.exec(migration('021_central_permissions.sql'));
  assert.deepEqual(await one('select * from public.orders where id=$1',[historical.id]),beforeOrder);
  assert.deepEqual((await db.query('select * from public.order_items where order_id=$1 order by id',[historical.id])).rows,beforeItems);
  assert.equal((await one("select pg_get_functiondef('public.pay_bill(uuid,uuid,text,uuid[],integer,text,bigint,bigint)'::regprocedure) definition")).definition,oldPay);

  const all = ['orders.read','orders.create','orders.cancel','payments.collect','payments.discount',
    'kitchen.complete','tables.transfer','bills.split','menu.manage','tables.manage','reports.read',
    'audit.read','employees.manage','settings.manage','receipts.read_own','receipts.read_all'];
  const service = ['orders.read','orders.create','payments.collect','tables.transfer','bills.split','receipts.read_own'];
  for (const [n, allowed] of [[1,all],[2,service],[3,[...service,'kitchen.complete']],[4,[]],[5,[]],[0,[]]]) {
    await asUser(n);
    for (const key of [...all, 'unknown.permission', null]) assert.equal(await permission(key), allowed.includes(key), `${n}: ${key}`);
  }
  console.log('ĐẠT: ma trận quyền Owner/Waiter/Kitchen, vai trò cũ, thiếu hồ sơ, thiếu phiên và quyền không tồn tại.');

  for (const n of [1,2,3]) {
    await asUser(n);
    const request = crypto.randomUUID();
    const order = await submit(request);
    assert.equal((await submit(request)).id, order.id);
    await db.exec('reset role');
    assert.equal((await one('select count(*)::int n from public.orders where request_id=$1',[request])).n,1);
    const item = await one('select price,qty from public.order_items where order_id=$1',[order.id]);
    assert.deepEqual(item,{price:58000,qty:2});
    await asUser(n);
    await assert.rejects(submit(crypto.randomUUID(),[{menu_item_id:food,qty:1,expected_price:1}]),/Giá món đã thay đổi/);
    await assert.rejects(submit(crypto.randomUUID(),[{menu_item_id:food,qty:0}]),/Số lượng/);
    await assert.rejects(submit(crypto.randomUUID(),[]),/1 đến 100/);
    // Cùng JWT giả lập, chỉ đổi trạng thái trong DB: kể cả replay cũng phải bị chặn.
    await db.exec('reset role');
    if (n === 1) {
      await db.query("insert into public.profiles(id,name,role) values($1,'Owner phụ','chu')",[uid(5)]);
    }
    await db.query('update public.profiles set is_active=false where id=$1',[uid(n)]);
    await db.exec('set role authenticated');
    assert.equal(await permission('orders.create'),false);
    await assert.rejects(submit(request),/không có quyền gửi đơn/);
    await assert.rejects(submit(),/không có quyền gửi đơn/);
    await db.exec('reset role');
    await db.query('update public.profiles set is_active=true where id=$1',[uid(n)]);
    await db.exec('set role authenticated');
    assert.equal(await permission('orders.create'),true);
  }
  console.log('ĐẠT: cả ba vai trò tạo đơn thật trong DB cục bộ, giá server, chống gửi lại và khóa/mở khóa trên phiên cũ.');

  await asUser(3);
  const kitchenOrder = await submit(crypto.randomUUID(),[{menu_item_id:food,qty:1},{menu_item_id:drink,qty:1}]);
  await db.exec('reset role');
  assert.equal((await one('select count(*)::int n from public.order_items where order_id=$1',[kitchenOrder.id])).n,2);
  await asUser(3);
  await db.query('select public.complete_kitchen_order($1)',[kitchenOrder.id]);
  assert.equal((await one('select status from public.orders where id=$1',[kitchenOrder.id])).status,'done');
  await assert.rejects(db.query("update public.profiles set role='chu' where id=$1",[uid(3)]),/permission denied/);
  await assert.rejects(db.exec('update public.menu_items set price=1'),/permission denied/);
  await assert.rejects(db.query("select public.revenue_report('2026-10-01','2026-10-31')"),/quyền/);
  for (const n of [2,3]) {
    await asUser(n);
    assert.equal(await permission('payments.collect'),true);
    await assert.rejects(db.query("select public.pay_bill(gen_random_uuid(),gen_random_uuid(),'cash',array[]::uuid[])"),/quyền thanh toán/);
  }
  console.log('ĐẠT: Kitchen tạo đơn và hoàn thành bếp; không tự nâng quyền/sửa giá/xem báo cáo. Thanh toán chưa được nối, vẫn bị từ chối như trước.');

  await asUser(4);
  await assert.rejects(submit(),/không có quyền gửi đơn/);
  await asUser(5); // Owner phụ không được đổi người tạo của request đã dùng.
  await assert.rejects(submit(beforeOrder.request_id),/đã được sử dụng/);
  await db.exec('reset role; set role anon');
  await assert.rejects(permission('orders.create'),/permission denied/);
  await assert.rejects(submit(),/permission denied/);
  await db.exec('reset role');
  assert.equal((await one(`select count(*)::int n from information_schema.role_table_grants
    where table_schema='public' and grantee in ('anon','authenticated') and privilege_type<>'SELECT'`)).n,0);

  const orderCount=(await one('select count(*)::int n from public.orders')).n;
  await db.exec(readFileSync(new URL('../supabase/rollbacks/021_central_permissions.sql',import.meta.url),'utf8'));
  assert.equal((await one("select to_regprocedure('public.has_permission(text)') fn")).fn,null);
  await asUser(3); await submit();
  await db.exec('reset role');
  await db.exec(migration('021_central_permissions.sql'));
  assert.equal((await one('select count(*)::int n from public.orders')).n,orderCount+1);
  console.log('ĐẠT: giữ đơn cũ, giữ nguyên pay_bill, quyền bảng, rollback về 020 và áp dụng lại 021.');
  console.log('Chỉ kiểm thử PGlite với Auth giả lập; chưa kiểm thử Supabase thật hoặc hai kết nối đồng thời.');
} finally { await db.close(); }
