-- LABZ AI — S5B, etapa 1: IDENTIDADE e LIMPEZA do projeto novo. SOMENTE LEITURA (só SELECT).
-- Esperado num projeto recém-criado e exclusivo: nenhuma tabela de usuário, nenhum schema "labz",
-- nenhum usuário no Auth, nenhum bucket no Storage, nenhum job no cron.

-- 1. banco e versão
select current_database() as banco, current_setting('server_version') as versao_postgres;

-- 2. schemas que não são do sistema nem do Supabase (esperado: só "public", vazio)
select n.nspname as schema
from pg_namespace n
where n.nspname not like 'pg\_%' escape '\'
  and n.nspname not in ('information_schema', 'auth', 'storage', 'realtime', 'extensions', 'graphql', 'graphql_public',
                        'vault', 'net', 'cron', 'pgbouncer', 'supabase_functions', 'supabase_migrations', '_realtime',
                        'pgsodium', 'pgsodium_masks', 'supavisor', '_analytics')
order by 1;

-- 3. tabelas de usuário (esperado: nenhuma)
select table_schema, table_name
from information_schema.tables
where table_type = 'BASE TABLE'
  and table_schema not in ('pg_catalog', 'information_schema', 'auth', 'storage', 'realtime', 'extensions', 'graphql',
                           'graphql_public', 'vault', 'net', 'cron', 'pgbouncer', 'supabase_functions',
                           'supabase_migrations', '_realtime', 'pgsodium', 'supavisor', '_analytics')
order by 1, 2;

-- 4. dados de outros sistemas (esperado: 0 em tudo)
select
  (select count(*) from auth.users) as usuarios_auth,
  (select count(*) from pg_namespace where nspname = 'labz') as schema_labz_existe,
  (select count(*) from pg_roles where rolname in ('labz_app', 'labz_borda')) as papeis_labz;

-- 5. extensão pg_cron (esperado: 0 = ainda não ligada)
select count(*) as extensao_cron_ligada
from pg_extension e
where e.extname = 'pg_cron';

-- 6. Storage (esperado: 0 buckets). Se der "relation storage.buckets does not exist", o Storage está
--    desligado neste projeto — também está certo.
select count(*) as buckets_storage from storage.buckets;
