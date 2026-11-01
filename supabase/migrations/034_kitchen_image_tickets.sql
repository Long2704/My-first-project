-- Sau 033. Phiếu ảnh độc lập; không sửa bảng doanh thu, bàn hoặc đơn món.
begin;
-- Fail closed if the target Storage schema is not protected by RLS.
do $preflight$ begin
 if not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='storage' and c.relname='objects' and c.relrowsecurity)
 or not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='storage' and c.relname='buckets' and c.relrowsecurity)
 then raise exception 'Storage objects/buckets phải bật RLS trước khi áp dụng 034.'; end if;
end $preflight$;

create or replace function public.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  with role_permissions(role, permissions) as (
    values
      ('chu', array[
        'orders.read', 'orders.create', 'orders.cancel',
        'payments.collect', 'payments.discount',
        'kitchen.complete', 'kitchen_images.read', 'kitchen_images.upload', 'tables.transfer', 'tables.cancel', 'bills.split',
        'menu.manage', 'tables.manage', 'reports.read', 'audit.read',
        'employees.manage', 'settings.manage',
        'receipts.read_own', 'receipts.read_all'
      ]::text[]),
      ('phuc_vu', array[
        'orders.read', 'orders.create', 'payments.collect',
        'tables.transfer', 'tables.cancel', 'bills.split', 'receipts.read_own'
      ]::text[]),
      ('bep', array[
        'orders.read', 'orders.create', 'payments.collect',
        'tables.transfer', 'tables.cancel', 'bills.split', 'receipts.read_own',
        'kitchen.complete', 'kitchen_images.read'
      ]::text[])
  )
  select exists (
    select 1
    from public.profiles p
    join role_permissions r on r.role = p.role
    where p.id = (select auth.uid())
      and p.is_active = true
      and p.must_change_password = false
      and (select public.staff_session_current())
      and p_permission = any(r.permissions)
  );
$function$;

create or replace function public.get_my_access()
returns jsonb language sql stable security definer set search_path = ''
as $function$
  select jsonb_build_object(
    'name', p.name, 'role', p.role, 'is_active', p.is_active and (select public.staff_session_current()),
    'session_invalid',not (select public.staff_session_current()),
    'must_change_password', p.must_change_password,
    'permissions', (
      select coalesce(jsonb_agg(permission), '[]'::jsonb)
      from unnest(array[
        'orders.read', 'orders.create', 'orders.cancel',
        'payments.collect', 'payments.discount', 'kitchen.complete', 'kitchen_images.read', 'kitchen_images.upload',
        'tables.transfer', 'tables.cancel', 'bills.split', 'menu.manage', 'tables.manage',
        'reports.read', 'audit.read', 'employees.manage', 'settings.manage',
        'receipts.read_own', 'receipts.read_all'
      ]::text[]) as permission
      where public.has_permission(permission)
    )
  )
  from public.profiles p where p.id = (select auth.uid());
$function$;

revoke all on function public.has_permission(text) from public,anon;
grant execute on function public.has_permission(text) to authenticated;
revoke all on function public.get_my_access() from public,anon;
grant execute on function public.get_my_access() to authenticated;

create table public.kitchen_image_uploads (
 id uuid primary key default gen_random_uuid(), request_id uuid not null,
 created_by uuid not null references auth.users(id), sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 state text not null default 'uploading' check(state in ('uploading','verified','committed','cleaning','cleaned')),
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null default clock_timestamp()+interval '2 minutes',
 image_path text not null unique, preview_path text not null unique,
 mime_type text, byte_size integer, width integer, height integer,
 check(byte_size is null or byte_size between 1 and 5242880),
 check(width is null or width between 1 and 4096), check(height is null or height between 1 and 4096)
);
create index kitchen_image_upload_request on public.kitchen_image_uploads(request_id);
create index kitchen_image_upload_expiry on public.kitchen_image_uploads(expires_at) where state in ('uploading','verified');
create table public.kitchen_image_tickets (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
 upload_id uuid not null unique references public.kitchen_image_uploads(id),
 image_path text not null unique, preview_path text not null unique,
 mime_type text not null check(mime_type='image/webp'), byte_size integer not null check(byte_size between 1 and 5242880),
 width integer not null check(width between 1 and 4096),height integer not null check(height between 1 and 4096),
 status text not null default 'cooking' check(status in ('cooking','done')),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp(),
 completed_by uuid references auth.users(id), completed_at timestamptz,
 check ((status='cooking' and completed_by is null and completed_at is null) or (status='done' and completed_by is not null and completed_at is not null))
);
create index kitchen_image_ticket_queue on public.kitchen_image_tickets(created_at,id) where status='cooking';
create index kitchen_image_ticket_history on public.kitchen_image_tickets(completed_at desc,id desc) where status='done';
alter table public.kitchen_image_uploads enable row level security;
alter table public.kitchen_image_tickets enable row level security;
revoke all on public.kitchen_image_uploads,public.kitchen_image_tickets from public,anon,authenticated;
grant select on public.kitchen_image_tickets to authenticated;
create policy kitchen_images_read on public.kitchen_image_tickets for select to authenticated
 using ((select public.has_permission('kitchen_images.read')));

