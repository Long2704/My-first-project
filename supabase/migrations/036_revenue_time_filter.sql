-- Read-only reporting addition after 035. Old revenue_report(date,date) stays compatible.
begin;
create function public.revenue_report_window(p_from_local timestamp without time zone,p_to_local timestamp without time zone)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_start timestamptz;v_end timestamptz;v_result jsonb;
begin
 if auth.uid() is null or not public.has_permission('reports.read') then
  raise exception 'Bạn không có quyền xem báo cáo doanh thu.';
 end if;
 if p_from_local is null or p_to_local is null or not isfinite(p_from_local) or not isfinite(p_to_local) then
  raise exception 'Chọn khoảng ngày giờ hợp lệ, tối đa 366 ngày.';
 end if;
 if extract(year from p_from_local) not between 1000 and 9999 or extract(year from p_to_local) not between 1000 and 9999
 or p_to_local<p_from_local or p_to_local::date-p_from_local::date>365
 or date_trunc('second',p_from_local)<>p_from_local or date_trunc('second',p_to_local)<>p_to_local then
  raise exception 'Chọn khoảng ngày giờ hợp lệ đến giây, tối đa 366 ngày.';
 end if;
 v_start:=p_from_local at time zone 'Asia/Ho_Chi_Minh';
 -- Whole selected end second is inclusive, even with fractional paid_at timestamps.
 v_end:=(p_to_local+interval '1 second') at time zone 'Asia/Ho_Chi_Minh';
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
  from public.bill_items i join selected b on b.id=i.bill_id group by i.name
 )
 select jsonb_build_object(
  'from',to_char(p_from_local,'YYYY-MM-DD"T"HH24:MI:SS'),
  'to',to_char(p_to_local,'YYYY-MM-DD"T"HH24:MI:SS'),
  'generated_at',statement_timestamp(),'products_complete',true,'time_filter',true,
  'invoices',count(*),'gross',coalesce(sum(gross),0),'discount',coalesce(sum(discount),0),
  'total',coalesce(sum(total),0),
  'cash',coalesce(sum(total) filter(where method='cash'),0),
  'transfer',coalesce(sum(total) filter(where method='transfer'),0),
  'days',coalesce((select jsonb_agg(to_jsonb(d) order by d.day desc) from daily d),'[]'::jsonb),
  'products',coalesce((select jsonb_agg(to_jsonb(p) order by p.name) from products p),'[]'::jsonb)
 ) into v_result from selected;
 return v_result;
end $$;
revoke all on function public.revenue_report_window(timestamp without time zone,timestamp without time zone) from public,anon,authenticated;
grant execute on function public.revenue_report_window(timestamp without time zone,timestamp without time zone) to authenticated;
notify pgrst,'reload schema';
commit;
