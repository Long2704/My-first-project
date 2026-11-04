-- Run ONLY after 037+038+039 on the target project. Enables the user's weekly 7-day retention.
-- Review/export needed old data before activation. No immediate cleanup call here.
begin;
create extension if not exists pg_cron;
do $$begin
 if coalesce(current_setting('cron.timezone',true),'GMT') not in ('GMT','UTC','Etc/UTC') then
  raise exception 'Kiểm tra cron.timezone trước: lịch này dùng UTC để chạy thứ Hai 03:00 Việt Nam.';
 end if;
 if to_regprocedure('public.run_weekly_sales_cleanup()') is null then raise exception 'Chạy SQL 038 và 039 trước.';end if;
 if pg_get_functiondef('public.run_weekly_sales_cleanup()'::regprocedure) not like '%168 hours%' then raise exception 'Chạy SQL 039 để giữ 7 ngày trước khi bật lịch.';end if;
end $$;
-- Sunday 20:00 UTC = Monday 03:00 Asia/Ho_Chi_Minh; named schedule is idempotent.
select cron.schedule('pos-weekly-sales-retention','0 20 * * 0',$job$select public.run_weekly_sales_cleanup();$job$);
update public.sales_retention_settings set enabled=true,updated_at=clock_timestamp(),updated_by=null where id;
commit;
select jobname,schedule,active from cron.job where jobname='pos-weekly-sales-retention';
