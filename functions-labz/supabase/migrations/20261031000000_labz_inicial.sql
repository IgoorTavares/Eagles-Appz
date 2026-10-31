-- LABZ AI: estrutura de dados (gerado por src/armazenamento/postgres-migracao.js; não edite à mão)
create schema if not exists labz;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'labz_app') then
    create role labz_app nologin;
  end if;
end $$;

create table if not exists labz.docs (
  caminho text primary key,
  colecao text not null,
  id text not null,
  -- json (texto exato, preserva a ORDEM das chaves: assinaturas e hashes dependem dela)
  dados json not null,
  -- jsonb gerado só para filtros, ordenação e índice (o jsonb reordena as chaves)
  busca jsonb generated always as (dados::jsonb) stored,
  atualizado_em timestamptz not null default now(),
  constraint docs_caminho_valido check (caminho ~ '^[^/]+(/[^/]+/[^/]+)*/[^/]+$' and char_length(caminho) <= 1500),
  constraint docs_partes check (caminho = colecao || '/' || id),
  constraint docs_objeto check (json_typeof(dados) = 'object'),
  constraint docs_tamanho check (octet_length(dados::text) <= 1048576)
);

create index if not exists docs_colecao_id on labz.docs (colecao, id collate "C");
create index if not exists docs_busca on labz.docs using gin (busca jsonb_path_ops);

alter table labz.docs enable row level security;
alter table labz.docs force row level security;
drop policy if exists labz_app_acesso on labz.docs;
create policy labz_app_acesso on labz.docs for all to labz_app using (true) with check (true);

revoke all on schema labz from public;
revoke all on all tables in schema labz from public;
do $$ declare papel text; begin
  foreach papel in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = papel) then
      execute format('revoke all on schema labz from %I', papel);
      execute format('revoke all on all tables in schema labz from %I', papel);
    end if;
  end loop;
end $$;

grant usage on schema labz to labz_app;
grant select, insert, update, delete on labz.docs to labz_app;
