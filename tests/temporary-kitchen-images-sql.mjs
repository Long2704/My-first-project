import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const one=async(sql,args=[])=> (await db.query(sql,args)).rows[0];
const as=async n=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid(n)]);await db.exec('set role authenticated');};
const rpc=async(name,args=[])=> (await one(`select to_jsonb(public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})) result`,args)).result;
const migration=n=>readFileSync(new URL('../supabase/migrations/'+n,import.meta.url),'utf8');
const request=n=>`00000000-0001-4000-8000-${String(n).padStart(12,'0')}`;
const reserve=n=>rpc('reserve_kitchen_image_upload',[request(n),'a'.repeat(64)]);
const verify=async job=>{await db.exec('reset role;set role service_role');await rpc('verify_kitchen_image_upload',[job.upload_id,1000,640,480]);};
const finalize=job=>rpc('finalize_kitchen_image_upload',[job.upload_id]);
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

 await db.exec(migration('034_kitchen_image_tickets.sql'));
 const beforeSales=(await db.query('select * from orders union all select * from bills')).rows;
 await db.exec(migration('035_temporary_kitchen_images.sql'));
 for(const n of [2,3,5]){await as(n);await assert.rejects(rpc('get_kitchen_image_epoch'),/không có quyền/);}
 await as(1);assert.equal(await rpc('get_kitchen_image_epoch'),'000000000001');assert.equal((await rpc('get_my_access')).data_epoch,0);
 const job=await reserve(1);await verify(job);await as(1);const ticket=await finalize(job);
 await db.exec('reset role');await db.query('insert into storage.objects(bucket_id,name) values($1,$2),($1,$3)',['kitchen-ticket-images',ticket.image_path,ticket.preview_path]);
 await db.query("insert into kitchen_image_uploads(request_id,created_by,sha256,image_path,preview_path,expires_at) values($1,$2,$3,'old/image.webp','old/preview.webp',now()-interval '1 hour')",[request(1),uid(1),'a'.repeat(64)]);await db.exec("insert into storage.objects(bucket_id,name) values('kitchen-ticket-images','old/image.webp'),('kitchen-ticket-images','old/preview.webp')");
 await as(2);assert.equal((await db.query("delete from storage.objects where bucket_id='kitchen-ticket-images' returning name")).rows.length,0);
 await assert.rejects(rpc('complete_kitchen_image_ticket',[ticket.id]),/Cập nhật app/);
 const begun=await rpc('begin_kitchen_image_completion',[ticket.id]);assert.deepEqual(new Set(begun.paths),new Set([ticket.image_path,ticket.preview_path,'old/image.webp','old/preview.webp']));
 await as(1);const again=await rpc('begin_kitchen_image_completion',[ticket.id]);assert.deepEqual(again.paths,begun.paths);
 await db.exec('reset role');assert.equal((await one('select status,delete_started_by from kitchen_image_tickets where id=$1',[ticket.id])).delete_started_by,uid(2));
 // A second in-flight upload remains valid even if completion rotates the global generation.
 await as(1);const inflight=await reserve(2);await verify(inflight);
 await as(3);assert.equal((await db.query("delete from storage.objects where bucket_id='kitchen-ticket-images' returning name")).rows.length,0);await assert.rejects(rpc('complete_kitchen_image_ticket',[ticket.id]),/không có quyền/);
 await as(2);assert.equal((await db.query('delete from storage.objects where name=$1 returning name',[ticket.image_path])).rows.length,1);
 await assert.rejects(rpc('complete_kitchen_image_ticket',[ticket.id]),/Chưa xóa xong/);
 assert.equal((await one('select status from kitchen_image_tickets where id=$1',[ticket.id])).status,'cooking');
 assert.equal((await db.query("delete from storage.objects where name like 'old/%' returning name")).rows.length,2);
 await db.query('delete from storage.objects where name=$1',[ticket.preview_path]);
 const purged=await rpc('complete_kitchen_image_ticket',[ticket.id]);assert.deepEqual(purged,{id:ticket.id,purged:true});
 assert.deepEqual(await rpc('complete_kitchen_image_ticket',[ticket.id]),purged);assert.deepEqual(await rpc('begin_kitchen_image_completion',[ticket.id]),purged);
 await as(1);assert.equal(await rpc('get_kitchen_image_epoch'),'000000000002');assert.deepEqual(await reserve(1),{expired:true});
 assert.equal((await rpc('reserve_kitchen_image_upload',[request(2),'a'.repeat(64)])).upload_id,inflight.upload_id);
 const second=await finalize(inflight);assert.ok(second.id);await rpc('begin_kitchen_image_completion',[second.id]);await rpc('complete_kitchen_image_ticket',[second.id]);
 await db.exec('reset role');assert.equal((await one('select count(*) n from kitchen_image_tickets')).n,0);assert.equal((await one('select count(*) n from kitchen_image_uploads')).n,0);assert.equal((await one('select count(*) n from storage.objects')).n,0);assert.equal((await one('select count(*) n from pos_runtime_settings')).n,1);
 assert.deepEqual((await db.query('select * from orders union all select * from bills')).rows,beforeSales);
 for(const n of [3,5]){await as(n);await assert.rejects(rpc('complete_kitchen_image_ticket',[ticket.id]),/không có quyền/);}
 await db.exec('reset role');await db.query('update profiles set is_active=false where id=$1',[uid(1)]);await as(1);await assert.rejects(rpc('begin_kitchen_image_completion',[ticket.id]),/không có quyền/);await assert.rejects(rpc('complete_kitchen_image_ticket',[ticket.id]),/không có quyền/);
 await db.exec('reset role');for(const sig of ['get_kitchen_image_epoch()','begin_kitchen_image_completion(uuid)','complete_kitchen_image_ticket(uuid)'])assert.equal((await one("select has_function_privilege('anon',$1,'execute') ok",['public.'+sig])).ok,false);
 console.log('PASS SQL 035: bounded single-row generation, Owner-only request epochs, two-phase Storage+SQL purge, no done history, retry without resurrection, partial deletion retry, first deletion actor while pending, role/lock gates, no sales changes. Storage API simulated via RLS-protected metadata deletion.');
}finally{await db.close();}
