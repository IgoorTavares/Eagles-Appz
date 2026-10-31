// Fase 4B: monitor LOCAL da fila e das execuções (verificação periódica,
// chamada pelo executor local a cada ciclo; nada agendado em produção).
// A cada verificação:
//  1. execuções RUNNING sem sinal de vida → voltam para a fila (READY) ou, sem
//     tentativas, viram FAILED; empresa arquivada → CANCELLED. Sem retomada
//     dupla (versão conferida na transição: execucao/servico.js);
//  2. reservas vencidas da fila: as que ainda têm tentativa são retomadas pelo
//     próximo executor (fila.reservar); as sem tentativa são ENCERRADAS como falha;
//  3. itens pendentes de execuções já encerradas (canceladas, concluídas, com
//     falha) saem da fila: cancelamento é preservado, nada é ressuscitado.
// Tudo vai para a auditoria só com ids e contagens.
const { caminhos } = require('../armazenamento/caminhos');
const { ATOR_SISTEMA } = require('../auth/super-admin');
const { FINAIS } = require('../contratos/execucao');
const { relogioPadrao } = require('../nucleo/ids');

const PADRAO = { limiteBatimentoMs: 5 * 60 * 1000 };

// retomadas (Fase 4C.2 passo 4, opcional): função do motor que tenta retomar as execuções paradas
// aguardando a aprovação de um documento (o mesmo caminho da notificação; idempotente).
function criarMonitorFila({ banco, execucoes, fila, auditoria, relogio = relogioPadrao, opcoes = {}, retomadas }) {
  const cfg = Object.assign({}, PADRAO, opcoes);
  return {
    async verificar() {
      const r = { recuperadas: [], reservasVencidas: 0, encerradasPorVencimento: [], descartados: [] };
      r.recuperadas = (await execucoes.recuperarInterrompidas(cfg.limiteBatimentoMs)).filter((x) => x.para);
      for (const it of await fila.reservasVencidas()) {
        r.reservasVencidas += 1;
        if ((it.tentativas || 0) >= fila.maxTentativas && await fila.encerrarVencido(it.id)) r.encerradasPorVencimento.push(it.id);
      }
      for (const it of await fila.pendentes()) {
        const exe = await banco.obter(caminhos.tarefa(it.execucaoId));
        if (!exe || FINAIS.includes(exe.estado)) {
          if (await fila.descartar(it.id, exe ? `execucao-${exe.estado}` : 'execucao-inexistente')) r.descartados.push(it.id);
        }
      }
      r.retomadas = retomadas ? (await retomadas()).filter((x) => x.resultado === 'retomada-agendada').map((x) => x.id) : [];
      if (r.recuperadas.length || r.encerradasPorVencimento.length || r.descartados.length || r.retomadas.length) {
        await auditoria.registrar('fila.monitor', ATOR_SISTEMA, caminhos.colecoes.fila, {
          recuperadas: r.recuperadas.length, paraFila: r.recuperadas.filter((x) => x.para === 'READY').length, falhas: r.recuperadas.filter((x) => x.para === 'FAILED').length,
          reservasVencidas: r.reservasVencidas, encerradas: r.encerradasPorVencimento.length, descartados: r.descartados.length, retomadas: r.retomadas.length,
        });
      }
      return r;
    },
  };
}

module.exports = { criarMonitorFila };