-- Caller JWT is checked again on reserve/finalize. Browser cannot set verified metadata.
create function public.reserve_kitchen_image_upload(p_request_id uuid,p_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_job public.kitchen_image_uploads%rowtype;v_ticket public.kitchen_image_tickets%rowtype;v_id uuid:=gen_random_uuid();v_path text;
begin
 if not public.has_permission('kitchen_images.upload') then raise exception 'Bạn không có quyền tải ảnh.'; end if;
 if p_request_id is null or p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'Thông tin ảnh không hợp lệ.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,34));
 if exists(select 1 from public.kitchen_image_uploads where request_id=p_request_id and (created_by<>v_user or sha256<>p_sha256)) then raise exception 'Mã tải ảnh đã dùng cho ảnh khác.'; end if;
 select * into v_ticket from public.kitchen_image_tickets where request_id=p_request_id;
 if found then return jsonb_build_object('ticket',to_jsonb(v_ticket)); end if;
 select * into v_job from public.kitchen_image_uploads where request_id=p_request_id and state in ('uploading','verified') and expires_at>clock_timestamp() order by created_at desc limit 1;
 if found then
  if v_job.state='verified' then return jsonb_build_object('upload_id',v_job.id,'verified',true); end if;
  raise exception 'Ảnh đang được xử lý. Thử lại sau ít phút.';
 end if;
 v_path:=v_user::text||'/'||p_request_id::text||'/'||v_id::text;
 insert into public.kitchen_image_uploads(id,request_id,created_by,sha256,image_path,preview_path)
 values(v_id,p_request_id,v_user,p_sha256,v_path||'/image.webp',v_path||'/preview.webp') returning * into v_job;
 return jsonb_build_object('upload_id',v_id,'image_path',v_job.image_path,'preview_path',v_job.preview_path,'verified',false);
end $$;

-- Only trusted Edge service may attest decoded, re-encoded files. No browser grant.
create function public.verify_kitchen_image_upload(p_upload_id uuid,p_byte_size integer,p_width integer,p_height integer)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_byte_size is null or p_width is null or p_height is null then raise exception 'Thiếu thông tin ảnh.'; end if;
 update public.kitchen_image_uploads set state='verified',mime_type='image/webp',byte_size=p_byte_size,width=p_width,height=p_height
 where id=p_upload_id and state='uploading' and expires_at>clock_timestamp();
 if not found then raise exception 'Lượt tải ảnh đã hết hạn.'; end if;
end $$;
create function public.finalize_kitchen_image_upload(p_upload_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_job public.kitchen_image_uploads%rowtype;v_ticket public.kitchen_image_tickets%rowtype;
begin
 if not public.has_permission('kitchen_images.upload') then raise exception 'Bạn không có quyền tải ảnh.'; end if;
 select * into v_job from public.kitchen_image_uploads where id=p_upload_id and created_by=auth.uid();
 if not found then raise exception 'Không tìm thấy lượt tải ảnh.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_job.request_id::text,34));
 select * into v_job from public.kitchen_image_uploads where id=p_upload_id for update;
 select * into v_ticket from public.kitchen_image_tickets where request_id=v_job.request_id;
 if found then return to_jsonb(v_ticket); end if;
 if v_job.state<>'verified' or v_job.expires_at<=clock_timestamp() then raise exception 'Ảnh chưa được xác minh hoặc đã hết hạn.'; end if;
 insert into public.kitchen_image_tickets(request_id,upload_id,image_path,preview_path,mime_type,byte_size,width,height,created_by)
 values(v_job.request_id,v_job.id,v_job.image_path,v_job.preview_path,v_job.mime_type,v_job.byte_size,v_job.width,v_job.height,auth.uid()) returning * into v_ticket;
 update public.kitchen_image_uploads set state='committed' where id=v_job.id;
 return to_jsonb(v_ticket);
end $$;
create function public.complete_kitchen_image_ticket(p_ticket_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_ticket public.kitchen_image_tickets%rowtype;
begin
 if not public.has_permission('kitchen_images.read') or not public.has_permission('kitchen.complete') then raise exception 'Bạn không có quyền hoàn thành phiếu ảnh.'; end if;
 select * into v_ticket from public.kitchen_image_tickets where id=p_ticket_id for update;
 if not found then raise exception 'Không tìm thấy phiếu ảnh.'; end if;
 if v_ticket.status='cooking' then
 update public.kitchen_image_tickets set status='done',completed_at=clock_timestamp(),completed_by=auth.uid() where id=p_ticket_id returning * into v_ticket;
 end if;
 return to_jsonb(v_ticket);
end $$;
-- Cleanup claims expire before deleting Storage objects. A claimed job can no longer finalize.
create function public.claim_kitchen_image_cleanup(p_owner uuid)
returns setof public.kitchen_image_uploads language sql security definer set search_path='' as $$
 update public.kitchen_image_uploads u set state='cleaning'
 where u.id in(select j.id from public.kitchen_image_uploads j where j.created_by=p_owner
 and ((j.state in ('uploading','verified') and j.expires_at<clock_timestamp()-interval '1 hour') or j.state='cleaning')
 and not exists(select 1 from public.kitchen_image_tickets t where t.upload_id=j.id or t.image_path=j.image_path or t.preview_path=j.preview_path)
 order by j.created_at limit 10 for update skip locked)
 returning u.*;
$$;
create function public.finish_kitchen_image_cleanup(p_upload_id uuid)
returns void language sql security definer set search_path='' as $$
 update public.kitchen_image_uploads set state='cleaned' where id=p_upload_id and state='cleaning'
 and not exists(select 1 from public.kitchen_image_tickets where upload_id=p_upload_id);
$$;

revoke all on function public.reserve_kitchen_image_upload(uuid,text), public.finalize_kitchen_image_upload(uuid),public.complete_kitchen_image_ticket(uuid), public.verify_kitchen_image_upload(uuid,integer,integer,integer),public.claim_kitchen_image_cleanup(uuid),public.finish_kitchen_image_cleanup(uuid) from public,anon,authenticated;
grant execute on function public.reserve_kitchen_image_upload(uuid,text),public.finalize_kitchen_image_upload(uuid),public.complete_kitchen_image_ticket(uuid) to authenticated;
grant execute on function public.verify_kitchen_image_upload(uuid,integer,integer,integer),public.claim_kitchen_image_cleanup(uuid),public.finish_kitchen_image_cleanup(uuid) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('kitchen-ticket-images','kitchen-ticket-images',false,5242880,array['image/webp']);
-- Browser cannot make this bucket public or replace/remove it via broad legacy bucket policies.
create policy kitchen_image_bucket_insert_guard on storage.buckets as restrictive for insert to anon,authenticated
 with check(id<>'kitchen-ticket-images');
create policy kitchen_image_bucket_update_guard on storage.buckets as restrictive for update to anon,authenticated
 using(id<>'kitchen-ticket-images') with check(id<>'kitchen-ticket-images');
create policy kitchen_image_bucket_delete_guard on storage.buckets as restrictive for delete to anon,authenticated
 using(id<>'kitchen-ticket-images');
-- Restrictive policies also protect this bucket if another bucket has a broad policy.
create policy kitchen_image_storage_read on storage.objects for select to authenticated
 using(bucket_id='kitchen-ticket-images' and public.has_permission('kitchen_images.read') and exists(
 select 1 from public.kitchen_image_tickets t where name in (t.image_path,t.preview_path)));
create policy kitchen_image_storage_read_guard on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'kitchen-ticket-images' or (public.has_permission('kitchen_images.read') and exists(
 select 1 from public.kitchen_image_tickets t where name in (t.image_path,t.preview_path))));
create policy kitchen_image_storage_insert_guard on storage.objects as restrictive for insert to anon,authenticated
 with check(bucket_id<>'kitchen-ticket-images');
create policy kitchen_image_storage_update_guard on storage.objects as restrictive for update to anon,authenticated
 using(bucket_id<>'kitchen-ticket-images') with check(bucket_id<>'kitchen-ticket-images');
create policy kitchen_image_storage_delete_guard on storage.objects as restrictive for delete to anon,authenticated
 using(bucket_id<>'kitchen-ticket-images');
create policy kitchen_image_storage_anon_guard on storage.objects as restrictive for select to anon
 using(bucket_id<>'kitchen-ticket-images');
commit;
