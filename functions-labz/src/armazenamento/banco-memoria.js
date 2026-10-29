// Banco de documentos EM MEMÓRIA (dublê de testes). Imita o necessário do
// Firestore por caminho: obter, gravar, atualizar, listar uma coleção e
// executar uma transação. Na Fase 2 entra o adaptador do Firestore (Admin SDK)
// com esta mesma interface:
//   obter(caminho) → objeto | null
//   gravar(caminho, dados)            (substitui)
//   atualizar(caminho, campos)        (falha se não existir)
//   listar(colecao, filtro?) → [{ id, ...dados }]   (só a coleção direta)
//   transacao(fn)  → fn recebe a mesma interface; tudo ou nada
const { erro } = require('../nucleo/erros');

const copia = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function criarBancoMemoria() {
  let docs = new Map();

  const api = {
    async obter(caminho) { return docs.has(caminho) ? copia(docs.get(caminho)) : null; },
    async gravar(caminho, dados) { docs.set(caminho, copia(dados)); },
    async atualizar(caminho, campos) {
      if (!docs.has(caminho)) throw erro('nao-encontrado', `documento não existe: ${caminho}`);
      docs.set(caminho, Object.assign(copia(docs.get(caminho)), copia(campos)));
    },
    async listar(colecao, filtro) {
      const prefixo = colecao + '/';
      const out = [];
      for (const [c, d] of docs) {
        if (!c.startsWith(prefixo)) continue;
        const resto = c.slice(prefixo.length);
        if (resto.includes('/')) continue; // só documentos diretos da coleção
        const item = Object.assign({ id: resto }, copia(d));
        if (!filtro || filtro(item)) out.push(item);
      }
      return out.sort((a, b) => a.id.localeCompare(b.id));
    },
    async transacao(fn) {
      const antes = new Map(docs);
      try { return await fn(api); } catch (e) { docs = antes; throw e; }
    },
    // só para testes e diagnóstico
    _caminhos: () => [...docs.keys()].sort(),
  };
  return api;
}

module.exports = { criarBancoMemoria };
