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
  await db.exec(migration('022_payment_permissions.sql'));
  await db.exec(migration('023_kitchen_service_access.sql'));
  const access=async()=> (await one('select public.get_my_access() data')).data;
  const pay=async(session,ids,request=crypto.randomUUID(),bill=1,discount=0)=>
    one("select public.pay_bill($1,$2,'cash',$3::uuid[],$4,'amount',$5,null) id",[session,request,ids,bill,discount]);
  const orderFor=async(n,table=1)=>{
    await asUser(n);
    return one('select public.submit_order($1,gen_random_uuid(),$2::jsonb) id',[
      table,JSON.stringify([{menu_item_id:food,qty:1},{menu_item_id:drink,qty:1}])
    ]);
  };
  const sessionFor=async(order)=>(await one('select session_id from public.orders where id=$1',[order])).session_id;
  const unpaid=async(session,bill=1)=>(await db.query(`select i.id from public.order_items i join public.orders o on o.id=i.order_id
    where o.session_id=$1 and i.bill_no=$2 and not i.paid and i.cancelled_at is null order by i.id`,[session,bill])).rows.map(i=>i.id);
  await asUser(3);
  const a=await access();
  assert.equal(a.role,'bep');assert.equal(a.is_active,true);
  for(const key of ['orders.create','payments.collect','kitchen.complete','tables.transfer','bills.split'])assert.ok(a.permissions.includes(key));
  for(const key of ['reports.read','audit.read','employees.manage','payments.discount','menu.manage'])assert.ok(!a.permissions.includes(key));
  const kitchenOrder=await orderFor(3);
  let kitchenSession=await sessionFor(kitchenOrder.id);
  let lines=(await db.query('select id,category from public.order_items where order_id=$1',[kitchenOrder.id])).rows;
  assert.equal(lines.length,2);assert.ok(lines.some(i=>i.category==='do_uong'));
  await db.query('select public.complete_kitchen_order($1)',[kitchenOrder.id]);
  await db.query('select public.complete_kitchen_order($1)',[kitchenOrder.id]);
  assert.equal((await one('select status from public.orders where id=$1',[kitchenOrder.id])).status,'done');
  const moveRequest=crypto.randomUUID();
  const split=(request=moveRequest)=>one("select public.move_bill_items($1,$2,1,0,$3::uuid[],'') bill",[kitchenSession,request,[lines[0].id]]);
  const splitBill=(await split()).bill;assert.equal((await split()).bill,splitBill);
  assert.equal(splitBill,2);
  // Chuyển vào bàn trống qua wrapper: cả wrapper và internal đều phải cho phép.
  const transferRequest=crypto.randomUUID();
  const transfer=()=>one("select public.transfer_table($1,1,2,$2,'',null) id",[kitchenSession,transferRequest]);
  assert.equal((await transfer()).id,kitchenSession);assert.equal((await transfer()).id,kitchenSession);
  await assert.rejects(db.query("select public.transfer_dine_in_internal($1,2,1,gen_random_uuid(),'',null)",[kitchenSession]),/permission denied/);
  assert.deepEqual((await one('select table_path from public.orders where id=$1',[kitchenOrder.id])).table_path,[1,2]);
  // Chuyển vào bàn đã có đơn, giữ các bill và đường đi của đơn.
  const waiterOrder=await orderFor(2,1);
  const targetSession=await sessionFor(waiterOrder.id);
  await asUser(3);
  assert.equal((await one("select public.transfer_table($1,2,1,gen_random_uuid(),'',$2) id",[kitchenSession,targetSession])).id,targetSession);
  kitchenSession=targetSession;
  assert.deepEqual((await one('select table_path from public.orders where id=$1',[kitchenOrder.id])).table_path,[1,2,1]);
  const bills=(await db.query(`select distinct i.bill_no from public.order_items i join public.orders o on o.id=i.order_id
    where o.session_id=$1 and not i.paid order by i.bill_no`,[kitchenSession])).rows.map(r=>r.bill_no);
  // Owner thanh toán bill 1; Kitchen chỉ được đọc các bill do mình thanh toán.
  await asUser(1);
  const ownerBill=await pay(kitchenSession,await unpaid(kitchenSession,1));
  await asUser(3);
  const kitchenBills=[];
  for(const billNo of bills.filter(b=>b!==1)){
    const ids=await unpaid(kitchenSession,billNo),request=crypto.randomUUID();
    await assert.rejects(pay(kitchenSession,ids,request,billNo,1),/Chỉ Owner/);
    const bill=await pay(kitchenSession,ids,request,billNo);
    assert.equal((await pay(kitchenSession,ids,request,billNo)).id,bill.id);
    kitchenBills.push({id:bill.id,ids,request,billNo});
  }
  assert.equal((await db.query('select id from public.bills where id=$1',[ownerBill.id])).rows.length,0);
  assert.equal((await db.query('select id from public.bill_items where bill_id=$1',[ownerBill.id])).rows.length,0);
  assert.equal((await db.query('select * from public.bill_orders where bill_id=$1',[ownerBill.id])).rows.length,0);
  assert.equal((await db.query('select id from public.bills')).rows.length,kitchenBills.length);
  for(const bill of kitchenBills){
    assert.equal((await db.query('select id from public.bills where id=$1',[bill.id])).rows.length,1);
    assert.ok((await db.query('select id from public.bill_items where bill_id=$1',[bill.id])).rows.length>0);
    assert.ok((await db.query('select order_id from public.bill_orders where bill_id=$1',[bill.id])).rows.length>0);
  }
  assert.equal((await db.query('select * from public.audit_log')).rows.length,0);
  await assert.rejects(db.query("select public.revenue_report('2026-10-01','2026-10-31')"),/quyền/);
  await assert.rejects(db.query('select public.list_menu_management()'),/Chỉ chủ quán/);
  await assert.rejects(db.query('select public.cancel_order_item($1,\'\')',[lines[0].id]),/quyền/);
  console.log('ĐẠT: Kitchen xem món nước, tạo/hoàn thành đơn, tách bill, chuyển bàn trống/đã order; hóa đơn chỉ của mình và không xem audit/report/menu admin.');

  // Thử chặn ngay trên JWT cũ: không đổi request.jwt.claim.sub khi khóa/mở khóa.
  await db.exec('reset role');
  await db.query("insert into public.takeaway_requests(request_id,user_id,session_id,customer_note) values(gen_random_uuid(),$1,$2,'test')",[uid(3),kitchenSession]);
  await db.exec('set role authenticated');
  assert.equal((await db.query('select * from public.takeaway_requests')).rows.length,1);
  await db.exec('reset role');
  await db.query('update public.profiles set is_active=false where id=$1',[uid(3)]);
  await db.exec('set role authenticated');
  const locked=await access();assert.equal(locked.is_active,false);assert.deepEqual(locked.permissions,[]);
  for(const table of ['bills','bill_items','bill_orders','order_items','orders','table_sessions','takeaway_requests']){
    assert.equal((await one('select count(*)::int n from public.'+table)).n,0,table);
  }
  const paid=kitchenBills[0];
  await assert.rejects(pay(kitchenSession,paid.ids,paid.request,paid.billNo),/không có quyền thanh toán/);
  await assert.rejects(submit(),/không có quyền gửi đơn/);
  await assert.rejects(db.query('select public.complete_kitchen_order($1)',[kitchenOrder.id]),/không có quyền/);
  await assert.rejects(transfer(),/không có quyền/);
  await assert.rejects(split(),/không có quyền/);
  await db.exec('reset role');
  await db.query('update public.profiles set is_active=true where id=$1',[uid(3)]);
  await db.exec('set role authenticated');
  assert.equal((await pay(kitchenSession,paid.ids,paid.request,paid.billNo)).id,paid.id);
  console.log('ĐẠT: Kitchen bị khóa không đọc dữ liệu nghiệp vụ, không gửi/hoàn thành/chuyển/tách/thanh toán kể cả replay; mở khóa khôi phục quyền.');

  await asUser(2);
  assert.equal((await db.query('select * from public.bills')).rows.length,0);
  await assert.rejects(db.query('select public.complete_kitchen_order($1)',[kitchenOrder.id]),/không có quyền/);
  const waiterNew=await orderFor(2,2),waiterSession=await sessionFor(waiterNew.id);
  const waiterBill=await pay(waiterSession,await unpaid(waiterSession));
  assert.equal((await one('select cashier_id from public.bills where id=$1',[waiterBill.id])).cashier_id,uid(2));
  await asUser(1);
  assert.equal((await db.query('select * from public.bills')).rows.length,kitchenBills.length+2);
  await asUser(4);assert.deepEqual((await access()).permissions,[]);
  await asUser(5);assert.equal(await access(),null);
  await db.exec('reset role; set role anon');
  await assert.rejects(access(),/permission denied/);
  await db.exec('reset role');
  const count=(await one('select count(*)::int n from public.bills')).n;
  await db.exec(readFileSync(new URL('../supabase/rollbacks/023_kitchen_service_access.sql',import.meta.url),'utf8'));
  assert.equal((await one("select to_regprocedure('public.get_my_access()') fn")).fn,null);
  await db.exec(migration('023_kitchen_service_access.sql'));
  assert.equal((await one('select count(*)::int n from public.bills')).n,count);
  console.log('ĐẠT: Owner xem tất cả, Waiter xem hóa đơn mình và vẫn thanh toán, ẩn danh bị từ chối; rollback/apply giữ nguyên giao dịch.');
  console.log('PGlite/Auth giả lập. Không thao tác Supabase thật; không giả nhận kiểm thử hai kết nối đồng thời.');
} finally { await db.close(); }
