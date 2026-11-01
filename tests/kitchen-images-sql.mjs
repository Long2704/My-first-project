import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const one=async(sql,args=[])=> (await db.query(sql,args)).rows[0];
const as=async n=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid(n)]);await db.exec('set role authenticated');};
const rpc=async(name,args=[])=>Object.values(await one(`select to_jsonb(public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})) result`,args))[0];
const reserve=(n=1,hash='a'.repeat(64))=>rpc('reserve_kitchen_image_upload',[uid(100+n),hash]);
const verify=async job=>{await db.exec('reset role;set role service_role');await rpc('verify_kitchen_image_upload',[job.upload_id,1234,640,480]);};
const migrate=()=>db.exec(readFileSync(new URL('../supabase/migrations/034_kitchen_image_tickets.sql',import.meta.url),'utf8'));
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create table public.profiles(id uuid primary key references auth.users(id),name text,role text,is_active boolean default true,must_change_password boolean default false);
 create function public.staff_session_current() returns boolean language sql stable as $$select coalesce(current_setting('test.session_current',true),'true')<>'false'$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;alter table storage.buckets enable row level security;grant all on storage.buckets to authenticated,anon;create policy broad_buckets on storage.buckets for all to authenticated,anon using(true) with check(true);grant usage on schema storage to authenticated,anon;grant all on storage.objects to authenticated,anon;
 -- Existing broad policy must not bypass this feature's restrictive guards.
 create policy existing_broad on storage.objects for all to authenticated,anon using(true) with check(true);
 create table public.orders(id int primary key,amount int);insert into public.orders values(1,100);
 create table public.bills(id int primary key,amount int);insert into public.bills values(1,100);`);
 for(const [n,role] of [[1,'chu'],[2,'bep'],[3,'phuc_vu'],[4,'chu'],[5,'thu_ngan']]){
  await db.query('insert into auth.users values($1)',[uid(n)]);await db.query('insert into profiles(id,name,role) values($1,$2,$2)',[uid(n),role]);
 }
 await migrate();
 const before=await db.query('select * from orders union all select * from bills');
 for(const n of [1,4]){await as(n);assert.equal(await rpc('has_permission',['kitchen_images.upload']),true);assert.ok((await rpc('get_my_access')).permissions.includes('kitchen_images.read'));}
 for(const n of [2,3,5]){await as(n);assert.equal(await rpc('has_permission',['kitchen_images.upload']),false);await assert.rejects(reserve(),/không có quyền/);}
 await as(1);assert.equal((await db.query("update storage.buckets set public=true where id='kitchen-ticket-images' returning *")).rows.length,0);assert.equal((await db.query("delete from storage.buckets where id='kitchen-ticket-images' returning *")).rows.length,0);const job=await reserve();assert.ok(job.image_path.endsWith('/image.webp'));
 await assert.rejects(reserve(),/đang được xử lý/);await assert.rejects(reserve(1,'b'.repeat(64)),/ảnh khác/);
 await assert.rejects(rpc('finalize_kitchen_image_upload',[job.upload_id]),/chưa được xác minh/);
 await assert.rejects(rpc('verify_kitchen_image_upload',[job.upload_id,1,1,1]),/permission denied/);
 await assert.rejects(db.query("insert into kitchen_image_tickets(id) values($1)",[uid(8)]),/permission denied/);
 await verify(job);await as(4);await assert.rejects(rpc('finalize_kitchen_image_upload',[job.upload_id]),/Không tìm thấy/);
 await as(1);const ticket=await rpc('finalize_kitchen_image_upload',[job.upload_id]);assert.equal(ticket.created_by,uid(1));assert.equal(ticket.status,'cooking');assert.equal((await reserve()).ticket.id,ticket.id);assert.equal((await rpc('finalize_kitchen_image_upload',[job.upload_id])).id,ticket.id);
 await db.exec('reset role');await db.query('insert into storage.objects(bucket_id,name) values($1,$2),($1,$3),($1,$4)',['kitchen-ticket-images',ticket.image_path,ticket.preview_path,'orphan']);
 for(const n of [1,2,4]){await as(n);assert.equal((await db.query('select * from kitchen_image_tickets')).rows.length,1);assert.equal((await db.query("select * from storage.objects where bucket_id='kitchen-ticket-images'")).rows.length,2);}
 for(const n of [3,5]){await as(n);assert.equal((await db.query('select * from kitchen_image_tickets')).rows.length,0);assert.equal((await db.query('select * from storage.objects')).rows.length,0);await assert.rejects(rpc('complete_kitchen_image_ticket',[ticket.id]),/không có quyền/);}
 await as(1);await assert.rejects(db.query("update kitchen_image_tickets set status='done',completed_by=created_by,completed_at=now()"),/permission denied/);await assert.rejects(db.query("delete from kitchen_image_tickets"),/permission denied/);await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('kitchen-ticket-images','forged')"),/row-level security/);assert.equal((await db.query("delete from storage.objects where bucket_id='kitchen-ticket-images' returning *")).rows.length,0);
 await as(2);const completed=await rpc('complete_kitchen_image_ticket',[ticket.id]);assert.equal(completed.completed_by,uid(2));
 await as(1);const repeated=await rpc('complete_kitchen_image_ticket',[ticket.id]);assert.equal(repeated.completed_by,uid(2));assert.equal(repeated.completed_at,completed.completed_at);
 for(const field of ['is_active=false','must_change_password=true']){
  await db.exec('reset role');await db.exec('update profiles set '+field+" where role='chu'");await as(1);await assert.rejects(reserve(2),/không có quyền/);await assert.rejects(rpc('complete_kitchen_image_ticket',[ticket.id]),/không có quyền/);assert.equal((await db.query('select * from kitchen_image_tickets')).rows.length,0);assert.equal((await db.query('select * from storage.objects')).rows.length,0);
  await db.exec('reset role');await db.exec("update profiles set is_active=true,must_change_password=false");
 }
 await as(1);await db.exec("select set_config('test.session_current','false',false)");await assert.rejects(reserve(2),/không có quyền/);await db.exec("select set_config('test.session_current','true',false)");
 // A failed upload never inserts a ticket. Cleanup claim blocks later finalization.
 const failed=await reserve(2);await verify(failed);await db.exec('reset role');await db.query("update kitchen_image_uploads set expires_at=now()-interval '2 hours' where id=$1",[failed.upload_id]);
 await db.exec('set role service_role');const claimed=await rpc('claim_kitchen_image_cleanup',[uid(1)]);assert.equal(claimed.id,failed.upload_id);await as(1);await assert.rejects(rpc('finalize_kitchen_image_upload',[failed.upload_id]),/hết hạn/);
 const retry=await reserve(2);assert.notEqual(retry.upload_id,failed.upload_id);assert.notEqual(retry.image_path,failed.image_path);await verify(retry);await as(1);await rpc('finalize_kitchen_image_upload',[retry.upload_id]);
 await db.exec('reset role;set role service_role');const candidates=(await db.query('select * from public.claim_kitchen_image_cleanup($1)',[uid(1)])).rows;assert.ok(candidates.every(j=>j.id!==job.upload_id&&j.id!==retry.upload_id));
 await db.exec('reset role');assert.deepEqual(await db.query('select * from orders union all select * from bills'),before);
 await db.exec('set role anon');assert.equal((await db.query('select * from storage.objects')).rows.length,0);await db.exec('reset role');
 // API privileges, including anon and service-only attestation.
 for(const signature of ['reserve_kitchen_image_upload(uuid,text)','finalize_kitchen_image_upload(uuid)','complete_kitchen_image_ticket(uuid)','verify_kitchen_image_upload(uuid,integer,integer,integer)'])assert.equal((await one("select has_function_privilege('anon',$1,'execute') ok",['public.'+signature])).ok,false);
 const count=(await one('select count(*) n from kitchen_image_tickets')).n;
 await db.exec(readFileSync(new URL('../supabase/rollbacks/034_kitchen_image_tickets.sql',import.meta.url),'utf8'));
 await as(1);assert.equal((await db.query('select * from kitchen_image_tickets')).rows.length,0);assert.equal((await db.query('select * from storage.objects')).rows.length,0);await db.exec('reset role');assert.equal((await one('select count(*) n from kitchen_image_tickets')).n,count);
 console.log('PASS SQL 034: role/session gates, private Storage RLS (including broad-policy guards), server actors, verified-only finalize, idempotency, first completer, cleanup races, no sales writes, rollback retains history. PGlite fixtures; not live Supabase.');
}finally{await db.close();}
