// Fase 4B: EXECUTOR AUTOMÁTICO LOCAL. Processa a fila sem chamada manual por
// etapa: a cada ciclo roda o monitor e põe N trabalhadores (concorrência) para
// pegar itens da fila (motor.trabalhar) até a fila esvaziar ou o lote acabar.
// Usa SÓ o que já existe: fila persistente (reservas), crachá do executor,
// estados da execução, aprovações e limites de custo. Sem Cloud Tasks, sem
// agendamento em produção, sem Blaze: é um laço local (setTimeout) que só roda
// quando alguém o inicia (testes, emulador).
//
// Paradas: aprovação pendente → WAITING_APPROVAL (a execução sai da fila até o
// Super Admin decidir); limite de custo → REVISION_REQUIRED; execução cancelada
// → o próximo passo não grava (crachá). parar() aborta o sinal: a chamada em
// curso é cancelada e a etapa volta para a fila sem gastar tentativa.

const PADRAO = { nome: 'local', concorrencia: 2, intervaloMs: 2000, loteMax: 20 };

function criarExecutorLocal({ motor, monitor, auditoria, opcoes = {}, agendar, cancelarAgendamento }) {
  const cfg = Object.assign({}, PADRAO, opcoes);
  const ag = agendar || ((fn, ms) => setTimeout(fn, ms));
  const cancela = cancelarAgendamento || ((h) => clearTimeout(h));
  let controle = new AbortController();
  let ativo = false;
  let pendente = null; // agendamento
  let emCurso = null; // ciclo em andamento
  const historico = { ciclos: 0, processados: 0, erros: 0, quedas: 0 };

  async function ciclo() {
    const sinal = controle.signal;
    const mon = await monitor.verificar();
    const processados = [];
    let restantes = cfg.loteMax;
    const trabalhador = async (i) => {
      while (!sinal.aborted && restantes > 0) {
        restantes -= 1;
        let r;
        try {
          r = await motor.trabalhar(`${cfg.nome}-${i}`, { sinal });
        } catch (e) {
          if (e && e.interrupcao) { historico.quedas += 1; continue; } // "queda" simulada: o monitor recupera depois
          historico.erros += 1;
          processados.push({ resultado: 'erro' });
          continue;
        }
        if (!r) break; // fila vazia (ou nada disponível agora)
        processados.push(r);
      }
    };
    await Promise.all(Array.from({ length: cfg.concorrencia }, (_, i) => trabalhador(i)));
    historico.ciclos += 1;
    historico.processados += processados.length;
    return { monitor: mon, processados };
  }

  function proximo() {
    if (!ativo) return;
    pendente = ag(async () => {
      pendente = null;
      if (!ativo) return;
      emCurso = ciclo().catch(() => { historico.erros += 1; });
      await emCurso;
      emCurso = null;
      proximo();
    }, cfg.intervaloMs);
  }

  return {
    ciclo: () => ciclo(),
    // Roda ciclos até um ciclo não processar nada (ou maxCiclos). Útil nos testes e no emulador.
    async drenar({ maxCiclos = 50 } = {}) {
      const todos = [];
      for (let i = 0; i < maxCiclos; i++) {
        const r = await ciclo();
        todos.push(...r.processados);
        if (!r.processados.length && !r.monitor.recuperadas.length) break;
      }
      return todos;
    },
    iniciar() {
      if (ativo) return false;
      ativo = true;
      if (controle.signal.aborted) controle = new AbortController();
      proximo();
      return true;
    },
    async parar() {
      ativo = false;
      if (pendente) { cancela(pendente); pendente = null; }
      controle.abort(); // cancela a chamada em curso (a etapa volta para a fila)
      if (emCurso) await emCurso;
      controle = new AbortController();
      return Object.assign({}, historico);
    },
    situacao: () => Object.assign({ ativo }, historico),
  };
}

module.exports = { criarExecutorLocal };
