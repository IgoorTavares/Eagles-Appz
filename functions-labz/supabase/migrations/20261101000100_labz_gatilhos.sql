-- LABZ AI (Fase S3): GATILHOS do worker. Só no Supabase (usa pg_net, pg_cron e o Vault).
-- 1. Item novo na fila (labz_fila) → chama o worker na hora (gatilho após o INSERT; o pedido
--    HTTP do pg_net só sai depois do COMMIT: transação desfeita ou repetida não chama nada).
-- 2. A cada 1 minuto (pg_cron) → chama o worker: retomada de tarefas travadas, itens com
--    espera (novas tentativas) e qualquer acionamento perdido.
-- DESLIGADO até DUAS coisas (S5B, Etapa 10):
--   a) o Vault ter os dois segredos:
--        labz_worker_url      (URL da função labz-worker)
--        labz_worker_segredo  (o MESMO valor do segredo LABZ_WORKER_SEGREDO da função; 32+ caracteres)
--   b) o INTERRUPTOR labz_config/worker = {"ativo": true} (em labz.docs). Registro ausente, com outro
--      formato, "ativo" diferente do booleano true, ou erro ao ler = DESLIGADO. A fila e o tique só
--      acionam o worker com o interruptor ligado; o acionamento 'manual' (só o dono do banco consegue
--      chamar) ignora o interruptor, para o teste controlado.
-- Desligar em emergência (efeito no próximo acionamento; nada é apagado):
--   update labz.docs set dados = '{"ativo":false}'::json where caminho = 'labz_config/worker';
-- Tarefas já iniciadas: a rodada em curso do worker termina sozinha dentro do orçamento (até ~2 min);
-- sem novos acionamentos, nada continua. Itens e tarefas ficam como estão e voltam quando o interruptor
-- for religado. Para encerrar uma tarefa de vez: execucoes.transicionar → CANCELLED (só o Super Admin).
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- O interruptor. Fechado por padrão: só devolve true com o registro exatamente {"ativo": true, ...}.
create or replace function labz.worker_ativo()
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v json;
begin
  select dados into v from labz.docs where caminho = 'labz_config/worker';
  if v is null or json_typeof(v) <> 'object' or json_typeof(v->'ativo') is distinct from 'boolean' then
    return false;
  end if;
  return (v->>'ativo')::boolean is true;
exception when others then
  return false; -- erro ao ler = desligado
end $$;

-- Há trabalho para o worker? Item da fila pendente/em andamento ou tarefa que avança.
-- (Usa o índice GIN de "busca".) Em erro, responde true: quem decide se chama é o interruptor.
create or replace function labz.ha_trabalho()
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  return exists (select 1 from labz.docs where colecao = 'labz_fila' and (busca @> '{"estado":"pendente"}' or busca @> '{"estado":"em-andamento"}'))
      or exists (select 1 from labz.docs where colecao = 'labz_tarefas' and (busca @> '{"estado":"PLANNING"}' or busca @> '{"estado":"RUNNING"}' or busca @> '{"estado":"READY"}' or busca @> '{"estado":"REVISION_REQUIRED"}'));
exception when others then
  return true;
end $$;

create or replace function labz.acionar_worker(p_motivo text)
returns bigint language plpgsql volatile security definer set search_path = '' as $$
declare
  v_url text;
  v_segredo text;
  a record;
  v_pedido bigint;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'labz_worker_url' limit 1;
  select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'labz_worker_segredo' limit 1;
  if p_motivo is distinct from 'manual' and not labz.worker_ativo() then
    return null; -- interruptor desligado: a fila e o tique não chamam nada
  end if;
  if v_url is null or v_segredo is null then
    return null; -- ainda não configurado: nada é chamado
  end if;
  select * into a from labz.criar_acionamento(p_motivo, v_segredo);
  -- o corpo NÃO é assinado nem usado pelo worker: tudo o que vale vai nos cabeçalhos assinados
  select net.http_post(
    url := v_url,
    body := jsonb_build_object('acionamento', a.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-labz-acionamento', a.id,
      'x-labz-tempo', a.tempo::text,
      'x-labz-motivo', a.motivo,
      'x-labz-assinatura', 'v1=' || a.assinatura
    ),
    timeout_milliseconds := 5000
  ) into v_pedido;
  return v_pedido;
end $$;

