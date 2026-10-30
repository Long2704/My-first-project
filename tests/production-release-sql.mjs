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

  const files=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>/^\d{3}_.*\.sql$/.test(f)&&Number(f.slice(0,3))<=16).sort();
  for(const file of files)await db.exec(migration(file));
  await db.exec("alter table auth.users add column encrypted_password text,add column raw_app_meta_data jsonb not null default '{}',add column email text unique;");
  const before=(await db.query('select id,name,role,created_at from public.profiles order by id')).rows;
  await db.exec("update public.profiles set role='phuc_vu' where role='thu_ngan'");
  const baseline=(await db.query('select id,name,role,created_at from public.profiles order by id')).rows;
  const release=readFileSync(new URL('../releases/production-017-027.sql',import.meta.url),'utf8');
  // Gây lỗi gần cuối để chứng minh các phần 017...026 không bị commit riêng.
  const broken=release.replace('-- === 027_employee_creation.sql ===',"select 1/0;\n-- === 027_employee_creation.sql ===");
  await assert.rejects(db.exec(broken),/division by zero/);await db.exec('rollback');
  assert.equal((await one("select count(*)::int n from information_schema.columns where table_name='profiles' and column_name='is_active'")).n,0);
  await db.exec(release);
  assert.deepEqual((await db.query('select id,name,role,created_at from public.profiles order by id')).rows,baseline);
  assert.ok((await db.query('select is_active,must_change_password from public.profiles')).rows.every(p=>p.is_active&&!p.must_change_password));
  await asUser(1);assert.equal(await permission('employees.manage'),true);const created=await submit();assert.ok(created.id);
  await db.exec('reset role');await assert.rejects(db.exec(release),/Schema profiles khác/);await db.exec('rollback');
  const result=await one(readFileSync(new URL('../scripts/production-preflight.sql',import.meta.url),'utf8'));assert.ok(result.production_preflight.helpers.some(h=>h.name==='prepare_employee_creation'));
  console.log('ĐẠT gói production: schema 016 -> 027, Owner và hồ sơ cũ giữ nguyên, Owner vẫn tạo đơn; lỗi cuối rollback toàn bộ, chặn chạy lại. PGlite/Auth giả lập.');
}finally{await db.close();}
