-- After 038. User changed the retention period to 7 days. Does NOT enable or run cleanup.
begin;
create or replace function public.sales_retention_candidates() returns table(id uuid)
language sql security definer set search_path='' as $$
 with recursive candidates as materialized (
  select s.id from public.table_sessions s
  where s.closed_at<statement_timestamp()-interval '168 hours' and s.opened_at<statement_timestamp()-interval '168 hours'
  and not exists(select 1 from public.orders o where o.session_id=s.id and (
   o.created_at>=statement_timestamp()-interval '168 hours' or o.done_at>=statement_timestamp()-interval '168 hours'
   or (o.status='cooking' and exists(select 1 from public.order_items i where i.order_id=o.id and i.cancelled_at is null and i.category<>'do_uong'))))
  and not exists(select 1 from public.order_items i join public.orders o on o.id=i.order_id where o.session_id=s.id and ((not i.paid and i.cancelled_at is null) or i.cancelled_at>=statement_timestamp()-interval '168 hours'))
  and not exists(select 1 from public.bills b where b.session_id=s.id and b.paid_at>=statement_timestamp()-interval '168 hours')
  and not exists(select 1 from public.audit_log a left join public.bills b on b.id=a.bill_id where (a.session_id=s.id or b.session_id=s.id) and a.created_at>=statement_timestamp()-interval '168 hours')
  and not exists(select 1 from public.table_transfers t where (t.session_id=s.id or t.target_session_id=s.id) and t.created_at>=statement_timestamp()-interval '168 hours')
  and not exists(select 1 from public.bill_moves m where m.session_id=s.id and m.created_at>=statement_timestamp()-interval '168 hours')
  and not exists(select 1 from public.table_cancellations c where c.session_id=s.id and c.created_at>=statement_timestamp()-interval '168 hours')
  and not exists(select 1 from public.takeaway_requests t where t.session_id=s.id and t.created_at>=statement_timestamp()-interval '168 hours')
  order by s.closed_at,s.id limit 10000
 ), edges(a,b) as materialized (
  select session_id,target_session_id from public.table_transfers where target_session_id is not null
  union select b.session_id,o.session_id from public.bill_orders x join public.bills b on b.id=x.bill_id join public.orders o on o.id=x.order_id
  union select b.session_id,o.session_id from public.bill_items x join public.bills b on b.id=x.bill_id join public.order_items i on i.id=x.source_item_id join public.orders o on o.id=i.order_id
  union select b.session_id,o.session_id from public.order_items i join public.orders o on o.id=i.order_id join public.bills b on b.id=i.bill_id
  union select a.session_id,b.session_id from public.audit_log a join public.bills b on b.id=a.bill_id where a.session_id is not null
 ), blocked(id) as (
  select c.id from candidates c where exists(select 1 from edges e where
   (e.a=c.id and not exists(select 1 from candidates d where d.id=e.b)) or
   (e.b=c.id and not exists(select 1 from candidates d where d.id=e.a)))
  union
  select c.id from blocked x join edges e on e.a=x.id or e.b=x.id join candidates c on c.id=case when e.a=x.id then e.b else e.a end
 )
 select c.id from candidates c where not exists(select 1 from blocked b where b.id=c.id);
$$;

create or replace function public.run_weekly_sales_cleanup() returns jsonb language plpgsql security definer set search_path='' as $$
declare v_ids uuid[];v_orders integer;v_invoices integer;v_result jsonb;v_enabled boolean;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('pos-weekly-sales-retention',38)) then return jsonb_build_object('skipped','already_running');end if;
 select enabled into v_enabled from public.sales_retention_settings where id for update;
 if not v_enabled then return jsonb_build_object('skipped','paused');end if;
 perform set_config('lock_timeout','3s',true);
 -- Bound wait rather than race with payment/transfer/order transactions. Reads keep working.
 lock table public.table_sessions,public.orders,public.order_items,public.bills,public.bill_items,public.bill_orders,
 public.table_transfers,public.bill_moves,public.table_cancellations,public.takeaway_requests,public.audit_log in share row exclusive mode;
 select coalesce(array_agg(id),'{}'::uuid[]) into v_ids from public.sales_retention_candidates();
 select count(*) into v_orders from public.orders where session_id=any(v_ids);
 select count(*) into v_invoices from public.bills where session_id=any(v_ids);
 insert into public.retired_order_requests(request_id) select request_id from public.orders where session_id=any(v_ids) on conflict do nothing;
 delete from public.audit_log a where a.session_id=any(v_ids) or a.bill_id in(select id from public.bills where session_id=any(v_ids));
 delete from public.bill_items where bill_id in(select id from public.bills where session_id=any(v_ids));
 delete from public.bill_orders where bill_id in(select id from public.bills where session_id=any(v_ids)) or order_id in(select id from public.orders where session_id=any(v_ids));
 delete from public.table_transfers where session_id=any(v_ids) or target_session_id=any(v_ids);
 delete from public.bill_moves where session_id=any(v_ids);
 delete from public.table_cancellations where session_id=any(v_ids);
 delete from public.takeaway_requests where session_id=any(v_ids);
 update public.order_items set bill_id=null where order_id in(select id from public.orders where session_id=any(v_ids));
 delete from public.order_items where order_id in(select id from public.orders where session_id=any(v_ids));
 delete from public.bills where session_id=any(v_ids);
 delete from public.orders where session_id=any(v_ids);
 delete from public.table_sessions where id=any(v_ids);
 insert into public.sales_retention_runs(cutoff,sessions,orders,invoices)
 values(statement_timestamp()-interval '168 hours',cardinality(v_ids),v_orders,v_invoices);
 delete from public.sales_retention_runs where id not in(select id from public.sales_retention_runs order by id desc limit 16);
 v_result:=jsonb_build_object('sessions',cardinality(v_ids),'orders',v_orders,'invoices',v_invoices);
 return v_result;
end $$;

create or replace function public.get_sales_retention_status() returns jsonb language plpgsql security definer set search_path='' as $$
declare v_scheduled boolean:=false;v_ids uuid[];v_next timestamp;v_last jsonb;v_enabled boolean;
begin
 if auth.uid() is null or not public.has_permission('settings.manage') then raise exception 'Chỉ Owner được xem lịch dọn.';end if;
 if to_regclass('cron.job') is not null then execute 'select exists(select 1 from cron.job where jobname=''pos-weekly-sales-retention'' and active and schedule=''0 20 * * 0'' and btrim(command)=''select public.run_weekly_sales_cleanup();'')' into v_scheduled;end if;
 select enabled into v_enabled from public.sales_retention_settings where id;
 select coalesce(array_agg(id),'{}'::uuid[]) into v_ids from public.sales_retention_candidates();
 v_next:=date_trunc('week',statement_timestamp() at time zone 'Asia/Ho_Chi_Minh')+interval '3 hours';
 if v_next<=statement_timestamp() at time zone 'Asia/Ho_Chi_Minh' then v_next:=v_next+interval '7 days';end if;
 select to_jsonb(r) into v_last from (select finished_at,sessions,orders,invoices from public.sales_retention_runs order by id desc limit 1) r;
 return jsonb_build_object('retention_days',7,'enabled',v_enabled,'scheduled',v_scheduled,'next_run',v_next at time zone 'Asia/Ho_Chi_Minh','last_run',v_last,
  'eligible',jsonb_build_object('sessions',cardinality(v_ids),'orders',(select count(*) from public.orders where session_id=any(v_ids)),
  'invoices',(select count(*) from public.bills where session_id=any(v_ids))));
end $$;
notify pgrst,'reload schema';
commit;
