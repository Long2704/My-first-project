import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
for(const after014 of [false,true]){
const db=new PGlite();
try{
await db.exec(`
create role anon; create role authenticated;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth to authenticated,anon;
create table public.profiles(id uuid primary key references auth.users(id), name text not null, role text not null);
create table public.menu_items(id uuid primary key default gen_random_uuid(),name text not null,price integer not null,category text not null,is_active boolean default true,is_out boolean default false,sort integer default 0);
create table public.restaurant_tables(id integer primary key, name text not null,is_active boolean default true);
create function public.current_staff_role() returns text language sql stable security definer set search_path='' as $$ select role from public.profiles where id=auth.uid() $$;
insert into auth.users values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003');
insert into public.profiles values ('00000000-0000-0000-0000-000000000001','Owner','chu'),('00000000-0000-0000-0000-000000000002','Service','phuc_vu'),('00000000-0000-0000-0000-000000000003','Kitchen','bep');
insert into public.restaurant_tables(id,name) values (1,'Bàn 1'),(2,'Bàn 2');
insert into public.menu_items(id,name,price,category) values ('10000000-0000-0000-0000-000000000001','Bún riêu',58000,'bun'),('10000000-0000-0000-0000-000000000002','Trà đá',3000,'do_uong');
`);
for(const file of ['003_ordering.sql','004_payments.sql','005_cancellations_audit.sql','006_revenue_report.sql','007_table_transfer.sql','008_menu_management.sql','009_split_bills.sql','010_optional_transfer_reason.sql','011_cancellations_kitchen_history.sql','012_table_actions_merge.sql','013_takeaway.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
const user=async n=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[`00000000-0000-0000-0000-00000000000${n}`]);await db.exec('set role authenticated');};
const one=async(sql,p=[])=> (await db.query(sql,p)).rows[0];
await db.exec("insert into auth.users values('00000000-0000-0000-0000-000000000004');insert into public.profiles values('00000000-0000-0000-0000-000000000004','Cashier','thu_ngan');");
await user(1);
const food='10000000-0000-0000-0000-000000000001',drink='10000000-0000-0000-0000-000000000002';

await db.exec('reset role');await db.exec('grant select on public.restaurant_tables,public.menu_items to authenticated');await user(1);


await db.exec('reset role');await db.exec("insert into public.restaurant_tables(id,name) select n,'Bàn '||n from generate_series(3,12) n;alter table public.restaurant_tables add constraint restaurant_tables_id_check check(id between 1 and 12)");
if(after014)await db.exec(readFileSync(new URL('../supabase/migrations/014_fixed_takeaway_table.sql',import.meta.url),'utf8'));
await db.exec(readFileSync(new URL('../supabase/migrations/015_table_management.sql',import.meta.url),'utf8'));await user(1);
const list=()=>one('select public.list_table_management() items');
assert.equal((await list()).items.length,13);assert.equal((await list()).items.filter(t=>t.name==='Mang về').length,1);
const req=crypto.randomUUID();
const save=(id=null,version=0,name='Bàn 14',active=true,r=req)=>one('select public.save_restaurant_table($1,$2,$3,$4,$5) id',[r,id,version,name,active]);
for(const n of [2,3,4]){await user(n);await assert.rejects(list(),/Chỉ chủ quán/);await assert.rejects(save(),/Chỉ chủ quán/);}await user(1);
await assert.rejects(save(null,0,' '),/Tên bàn/);await assert.rejects(save(null,0,'x'.repeat(81)),/Tên bàn/);
const created=(await save()).id;assert.equal(created,14);assert.equal((await save()).id,14);await assert.rejects(save(null,0,'Khác'),/đã được sử dụng/);
const fresh=()=> (list()).then(r=>r.items.find(t=>t.id===created));
assert.equal((await fresh()).version,1);
await save(created,1,'Khu A',true,crypto.randomUUID());await assert.rejects(save(created,1,'Cũ',true,crypto.randomUUID()),/đã được sửa/);
const payload=JSON.stringify([{menu_item_id:food,qty:1,note:'Không hành'}]);
const order=(await one('select public.submit_order($1,gen_random_uuid(),$2::jsonb) id',[created,payload])).id;
assert.equal((await fresh()).busy,true);await assert.rejects(save(created,2,'Khu A',false,crypto.randomUUID()),/Bàn còn phiên/);
const session=(await one('select session_id from public.orders where id=$1',[order])).session_id;
const ids=(await db.query('select id from public.order_items where order_id=$1',[order])).rows.map(i=>i.id);
const paid=(await one("select public.pay_bill($1,gen_random_uuid(),'cash',$2::uuid[]) id",[session,ids])).id;
await assert.rejects(save(created,2,'Khu A',false,crypto.randomUUID()),/Bàn còn phiên/);
await db.query('select public.complete_kitchen_order($1)',[order]);
await save(created,2,'Khu A',false,crypto.randomUUID());assert.equal((await fresh()).is_active,false);
await assert.rejects(save(null,0,' khu a ',true,crypto.randomUUID()),/Tên bàn đã tồn tại/);
await assert.rejects(db.query('select public.submit_order($1,gen_random_uuid(),$2::jsonb)',[created,payload]),/không hoạt động/);
await save(created,3,'Khu B',true,crypto.randomUUID());assert.equal((await fresh()).version,4);
assert.equal((await one('select service_label from public.bills where id=$1',[paid])).service_label,'Khu A');
assert.equal((await one('select count(*)::int n from public.table_changes')).n,4);
await assert.rejects(db.exec("update public.restaurant_tables set name='Fake' where id=14"),/permission denied/);
await assert.rejects(db.exec('delete from public.table_changes'),/permission denied/);
await user(2);assert.equal((await one('select count(*)::int n from public.table_changes')).n,0);
await db.exec('reset role');await db.exec('set role anon');await assert.rejects(list(),/permission denied/);await assert.rejects(save(),/permission denied/);
console.log(`PASS: 015 ${after014?'after 014':'directly after 013 with original ID limit'}; fixed Mang về, owner-only list/save, new ID14, idempotent create, name/version checks, busy and paid kitchen guards, deactivate/reactivate, invoice snapshot, journal/RLS/direct-write protection.`);
}finally{await db.close();}
}
