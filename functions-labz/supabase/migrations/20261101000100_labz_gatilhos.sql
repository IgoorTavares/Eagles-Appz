-- LABZ AI (Fase S3): GATILHOS do worker. Só no Supabase (usa pg_net, pg_cron e o Vault).
-- 1. Item novo na fila (labz_fila) → chama o worker na hora (gatilho após o INSERT; o pedido
--    HTTP do pg_net só sai depois do COMMIT: transação desfeita ou repetida não chama nada).
-- 2. A cada 1 minuto (pg_cron) → chama o worker: retomada de tarefas travadas, itens com
--    espera (novas tentativas) e qualquer acionamento perdido.
-- DESLIGADO até alguém cadastrar no Vault os dois segredos:
--   labz_worker_url      (URL da função labz-worker)
--   labz_worker_segredo  (o MESMO valor do segredo LABZ_WORKER_SEGREDO da função; 32+ caracteres)
-- Sem eles, labz.acionar_worker() não faz nada (devolve null).
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

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

-- O "tique" de 1 minuto: limpa acionamentos velhos e chama o worker.
create or replace function labz.tique()
returns bigint language plpgsql volatile security definer set search_path = '' as $$
begin
  perform labz.limpar_acionamentos();
  return labz.acionar_worker('cron');
end $$;

revoke all on function labz.acionar_worker(text) from public;
revoke all on function labz.ao_entrar_na_fila() from public;
revoke all on function labz.tique() from public;
do $$ declare papel text; begin
  foreach papel in array array['anon', 'authenticated', 'labz_app'] loop
    if exists (select 1 from pg_roles where rolname = papel) then
      execute format('revoke all on function labz.acionar_worker(text) from %I', papel);
      execute format('revoke all on function labz.tique() from %I', papel);
    end if;
  end loop;
end $$;

-- agenda (idempotente: o mesmo nome substitui o job)
select cron.schedule('labz-worker-tique', '* * * * *', 'select labz.tique()');
