// LABZ AI — Fase S3: uma RODADA do worker (o que a Edge Function labz-worker faz a cada chamada).
// Usa SÓ o que já existe e já foi testado (memória e PostgreSQL): o monitor (recupera execuções
// travadas, encerra reservas vencidas sem tentativa, retomadas automáticas) e motor.trabalhar
// (fila com reserva por prazo + crachá do executor: duas rodadas ao mesmo tempo nunca executam a
// mesma etapa).
//
// LIMITES DO RUNTIME (dividir em etapas NÃO resolve sozinho): a Edge Function tem limite de
// tempo total por chamada e de CPU. Por isso a rodada tem um ORÇAMENTO:
//   - parada SUAVE (paradaSuaveMs ou cpuMaxMs de CPU): não pega item novo e, dentro de uma
//     execução, para ENTRE etapas (a execução volta para a fila e a próxima chamada continua).
//     Nunca corta uma chamada em curso → nenhuma chamada ao modelo é desperdiçada ou repetida.
//     Regra: paradaSuaveMs + (tempo máximo de UMA etapa) < limiteMs < limite do runtime.
//   - parada DURA (limiteMs, ou o aviso de desligamento do runtime): cancela a chamada em curso;
//     a etapa volta para "pendente" SEM gastar tentativa.
//   - se o runtime MATAR o processo sem aviso: o item da fila fica reservado até o prazo e a
//     execução fica sem sinal de vida; o monitor da próxima rodada devolve tudo para a fila.
//     Só nesse caso a etapa interrompida é refeita (a chamada cortada é repetida uma vez).
const { ATOR_SISTEMA } = require('../auth/super-admin');

// vazioEsperaMs: chamada do GATILHO que acha a fila vazia olha de novo uma vez (outra chamada pode ter
// pegado o item desta e o item seguinte ainda não estava visível); o cron de 1 min cobre o resto.
const PADRAO = { paradaSuaveMs: 60 * 1000, limiteMs: 120 * 1000, cpuMaxMs: 1200, maxItens: 25, vazioEsperaMs: 400 };

// servicos: criarLabz(...); agoraMs/cpuMs: relógio e CPU usada (ms) do processo (cpuMs opcional)
function criarWorker({ servicos, orcamento = {}, agoraMs = () => Date.now(), cpuMs = null, agendar = setTimeout, cancelar = clearTimeout, esperar = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const cfg = Object.assign({}, PADRAO, orcamento);
  if (!(cfg.paradaSuaveMs < cfg.limiteMs)) throw new Error('orçamento inválido: a parada suave precisa vir antes do limite');
  const ativas = new Set();

  async function rodar({ acionamento } = {}) {
    const nome = `edge-${acionamento && acionamento.id ? acionamento.id.slice(4, 16) : 'manual'}`;
    const inicio = agoraMs();
    const cpu0 = cpuMs ? cpuMs() : 0;
    const duro = new AbortController();
    const motivoSuave = () => {
      if (duro.signal.aborted) return 'parada-dura';
      if (agoraMs() - inicio >= cfg.paradaSuaveMs) return 'orcamento-tempo';
      if (cpuMs && cpuMs() - cpu0 >= cfg.cpuMaxMs) return 'orcamento-cpu';
      return null;
    };
    const suave = { get aborted() { return motivoSuave() !== null; } };
    const timer = agendar(() => duro.abort(), cfg.limiteMs);
    ativas.add(duro);
    const resumo = { trabalhador: nome, acionamento: acionamento ? acionamento.motivo : null, recuperadas: 0, retomadas: 0, processados: 0, resultados: {}, erros: 0, parouPor: 'fila-vazia' };
    try {
      const mon = await servicos.monitor.verificar();
      resumo.recuperadas = mon.recuperadas.length;
      resumo.retomadas = (mon.retomadas || []).length;
      let olhouDeNovo = false;
      for (let i = 0; i < cfg.maxItens; i++) {
        // o 1º item sempre é pego (só a parada DURA impede): toda chamada avança pelo menos uma etapa
        const m = i === 0 ? (duro.signal.aborted ? 'parada-dura' : null) : motivoSuave();
        if (m) { resumo.parouPor = m; break; }
        let r;
        try {
          r = await servicos.motor.trabalhar(nome, { sinal: duro.signal, entreEtapas: suave });
        } catch (e) {
          resumo.erros += 1; // o item continua protegido pela reserva (o monitor recupera)
          resumo.parouPor = 'erro';
          break;
        }
        if (!r && i === 0 && !olhouDeNovo && acionamento && acionamento.motivo === 'fila' && cfg.vazioEsperaMs > 0) {
          olhouDeNovo = true;
          await esperar(cfg.vazioEsperaMs);
          i -= 1; // a nova tentativa ainda conta como "1º item"
          continue;
        }
        if (!r) { resumo.parouPor = 'fila-vazia'; break; }
        resumo.processados += 1;
        resumo.resultados[r.resultado] = (resumo.resultados[r.resultado] || 0) + 1;
        if (i === cfg.maxItens - 1) resumo.parouPor = 'max-itens';
      }
    } finally {
      cancelar(timer);
      ativas.delete(duro);
    }
    resumo.ms = Math.round(agoraMs() - inicio);
    if (cpuMs) resumo.cpuMs = Math.round(cpuMs() - cpu0);
    await servicos.auditoria.registrar('worker.rodada', ATOR_SISTEMA, 'labz_fila', {
      trabalhador: nome, motivo: resumo.acionamento, processados: resumo.processados, recuperadas: resumo.recuperadas,
      retomadas: resumo.retomadas, erros: resumo.erros, parouPor: resumo.parouPor, ms: resumo.ms, cpuMs: resumo.cpuMs === undefined ? null : resumo.cpuMs,
    }).catch(() => {});
    return resumo;
  }

  return {
    rodar,
    // aviso de desligamento do runtime (ex.: evento "beforeunload" da Edge Function): parada dura já
    pararTudo() { for (const c of ativas) c.abort(); return ativas.size; },
    orcamento: Object.freeze(Object.assign({}, cfg)),
  };
}

module.exports = { criarWorker, PADRAO_ORCAMENTO: PADRAO };
