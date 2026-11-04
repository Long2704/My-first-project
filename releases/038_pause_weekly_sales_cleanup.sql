-- The cron job can stay scheduled: a paused setting makes every run a no-op.
update public.sales_retention_settings set enabled=false,updated_at=clock_timestamp() where id;
