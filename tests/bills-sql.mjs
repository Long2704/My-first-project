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
for(const file of ['003_ordering.sql','004_payments.sql','005_cancellations_audit.sql','006_revenue_report.sql','007_table_transfer.sql','008_menu_management.sql','009_split_bills.sql','010_optional_transfer_reason.sql','011_cancellations_kitchen_history.sql','012_table_actions_merge.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
const user=async n=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[`00000000-0000-0000-0000-00000000000${n}`]);await db.exec('set role authenticated');};
const one=async(sql,p=[])=> (await db.query(sql,p)).rows[0];
await db.exec("insert into auth.users values('00000000-0000-0000-0000-000000000004');insert into public.profiles values('00000000-0000-0000-0000-000000000004','Cashier','thu_ngan');");
await user(1);
const food='10000000-0000-0000-0000-000000000001',drink='10000000-0000-0000-0000-000000000002';
const payload=JSON.stringify([{menu_item_id:food,qty:2,note:'Không hành',expected_price:58000},{menu_item_id:drink,qty:1,expected_price:3000}]);
const order=(await one('select public.submit_order(1,gen_random_uuid(),$1::jsonb) id',[payload])).id;
const session=(await one('select session_id from public.orders where id=$1',[order])).session_id;
const original=(await db.query('select * from public.order_items where order_id=$1 order by id',[order])).rows;
const foodId=original.find(i=>i.category==='bun').id,drinkId=original.find(i=>i.category==='do_uong').id;
const req='60000000-0000-0000-0000-000000000001';
const move=(ids=[drinkId],from=1,to=0,r=req,s=session,reason='Khách trả riêng')=>db.query('select public.move_bill_items($1,$2,$3,$4,$5::uuid[],$6) target',[s,r,from,to,ids,reason]);
await user(2);await assert.rejects(move(),/không có quyền/);
await user(3);await assert.rejects(move(),/không có quyền/);
await user(4);await assert.rejects(move([],1,0),/Chọn từ/);await assert.rejects(move([drinkId,drinkId]),/bị trùng/);await assert.rejects(move([drinkId],1,1),/không hợp lệ/);await assert.rejects(move([drinkId],1,0,req,session,'a'.repeat(501)),/tối đa/);
const target=(await move()).rows[0].target;assert.equal(target,2);assert.equal((await move()).rows[0].target,2);
assert.equal((await one("select count(*)::int n from public.audit_log where type='bill_move'")).n,1);
const after=(await db.query('select * from public.order_items where order_id=$1 order by id',[order])).rows;
assert.deepEqual(after.map(i=>({...i,bill_no:1})),original);assert.equal((await one('select status from public.orders where id=$1',[order])).status,'cooking');
await assert.rejects(move([foodId]),/đã được sử dụng/);
await user(1);
// Không chuyển dòng món của phiên khách khác vào phiên này.
const foreignOrder=(await one('select public.submit_order(2,gen_random_uuid(),$1::jsonb) id',[JSON.stringify([{menu_item_id:food,qty:1}])])).id;
const foreignId=(await one('select id from public.order_items where order_id=$1',[foreignOrder])).id;
await assert.rejects(move([foreignId],1,0,'60000000-0000-0000-0000-000000000010'),/đã thay đổi/);
await assert.rejects(move([drinkId],1,0,'60000000-0000-0000-0000-000000000011'),/đã thay đổi/);
const pay=(bill,ids,r='70000000-0000-0000-0000-000000000001',method='cash',discount=0)=>db.query("select public.pay_bill($1,$2,$3,$4::uuid[],$5,'amount',$6) id",[session,r,method,ids,bill,discount]);
await assert.rejects(pay(1,[foodId,drinkId]),/đã thay đổi/);
const paid1=(await pay(1,[foodId],undefined,'cash',16000)).rows[0].id;
assert.equal((await one('select total from public.bills where id=$1',[paid1])).total,100000);
assert.equal((await one('select closed_at from public.table_sessions where id=$1',[session])).closed_at,null);
await assert.rejects(move([foodId],1,0,'60000000-0000-0000-0000-000000000002'),/đã thay đổi/);
// Món gọi thêm tự vào bill chưa trả nhỏ nhất (Bill 2), không vào Bill 1 đã trả.
const extra=(await one('select public.submit_order(1,gen_random_uuid(),$1::jsonb) id',[JSON.stringify([{menu_item_id:food,qty:1,expected_price:58000}])])).id;
const extraLine=await one('select id,bill_no from public.order_items where order_id=$1',[extra]);assert.equal(extraLine.bill_no,2);
assert.equal((await move([extraLine.id],2,0,'60000000-0000-0000-0000-000000000003')).rows[0].target,3);
// Không gộp vào bill đã trả hoặc số bill không tồn tại.
await assert.rejects(move([drinkId],2,1,'60000000-0000-0000-0000-000000000004'),/Bill đích/);
assert.equal((await move([drinkId],2,3,'60000000-0000-0000-0000-000000000005')).rows[0].target,3);
await db.query('select public.cancel_order_item($1,$2)',[drinkId,'Không dùng nước']);
await assert.rejects(move([drinkId],3,0,'60000000-0000-0000-0000-000000000006'),/đã thay đổi/);
const paid3=(await pay(3,[extraLine.id],'70000000-0000-0000-0000-000000000002','transfer')).rows[0].id;
assert.equal((await one('select total from public.bills where id=$1',[paid3])).total,58000);
assert.notEqual((await one('select closed_at from public.table_sessions where id=$1',[session])).closed_at,null);
assert.equal((await one('select count(*)::int n from public.bill_items')).n,2);
assert.equal((await one('select status from public.orders where id=$1',[order])).status,'cooking');
await user(3);await db.query('select public.complete_kitchen_order($1)',[order]);await db.query('select public.complete_kitchen_order($1)',[order]);
assert.equal((await one('select status from public.orders where id=$1',[order])).status,'done');
await user(4);assert.equal((await one("select count(*)::int n from public.audit_log where type='kitchen_done'")).n,1);
await user(4);assert.equal((await move()).rows[0].target,2); // Retry sau khi toàn bàn đã trả vẫn an toàn.
await assert.rejects(move([extraLine.id],3,0,'60000000-0000-0000-0000-000000000007'),/đã đóng/);
await assert.rejects(db.exec('delete from public.bill_moves'),/permission denied/);
await user(2);assert.equal((await one('select count(*)::int n from public.bill_moves')).n,0);
await db.exec('reset role');await db.exec('set role anon');await assert.rejects(move(),/permission denied/);
console.log('PASS: split/merge role checks, inputs, duplicate retry, preserved rows/kitchen, stale payment rejection, separate invoices/discounts, open-until-last-bill, added items route to unpaid bill, paid/cancelled protection, merge targets, immutable history and retry after closure. PGlite, not concurrent database sessions.');
}finally{await db.close();}
