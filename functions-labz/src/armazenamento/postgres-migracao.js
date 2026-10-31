// LABZ AI — Fase S1: estrutura do PostgreSQL (Supabase) da LABZ AI.
// UMA fonte para a migração: o arquivo supabase/migrations/…_labz_inicial.sql é gerado
// daqui (um teste confere que são iguais), e os testes criam um schema isolado com o
// MESMO texto. Os dados ficam numa tabela de documentos por caminho (labz_tarefas/{id},
// labz_entregas/{id}/labz_versoes_entrega/{n}…), igual ao que os serviços já usam: nenhum
// serviço precisa mudar.
//
// Segurança:
// - schema próprio ("labz"), que NÃO deve ser exposto pela API automática do Supabase;
// - RLS ligado e FORÇADO; a única política é a do papel do servidor (labz_app);
// - nada para public/anon/authenticated (nem uso do schema): o navegador não lê nem grava;
// - o papel labz_app nasce SEM login: a senha é definida à mão no projeto (nunca no Git).
const NOME_VALIDO = /^[a-z_][a-z0-9_]{0,40}$/;

function sqlMigracao(schema = 'labz') {
  if (!NOME_VALIDO.test(schema)) throw new Error('nome de schema inválido');
  const s = schema;
  return `-- LABZ AI: estrutura de dados (gerado por src/armazenamento/postgres-migracao.js; não edite à mão)
create schema if not exists ${s};

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'labz_app') then
    create role labz_app nologin;
  end if;
exception when duplicate_object or unique_violation then null; -- outra migração criou ao mesmo tempo
end $$;

create table if not exists ${s}.docs (
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

create index if not exists docs_colecao_id on ${s}.docs (colecao, id collate "C");
create index if not exists docs_busca on ${s}.docs using gin (busca jsonb_path_ops);

alter table ${s}.docs enable row level security;
alter table ${s}.docs force row level security;
drop policy if exists labz_app_acesso on ${s}.docs;
create policy labz_app_acesso on ${s}.docs for all to labz_app using (true) with check (true);

revoke all on schema ${s} from public;
revoke all on all tables in schema ${s} from public;
do $$ declare papel text; begin
  foreach papel in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = papel) then
      execute format('revoke all on schema ${s} from %I', papel);
      execute format('revoke all on all tables in schema ${s} from %I', papel);
    end if;
  end loop;
end $$;

grant usage on schema ${s} to labz_app;
grant select, insert, update, delete on ${s}.docs to labz_app;
`;
}

module.exports = { sqlMigracao, NOME_VALIDO };
