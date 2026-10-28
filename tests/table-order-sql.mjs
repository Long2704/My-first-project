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

await db.exec('reset role');await db.exec(readFileSync(new URL('../supabase/migrations/016_table_order.sql',import.meta.url),'utf8'));await user(1);
const list=()=>one('select public.list_table_management() items');
await db.query("select public.save_restaurant_table(gen_random_uuid(),2,1,'Bàn 2',false)");
const original=(await list()).items;const before=original.map(t=>t.id);const desired=[before.at(-1),...before.slice(0,-1)];
const request=crypto.randomUUID();const reorder=(expected=before,ordered=desired,r=request)=>db.query('select public.reorder_restaurant_tables($1,$2::integer[],$3::integer[])',[r,expected,ordered]);
for(const n of [2,3,4]){await user(n);await assert.rejects(reorder(),/Chỉ chủ quán/);}await user(1);
await assert.rejects(reorder(before,desired.slice(1)),/không hợp lệ/);await assert.rejects(reorder(before,desired.map(()=>1)),/không hợp lệ/);
await assert.rejects(reorder(before,desired.map((n,i)=>i===0?-1:n)),/không hợp lệ/);
// Busy tables can move visually without changing the session or order.
const order=(await one('select public.submit_order(1,gen_random_uuid(),$1::jsonb) id',[JSON.stringify([{menu_item_id:food,qty:1}])])).id;
const orderBefore=await one('select * from public.orders where id=$1',[order]);
await reorder();await reorder();assert.deepEqual((await list()).items.map(t=>t.id),desired);
assert.deepEqual(await one('select * from public.orders where id=$1',[order]),orderBefore);
assert.deepEqual((await list()).items.map(t=>[t.id,t.version]).sort((a,b)=>a[0]-b[0]),original.map(t=>[t.id,t.version]));
assert.equal((await one("select count(*)::int n from public.audit_log where type='table_order'")).n,1);
await assert.rejects(reorder(before,[...desired].reverse()),/đã được sử dụng/);
await assert.rejects(reorder(before,before,crypto.randomUUID()),/đã thay đổi/);
await db.query("select public.save_restaurant_table(gen_random_uuid(),2,2,'Bàn 2',true)");assert.deepEqual((await list()).items.map(t=>t.id),desired);
const newId=(await one("select public.save_restaurant_table(gen_random_uuid(),null,0,'Bàn mới',true) id")).id;
assert.equal((await list()).items.at(-1).id,newId);
await assert.rejects(reorder(desired,[...desired].reverse(),crypto.randomUUID()),/đã thay đổi/);
await reorder();assert.equal((await list()).items.at(-1).id,newId); // Replay does not undo later creation.
const current=(await list()).items.map(t=>t.id);await reorder(current,[...current].reverse(),crypto.randomUUID());
assert.deepEqual((await list()).items.map(t=>t.id),[...current].reverse());
await assert.rejects(db.exec('delete from public.table_order_changes'),/permission denied/);
await user(2);assert.equal((await one('select count(*)::int n from public.table_order_changes')).n,0);
await db.exec('reset role');await db.exec('set role anon');await assert.rejects(reorder(),/permission denied/);
console.log(`PASS: 016 after 015 (${after014?'via 014':'direct upgrade'}), owner-only reorder, list/display order, validation, duplicate replay, stale order/addition rejection, new tables append, preserved busy session/items/versions, audit/RLS and anonymous denial. PGlite only.`);
}finally{await db.close();}
}
