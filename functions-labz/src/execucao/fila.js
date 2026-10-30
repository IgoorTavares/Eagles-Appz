// Fila PERSISTENTE de trabalho (labz_fila). Funciona com qualquer banco da
// interface (memória nos testes, Firestore no servidor), sem Cloud Tasks.
// Na Fase 4 o "trabalhador" será uma função agendada ou o Cloud Tasks
// chamando reservar() → executar → concluir()/falhar().
//
//  pendente ──reservar──► em-andamento ──concluir──► feita
//      ▲                       │
//      └──── falhar (nova tentativa, com espera crescente) ◄┘
//                              └── falhar na última tentativa ──► falhou
// Uma reserva vence (travadoAte): se o trabalhador morrer no meio, outro
// trabalhador pode pegar o item de novo (retomada).
const { caminhos } = require('../armazenamento/caminhos');
const { erro } = require('../nucleo/erros');
const { novoId, relogioPadrao } = require('../nucleo/ids');

const PADRAO = { maxTentativas: 3, reservaMs: 5 * 60 * 1000, esperaBaseMs: 30 * 1000 };

function criarFila({ banco, relogio = relogioPadrao, opcoes = {} }) {
  const cfg = Object.assign({}, PADRAO, opcoes);
  const ms = (iso) => Date.parse(iso);
  const iso = (n) => new Date(n).toISOString();

  const elegivel = (it, agora) =>
    (it.estado === 'pendente' && ms(it.disponivelEm) <= agora) ||
    (it.estado === 'em-andamento' && ms(it.travadoAte) < agora); // reserva vencida = trabalhador caiu

  return {
    // t (opcional): grava dentro de uma transação já aberta
    async enfileirar(trabalho, t) {
      if (!trabalho || typeof trabalho.tipo !== 'string' || !trabalho.execucaoId) throw erro('invalido', 'Trabalho inválido para a fila');
      const id = novoId('fila');
      const agora = relogio();
      const doc = { execucaoId: trabalho.execucaoId, tipo: trabalho.tipo, dados: trabalho.dados || {}, estado: 'pendente', tentativas: 0, disponivelEm: agora, criadoEm: agora, travadoAte: null, trabalhador: null };
      await (t || banco).gravar(caminhos.filaItem(id), doc);
      return id;
    },

    // Pega o próximo item disponível (o mais antigo), com reserva por tempo limitado.
    async reservar(trabalhador) {
      const agora = ms(relogio());
      const candidatos = (await banco.listar(caminhos.colecoes.fila, (it) => elegivel(it, agora)))
        .sort((a, b) => ms(a.disponivelEm) - ms(b.disponivelEm));
      for (const c of candidatos) {
        const pego = await banco.transacao(async (t) => {
          const it = await t.obter(caminhos.filaItem(c.id));
          if (!it || !elegivel(it, agora)) return null; // outro trabalhador pegou antes
          const mud = { estado: 'em-andamento', trabalhador, travadoAte: iso(agora + cfg.reservaMs), tentativas: (it.tentativas || 0) + 1, reservadoEm: iso(agora) };
          await t.atualizar(caminhos.filaItem(c.id), mud);
          return Object.assign({ id: c.id }, it, mud);
        });
        if (pego) return pego;
      }
      return null;
    },

    async concluir(id, trabalhador, resultado) {
      await banco.transacao(async (t) => {
        const it = await t.obter(caminhos.filaItem(id));
        if (!it) throw erro('nao-encontrado', 'Item da fila não encontrado');
        if (it.estado !== 'em-andamento' || it.trabalhador !== trabalhador) throw erro('precondicao', 'Item não está reservado para este trabalhador');
        await t.atualizar(caminhos.filaItem(id), { estado: 'feita', concluidoEm: relogio(), travadoAte: null, resultado: resultado || null });
      });
    },

    // Devolve para a fila com espera crescente, ou desiste na última tentativa.
    async falhar(id, trabalhador, mensagem) {
      let final = null;
      await banco.transacao(async (t) => {
        const it = await t.obter(caminhos.filaItem(id));
        if (!it) throw erro('nao-encontrado', 'Item da fila não encontrado');
        if (it.estado !== 'em-andamento' || it.trabalhador !== trabalhador) throw erro('precondicao', 'Item não está reservado para este trabalhador');
        const ultimoErro = String(mensagem || '').slice(0, 500);
        if (it.tentativas >= cfg.maxTentativas) {
          final = 'falhou';
          await t.atualizar(caminhos.filaItem(id), { estado: 'falhou', travadoAte: null, ultimoErro, falhouEm: relogio() });
        } else {
          final = 'pendente';
          const espera = cfg.esperaBaseMs * 2 ** (it.tentativas - 1);
          await t.atualizar(caminhos.filaItem(id), { estado: 'pendente', travadoAte: null, trabalhador: null, ultimoErro, disponivelEm: iso(ms(relogio()) + espera) });
        }
      });
      return final;
    },

    listar: (filtro) => banco.listar(caminhos.colecoes.fila, filtro),
  };
}

module.exports = { criarFila };
