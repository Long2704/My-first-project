import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// Extend the existing complete 001–033 business fixture; compare actual financial/table/report snapshots.
export async function checkKitchenImageIsolation(db,owner,kitchen){
 const sql=path=>readFileSync(new URL('../../supabase/'+path,import.meta.url),'utf8');
 const one=async(text,args=[])=> (await db.query(text,args)).rows[0];
 const as=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
 const snapshot=async()=>{
  const result={};for(const table of ['orders','order_items','table_sessions','bills','bill_items','restaurant_tables','table_cancellations','audit_log'])result[table]=(await db.query('select to_jsonb(t) value from public.'+table+' t order by to_jsonb(t)::text')).rows;
  return result;
 };
 await db.exec('reset role');const before=await snapshot();
 await as(owner);const reportBefore=await one("select public.revenue_report(current_date-1,current_date+1)-'generated_at' result");
 await db.exec(`reset role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;alter table storage.buckets enable row level security;`);
 await db.exec(sql('migrations/034_kitchen_image_tickets.sql'));
 await as(owner);const job=(await one("select public.reserve_kitchen_image_upload(gen_random_uuid(),$1) result",['c'.repeat(64)])).result;
 await db.exec('reset role;set role service_role');await db.query('select public.verify_kitchen_image_upload($1,1000,800,600)',[job.upload_id]);
 await as(owner);const ticket=(await one('select to_jsonb(public.finalize_kitchen_image_upload($1)) result',[job.upload_id])).result;
 await as(kitchen);await db.query('select public.complete_kitchen_image_ticket($1)',[ticket.id]);
 await as(owner);assert.deepEqual(await one("select public.revenue_report(current_date-1,current_date+1)-'generated_at' result"),reportBefore);
 await db.exec('reset role');assert.deepEqual(await snapshot(),before);
 await db.exec(sql('rollbacks/034_kitchen_image_tickets.sql'));assert.deepEqual(await snapshot(),before);
 console.log('ĐẠT cách ly 034 trên fixture nghiệp vụ 001–033: tạo/hoàn thành/rollback phiếu ảnh giữ nguyên orders, items, sessions, bills, bill_items, tables, cancellations, audit và kết quả revenue_report thực tế.');
}
