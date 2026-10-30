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


  for(const name of ['021_central_permissions.sql','022_payment_permissions.sql','023_kitchen_service_access.sql'])await db.exec(migration(name));
  const report=async(from='2026-10-29',to=from)=>(await one('select public.revenue_report($1::date,$2::date) data',[from,to])).data;
  const paid=async(items,at,discount=0,actor=1)=>{
    await asUser(actor);
    const order=await one('select public.submit_order(1,gen_random_uuid(),$1::jsonb) id',[JSON.stringify(items)]);
    const session=(await one('select session_id from public.orders where id=$1',[order.id])).session_id;
    const ids=(await db.query('select id from public.order_items where order_id=$1',[order.id])).rows.map(i=>i.id);
    const bill=await one("select public.pay_bill($1,gen_random_uuid(),'cash',$2::uuid[],1,'amount',$3,null) id",[session,ids,discount]);
    await db.exec('reset role');await db.query('update public.bills set paid_at=$1 where id=$2',[at,bill.id]);
    return bill.id;
  };
  const items=[];
  for(let i=0;i<25;i++){
    const id=crypto.randomUUID(),name=`Món thử ${String(i+1).padStart(2,'0')}`,category=['bun','an_them','do_uong'][i%3];
    await db.query('insert into public.menu_items(id,name,price,category) values($1,$2,$3,$4)',[id,name,1000+i,category]);
    items.push({menu_item_id:id,qty:2});
  }
  const bigBill=await paid(items,'2026-10-28T17:00:00Z',1000);
  await paid([{menu_item_id:drink,qty:1}],'2026-10-29T16:59:59Z');
  await paid([{menu_item_id:food,qty:1}],'2026-10-28T16:59:59Z');
  await paid([{menu_item_id:food,qty:1}],'2026-10-29T17:00:00Z');
  await asUser(1);assert.equal((await report()).products.length,20);
  await db.exec('reset role');
  const beforeBill=await one('select * from public.bills where id=$1',[bigBill]);
  const skipped=['table_order','table_update','takeaway_created','takeaway_discarded','menu_update'];
  for(const type of skipped)await db.query('insert into public.audit_log(type,user_id) values($1,$2)',[type,uid(1)]);
  const beforeLogs=(await db.query('select * from public.audit_log order by id')).rows;
  await db.exec(migration('024_management_reports_audit.sql'));
  assert.deepEqual(await one('select * from public.bills where id=$1',[bigBill]),beforeBill);
  assert.deepEqual((await db.query('select * from public.audit_log order by id')).rows,beforeLogs);
  // Giá hiện tại thay đổi không được ảnh hưởng tiền món trên hóa đơn.
  await db.exec('update public.menu_items set price=999999');
  await asUser(1);
  const result=await report();
  assert.equal(result.products_complete,true);assert.equal(result.products.length,26);
  assert.equal(result.invoices,2);assert.equal(result.gross,53600);assert.equal(result.discount,1000);assert.equal(result.total,52600);
  assert.equal(result.products.reduce((sum,p)=>sum+p.gross,0),result.gross);
  assert.equal(result.products.reduce((sum,p)=>sum+p.qty,0),51);
  assert.equal(result.days.length,1);assert.equal(result.days[0].day,'2026-10-29');
  assert.ok(result.products.some(p=>p.name==='Trà thử'&&p.qty===1&&p.gross===3000));
  for(let i=0;i<25;i++)assert.deepEqual(result.products.find(p=>p.name===`Món thử ${String(i+1).padStart(2,'0')}`),{name:`Món thử ${String(i+1).padStart(2,'0')}`,qty:2,gross:2*(1000+i)});
  assert.equal((await report('2026-10-29','2026-10-30')).invoices,3);
  const empty=await report('2020-01-01');assert.equal(empty.products_complete,true);assert.deepEqual(empty.products,[]);assert.equal(empty.total,0);
  await assert.rejects(report('2026-10-30','2026-10-29'),/khoảng ngày/);
  await assert.rejects(report('2020-01-01','2026-10-29'),/khoảng ngày/);
  await assert.rejects(report(null),/khoảng ngày/);
  console.log('ĐẠT: 26 món gồm món chính/phụ/nước, toàn khoảng ngày VN, không giới hạn 20, tổng tiền snapshot trước giảm giá khớp hóa đơn, không tính đơn ngoài khoảng.');

  // Cập nhật/menu/bàn và sắp xếp vẫn hoạt động, giữ mã chống trùng nhưng không ghi audit loại bị bỏ.
  await db.exec('reset role');
  const counts=async()=>{
    const map={};for(const type of skipped)map[type]=(await one('select count(*)::int n from public.audit_log where type=$1',[type])).n;return map;
  };
  const oldCounts=await counts();
  await asUser(1);
  const menuRequest=crypto.randomUUID();
  const saveMenu=()=>db.query("select public.save_menu_item($1,$2,1,'Tên món thử mới',58000,'bun',true,false,0)",[menuRequest,food]);
  await saveMenu();await saveMenu();
  await db.query("select public.save_restaurant_table(gen_random_uuid(),2,1,'Bàn đổi tên',true)");
  const tables=(await one('select public.list_table_management() data')).data.map(t=>t.id);
  await db.query('select public.reorder_restaurant_tables(gen_random_uuid(),$1::integer[],$2::integer[])',[tables,[...tables].reverse()]);
  await db.exec('reset role');
  for(const type of skipped)await db.query('insert into public.audit_log(type,user_id) values($1,$2)',[type,uid(1)]);
  assert.deepEqual(await counts(),oldCounts);
  assert.equal((await one('select count(*)::int n from public.menu_changes where request_id=$1',[menuRequest])).n,1);
  assert.equal((await one('select name from public.restaurant_tables where id=2')).name,'Bàn đổi tên');
  // Những sự kiện tài chính, hủy và phân quyền tương lai không bị filter chặn.
  for(const type of ['payment','cancel_item','cancel_table','bill_move','table_transfer','order_created','kitchen_done','staff_locked']){
    const before=(await one('select count(*)::int n from public.audit_log where type=$1',[type])).n;
    await db.query('insert into public.audit_log(type,user_id) values($1,$2)',[type,uid(1)]);
    assert.equal((await one('select count(*)::int n from public.audit_log where type=$1',[type])).n,before+1);
  }
  // Một thanh toán thật sau migration vẫn phải có audit và ảnh hưởng đúng báo cáo.
  const newBill=await paid([{menu_item_id:food,qty:1}],'2026-10-29T02:00:00Z',0,3);
  assert.equal((await one("select count(*)::int n from public.audit_log where type='payment' and bill_id=$1",[newBill])).n,1);
  await asUser(1);assert.equal((await report()).total,110600);
  for(const actor of [2,3,4,5,0]){await asUser(actor);await assert.rejects(report(),/không có quyền/);}
  await db.exec('reset role; set role anon');await assert.rejects(report(),/permission denied/);
  await db.exec('reset role');
  console.log('ĐẠT: ngừng 5 loại audit mới, giữ toàn bộ lịch sử cũ và idempotency; thanh toán và các sự kiện quan trọng vẫn ghi, report chỉ Owner.');

  const billCount=(await one('select count(*)::int n from public.bills')).n;
  const oldAuditCount=(await one('select count(*)::int n from public.audit_log')).n;
  await db.exec(readFileSync(new URL('../supabase/rollbacks/024_management_reports_audit.sql',import.meta.url),'utf8'));
  await db.query("insert into public.audit_log(type,user_id) values('menu_update',$1)",[uid(1)]);
  assert.equal((await one('select count(*)::int n from public.audit_log')).n,oldAuditCount+1);
  await db.exec(migration('024_management_reports_audit.sql'));
  assert.equal((await one('select count(*)::int n from public.bills')).n,billCount);
  assert.deepEqual(await one('select * from public.bills where id=$1',[bigBill]),beforeBill);
  console.log('ĐẠT: rollback khôi phục ghi từ thời điểm quay lại, áp dụng lại không mất hóa đơn/lịch sử. PGlite/Auth giả lập, không thay Supabase thật.');
} finally { await db.close(); }
