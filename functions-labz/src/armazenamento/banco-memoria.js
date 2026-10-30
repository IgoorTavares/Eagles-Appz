// Banco de documentos EM MEMÓRIA (dublê de testes). Imita o necessário do
// Firestore por caminho: obter, gravar, atualizar, listar uma coleção e
// executar uma transação. Na Fase 2 entra o adaptador do Firestore (Admin SDK)
// com esta mesma interface:
//   obter(caminho) → objeto | null
//   gravar(caminho, dados)            (substitui)
//   atualizar(caminho, campos)        (falha se não existir)
//   listar(colecao, filtro?) → [{ id, ...dados }]   (só a coleção direta)
//   transacao(fn)  → fn recebe a mesma interface; tudo ou nada
//   consultar(colecao, { onde, ordenar, limite, depoisDe }) → consulta LIMITADA
//     (Fase 3C), com as mesmas restrições do Firestore (validarConsultaBanco):
//     limite obrigatório, até 30 valores em in/array-contains-any, um só
//     array-contains, e orderBy deixa de fora quem não tem o campo.
//   estatisticas() → quantas chamadas e documentos cada leitura devolveu (testes)
const { erro } = require('../nucleo/erros');
const { validarConsultaBanco } = require('../contratos/recuperacao');

const valorCampo = (doc, campo) => (campo === 'id' ? doc.id : campo.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc));
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function passa(doc, c) {
  const v = valorCampo(doc, c.campo);
  switch (c.op) {
    case '==': return v !== undefined && igual(v, c.valor);
    case 'in': return v !== undefined && c.valor.some((x) => igual(v, x));
    case 'array-contains': return Array.isArray(v) && v.some((x) => igual(x, c.valor));
    case 'array-contains-any': return Array.isArray(v) && v.some((x) => c.valor.some((y) => igual(x, y)));
    default: return false;
  }
}
// Cursor preso ao escopo (F6): os campos pedidos têm de casar com os filtros "==".
function cursorNoEscopo(doc, opcoes) {
  (opcoes.cursorMesmoFiltro || []).forEach((campo) => {
    const f = (opcoes.onde || []).find((c) => c.campo === campo && c.op === '==');
    if (f && !igual(valorCampo(doc, campo), f.valor)) throw erro('invalido', 'Cursor de paginação de outro escopo');
  });
}

// Ordem do Firestore: o campo pedido e, no empate, o id do documento na mesma direção.
function comparador(ordenar) {
  if (!ordenar) return (a, b) => a.id.localeCompare(b.id);
  const s = ordenar.direcao === 'desc' ? -1 : 1;
  return (a, b) => {
    const x = valorCampo(a, ordenar.campo), y = valorCampo(b, ordenar.campo);
    if (x !== y) return (x < y ? -1 : 1) * s;
    return a.id.localeCompare(b.id) * s;
  };
}

const copia = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function criarBancoMemoria() {
  let docs = new Map();
  let fila = Promise.resolve(); // transações em fila
  const est = { listar: { chamadas: 0, documentos: 0 }, consultar: { chamadas: 0, documentos: 0 }, porColecao: {} };
  const contar = (tipo, colecao, n) => {
    est[tipo].chamadas++; est[tipo].documentos += n;
    const pc = est.porColecao[colecao] = est.porColecao[colecao] || { listar: 0, consultar: 0, documentos: 0 };
    pc[tipo]++; pc.documentos += n;
  };
  const filhos = (colecao) => {
    const prefixo = colecao + '/';
    const out = [];
    for (const [c, d] of docs) {
      if (!c.startsWith(prefixo)) continue;
      const resto = c.slice(prefixo.length);
      if (!resto.includes('/')) out.push(Object.assign({ id: resto }, copia(d)));
    }
    return out;
  };

  const api = {
    async obter(caminho) { return docs.has(caminho) ? copia(docs.get(caminho)) : null; },
    async gravar(caminho, dados) { docs.set(caminho, copia(dados)); },
    async atualizar(caminho, campos) {
      if (!docs.has(caminho)) throw erro('nao-encontrado', `documento não existe: ${caminho}`);
      docs.set(caminho, Object.assign(copia(docs.get(caminho)), copia(campos)));
    },
    // Lê a coleção INTEIRA (só os documentos diretos). Fora da busca de
    // memórias; a aprovação usa dentro da transação para não deixar escapar conflito.
    async listar(colecao, filtro) {
      const todos = filhos(colecao);
      contar('listar', colecao, todos.length);
      return todos.filter((item) => !filtro || filtro(item)).sort((a, b) => a.id.localeCompare(b.id));
    },
    // Uma transação de cada vez (como o Firestore, que isola as transações):
    // uma segunda espera a primeira terminar. Não chame transacao() de dentro
    // de outra transação.
    async consultar(colecao, opcoes) {
      validarConsultaBanco(colecao, opcoes);
      const cmp = comparador(opcoes.ordenar);
      let itens = filhos(colecao).filter((d) => (opcoes.onde || []).every((c) => passa(d, c)));
      if (opcoes.ordenar && opcoes.ordenar.campo !== 'id') itens = itens.filter((d) => valorCampo(d, opcoes.ordenar.campo) !== undefined);
      itens.sort(cmp);
      if (opcoes.depoisDe) {
        const cursor = docs.get(`${colecao}/${opcoes.depoisDe}`);
        if (!cursor) throw erro('invalido', 'Cursor de paginação inválido');
        const ref = Object.assign({ id: opcoes.depoisDe }, cursor);
        cursorNoEscopo(ref, opcoes);
        itens = itens.filter((d) => cmp(d, ref) > 0);
      }
      itens = itens.slice(0, opcoes.limite);
      contar('consultar', colecao, itens.length);
      return itens;
    },
    estatisticas: () => JSON.parse(JSON.stringify(est)),
    zerarEstatisticas() { est.listar = { chamadas: 0, documentos: 0 }; est.consultar = { chamadas: 0, documentos: 0 }; est.porColecao = {}; },

    async transacao(fn) {
      const vez = fila.then(async () => {
        const antes = new Map(docs);
        try { return await fn(api); } catch (e) { docs = antes; throw e; }
      });
      fila = vez.catch(() => {});
      return vez;
    },
    // só para testes e diagnóstico
    _caminhos: () => [...docs.keys()].sort(),
  };
  return api;
}

module.exports = { criarBancoMemoria };
