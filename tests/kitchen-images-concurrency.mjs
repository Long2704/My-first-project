// Real PostgreSQL, two independent connections. Storage/Auth schemas are fixtures, not live Supabase services.
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const env={...process.env};for(const name of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[name];
const name='pos-kitchen-image-concurrency-'+process.pid;
const docker=(args,input)=>execFileSync('docker',['--host=unix:///var/run/docker.sock',...args],{env,input,encoding:'utf8',stdio:['pipe','pipe','pipe']});
const sql=input=>docker(['exec','-i',name,'psql','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1','-At'],input);
const owner='00000000-0000-0000-0000-000000000001',kitchen='00000000-0000-0000-0000-000000000002';
const as=(id,body)=>`set role authenticated;set request.jwt.claim.sub='${id}';${body}`;
try{
 docker(['run','-d','--name',name,'--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine']);
 let healthy=false;for(let n=0;n<50;n++){try{docker(['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres']);healthy=true;break;}catch{await new Promise(r=>setTimeout(r,200));}}
 assert.ok(healthy,'PostgreSQL starts');
 sql(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.profiles(id uuid primary key references auth.users(id),name text,role text,is_active boolean default true,must_change_password boolean default false);
 create function public.staff_session_current() returns boolean language sql stable as $$select true$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;alter table storage.buckets enable row level security;
 insert into auth.users values('${owner}'),('${kitchen}');insert into profiles(id,name,role) values('${owner}','Owner','chu'),('${kitchen}','Kitchen','bep');`);
 sql(readFileSync(new URL('../supabase/migrations/034_kitchen_image_tickets.sql',import.meta.url),'utf8'));
 const job=JSON.parse(sql(as(owner,"select public.reserve_kitchen_image_upload('10000000-0000-0000-0000-000000000001','"+'a'.repeat(64)+"');")).split('\n').find(x=>x.startsWith('{')));
 sql(`set role service_role;select public.verify_kitchen_image_upload('${job.upload_id}',100,100,100);`);
 const ticket=JSON.parse(sql(as(owner,`select to_jsonb(public.finalize_kitchen_image_upload('${job.upload_id}'));`)).split('\n').find(x=>x.startsWith('{')));
 let signalLocked;const locked=new Promise(resolve=>{signalLocked=resolve;});
 function connection(id,pause=false){
  const child=spawn('docker',['--host=unix:///var/run/docker.sock','exec','-i',name,'psql','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1','-At'],{env,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',chunk=>{stdout+=chunk;if(pause&&stdout.includes('"status": "done"'))signalLocked();});child.stderr.on('data',chunk=>{stderr+=chunk;});
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code?reject(new Error(stderr)):resolve(stdout));});
  child.stdin.end(`begin;${as(id,`select to_jsonb(public.complete_kitchen_image_ticket('${ticket.id}'));`)}${pause?'select pg_sleep(1);':''}commit;`);return done;
 }
 const first=connection(owner,true);await Promise.race([locked,new Promise((_,reject)=>setTimeout(()=>reject(new Error('No lock signal')),10000))]);
 const second=connection(kitchen);
 const [a,b]=await Promise.all([first,second]);
 const result=s=>JSON.parse(s.split('\n').find(x=>x.startsWith('{')));
 assert.equal(result(a).completed_by,owner);assert.equal(result(b).completed_by,owner);assert.equal(result(a).completed_at,result(b).completed_at);
 assert.equal(sql('select count(*) from kitchen_image_tickets;').trim(),'1');
 console.log('PASS real PostgreSQL 17: two overlapping transactions complete the same ticket; second waits on row lock, both return the same first actor/time; exactly one ticket. Auth/Storage schemas are fixtures.');
}finally{try{docker(['rm','-f',name]);}catch{}}
