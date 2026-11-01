-- Disable purge behavior; deleted files/rows cannot be recreated by rollback.
-- Keep runtime settings/data_epoch and new columns. Roll back the frontend together.
begin;
drop policy kitchen_image_storage_pending_delete_read on storage.objects;
drop policy kitchen_image_storage_read_guard on storage.objects;
create policy kitchen_image_storage_read_guard on storage.objects as restrictive for select to authenticated using(bucket_id<>'kitchen-ticket-images' or (public.has_permission('kitchen_images.read') and exists(select 1 from public.kitchen_image_tickets t where name in(t.image_path,t.preview_path))));
drop policy kitchen_image_storage_complete_delete on storage.objects;
drop policy kitchen_image_storage_anon_delete_guard on storage.objects;
drop policy kitchen_image_storage_delete_guard on storage.objects;
create policy kitchen_image_storage_delete_guard on storage.objects as restrictive for delete to anon,authenticated using(bucket_id<>'kitchen-ticket-images');
revoke execute on function public.get_kitchen_image_epoch(),public.begin_kitchen_image_completion(uuid),public.can_delete_kitchen_image(text) from authenticated;
create or replace function public.reserve_kitchen_image_upload(p_request_id uuid,p_sha256 text)
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


create or replace function public.complete_kitchen_image_ticket(p_ticket_id uuid)
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

-- Keep get_my_access.data_epoch so old test retries remain invalidated after a reset.
commit;
