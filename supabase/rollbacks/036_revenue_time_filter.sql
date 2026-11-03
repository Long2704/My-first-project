-- Roll back the frontend first. No sales data or legacy date report is changed.
begin;
revoke all on function public.revenue_report_window(timestamp without time zone,timestamp without time zone) from public,anon,authenticated;
drop function public.revenue_report_window(timestamp without time zone,timestamp without time zone);
notify pgrst,'reload schema';
commit;
