// Memory Auditor: aponta problemas nas memórias de um escopo/alvo, sem mudar nada.
//  - duplicadas (conteúdo muito parecido entre memórias vigentes)
//  - conflitos (mesma "chave" em mais de uma memória ativa)
//  - pendentes antigas (proposta esperando aprovação há muito tempo)
const { similaridade } = require('./correcoes');
const { relogioPadrao } = require('../nucleo/ids');

const LIMIAR = 0.8;
const DIAS_PENDENTE = 14;

function criarAuditorMemoria({ registro, relogio = relogioPadrao }) {
  return {
    async auditar(escopo, alvo) {
      const todas = await registro.listar(escopo, alvo);
      const vigentes = todas.filter((m) => m.status === 'ativa' && m.vigente);
      const duplicadas = [];
      for (let i = 0; i < vigentes.length; i++) {
        for (let j = i + 1; j < vigentes.length; j++) {
          const s = similaridade(vigentes[i].vigente.conteudo, vigentes[j].vigente.conteudo);
          if (s >= LIMIAR) duplicadas.push({ a: vigentes[i].id, b: vigentes[j].id, similaridade: Math.round(s * 100) / 100 });
        }
      }
      const porChave = {};
      vigentes.filter((m) => m.chave).forEach((m) => { (porChave[m.chave] = porChave[m.chave] || []).push(m.id); });
      const conflitos = Object.entries(porChave).filter(([, ids]) => ids.length > 1).map(([chave, ids]) => ({ chave, ids }));
      const limite = Date.parse(relogio()) - DIAS_PENDENTE * 864e5;
      const pendentesAntigas = todas.filter((m) => m.status === 'pendente' && Date.parse(m.criadoEm) < limite).map((m) => m.id);
      return { escopo, alvo, total: todas.length, vigentes: vigentes.length, duplicadas, conflitos, pendentesAntigas };
    },
  };
}

module.exports = { criarAuditorMemoria };
