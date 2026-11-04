// LABZ AI — Edge Function "labz-worker" (Fase S3; NÃO publicada).
// Chamada SÓ pelo banco (gatilho da fila e pg_cron, migração 3). Cada chamada precisa de um
// acionamento assinado E registrado no banco (uma vez só): ver src/borda/acionamento.js.
// Responde 202 na hora e trabalha ao fundo (EdgeRuntime.waitUntil), dentro do orçamento.
// Segredos lidos do ambiente (Supabase Secrets; nunca no Git):
//   LABZ_DB_URL          conexão com o papel de LOGIN da LABZ AI (membro de labz_app)
//   LABZ_WORKER_SEGREDO  o mesmo valor do segredo "labz_worker_segredo" do Vault (32+ caracteres)
import process from 'node:process';
import { montarWorker, postgres } from './labz-b49c379e0336.mjs';

const env = (k: string) => Deno.env.get(k) ?? '';
const numero = (k: string, padrao: number) => { const n = Number(env(k)); return Number.isFinite(n) && n > 0 ? n : padrao; };

const sql = postgres(env('LABZ_DB_URL'), { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10 });

// Orçamento (ver src/borda/worker.js). Limite do plano grátis: ~150 s por chamada e 2 s de CPU.
const orcamento = {
  paradaSuaveMs: numero('LABZ_WORKER_PARADA_SUAVE_MS', 60_000),
  limiteMs: numero('LABZ_WORKER_LIMITE_MS', 120_000),
  cpuMaxMs: numero('LABZ_WORKER_CPU_MAX_MS', 1_200),
};

// Medida de CPU: no Supabase Edge Runtime (testado na v1.77.8) process.cpuUsage() devolve sempre 0;
// nesse caso a medida é ignorada e valem o orçamento de tempo e o limite de CPU do próprio runtime.
let cpuMs: (() => number) | null = null;
try {
  let x = 0;
  for (let i = 0; i < 2e5; i++) x += Math.sqrt(i); // um pouco de trabalho para a medida sair do zero
  const u = process.cpuUsage();
  if (x > 0 && u.user + u.system > 0) cpuMs = () => { const v = process.cpuUsage(); return (v.user + v.system) / 1000; };
} catch (_e) { cpuMs = null; }

// deno-lint-ignore no-explicit-any
const edge = (globalThis as any).EdgeRuntime;
const { handler, worker } = montarWorker({
  sql,
  config: { segredoWorker: env('LABZ_WORKER_SEGREDO'), orcamento },
  cpuMs,
  aoFundo: edge && typeof edge.waitUntil === 'function' ? (p: Promise<unknown>) => edge.waitUntil(p) : undefined,
  registrarErro: (e: unknown) => console.error('labz-worker: erro', e instanceof Error ? e.message : 'desconhecido'),
});

// o runtime avisa antes de desligar a instância: parada dura (a etapa em curso volta para a fila)
addEventListener('beforeunload', () => { worker.pararTudo(); });

Deno.serve(handler);
