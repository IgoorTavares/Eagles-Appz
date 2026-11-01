-- LABZ AI (S5B, Etapa 4): papel de LOGIN das Edge Functions (labz-api e labz-worker).
-- SEM senha aqui: a senha é definida pelo Igor, já como VERIFICADOR SCRAM (gerado no computador
-- dele, sem internet, por supabase/s5b/gerar-senha.html), e nunca entra no Git, no chat ou nos logs.
-- Sem senha, o papel não consegue entrar (o login exige a senha).
--
-- O papel NÃO tem nenhum privilégio próprio: só HERDA as permissões de labz_app (schema labz:
-- ler/gravar labz.docs; ler e marcar como consumido labz.acionamentos). "set false": não consegue
-- nem "vestir" o papel labz_app; "inherit true": as permissões valem direto na conexão.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'labz_borda') then
    create role labz_borda with login inherit connection limit 15;
  end if;
exception when duplicate_object or unique_violation then null; -- outra migração criou ao mesmo tempo
end $$;

-- garante os atributos mesmo se o papel já existia (idempotente). Os privilégios administrativos
-- (superuser, createdb, createrole, replication, bypassrls) já nascem DESLIGADOS num papel novo; no
-- Supabase, o postgres não pode nem citá-los num ALTER ROLE (achado no Supabase local), e o teste
-- confere que todos estão desligados.
alter role labz_borda with login inherit connection limit 15;

grant labz_app to labz_borda with inherit true, set false;

-- limites da sessão das funções (protege o banco de consultas presas)
alter role labz_borda set statement_timeout = '30s';
alter role labz_borda set lock_timeout = '10s';
alter role labz_borda set idle_in_transaction_session_timeout = '60s';
