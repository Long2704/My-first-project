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
for(const file of ['003_ordering.sql','004_payments.sql','005_cancellations_audit.sql','006_revenue_report.sql','007_table_transfer.sql','008_menu_management.sql','009_split_bills.sql','010_optional_transfer_reason.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
const user=async n=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[`00000000-0000-0000-0000-00000000000${n}`]);await db.exec('set role authenticated');};
const one=async(sql,p=[])=> (await db.query(sql,p)).rows[0];
await db.exec("insert into public.restaurant_tables(id,name,is_active) values (3,'Bàn 3',true),(4,'Bàn 4',false)");
await user(1);
const payload=JSON.stringify([{menu_item_id:'10000000-0000-0000-0000-000000000001',qty:2,note:'Không hành'},{menu_item_id:'10000000-0000-0000-0000-000000000002',qty:1}]);
const req='20000000-0000-0000-0000-000000000001';
const order=(await one('select public.submit_order(1,$1,$2::jsonb) id',[req,payload])).id;
const session=(await one('select session_id from public.orders where id=$1',[order])).session_id;
const before=(await db.query('select * from public.order_items where order_id=$1 order by id',[order])).rows;
const moveReq='40000000-0000-0000-0000-000000000001';
const move=(from=1,to=2,r=moveReq,s=session,reason='Khách đổi vị trí')=>db.query('select public.transfer_table($1,$2,$3,$4,$5) id',[s,from,to,r,reason]);
await user(2);await assert.rejects(move(),/không có quyền/);
await user(3);await assert.rejects(move(),/không có quyền/);
await user(1);
await assert.rejects(move(1,1),/không hợp lệ/);
await assert.rejects(move(1,2,moveReq,session,'a'.repeat(501)),/Lý do/);
await assert.rejects(move(1,4),/không hoạt động/);
assert.equal((await move()).rows[0].id,session);
assert.equal((await move()).rows[0].id,session);
assert.equal((await one("select count(*)::int n from public.audit_log where type='table_transfer'")).n,1);
assert.equal((await one('select table_id from public.table_sessions where id=$1',[session])).table_id,2);
assert.deepEqual((await db.query('select * from public.order_items where order_id=$1 order by id',[order])).rows,before);
assert.equal((await one('select status from public.orders where id=$1',[order])).status,'cooking');
// Gửi lại đơn từ bàn gốc sau chuyển phải trả về chính đơn cũ.
assert.equal((await one('select public.submit_order(1,$1,$2::jsonb) id',[req,payload])).id,order);
await assert.rejects(db.query('select public.submit_order(2,$1,$2::jsonb)',[req,payload]),/không thuộc bàn/);
await assert.rejects(move(1,3,'40000000-0000-0000-0000-000000000002'),/đã chuyển sang bàn khác/);
await assert.rejects(move(1,3,moveReq),/đã được sử dụng/);
// Bàn nguồn nhận phiên khách mới, không được thử chuyển phiên cũ về đó.
const second=(await one('select public.submit_order(1,gen_random_uuid(),$1::jsonb) id',[payload])).id;
await assert.rejects(move(2,1,'40000000-0000-0000-0000-000000000003'),/đang có khách/);
const drink=before.find(i=>i.category==='do_uong').id;
await db.query('select public.cancel_order_item($1,$2)',[drink,'Không dùng nước']);
const food=before.find(i=>i.category==='bun').id;
const bill=(await one("select public.pay_bill($1,gen_random_uuid(),'cash',$2::uuid[]) id",[session,[food]])).id;
assert.equal((await one('select table_no from public.bills where id=$1',[bill])).table_no,2);
assert.equal((await one('select total from public.bills where id=$1',[bill])).total,116000);
// Retry yêu cầu chuyển đã thành công vẫn an toàn kể cả phiên đã trả tiền.
assert.equal((await move()).rows[0].id,session);
await assert.rejects(move(2,3,'40000000-0000-0000-0000-000000000004'),/đã đóng/);
await db.query('select public.complete_kitchen_order($1)',[order]);
assert.equal((await one('select status from public.orders where id=$1',[order])).status,'done');
// Trống, chỉ khoảng trắng, null và bỏ tham số đều hợp lệ và lưu thành chuỗi trống.
const session2=(await one('select session_id from public.orders where id=$1',[second])).session_id;
const blankReq='40000000-0000-0000-0000-000000000005';
await move(1,3,blankReq,session2,'  ');
assert.equal((await one('select reason from public.table_transfers where request_id=$1',[blankReq])).reason,'');
assert.equal((await move(1,3,blankReq,session2,null)).rows[0].id,session2);
assert.equal((await one("select extra->>'reason' reason from public.audit_log where type='table_transfer' and session_id=$1 order by created_at desc limit 1",[session2])).reason,'');
await db.query('select public.transfer_table($1,3,2,$2)',[session2,'40000000-0000-0000-0000-000000000006']);
assert.equal((await one('select table_id from public.table_sessions where id=$1',[session2])).table_id,2);
assert.equal((await one('select reason from public.table_transfers where request_id=$1',[moveReq])).reason,'Khách đổi vị trí');
await assert.rejects(db.exec('delete from public.table_transfers'),/permission denied/);
await user(2);assert.equal((await one('select count(*)::int n from public.table_transfers')).n,0);
await db.exec('reset role');await db.exec('set role anon');await assert.rejects(move(),/permission denied/);
console.log('PASS: transfer permissions, optional blank/null/omitted reason, trimmed retry and max length, validation, inactive/occupied targets, stable session/items/kitchen, idempotent retry, submit retry from original table, stale source rejection, original table reuse, cancel/pay/complete after transfer and immutable transfer history. PGlite; not concurrent database sessions.');
}finally{await db.close();}
