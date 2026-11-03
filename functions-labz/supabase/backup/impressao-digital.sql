-- LABZ AI — Etapa 12: IMPRESSÃO DIGITAL dos dados do schema labz (SÓ LEITURA).
-- Devolve só o cabeçalho (total, contagem por coleção e sha256), nunca os dados. Serve para
-- conferir, pela conexão Claude/Supabase, que o arquivo baixado bate com o banco.
-- O bloco "with" abaixo é IDÊNTICO ao de exportar-dados.sql (um teste confere).
with base as (
  select caminho, colecao, id, dados::text as dados,
         to_char(atualizado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as atualizado
  from labz.docs
),
ordenada as (
  select row_number() over (order by caminho collate "C") as ordem, caminho, colecao, id, atualizado, dados from base
),
cabecalho as (
  select json_build_object(
    'formato', 'labz-backup-dados',
    'versao', 1,
    'algoritmo', 'sha256-netstring-v1',
    'tabela', 'labz.docs',
    'geradoEm', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'total', (select count(*) from ordenada),
    'contagem', (select coalesce(json_object_agg(colecao, n order by colecao collate "C"), '{}'::json)
                 from (select colecao, count(*) as n from ordenada group by colecao) c),
    'sha256', (select encode(sha256(convert_to(coalesce(string_agg(
                 octet_length(caminho) || ':' || caminho || octet_length(colecao) || ':' || colecao ||
                 octet_length(id) || ':' || id || octet_length(atualizado) || ':' || atualizado ||
                 octet_length(dados) || ':' || dados, '' order by ordem), ''), 'UTF8')), 'hex') from ordenada)
  ) as c
)
select c::text as cabecalho from cabecalho;
