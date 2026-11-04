-- LABZ AI — Etapa 12: EXPORTAÇÃO DOS DADOS do schema labz (SÓ LEITURA: nada é gravado).
-- Como usar: SQL Editor do Supabase → colar TUDO → Run → baixar o resultado (CSV ou JSON).
-- Se o SQL Editor tiver a opção de limitar linhas, escolha "sem limite" (a página de conferência
-- acusa "incompleto" se faltar alguma linha).
-- Resultado: linha 0 = cabeçalho (formato, data, total, contagem por coleção e impressão digital
-- sha256); linhas 1..N = um documento cada, como texto JSON [caminho, colecao, id, atualizado_em, dados].
-- Tudo numa consulta só = um retrato único e coerente do banco. NÃO lê o Vault, senhas ou a tabela
-- labz.acionamentos (bilhetes de uso único). Formato: functions-labz/README.md (seção "Backup do Supabase").
-- O bloco "with" abaixo é IDÊNTICO ao de impressao-digital.sql (um teste confere).
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
select 0::bigint as ordem, (select c from cabecalho)::text as linha
union all
select ordem, json_build_array(caminho, colecao, id, atualizado, dados)::text from ordenada
order by ordem;
