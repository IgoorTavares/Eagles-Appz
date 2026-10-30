// Adaptador do Firestore (Admin SDK) com a MESMA interface do banco em
// memória. Recebe o "db" pronto (admin.firestore()), então não depende do
// pacote do Firebase aqui dentro.
//
// Transações: o Firestore exige todas as leituras antes de qualquer
// gravação. Os serviços às vezes leem depois de gravar (ex.: cria a memória
// e em seguida a primeira versão). Por isso as gravações ficam guardadas
// numa "camada" e só são enviadas no fim; as leituras enxergam essa camada
// (lê o que acabou de gravar). Se a função lançar erro, nada é enviado.
const { erro } = require('../nucleo/erros');

const copia = (v) => (v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)));
const naoEncontrado = (e) => e && (e.code === 5 || /NOT_FOUND|No document to update/i.test(String(e.message)));

function criarBancoFirestore(db) {
  const ref = (caminho) => db.doc(caminho);

  async function listar(colecao, filtro) {
    const snap = await db.collection(colecao).get();
    const out = snap.docs.map((d) => Object.assign({ id: d.id }, d.data())).filter((x) => !filtro || filtro(x));
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  const api = {
    async obter(caminho) {
      const s = await ref(caminho).get();
      return s.exists ? s.data() : null;
    },
    async gravar(caminho, dados) { await ref(caminho).set(copia(dados)); },
    async atualizar(caminho, campos) {
      try { await ref(caminho).update(copia(campos)); } catch (e) {
        if (naoEncontrado(e)) throw erro('nao-encontrado', `documento não existe: ${caminho}`);
        throw e;
      }
    },
    listar,

    async transacao(fn) {
      return db.runTransaction(async (tx) => {
        const camada = new Map(); // caminho → documento completo depois desta transação
        const t = {
          async obter(caminho) {
            if (camada.has(caminho)) return copia(camada.get(caminho));
            const s = await tx.get(ref(caminho));
            return s.exists ? s.data() : null;
          },
          async gravar(caminho, dados) { camada.set(caminho, copia(dados)); },
          async atualizar(caminho, campos) {
            const atual = await t.obter(caminho);
            if (!atual) throw erro('nao-encontrado', `documento não existe: ${caminho}`);
            camada.set(caminho, Object.assign(atual, copia(campos)));
          },
          // Leitura da coleção DENTRO da transação (tx.get de uma consulta): o
          // Firestore isola a transação, então se um documento lido mudar antes
          // do fim, ela é repetida com o estado novo. Enxerga a camada.
          async listar(colecao, filtro) {
            const snap = await tx.get(db.collection(colecao));
            const mapa = new Map(snap.docs.map((d) => [d.id, Object.assign({ id: d.id }, d.data())]));
            camada.forEach((doc, caminho) => {
              const resto = caminho.startsWith(colecao + '/') ? caminho.slice(colecao.length + 1) : null;
              if (resto && !resto.includes('/')) mapa.set(resto, Object.assign({ id: resto }, copia(doc)));
            });
            return [...mapa.values()].filter((x) => !filtro || filtro(x)).sort((a, b) => a.id.localeCompare(b.id));
          },
        };
        const resultado = await fn(t);
        camada.forEach((doc, caminho) => tx.set(ref(caminho), doc));
        return resultado;
      });
    },
  };
  return api;
}

module.exports = { criarBancoFirestore };
