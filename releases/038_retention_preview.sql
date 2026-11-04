-- Read-only preview, does not start/enable cleanup. Run after 038 in SQL Editor.
select statement_timestamp()-interval '720 hours' as older_than,
 (select count(*) from public.sales_retention_candidates()) as sessions,
 (select count(*) from public.orders where session_id in(select id from public.sales_retention_candidates())) as orders,
 (select count(*) from public.bills where session_id in(select id from public.sales_retention_candidates())) as invoices,
 (select coalesce(sum(total),0) from public.bills where session_id in(select id from public.sales_retention_candidates())) as total_invoice_amount;
