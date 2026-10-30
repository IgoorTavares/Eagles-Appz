// Memory Auditor: aponta problemas nas memórias de um escopo/alvo, sem mudar nada.
//  - duplicadas (conteúdo muito parecido entre memórias vigentes)
//  - conflitos (mesma "chave" em mais de uma memória ativa)
//  - pendentes antigas (proposta esperando aprovação há muito tempo)
const { analisarConjunto } = require('./verificacoes');
const { relogioPadrao } = require('../nucleo/ids');

const DIAS_PENDENTE = 14;

function criarAuditorMemoria({ registro, relogio = relogioPadrao }) {
  return {
    async auditar(escopo, alvo) {
      const todas = await registro.listar(escopo, alvo);
      const vigentes = todas.filter((m) => m.status === 'ativa' && m.vigente);
      const { duplicadas, conflitos } = analisarConjunto(vigentes);
      const limite = Date.parse(relogio()) - DIAS_PENDENTE * 864e5;
      const pendentesAntigas = todas.filter((m) => m.status === 'pendente' && Date.parse(m.criadoEm) < limite).map((m) => m.id);
      return { escopo, alvo, total: todas.length, vigentes: vigentes.length, duplicadas, conflitos, pendentesAntigas };
    },
  };
}

module.exports = { criarAuditorMemoria };
