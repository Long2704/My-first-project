-- After 034. Image tickets are temporary; normal orders/payments are untouched.
begin;
do $storage_preflight$ begin
 if not has_table_privilege('authenticated','storage.objects','DELETE') or not has_table_privilege('authenticated','storage.objects','SELECT') then
  raise exception 'Storage API cần quyền SELECT/DELETE cho authenticated; dừng để kiểm tra grants trước khi áp dụng 035.';
 end if;
 if not exists(select 1 from storage.buckets where id='kitchen-ticket-images' and not public) then
  raise exception 'Bucket kitchen-ticket-images phải tồn tại và Private.';
 end if;
end $storage_preflight$;
create table public.pos_runtime_settings (
 id boolean primary key default true check(id),
 image_epoch bigint not null default 1 check(image_epoch between 1 and 281474976710655),
 data_epoch bigint not null default 0 check(data_epoch>=0),
 trial_reset_done boolean not null default false
);
insert into public.pos_runtime_settings(id) values(true);
alter table public.pos_runtime_settings enable row level security;
revoke all on public.pos_runtime_settings from public,anon,authenticated;
alter table public.kitchen_image_tickets add column delete_started_at timestamptz,
 add column delete_started_by uuid references auth.users(id);

-- One constant-size generation, not a per-image completion history. Old upload retries
-- cannot recreate a purged ticket after its request/upload rows have been deleted.
create function public.get_kitchen_image_epoch()
returns text language plpgsql stable security definer set search_path='' as $$
declare v_epoch bigint;
begin
 if not public.has_permission('kitchen_images.upload') then raise exception 'Bạn không có quyền tải ảnh.'; end if;
 select image_epoch into v_epoch from public.pos_runtime_settings where id;
 return lpad(to_hex(v_epoch),12,'0');
end $$;
create or replace function public.reserve_kitchen_image_upload(p_request_id uuid,p_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_epoch bigint;v_job public.kitchen_image_uploads%rowtype;v_ticket public.kitchen_image_tickets%rowtype;v_id uuid:=gen_random_uuid();v_path text;
begin
 if not public.has_permission('kitchen_images.upload') then raise exception 'Bạn không có quyền tải ảnh.'; end if;
 if p_request_id is null or p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'Thông tin ảnh không hợp lệ.'; end if;
 select image_epoch into v_epoch from public.pos_runtime_settings where id for update;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,34));
 if exists(select 1 from public.kitchen_image_uploads where request_id=p_request_id and (created_by<>v_user or sha256<>p_sha256)) then raise exception 'Mã tải ảnh đã dùng cho ảnh khác.'; end if;
 select * into v_ticket from public.kitchen_image_tickets where request_id=p_request_id;
 if found then return jsonb_build_object('ticket',to_jsonb(v_ticket)); end if;
 select * into v_job from public.kitchen_image_uploads where request_id=p_request_id and state in ('uploading','verified') and expires_at>clock_timestamp() order by created_at desc limit 1;
 if found then
  if v_job.state='verified' then return jsonb_build_object('upload_id',v_job.id,'verified',true); end if;
  raise exception 'Ảnh đang được xử lý. Thử lại sau ít phút.';
 end if;
 if left(replace(p_request_id::text,'-',''),12)<>lpad(to_hex(v_epoch),12,'0') then return jsonb_build_object('expired',true); end if;
 v_path:=v_user::text||'/'||p_request_id::text||'/'||v_id::text;
 insert into public.kitchen_image_uploads(id,request_id,created_by,sha256,image_path,preview_path)
 values(v_id,p_request_id,v_user,p_sha256,v_path||'/image.webp',v_path||'/preview.webp') returning * into v_job;
 return jsonb_build_object('upload_id',v_id,'image_path',v_job.image_path,'preview_path',v_job.preview_path,'verified',false);
end $$;

