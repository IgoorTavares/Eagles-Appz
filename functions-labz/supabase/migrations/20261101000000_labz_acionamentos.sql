-- LABZ AI (Fase S3): ACIONAMENTOS do worker. Portável (PostgreSQL puro ou Supabase).
-- Cada chamada ao worker nasce AQUI: o banco registra o acionamento (id único, tempo,
-- motivo) e o assina com HMAC-SHA256. O worker só trabalha se (1) a assinatura confere,
-- (2) o tempo está na janela e (3) consegue CONSUMIR o acionamento no banco (uma vez só).
-- Assim, nem o segredo sozinho nem a URL da função bastam: cada chamada precisa existir no banco.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists labz.acionamentos (
  id text primary key,
  motivo text not null,
  tempo bigint not null, -- segundos desde 1970 (o mesmo valor assinado)
  criado_em timestamptz not null default now(),
  consumido_em timestamptz,
  consumido_por text,
  constraint acionamentos_id check (id ~ '^acn_[0-9a-f]{32}$'),
  constraint acionamentos_motivo check (motivo in ('cron', 'fila', 'manual')),
  constraint acionamentos_por check (consumido_por is null or char_length(consumido_por) <= 80)
);
create index if not exists acionamentos_criado on labz.acionamentos (criado_em);

alter table labz.acionamentos enable row level security;
alter table labz.acionamentos force row level security;
drop policy if exists labz_app_consumir on labz.acionamentos;
create policy labz_app_consumir on labz.acionamentos for all to labz_app using (true) with check (true);

revoke all on labz.acionamentos from public;
do $$ declare papel text; begin
  foreach papel in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = papel) then
      execute format('revoke all on labz.acionamentos from %I', papel);
    end if;
  end loop;
end $$;
-- o worker (papel labz_app) só LÊ e MARCA como consumido; criar é só pelo banco (função abaixo)
grant select on labz.acionamentos to labz_app;
grant update (consumido_em, consumido_por) on labz.acionamentos to labz_app;

-- A mensagem assinada (o worker monta a mesma em src/borda/acionamento.js)
create or replace function labz.mensagem_acionamento(p_id text, p_tempo bigint, p_motivo text)
returns text language sql immutable set search_path = '' as $$
  select 'labz-worker.v1.' || p_tempo::text || '.' || p_id || '.' || p_motivo
$$;

-- Cria e assina um acionamento. O segredo vem de quem chama (no Supabase: o Vault, migração 3).
create or replace function labz.criar_acionamento(p_motivo text, p_segredo text)
returns table (id text, tempo bigint, motivo text, assinatura text)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id text := 'acn_' || replace(gen_random_uuid()::text, '-', '');
  v_tempo bigint := floor(extract(epoch from clock_timestamp()))::bigint;
begin
  if p_segredo is null or char_length(p_segredo) < 32 then
    raise exception 'segredo do worker ausente ou curto (mínimo 32 caracteres)';
  end if;
  insert into labz.acionamentos (id, motivo, tempo) values (v_id, p_motivo, v_tempo);
  return query select v_id, v_tempo, p_motivo,
    encode(extensions.hmac(labz.mensagem_acionamento(v_id, v_tempo, p_motivo), p_segredo, 'sha256'), 'hex');
end $$;

-- Limpeza (acionamentos com mais de 1 dia)
create or replace function labz.limpar_acionamentos()
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare n integer;
begin
  delete from labz.acionamentos where criado_em < now() - interval '1 day';
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function labz.mensagem_acionamento(text, bigint, text) from public;
revoke all on function labz.criar_acionamento(text, text) from public;
revoke all on function labz.limpar_acionamentos() from public;
do $$ declare papel text; begin
  foreach papel in array array['anon', 'authenticated', 'labz_app'] loop
    if exists (select 1 from pg_roles where rolname = papel) then
      execute format('revoke all on function labz.criar_acionamento(text, text) from %I', papel);
      execute format('revoke all on function labz.limpar_acionamentos() from %I', papel);
    end if;
  end loop;
end $$;
