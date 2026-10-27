import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
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
for(const file of ['003_ordering.sql','004_payments.sql','005_cancellations_audit.sql','006_revenue_report.sql','007_table_transfer.sql','008_menu_management.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
const user=async n=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[`00000000-0000-0000-0000-00000000000${n}`]);await db.exec('set role authenticated');};
const one=async(sql,p=[])=> (await db.query(sql,p)).rows[0];
await user(1);
async function paid(method,discount,at){
 const o=(await one('select public.submit_order(1,gen_random_uuid(),$1::jsonb) id',[JSON.stringify([{menu_item_id:'10000000-0000-0000-0000-000000000001',qty:2}])])).id;
 const session=(await one('select session_id from public.orders where id=$1',[o])).session_id;
 const ids=(await db.query('select id from public.order_items where order_id=$1',[o])).rows.map(i=>i.id);
 const b=(await one("select public.pay_bill($1,gen_random_uuid(),$2,$3::uuid[],1,'amount',$4) id",[session,method,ids,discount])).id;
 await db.exec('reset role');await db.query('update public.bills set paid_at=$1 where id=$2',[at,b]);await user(1);
}
await paid('cash',6000,'2026-10-26T16:59:59Z'); // outside selected VN day
await paid('cash',16000,'2026-10-26T17:00:00Z'); // first instant VN 27
await paid('transfer',6000,'2026-10-27T16:59:59Z'); // last second VN 27
await paid('cash',0,'2026-10-27T17:00:00Z'); // VN 28, exclusive upper bound
const report=async(a='2026-10-27',b=a)=>(await one('select public.revenue_report($1::date,$2::date) data',[a,b])).data;
// Đơn chưa trả và món hủy không được tính vào doanh thu.
const pending=(await one('select public.submit_order(2,gen_random_uuid(),$1::jsonb) id',[JSON.stringify([{menu_item_id:'10000000-0000-0000-0000-000000000001',qty:1},{menu_item_id:'10000000-0000-0000-0000-000000000002',qty:1}])])).id;
const cancelled=(await one("select id from public.order_items where order_id=$1 and category='bun'",[pending])).id;
await db.query('select public.cancel_order_item($1,$2)',[cancelled,'Khách đổi ý']);
await db.exec('reset role');await db.exec('update public.menu_items set price=99000');await user(1);
let r=await report();
assert.equal(r.invoices,2);assert.equal(r.gross,232000);assert.equal(r.discount,22000);assert.equal(r.total,210000);assert.equal(r.cash,100000);assert.equal(r.transfer,110000);
assert.equal(r.days.length,1);assert.equal(r.days[0].day,'2026-10-27');assert.equal(r.days[0].total,r.total);
assert.deepEqual(r.products,[{name:'Bún riêu',qty:4,gross:232000}]);
r=await report('2026-10-27','2026-10-28');assert.equal(r.invoices,3);assert.equal(r.days.length,2);
r=await report('2020-01-01');assert.equal(r.total,0);assert.equal(r.invoices,0);assert.deepEqual(r.days,[]);assert.deepEqual(r.products,[]);
await assert.rejects(report('2026-10-28','2026-10-27'),/khoảng ngày/);
await assert.rejects(report('2020-01-01','2026-01-01'),/khoảng ngày/);
await user(2);await assert.rejects(report(),/không có quyền/);
await user(3);await assert.rejects(report(),/không có quyền/);
await db.exec('reset role');await db.exec('set role anon');await assert.rejects(report(),/permission denied/);
console.log('PASS: revenue report role/anonymous restrictions, VN midnight boundaries, cash/transfer, discounts, invoice snapshots, daily totals, empty periods and invalid date ranges. PGlite only.');
}finally{await db.close();}
