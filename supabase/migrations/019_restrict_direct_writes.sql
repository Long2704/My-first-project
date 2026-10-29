begin;
revoke all privileges on all tables in schema public from anon;
revoke insert, update, delete, truncate, references, trigger
on all tables in schema public from authenticated;
commit;
