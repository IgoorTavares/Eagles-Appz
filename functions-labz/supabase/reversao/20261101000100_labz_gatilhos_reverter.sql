-- LABZ AI (S5B, Etapa 10): REVERSÃO da migração 3 (labz_gatilhos). Só com autorização do Igor.
-- Desfaz o agendamento, o gatilho da fila, as funções e o interruptor. NÃO apaga dados da LABZ AI
-- (perfil, lista de acesso, contador, tarefas, entregas, memórias) e NÃO mexe no Vault.
-- As extensões pg_cron e pg_net ficam instaladas (não atrapalham); removê-las é um passo à parte.
-- Ensaio no Supabase local: supabase/ensaiar-etapa10.mjs.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') and exists (select 1 from cron.job where jobname = 'labz-worker-tique') then
    perform cron.unschedule('labz-worker-tique');
  end if;
end $$;
drop trigger if exists labz_fila_acionar on labz.docs;
drop function if exists labz.tique();
drop function if exists labz.ao_entrar_na_fila();
drop function if exists labz.acionar_worker(text);
drop function if exists labz.limpar_eventos_operacionais();
drop function if exists labz.limpar_historico_cron();
drop function if exists labz.ha_trabalho();
drop function if exists labz.worker_ativo();
delete from labz.docs where caminho = 'labz_config/worker';
