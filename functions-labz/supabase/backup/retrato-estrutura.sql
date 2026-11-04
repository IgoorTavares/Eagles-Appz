-- LABZ AI — Etapa 12: RETRATO DA ESTRUTURA do schema labz (SÓ LEITURA; sem dados e sem segredos).
-- Lista tabelas, colunas, restrições, índices, RLS, regras, funções (impressão digital do código),
-- gatilhos, permissões, papéis da LABZ AI (sem senha), o agendamento do cron, extensões e migrações.
-- "comparavel" = o que precisa ser igual entre a produção e um banco montado só com as migrações
-- do repositório; "ambiente" = o que muda de um lugar para outro (versões, nomes do Vault, datas).
-- Não lê: labz.docs, labz.acionamentos, valores do Vault (só os NOMES), senhas ou verificadores.
-- Comparar dois retratos: node supabase/backup/comparar-estrutura.mjs a.json b.json
select json_build_object(
  'formato', 'labz-retrato-estrutura',
  'versao', 1,
  'comparavel', json_build_object(
    'tabelas', (select coalesce(json_agg(json_build_object(
        'nome', c.relname, 'tipo', c.relkind::text, 'dono', pg_get_userbyid(c.relowner),
        'rls', c.relrowsecurity, 'rlsForcado', c.relforcerowsecurity) order by c.relname collate "C"), '[]'::json)
      from pg_class c where c.relnamespace = 'labz'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')),
    'colunas', (select coalesce(json_agg(json_build_object(
        'tabela', c.relname, 'ordem', a.attnum, 'nome', a.attname, 'tipo', format_type(a.atttypid, a.atttypmod),
        'naoNulo', a.attnotnull, 'padrao', pg_get_expr(d.adbin, d.adrelid), 'gerada', a.attgenerated::text,
        'collation', (select co.collname from pg_collation co where co.oid = a.attcollation and a.attcollation <> 0))
        order by c.relname collate "C", a.attnum), '[]'::json)
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where c.relnamespace = 'labz'::regnamespace and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped),
    'restricoes', (select coalesce(json_agg(json_build_object(
        'tabela', c.relname, 'nome', con.conname, 'tipo', con.contype::text, 'definicao', pg_get_constraintdef(con.oid))
        order by c.relname collate "C", con.conname collate "C"), '[]'::json)
      from pg_constraint con join pg_class c on c.oid = con.conrelid
      where con.connamespace = 'labz'::regnamespace),
    'indices', (select coalesce(json_agg(json_build_object('tabela', tablename, 'nome', indexname, 'definicao', indexdef)
        order by tablename collate "C", indexname collate "C"), '[]'::json)
      from pg_indexes where schemaname = 'labz'),
    'politicas', (select coalesce(json_agg(json_build_object(
        'tabela', tablename, 'nome', policyname, 'permissiva', permissive, 'papeis', to_json(roles),
        'comando', cmd, 'usando', qual, 'conferindo', with_check)
        order by tablename collate "C", policyname collate "C"), '[]'::json)
      from pg_policies where schemaname = 'labz'),
    'funcoes', (select coalesce(json_agg(json_build_object(
        'nome', p.proname, 'argumentos', pg_get_function_identity_arguments(p.oid), 'retorno', pg_get_function_result(p.oid),
        'linguagem', l.lanname, 'securityDefiner', p.prosecdef, 'volatilidade', p.provolatile::text,
        'configuracao', to_json(p.proconfig), 'dono', pg_get_userbyid(p.proowner),
        'sha256Codigo', encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex'))
        order by p.proname collate "C", pg_get_function_identity_arguments(p.oid) collate "C"), '[]'::json)
      from pg_proc p join pg_language l on l.oid = p.prolang
      where p.pronamespace = 'labz'::regnamespace),
    'gatilhos', (select coalesce(json_agg(json_build_object(
        'tabela', c.relname, 'nome', t.tgname, 'definicao', pg_get_triggerdef(t.oid), 'habilitado', t.tgenabled::text)
        order by c.relname collate "C", t.tgname collate "C"), '[]'::json)
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relnamespace = 'labz'::regnamespace and not t.tgisinternal),
    'permissoes', (select coalesce(json_agg(x order by x->>'objeto' collate "C", x->>'papel' collate "C", x->>'privilegio' collate "C"), '[]'::json) from (
        select json_build_object('objeto', 'schema labz', 'papel', case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
               'privilegio', a.privilege_type, 'repassa', a.is_grantable) as x
          from pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a where n.nspname = 'labz'
        union all
        select json_build_object('objeto', 'tabela ' || c.relname, 'papel', case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
               'privilegio', a.privilege_type, 'repassa', a.is_grantable)
          from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
          where c.relnamespace = 'labz'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
        union all
        select json_build_object('objeto', 'funcao ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
               'papel', case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
               'privilegio', a.privilege_type, 'repassa', a.is_grantable)
          from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where p.pronamespace = 'labz'::regnamespace
      ) s),
    'privilegiosPadrao', (select coalesce(json_agg(json_build_object(
        'papel', pg_get_userbyid(d.defaclrole), 'tipo', d.defaclobjtype::text, 'acl', d.defaclacl::text)
        order by pg_get_userbyid(d.defaclrole) collate "C", d.defaclobjtype::text), '[]'::json)
      from pg_default_acl d where d.defaclnamespace = 'labz'::regnamespace),
    'papeis', (select coalesce(json_agg(json_build_object(
        'nome', r.rolname, 'login', r.rolcanlogin, 'superusuario', r.rolsuper, 'herda', r.rolinherit,
        'criaPapel', r.rolcreaterole, 'criaBanco', r.rolcreatedb, 'replicacao', r.rolreplication,
        'ignoraRls', r.rolbypassrls, 'limiteConexoes', r.rolconnlimit, 'configuracao', to_json(r.rolconfig),
        'membroDe', (select coalesce(json_agg(json_build_object('papel', pg_get_userbyid(m.roleid), 'herda', m.inherit_option, 'assume', m.set_option)
                     order by pg_get_userbyid(m.roleid) collate "C"), '[]'::json)
                     from pg_auth_members m where m.member = r.oid))
        order by r.rolname collate "C"), '[]'::json)
      from pg_roles r where r.rolname in ('labz_app', 'labz_borda')),
    'cron', (select coalesce(json_agg(json_build_object('nome', j.jobname, 'agenda', j.schedule, 'comando', j.command, 'ativo', j.active)
        order by j.jobname collate "C"), '[]'::json)
      from cron.job j where j.jobname like 'labz%'),
    'extensoes', (select coalesce(json_agg(json_build_object('nome', e.extname, 'schema', n.nspname) order by e.extname collate "C"), '[]'::json)
      from pg_extension e join pg_namespace n on n.oid = e.extnamespace
      where e.extname in ('pg_cron', 'pg_net', 'supabase_vault')),
    'migracoes', (select coalesce(json_agg(m.name order by m.version collate "C"), '[]'::json)
      from supabase_migrations.schema_migrations m)
  ),
  'ambiente', json_build_object(
    'geradoEm', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'postgres', current_setting('server_version'),
    'extensoesVersao', (select coalesce(json_object_agg(e.extname, e.extversion order by e.extname collate "C"), '{}'::json)
      from pg_extension e where e.extname in ('pg_cron', 'pg_net', 'supabase_vault')),
    'migracoes', (select coalesce(json_agg(json_build_object('versao', m.version, 'nome', m.name,
        'sha256Texto', encode(sha256(convert_to(array_to_string(m.statements, ''), 'UTF8')), 'hex'))
        order by m.version collate "C"), '[]'::json)
      from supabase_migrations.schema_migrations m),
    'vaultNomes', (select coalesce(json_agg(s.name order by s.name collate "C"), '[]'::json) from vault.secrets s)
  )
)::text as retrato;
