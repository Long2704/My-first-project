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


  await db.exec(migration('021_central_permissions.sql'));
  const pay = (session, request, ids, method='cash', kind='amount', discount=0, cash=null) =>
    one('select public.pay_bill($1,$2,$3,$4::uuid[],1,$5,$6,$7) id',
      [session,request,method,ids,kind,discount,cash]);
  const open = async (n=1) => {
    await asUser(n);
    const order=await submit();
    const session=(await one('select session_id from public.orders where id=$1',[order.id])).session_id;
    const ids=(await db.query(`select i.id from public.order_items i join public.orders o on o.id=i.order_id
      where o.session_id=$1 and not i.paid and i.cancelled_at is null order by i.id`,[session])).rows.map(r=>r.id);
    return {order:order.id,session,ids};
  };
  const historical=await open();
  const historicalBill=await pay(historical.session,crypto.randomUUID(),historical.ids);
  await db.exec('reset role');
  const savedBill=await one('select * from public.bills where id=$1',[historicalBill.id]);
  await db.exec(migration('022_payment_permissions.sql'));
  assert.deepEqual(await one('select * from public.bills where id=$1',[historicalBill.id]),savedBill);

  for (const n of [2,3]) {
    const {order,session,ids}=await open(n);
    const request=crypto.randomUUID();
    const before=(await one('select count(*)::int n from public.bills')).n;
    for (const kind of ['amount','percent']) {
      await assert.rejects(pay(session,request,ids,'cash',kind,1),/Chỉ Owner được giảm giá/);
    }
    assert.equal((await one('select count(*)::int n from public.bills')).n,before);
    // Gửi yêu cầu sai không được lưu nửa hóa đơn.
    await assert.rejects(pay(session,request,[]),/Danh sách món đã thay đổi/);
    await assert.rejects(pay(session,request,ids,'cash','amount',0,1),/Tiền khách đưa chưa đủ/);
    await assert.rejects(pay(session,request,ids,'invalid'),/Hình thức thanh toán/);
    const method=n===2?'cash':'transfer';
    const bill=await pay(session,request,ids,method,'amount',0,120000);
    assert.equal((await pay(session,request,ids,method,'amount',0,120000)).id,bill.id);
    await db.exec('reset role');
    const row=await one('select * from public.bills where id=$1',[bill.id]);
    assert.equal(row.total,116000);
    assert.equal(row.discount,0);
    assert.equal(row.cashier_id,uid(n));
    assert.equal(row.method,method);
    assert.ok(row.paid_at);
    assert.equal(row.change_due,n===2?4000:0);
    assert.equal((await one('select count(*)::int n from public.bills where request_id=$1',[request])).n,1);
    assert.equal((await one("select count(*)::int n from public.audit_log where type='payment' and bill_id=$1",[bill.id])).n,1);
    assert.equal((await one('select count(*)::int n from public.bill_items where bill_id=$1',[bill.id])).n,1);
    assert.equal((await one('select paid from public.order_items where id=$1',[ids[0]])).paid,true);
    assert.ok((await one('select closed_at from public.table_sessions where id=$1',[session])).closed_at);
    assert.equal((await one('select status from public.orders where id=$1',[order])).status,'cooking');
    await asUser(n);
    await assert.rejects(pay(session,crypto.randomUUID(),ids),/Phiên bàn đã thanh toán xong/);
    await assert.rejects(db.query('update public.bills set total=1 where id=$1',[bill.id]),/permission denied/);
    // Cùng mã người dùng và phiên giả lập, khóa DB phải chặn cả việc gửi lại hóa đơn cũ.
    await db.exec('reset role');
    await db.query('update public.profiles set is_active=false where id=$1',[uid(n)]);
    await db.exec('set role authenticated');
    await assert.rejects(pay(session,request,ids),/không có quyền thanh toán/);
    await db.exec('reset role');
    await db.query('update public.profiles set is_active=true where id=$1',[uid(n)]);
    await db.exec('set role authenticated');
    assert.equal((await pay(session,request,ids,method)).id,bill.id);
    await asUser(n===2?3:2);
    await assert.rejects(pay(session,request,ids,method),/Mã thanh toán đã được sử dụng/);
  }
  console.log('ĐẠT: Waiter/Kitchen thanh toán, không tự giảm giá, tiền server, actor/thời gian/audit, gửi lại không trùng, khóa phiên cũ, giữ công việc bếp.');

  for (const [kind,value,expected] of [['amount',1000,115000],['percent',10,104400]]) {
    const {session,ids}=await open(1);
    const bill=await pay(session,crypto.randomUUID(),ids,'cash',kind,value);
    assert.equal((await one('select total from public.bills where id=$1',[bill.id])).total,expected);
  }
  // Hai nhân viên gửi hai request khác nhau: mô phỏng tuần tự, KHÔNG giả nhận là test đồng thời.
  const contested=await open(2);
  await pay(contested.session,crypto.randomUUID(),contested.ids);
  await asUser(3);
  await assert.rejects(pay(contested.session,crypto.randomUUID(),contested.ids),/Phiên bàn đã thanh toán xong/);
  await db.exec('reset role');
  assert.equal((await one('select count(*)::int n from public.bills where session_id=$1',[contested.session])).n,1);
  for (const n of [4,5,0]) {
    await asUser(n);
    await assert.rejects(pay(crypto.randomUUID(),crypto.randomUUID(),[]),/không có quyền thanh toán/);
  }
  await db.exec('reset role; set role anon');
  await assert.rejects(pay(crypto.randomUUID(),crypto.randomUUID(),[]),/permission denied/);
  await db.exec('reset role');
  const beforeRollback=(await one('select count(*)::int n from public.bills')).n;
  await db.exec(readFileSync(new URL('../supabase/rollbacks/022_payment_permissions.sql',import.meta.url),'utf8'));
  await asUser(2);
  await assert.rejects(pay(crypto.randomUUID(),crypto.randomUUID(),[]),/không có quyền thanh toán/);
  await db.exec('reset role');
  await db.exec(migration('022_payment_permissions.sql'));
  assert.equal((await one('select count(*)::int n from public.bills')).n,beforeRollback);
  assert.deepEqual(await one('select * from public.bills where id=$1',[historicalBill.id]),savedBill);
  console.log('ĐẠT: Owner giảm giá; vai trò cũ/thiếu hồ sơ/ẩn danh bị từ chối; giữ hóa đơn cũ; rollback và áp dụng lại.');
  console.log('Chỉ kiểm thử PGlite/Auth giả lập. Chưa kiểm thử Supabase thật, RLS đọc hóa đơn Kitchen hoặc hai kết nối đồng thời.');
} finally { await db.close(); }
