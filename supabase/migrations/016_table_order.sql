-- Chạy sau 015. Thứ tự hiển thị không thay đổi phiên khách, món hay hóa đơn.
begin;
alter table public.restaurant_tables add column display_order integer not null default 0;
with ranks as (select id,row_number() over(order by (id<0),id)::integer n from public.restaurant_tables)
update public.restaurant_tables t set display_order=r.n from ranks r where r.id=t.id;
create function public.append_table_display_order() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.id>0 and new.display_order=0 then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('goc-pho-table-management',0));
  select coalesce(max(display_order),0)+1 into new.display_order from public.restaurant_tables where id>0;
 end if;
 return new;
end;
$$;
create trigger append_table_display_order before insert on public.restaurant_tables for each row execute function public.append_table_display_order();
create table public.table_order_changes (
 request_id uuid primary key,user_id uuid not null references public.profiles(id),expected_ids integer[] not null,ordered_ids integer[] not null,
 created_at timestamptz not null default now()
);
alter table public.table_order_changes enable row level security;
revoke all on public.table_order_changes from public,anon,authenticated;
grant select on public.table_order_changes to authenticated;
create policy table_order_owner_read on public.table_order_changes for select to authenticated using(public.current_staff_role()='chu');
create function public.reorder_restaurant_tables(p_request_id uuid,p_expected_ids integer[],p_ordered_ids integer[])
returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_old public.table_order_changes%rowtype;v_actual integer[];v_expected_set integer[];v_new_set integer[];v_count integer;
begin
 if v_user is null or coalesce(public.current_staff_role(),'')<>'chu' then raise exception 'Chỉ chủ quán được sắp xếp bàn.';end if;
 if p_request_id is null or p_expected_ids is null or p_ordered_ids is null or cardinality(p_expected_ids)=0 or cardinality(p_expected_ids)<>cardinality(p_ordered_ids) then raise exception 'Danh sách bàn không hợp lệ.';end if;
 select array_agg(x order by x) into v_expected_set from unnest(p_expected_ids) x;
 select array_agg(x order by x),count(distinct x) into v_new_set,v_count from unnest(p_ordered_ids) x where x>0;
 if v_count<>cardinality(p_ordered_ids) or v_new_set is distinct from v_expected_set then raise exception 'Danh sách bàn không hợp lệ.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
 select * into v_old from public.table_order_changes where request_id=p_request_id;
 if found then
  if v_old.user_id<>v_user or v_old.expected_ids is distinct from p_expected_ids or v_old.ordered_ids is distinct from p_ordered_ids then raise exception 'Mã sắp xếp bàn đã được sử dụng.';end if;
  return;
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('goc-pho-table-management',0));
 perform 1 from public.restaurant_tables where id>0 order by id for update;
 select array_agg(id order by display_order,id) into v_actual from public.restaurant_tables where id>0;
 if v_actual is distinct from p_expected_ids then raise exception 'Danh sách hoặc thứ tự bàn đã thay đổi. Tải lại và sắp xếp lại.';end if;
 update public.restaurant_tables t set display_order=x.n::integer from unnest(p_ordered_ids) with ordinality x(id,n) where t.id=x.id;
 insert into public.table_order_changes(request_id,user_id,expected_ids,ordered_ids) values(p_request_id,v_user,p_expected_ids,p_ordered_ids);
 insert into public.audit_log(type,user_id,extra) values('table_order',v_user,jsonb_build_object('ordered_ids',p_ordered_ids,'count',cardinality(p_ordered_ids)));
end;
$$;
revoke all on function public.reorder_restaurant_tables(uuid,integer[],integer[]) from public,anon;
grant execute on function public.reorder_restaurant_tables(uuid,integer[],integer[]) to authenticated;
create or replace function public.list_table_management() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(public.current_staff_role(),'')<>'chu' then raise exception 'Chỉ chủ quán được quản lý bàn.';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'is_active',t.is_active,'version',t.management_version,'display_order',t.display_order,
 'busy',exists(select 1 from public.table_sessions s where s.table_id=t.id and s.closed_at is null)
 or exists(select 1 from public.orders o join public.table_sessions s on s.id=o.session_id where o.status='cooking' and o.kitchen_relevant and (s.table_id=t.id or o.table_path @> array[t.id] or s.table_path @> array[t.id]))) order by t.display_order,t.id),'[]'::jsonb)
 from public.restaurant_tables t where t.id>0);
end;
$$;
commit;
