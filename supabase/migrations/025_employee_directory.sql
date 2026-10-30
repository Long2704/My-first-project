-- Chạy sau 024 trên project thử nghiệm. Chỉ thêm hàm đọc, không sửa tài khoản.
begin;

create function public.list_employees(
  p_search text default '',
  p_role text default null,
  p_active boolean default null,
  p_page integer default 1,
  p_page_size integer default 20
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_search text := btrim(coalesce(p_search, ''));
  v_result jsonb;
begin
  if auth.uid() is null
     or public.current_staff_role() is distinct from 'chu'
     or not public.has_permission('employees.manage') then
    raise exception 'Chỉ Owner đang hoạt động được xem danh sách nhân viên.';
  end if;

  if char_length(v_search) > 100 then
    raise exception 'Tìm kiếm tối đa 100 ký tự.';
  end if;
  if p_role is not null and p_role not in ('chu', 'phuc_vu', 'bep') then
    raise exception 'Vai trò lọc không hợp lệ.';
  end if;
  if p_page is null or p_page < 1
     or p_page_size is null or p_page_size not between 1 and 100 then
    raise exception 'Phân trang không hợp lệ.';
  end if;

  -- Số dòng và trang dữ liệu dùng cùng snapshot. Không đọc auth.users/email.
  with filtered as materialized (
    select p.id, p.name, p.staff_code, p.role, p.is_active, p.created_at
    from public.profiles p
    where (p_role is null or p.role = p_role)
      and (p_active is null or p.is_active = p_active)
      and (
        v_search = ''
        or strpos(lower(p.name), lower(v_search)) > 0
        or strpos(lower(coalesce(p.staff_code, '')), lower(v_search)) > 0
      )
  ), page_rows as (
    select * from filtered
    order by created_at desc, id desc
    limit p_page_size
    offset ((p_page::bigint - 1) * p_page_size)
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id desc)
      from page_rows r
    ), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'page', p_page,
    'page_size', p_page_size
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.list_employees(text,text,boolean,integer,integer)
from public, anon;
grant execute on function public.list_employees(text,text,boolean,integer,integer)
to authenticated;

commit;
