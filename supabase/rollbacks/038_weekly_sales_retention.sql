-- Pause future deletion. Cannot restore deleted sales. Keep anti-replay IDs/trigger forever.
begin;
update public.sales_retention_settings set enabled=false,updated_at=clock_timestamp() where id;
commit;
