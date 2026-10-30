-- CHỈ ĐỌC: chạy trên project Supabase bản thật để chọn đúng migration.
-- Không trả mật khẩu, hash, email hoặc API key.
select jsonb_build_object(
 'profile_columns',(select jsonb_agg(jsonb_build_object('name',column_name,'type',data_type) order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='profiles'),
 'roles',(select jsonb_agg(to_jsonb(r)) from (select role,coalesce(to_jsonb(p)->>'is_active','chưa có cột') as active,count(*) as accounts from public.profiles p group by role,coalesce(to_jsonb(p)->>'is_active','chưa có cột')) r),
 'helpers',(select jsonb_agg(jsonb_build_object('name',proname,'arguments',pg_get_function_identity_arguments(oid))) from pg_proc where pronamespace='public'::regnamespace and proname in ('has_permission','get_my_access','prepare_employee_creation','current_staff_role','protect_last_active_owner','finish_initial_password_setup')),
 'auth_triggers',(select coalesce(jsonb_agg(jsonb_build_object('name',tgname,'definition',pg_get_triggerdef(oid))),'[]'::jsonb) from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal),
 'constraints',(select jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(oid))) from pg_constraint where conrelid in ('public.profiles'::regclass,'public.audit_log'::regclass)),
 'rls',(select jsonb_agg(jsonb_build_object('table',relname,'enabled',relrowsecurity)) from pg_class where relnamespace='public'::regnamespace and relname in ('profiles','bills','bill_items','orders','order_items','menu_items','audit_log'))
) as production_preflight;