create function public.begin_kitchen_image_completion(p_ticket_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_ticket public.kitchen_image_tickets%rowtype;v_paths text[];
begin
 if not public.has_permission('kitchen_images.read') or not public.has_permission('kitchen.complete') then raise exception 'Bạn không có quyền hoàn thành phiếu ảnh.'; end if;
 if p_ticket_id is null then raise exception 'Thiếu phiếu ảnh.'; end if;
 select * into v_ticket from public.kitchen_image_tickets where id=p_ticket_id for update;
 if not found then return jsonb_build_object('id',p_ticket_id,'purged',true); end if;
 update public.kitchen_image_tickets set delete_started_at=coalesce(delete_started_at,clock_timestamp()),delete_started_by=coalesce(delete_started_by,auth.uid()) where id=p_ticket_id;
 update public.kitchen_image_uploads set state='cleaning' where request_id=v_ticket.request_id and state<>'committed';
 select array_agg(distinct path order by path) into v_paths from (select v_ticket.image_path path union all select v_ticket.preview_path union all select image_path from public.kitchen_image_uploads where request_id=v_ticket.request_id union all select preview_path from public.kitchen_image_uploads where request_id=v_ticket.request_id) files;
 -- Keep cooking until all attempts' Storage files and SQL rows have been removed.
 return jsonb_build_object('id',p_ticket_id,'purged',false,'paths',v_paths);
end $$;

create or replace function public.complete_kitchen_image_ticket(p_ticket_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_ticket public.kitchen_image_tickets%rowtype;v_epoch bigint;
begin
 if not public.has_permission('kitchen_images.read') or not public.has_permission('kitchen.complete') then raise exception 'Bạn không có quyền hoàn thành phiếu ảnh.'; end if;
 if p_ticket_id is null then raise exception 'Thiếu phiếu ảnh.'; end if;
 select image_epoch into v_epoch from public.pos_runtime_settings where id for update;
 select * into v_ticket from public.kitchen_image_tickets where id=p_ticket_id for update;
 if not found then return jsonb_build_object('id',p_ticket_id,'purged',true); end if;
 if v_ticket.delete_started_at is null then raise exception 'Cập nhật app để hoàn thành và xóa ảnh.'; end if;
 if exists(select 1 from storage.objects where bucket_id='kitchen-ticket-images' and (name in(v_ticket.image_path,v_ticket.preview_path) or exists(select 1 from public.kitchen_image_uploads u where u.request_id=v_ticket.request_id and storage.objects.name in(u.image_path,u.preview_path)))) then raise exception 'Chưa xóa xong file ảnh. Thử lại.'; end if;
 update public.pos_runtime_settings set image_epoch=image_epoch+1 where id;
 delete from public.kitchen_image_tickets where id=p_ticket_id;
 delete from public.kitchen_image_uploads where request_id=v_ticket.request_id;
 return jsonb_build_object('id',p_ticket_id,'purged',true);
end $$;

create or replace function public.can_delete_kitchen_image(p_name text)
returns boolean language sql stable security definer set search_path='' as $$
 select public.has_permission('kitchen_images.read') and public.has_permission('kitchen.complete')
 and exists(select 1 from public.kitchen_image_tickets t where t.delete_started_at is not null and (p_name in(t.image_path,t.preview_path) or exists(select 1 from public.kitchen_image_uploads u where u.request_id=t.request_id and p_name in(u.image_path,u.preview_path))));
$$;
revoke all on function public.can_delete_kitchen_image(text) from public,anon;
grant execute on function public.can_delete_kitchen_image(text) to authenticated;
drop policy kitchen_image_storage_read_guard on storage.objects;
create policy kitchen_image_storage_read_guard on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'kitchen-ticket-images' or (public.has_permission('kitchen_images.read') and (exists(select 1 from public.kitchen_image_tickets t where name in(t.image_path,t.preview_path)) or public.can_delete_kitchen_image(name))));
create policy kitchen_image_storage_pending_delete_read on storage.objects for select to authenticated
 using(bucket_id='kitchen-ticket-images' and public.can_delete_kitchen_image(name));
drop policy kitchen_image_storage_delete_guard on storage.objects;
create policy kitchen_image_storage_delete_guard on storage.objects as restrictive for delete to anon,authenticated
 using(bucket_id<>'kitchen-ticket-images' or (auth.uid() is not null and public.can_delete_kitchen_image(name)));
create policy kitchen_image_storage_complete_delete on storage.objects for delete to authenticated
 using(bucket_id='kitchen-ticket-images' and public.can_delete_kitchen_image(name));
-- anon cannot execute the permission helper, even under a broad legacy DELETE policy.
create policy kitchen_image_storage_anon_delete_guard on storage.objects as restrictive for delete to anon
 using(bucket_id<>'kitchen-ticket-images');
revoke all on function public.get_kitchen_image_epoch(),public.begin_kitchen_image_completion(uuid),public.complete_kitchen_image_ticket(uuid) from public,anon;
grant execute on function public.get_kitchen_image_epoch(),public.begin_kitchen_image_completion(uuid),public.complete_kitchen_image_ticket(uuid) to authenticated;

create or replace function public.get_my_access()
returns jsonb language sql stable security definer set search_path = ''
as $function$
  select jsonb_build_object(
    'data_epoch',(select data_epoch from public.pos_runtime_settings where id),'name', p.name, 'role', p.role, 'is_active', p.is_active and (select public.staff_session_current()),
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


commit;
