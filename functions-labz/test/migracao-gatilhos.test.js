// S5B, Etapa 10 — leitura da migração 3 (gatilhos, pg_cron e Vault). O comportamento de verdade
// é testado no Supabase local (supabase/testar-local.mjs); aqui ficam as regras que não podem
// mudar sem alguém perceber: isolamento, interruptor fechado por padrão e limpeza restrita.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SQL = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261101000100_labz_gatilhos.sql'), 'utf8');
const semComentarios = SQL.replace(/--.*$/gm, '');

test('migração 3: isolamento — só objetos do schema labz, um único job de cron e nenhuma mudança fora da LABZ AI', () => {
  const funcoes = [...semComentarios.matchAll(/create or replace function\s+([a-z_.]+)\(/gi)].map((m) => m[1]);
  assert.ok(funcoes.length >= 7);
  assert.ok(funcoes.every((f) => f.startsWith('labz.')), `funções fora do schema labz: ${funcoes.join(', ')}`);
  assert.deepEqual([...semComentarios.matchAll(/cron\.schedule\(\s*'([^']+)'/g)].map((m) => m[1]), ['labz-worker-tique']);
  assert.doesNotMatch(semComentarios, /cron\.unschedule|alter\s+(role|table|database|system)|grant\s/i, 'nada de mexer em papéis, tabelas de fora ou permissões');
  // apagar: só labz.docs (eventos operacionais), labz.acionamentos (pela função da migração 2) e o histórico do job da LABZ AI
  const deletes = [...semComentarios.matchAll(/delete\s+from\s+([a-z_.]+)/gi)].map((m) => m[1]).sort();
  assert.deepEqual(deletes, ['cron.job_run_details', 'labz.docs']);
  assert.match(semComentarios, /where j\.jobname = 'labz-worker-tique'/, 'a limpeza do cron é presa ao job da LABZ AI');
  assert.match(semComentarios, /colecao = 'labz_eventos' and \(dados->>'tipo'\) in \('worker\.rodada', 'fila\.monitor'\)/, 'só eventos operacionais são apagados');
  // a única gravação de dado: o interruptor DESLIGADO, sem sobrescrever um que já exista
  const inserts = [...semComentarios.matchAll(/insert\s+into\s+([a-z_.]+)/gi)].map((m) => m[1]);
  assert.deepEqual(inserts, ['labz.docs']);
  assert.match(semComentarios, /values \('labz_config\/worker', 'labz_config', 'worker', '\{"ativo":false\}'::json\)\s*on conflict \(caminho\) do nothing/);
  // nada de Firebase, CRM/ERP ou outros schemas do Supabase
  assert.doesNotMatch(semComentarios, /\b(public|auth|storage|realtime)\.\w+/i);
  assert.doesNotMatch(SQL, /tenants|usuarios\/|firestore|firebase/i);
});

test('migração 3: interruptor fechado por padrão (ausente, outro formato ou erro = desligado) e respeitado pela fila e pelo tique', () => {
  const corpo = /create or replace function labz\.worker_ativo\(\)[\s\S]*?end \$\$;/.exec(SQL)[0];
  assert.match(corpo, /json_typeof\(v->'ativo'\) is distinct from 'boolean'/);
  assert.match(corpo, /return \(v->>'ativo'\)::boolean is true;/);
  assert.match(corpo, /exception when others then\s+return false;/);
  const acionar = /create or replace function labz\.acionar_worker\(p_motivo text\)[\s\S]*?end \$\$;/.exec(SQL)[0];
  assert.match(acionar, /if p_motivo is distinct from 'manual' and not labz\.worker_ativo\(\) then\s+return null;/);
  // o interruptor é conferido ANTES de criar o acionamento (nada é registrado com ele desligado)
  assert.ok(acionar.indexOf('labz.worker_ativo()') < acionar.indexOf('criar_acionamento'));
  const tique = /create or replace function labz\.tique\(\)[\s\S]*?end \$\$;/.exec(SQL)[0];
  assert.match(tique, /if not labz\.worker_ativo\(\) or not labz\.ha_trabalho\(\) then\s+return null;/);
  // limpezas não derrubam o tique, mas deixam aviso no log
  assert.equal((tique.match(/exception when others then raise warning/g) || []).length, 3);
  // ninguém além do dono do banco chama estas funções
  for (const f of ['acionar_worker(text)', 'tique()', 'limpar_eventos_operacionais()', 'limpar_historico_cron()', 'worker_ativo()', 'ha_trabalho()']) {
    assert.ok(SQL.includes(`revoke all on function labz.${f} from public;`), f);
    assert.ok(SQL.includes(`'revoke all on function labz.${f} from %I'`), f);
  }
});

test('migração 3: limpeza do cron guarda as FALHAS por mais tempo (diagnóstico) e trabalha em lotes', () => {
  const corpo = /create or replace function labz\.limpar_historico_cron\(\)[\s\S]*?end \$\$;/.exec(SQL)[0];
  assert.match(corpo, /\(d\.status = 'succeeded' and d\.end_time < now\(\) - interval '7 days'\) or d\.end_time < now\(\) - interval '30 days'/);
  assert.match(corpo, /d\.end_time is not null/, 'execução em andamento nunca é apagada');
  assert.match(corpo, /limit 1000/);
});
