// Trilha de auditoria: só acrescenta (nada é editado nem apagado).
const { caminhos } = require('../armazenamento/caminhos');
const { novoId, relogioPadrao } = require('../nucleo/ids');
const { garantir } = require('../nucleo/validador');

const ESQUEMA_EVENTO = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    tipo: { tipo: 'texto', obrigatorio: true, padrao: /^[a-z]+(\.[a-z_]+)+$/ },
    ator: { tipo: 'objeto', obrigatorio: true, nulo: true, campos: { uid: { tipo: 'texto', obrigatorio: true } } },
    alvo: { tipo: 'texto', obrigatorio: true, max: 300 },
    detalhes: { tipo: 'objeto', obrigatorio: false },
    em: { tipo: 'texto', obrigatorio: true },
  },
};

function criarAuditoria(banco, relogio = relogioPadrao) {
  return {
    async registrar(tipo, ator, alvo, detalhes) {
      const evento = { tipo, ator: ator ? { uid: ator.uid } : null, alvo, em: relogio() };
      if (detalhes) evento.detalhes = detalhes;
      garantir(ESQUEMA_EVENTO, evento, 'Evento de auditoria');
      const id = novoId('ev');
      await banco.gravar(caminhos.evento(id), evento);
      return id;
    },
    async listar(filtro) { return banco.listar(caminhos.colecoes.eventos, filtro); },
  };
}

module.exports = { criarAuditoria, ESQUEMA_EVENTO };