create or replace function labz.ao_entrar_na_fila()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform labz.acionar_worker('fila');
  return null;
end $$;

drop trigger if exists labz_fila_acionar on labz.docs;
create trigger labz_fila_acionar
  after insert on labz.docs
  for each row when (new.colecao = 'labz_fila')
  execute function labz.ao_entrar_na_fila();

-- Retenção: só os eventos OPERACIONAIS do worker e do monitor com mais de 30 dias (os eventos de
-- decisão — aprovações, memórias, entregas, acessos — nunca são apagados aqui). Até 500 por vez.
create or replace function labz.limpar_eventos_operacionais()
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare n integer;
begin
  delete from labz.docs where caminho in (
    select caminho from labz.docs
    where colecao = 'labz_eventos' and (dados->>'tipo') in ('worker.rodada', 'fila.monitor')
      and atualizado_em < now() - interval '30 days'
    limit 500);
  get diagnostics n = row_count;
  return n;
end $$;

-- Histórico do pg_cron: SÓ as execuções do job da LABZ AI (labz-worker-tique). As que deram certo
-- ficam 7 dias; as que FALHARAM ficam 30 dias (diagnóstico). Jobs de outros sistemas não são tocados.
-- Até 1000 por vez.
create or replace function labz.limpar_historico_cron()
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare n integer;
begin
  delete from cron.job_run_details where runid in (
    select d.runid from cron.job_run_details d
    where d.jobid in (select j.jobid from cron.job j where j.jobname = 'labz-worker-tique')
      and d.end_time is not null
      and ((d.status = 'succeeded' and d.end_time < now() - interval '7 days') or d.end_time < now() - interval '30 days')
    limit 1000);
  get diagnostics n = row_count;
  return n;
end $$;

-- O "tique" de 1 minuto: limpezas (acionamentos com mais de 1 dia, eventos operacionais com mais de
-- 30 dias, histórico do cron da LABZ AI) e, SÓ com o interruptor ligado E havendo trabalho, chama o
-- worker. Uma limpeza que falhar vira aviso no log do banco e não impede o resto.
create or replace function labz.tique()
returns bigint language plpgsql volatile security definer set search_path = '' as $$
begin
  begin perform labz.limpar_acionamentos(); exception when others then raise warning 'labz.tique: limpar_acionamentos falhou: %', sqlerrm; end;
  begin perform labz.limpar_eventos_operacionais(); exception when others then raise warning 'labz.tique: limpar_eventos_operacionais falhou: %', sqlerrm; end;
  begin perform labz.limpar_historico_cron(); exception when others then raise warning 'labz.tique: limpar_historico_cron falhou: %', sqlerrm; end;
  if not labz.worker_ativo() or not labz.ha_trabalho() then
    return null; -- desligado, ou nada a fazer: não chama o worker
  end if;
  return labz.acionar_worker('cron');
end $$;

revoke all on function labz.acionar_worker(text) from public;
revoke all on function labz.ao_entrar_na_fila() from public;
revoke all on function labz.tique() from public;
revoke all on function labz.limpar_eventos_operacionais() from public;
revoke all on function labz.limpar_historico_cron() from public;
revoke all on function labz.worker_ativo() from public;
revoke all on function labz.ha_trabalho() from public;
do $$ declare papel text; begin
  foreach papel in array array['anon', 'authenticated', 'labz_app'] loop
    if exists (select 1 from pg_roles where rolname = papel) then
      execute format('revoke all on function labz.acionar_worker(text) from %I', papel);
      execute format('revoke all on function labz.tique() from %I', papel);
      execute format('revoke all on function labz.limpar_eventos_operacionais() from %I', papel);
      execute format('revoke all on function labz.limpar_historico_cron() from %I', papel);
      execute format('revoke all on function labz.worker_ativo() from %I', papel);
      execute format('revoke all on function labz.ha_trabalho() from %I', papel);
    end if;
  end loop;
end $$;

-- o interruptor nasce DESLIGADO (e, se já existir, a migração não mexe nele)
insert into labz.docs (caminho, colecao, id, dados)
values ('labz_config/worker', 'labz_config', 'worker', '{"ativo":false}'::json)
on conflict (caminho) do nothing;

-- agenda (idempotente: o mesmo nome substitui o job)
select cron.schedule('labz-worker-tique', '* * * * *', 'select labz.tique()');
