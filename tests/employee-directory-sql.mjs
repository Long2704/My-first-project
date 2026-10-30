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


  for(const name of ['021_central_permissions.sql','022_payment_permissions.sql','023_kitchen_service_access.sql','024_management_reports_audit.sql'])await db.exec(migration(name));
  await asUser(1);
  const oldOrder=await submit();
  const session=(await one('select session_id from public.orders where id=$1',[oldOrder.id])).session_id;
  const ids=(await db.query('select id from public.order_items where order_id=$1',[oldOrder.id])).rows.map(i=>i.id);
  const oldBill=await one("select public.pay_bill($1,gen_random_uuid(),'cash',$2::uuid[]) id",[session,ids]);
  await db.exec('reset role');
  for(let i=10;i<51;i++){
    await db.query('insert into auth.users values($1)',[uid(i)]);
    await db.query('insert into public.profiles(id,name,role,staff_code,is_active,created_at) values($1,$2,$3,$4,$5,$6)',[
      uid(i),i===10?'100% Hương':`Nhân viên ${i}`,
      i%2?'bep':'phuc_vu',i===10?'NV_01':`NV${i}`,i%3!==0,'2026-10-28T18:00:00Z'
    ]);
  }
  const snapshot=async()=>({
    profiles:(await db.query('select * from public.profiles order by id')).rows,
    users:(await db.query('select * from auth.users order by id')).rows,
    bill:await one('select * from public.bills where id=$1',[oldBill.id]),
    orders:(await db.query('select * from public.orders order by id')).rows,
    audit:(await db.query('select * from public.audit_log order by id')).rows
  });
  const before=await snapshot();
  await db.exec(migration('025_employee_directory.sql'));
  const list=async(search='',role=null,active=null,page=1,size=20)=>(await one('select public.list_employees($1,$2,$3,$4,$5) data',[search,role,active,page,size])).data;
  await asUser(1);
  const first=await list(),second=await list('',null,null,2),third=await list('',null,null,3);
  assert.equal(first.total,45);assert.equal(first.items.length,20);assert.equal(first.page_size,20);
  assert.equal(second.items.length,20);assert.equal(third.items.length,5);
  const all=[...first.items,...second.items,...third.items];
  assert.equal(new Set(all.map(p=>p.id)).size,45);
  assert.deepEqual(Object.keys(first.items[0]).sort(),['id','name','staff_code','role','is_active','created_at'].sort());
  assert.ok(!JSON.stringify(first).includes('password'));assert.ok(!JSON.stringify(first).includes('email'));
  assert.equal((await list('',null,null,1,100)).items.length,45);
  const ordered=all.map(p=>p.id);
  assert.deepEqual((await list('',null,null,1,100)).items.map(p=>p.id),ordered);
  const kitchen=await list('', 'bep',false,1,100);
  assert.ok(kitchen.total>0);assert.ok(kitchen.items.every(p=>p.role==='bep'&&!p.is_active));
  assert.equal((await list('  nv_01  ')).total,1);
  assert.equal((await list('%')).total,1);
  assert.equal((await list('NV_')).total,1);
  assert.equal((await list("' OR true --")).total,0);
  assert.equal((await list('không có nhân viên')).total,0);
  assert.equal((await list('',null,null,2147483647)).items.length,0);
  for(const args of [['','thu_ngan'],['','owner'],['x'.repeat(101)],['',null,null,0],['',null,null,null],['',null,null,1,101],['',null,null,1,0]])await assert.rejects(list(...args),/không hợp lệ|100 ký tự/);
  assert.ok(all.some(p=>p.role==='thu_ngan')); // Giữ hồ sơ cũ để Owner nhận biết, không tự đổi vai trò.
  console.log('ĐẠT: Owner xem/phân trang 45 hồ sơ, lọc vai trò/trạng thái, tìm mã không phân biệt hoa thường, ký tự %/_ là chữ thường, không lộ email/password.');
  for(const actor of [2,3,4,5,0]){
    await asUser(actor);
    await assert.rejects(list(),/Chỉ Owner đang hoạt động/);
  }
  await asUser(2);
  await db.query("select set_config('request.jwt.claim.role','chu',false)");
  await assert.rejects(list(),/Chỉ Owner/);
  await assert.rejects(db.query("update public.profiles set role='chu' where id=$1",[uid(2)]),/permission denied/);
  await db.exec('reset role; set role anon');await assert.rejects(list(),/permission denied/);
  await db.exec('reset role');
  assert.deepEqual(await snapshot(),before);
  // Giữ phiên Owner cũ, khóa hồ sơ trong DB khi đã có Owner dự phòng.
  await db.query("insert into public.profiles(id,name,role) values($1,'Owner dự phòng','chu')",[uid(5)]);
  await asUser(1);
  await db.exec('reset role');await db.query('update public.profiles set is_active=false where id=$1',[uid(1)]);
  await db.exec('set role authenticated');
  await assert.rejects(list(),/Chỉ Owner đang hoạt động/);
  await db.exec('reset role');await db.query('update public.profiles set is_active=true where id=$1',[uid(1)]);
  await db.query('delete from public.profiles where id=$1',[uid(5)]);
  assert.deepEqual(await snapshot(),before);
  console.log('ĐẠT: Waiter/Kitchen/vai trò cũ/thiếu hồ sơ/ẩn danh không gọi được API; giả JWT role không nâng quyền; Owner bị khóa bị chặn trên phiên cũ.');
  await db.exec(readFileSync(new URL('../supabase/rollbacks/025_employee_directory.sql',import.meta.url),'utf8'));
  assert.equal((await one("select to_regprocedure('public.list_employees(text,text,boolean,integer,integer)') fn")).fn,null);
  assert.deepEqual(await snapshot(),before);
  await db.exec(migration('025_employee_directory.sql'));
  await asUser(1);assert.equal((await list()).total,45);
  await db.exec('reset role');assert.deepEqual(await snapshot(),before);
  console.log('ĐẠT: áp dụng, các lần đọc, rollback và áp dụng lại không đổi hồ sơ/Auth/đơn/hóa đơn/audit. PGlite/Auth giả lập, không thao tác Supabase thật.');
} finally { await db.close(); }
