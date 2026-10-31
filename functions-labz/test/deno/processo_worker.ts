// Processo SEPARADO (Deno) que roda uma rodada do worker com uma chamada ao "modelo" que nunca
// termina. O teste mata este processo com SIGKILL no meio da chamada (queda sem aviso, como o
// runtime fazendo ao passar do limite) e confere a recuperação.
//   deno run -A processo_worker.ts <url-do-banco> <reservaMs>
import { L, SEGREDO, transporteContado } from './comum.ts';

const [url, reservaMs] = Deno.args;
const sql = L.postgres(url, { max: 3, prepare: false, onnotice: () => {} });
const transporte = transporteContado((x) => {
  if (x.meta.modo !== 'planejar') { console.log('PENDURADO'); return { pendurar: true }; }
  return null;
});
const { worker } = L.montarWorker({
  sql,
  config: { segredoWorker: SEGREDO },
  ia: { transporte, timeoutMs: 10 * 60 * 1000 },
  opcoes: { fila: { reservaMs: Number(reservaMs) }, monitor: { limiteBatimentoMs: Number(reservaMs) } },
});
await worker.rodar({ acionamento: { id: `acn_${'9'.repeat(32)}`, motivo: 'manual' } });
console.log('NAO-DEVERIA-TERMINAR');
