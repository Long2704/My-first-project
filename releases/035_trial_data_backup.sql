-- READ ONLY. Export the SQL Editor result as CSV/JSON and keep it locally before reset.
-- This exports database records and a file manifest, NOT the image file bytes.
select 'table_sessions' as source,coalesce(jsonb_agg(to_jsonb(t)),'[]') as records from public.table_sessions t
union all select 'orders',coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.orders t
union all select 'order_items',coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.order_items t
union all select 'bills',coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.bills t
union all select 'bill_items',coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.bill_items t
union all select 'bill_orders',coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.bill_orders t
union all select 'table_transfers',coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.table_transfers t
union all select 'bill_moves',coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.bill_moves t
union all select 'table_cancellations',coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.table_cancellations t
union all select 'takeaway_requests',coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.takeaway_requests t
union all select 'audit_log',coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.audit_log t
union all select 'kitchen_image_tickets',coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.kitchen_image_tickets t
union all select 'kitchen_image_uploads',coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.kitchen_image_uploads t
union all select 'image_file_manifest',coalesce(jsonb_agg(jsonb_build_object('name',name,'metadata',metadata)),'[]') from storage.objects where bucket_id='kitchen-ticket-images';
