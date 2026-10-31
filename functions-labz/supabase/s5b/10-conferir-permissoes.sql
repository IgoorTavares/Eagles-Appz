-- LABZ AI — S5B: conferência das PERMISSÕES depois das migrações 1 e 2. SOMENTE LEITURA.
-- Esperado (igual ao medido no Supabase local na S5A):
--   anon / authenticated / service_role / authenticator: tudo "false"
--   labz_app: usa o schema, lê docs e acionamentos; NÃO cria acionamento
--   RLS ligado e FORÇADO nas duas tabelas; labz_app sem login
select r as papel,
  has_schema_privilege(r, 'labz', 'usage') as usa_schema,
  has_table_privilege(r, 'labz.docs', 'select') as le_docs,
  has_table_privilege(r, 'labz.docs', 'insert') as grava_docs,
  has_table_privilege(r, 'labz.acionamentos', 'select') as le_acionamentos,
  has_function_privilege(r, 'labz.criar_acionamento(text,text)', 'execute') as cria_acionamento
from unnest(array['anon', 'authenticated', 'service_role', 'authenticator', 'labz_app']) as r
where exists (select 1 from pg_roles where rolname = r);

select c.relname as tabela, c.relrowsecurity as rls_ligado, c.relforcerowsecurity as rls_forcado
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'labz' and c.relkind = 'r'
order by 1;

select rolname, rolcanlogin as tem_login, rolbypassrls as ignora_rls
from pg_roles where rolname in ('labz_app', 'labz_borda')
order by 1;

-- membros de labz_app (esperado: labz_borda, depois da etapa 4, e postgres — no Postgres 16+ quem cria
-- um papel vira administrador dele; o postgres já é o dono do banco)
select m.rolname as membro
from pg_auth_members am join pg_roles g on g.oid = am.roleid join pg_roles m on m.oid = am.member
where g.rolname = 'labz_app'
order by 1;

-- funções do schema que o navegador (anon) consegue executar (esperado: 0)
select count(*) as funcoes_labz_para_anon
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'labz' and has_function_privilege('anon', p.oid, 'execute');
