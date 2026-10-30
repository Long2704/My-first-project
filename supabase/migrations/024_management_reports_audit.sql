-- Sau 023. Chỉ chạy trên project thử nghiệm trước.
begin;

create or replace function public.revenue_report(p_from date, p_to date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_start timestamptz; v_end timestamptz; v_result jsonb;
begin
 if auth.uid() is null or not public.has_permission('reports.read') then
  raise exception 'Bạn không có quyền xem báo cáo doanh thu.';
 end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>365 then
  raise exception 'Chọn khoảng ngày hợp lệ, tối đa 366 ngày.';
 end if;
 v_start := p_from::timestamp at time zone 'Asia/Ho_Chi_Minh';
 v_end := (p_to+1)::timestamp at time zone 'Asia/Ho_Chi_Minh';
 -- Một câu truy vấn dùng cùng snapshot cho tổng, từng ngày và món bán.
 with selected as materialized (
  select id,paid_at,gross,discount,total,method from public.bills
  where paid_at>=v_start and paid_at<v_end
 ), daily as (
  select (paid_at at time zone 'Asia/Ho_Chi_Minh')::date as "day",
   count(*) invoices,sum(gross) gross,sum(discount) discount,sum(total) total,
   coalesce(sum(total) filter(where method='cash'),0) cash,
   coalesce(sum(total) filter(where method='transfer'),0) transfer
  from selected group by 1
 ), products as (
  select i.name,sum(i.qty) qty,sum(i.qty::bigint*i.price) gross
  from public.bill_items i join selected b on b.id=i.bill_id
  group by i.name
 )
 select jsonb_build_object(
  'from',p_from,'to',p_to,'generated_at',statement_timestamp(),'products_complete',true,
  'invoices',count(*),'gross',coalesce(sum(gross),0),'discount',coalesce(sum(discount),0),
  'total',coalesce(sum(total),0),
  'cash',coalesce(sum(total) filter(where method='cash'),0),
  'transfer',coalesce(sum(total) filter(where method='transfer'),0),
  'days',coalesce((select jsonb_agg(to_jsonb(d) order by d.day desc) from daily d),'[]'::jsonb),
  'products',coalesce((select jsonb_agg(to_jsonb(p) order by p.name) from products p),'[]'::jsonb)
 ) into v_result from selected;
 return v_result;
end;
$$;

-- Chỉ bỏ các sự kiện được yêu cầu; không xóa bất kỳ dòng lịch sử nào.
create function public.filter_optional_audit_events()
returns trigger language plpgsql set search_path = ''
as $function$
begin
  if new.type in (
    'table_order', 'table_update', 'takeaway_created',
    'takeaway_discarded', 'menu_update'
  ) then
    return null;
  end if;
  return new;
end;
$function$;
revoke all on function public.filter_optional_audit_events()
from public, anon, authenticated;

create trigger audit_log_filter_optional_events
before insert on public.audit_log
for each row execute function public.filter_optional_audit_events();

commit;
