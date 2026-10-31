// Fase 4C.2 (passo 3): COMPARTILHAMENTO SEGURO de documentos entre as etapas
// de uma execução. Usa o que já existe: o plano validado (dependeDe), o Registro
// de Entregas (versões, hash, aprovação) e o catálogo de documentos (quem pode
// receber cada um e quais são sensíveis). Não há outra memória nem outra autorização.
//
// Política de compartilhamento (a etapa consumidora recebe só):
//  - as entregas das etapas das quais ela DEPENDE no plano validado (nada que o
//    modelo escolha; o modelo não muda dependências);
//  - da MESMA execução (tarefa) e da MESMA empresa (cliente);
//  - de documentos que o agente receptor pode receber (catálogo);
//  - com a integridade conferida (documento + Markdown juntos; texto pelo hash).
//
// Política de versões:
//  - usa a versão FIXADA no resultado da etapa produtora (resultado.entrega.versao);
//  - se a entrega ganhou versão nova depois disso, NÃO troca em silêncio: bloqueia
//    ("versao-substituida") até o Super Admin retomar (aí a versão nova é fixada e
//    tudo que dependia da antiga é refeito: reprocessar());
//  - versão rejeitada ou com pedido de revisão: bloqueia ("dependencia-rejeitada");
//  - documento SENSÍVEL só segue na versão APROVADA (exata); pendente bloqueia
//    ("dependencia-aguarda-aprovacao"). Documento não sensível segue com a validação
//    interna (válido e íntegro), sem aprovação humana;
//  - se um insumo da etapa produtora foi rejeitado depois, a produtora não serve mais
//    ("insumo-invalidado"); um nível de profundidade (os outros já foram conferidos
//    quando cada etapa rodou);
//  - na gravação, a mesma situação é conferida de novo DENTRO da transação do crachá
//    (reconferir): se algo mudou no meio, nada é gravado ("dependencia-mudou").
//
// Limites (determinísticos; sem resumir e sem cortar em silêncio): até MAX_DOCUMENTOS,
// cada um até MAX_BYTES_DOCUMENTO e no total até MAX_BYTES_TOTAL / MAX_TOKENS_ESTIMADOS.
// Toda dependência direta é obrigatória: se não couber, a etapa é BLOQUEADA
// ("contexto-excede-limite"), nunca cortada.
const { consumoPermitido } = require('../contratos/documentos');
const { caminhos } = require('../armazenamento/caminhos');
const { erro } = require('../nucleo/erros');

const LIMITES = Object.freeze({ MAX_DOCUMENTOS: 8, MAX_BYTES_DOCUMENTO: 24 * 1024, MAX_BYTES_TOTAL: 64 * 1024, MAX_TOKENS_ESTIMADOS: 16000 });
const RUINS = ['rejeitada', 'precisa-revisao'];
const tokensDe = (t) => Math.ceil(String(t || '').length / 4);
const bloqueio = (motivo, extra) => ({ documentos: null, bloqueio: Object.assign({ motivo }, extra) });

function criarCompartilhamento({ banco, entregas, relogio }) {
  // Situação da entrega de uma dependência (leitor: banco ou transação). → { ok, motivo?, entrega, versao }
  async function situacao(leitor, exe, consumidor, prod) {
    const pino = prod.resultado && prod.resultado.entrega;
    if (prod.status !== 'concluida' || !pino) return { ok: false, motivo: 'dependencia-incompleta' };
    const ent = await leitor.obter(caminhos.entrega(pino.id));
    if (!ent) return { ok: false, motivo: 'dependencia-inexistente' };
    if (ent.execucaoId !== exe.id || ent.etapaId !== prod.id || (ent.empresaId || null) !== (exe.empresaId || null)) return { ok: false, motivo: 'dependencia-de-outro-escopo' };
    if ((ent.documento || null) !== (prod.documento || null)) return { ok: false, motivo: 'dependencia-de-outro-tipo' };
    let sensivel = false;
    if (ent.documento) {
      const c = consumoPermitido(consumidor.agenteId, ent.documento);
      if (!c.permitido) return { ok: false, motivo: c.motivo };
      sensivel = c.sensivel;
    }
    const v = await leitor.obter(caminhos.versaoEntrega(pino.id, pino.versao));
    if (!v || v.hash !== pino.hash) return { ok: false, motivo: 'dependencia-inconsistente' };
    if (ent.versaoAtual !== pino.versao) return { ok: false, motivo: 'versao-substituida', versaoAtual: ent.versaoAtual };
    if (RUINS.includes(v.estado)) return { ok: false, motivo: 'dependencia-rejeitada' };
    const aprovada = v.estado === 'aprovada' && ent.versaoAprovada === pino.versao;
    if (sensivel && !aprovada) return { ok: false, motivo: 'dependencia-aguarda-aprovacao' };
    for (const i of v.insumos || []) {
      const vi = await leitor.obter(caminhos.versaoEntrega(i.entregaId, i.versao));
      if (!vi || RUINS.includes(vi.estado)) return { ok: false, motivo: 'insumo-invalidado', insumo: i.entregaId };
    }
    return { ok: true, entrega: Object.assign({ id: pino.id }, ent), versao: v, autorizacao: aprovada ? 'aprovacao-super-admin' : 'validacao-interna', sensivel };
  }

  return {
    LIMITES,

    // Usa documentos? (só planos com documentos usam este caminho; os antigos seguem como antes)
    aplicavel: (exe, etapa) => (etapa.dependeDe || []).some((d) => { const p = (exe.etapas || []).find((x) => x.id === d); return p && p.documento; }),

    // Resolve os documentos que a etapa recebe. → { documentos: [...], bloqueio: null } | { documentos: null, bloqueio }
    async resolver(exe, etapa) {
      const deps = (etapa.dependeDe || []).slice().sort();
      if (deps.length > LIMITES.MAX_DOCUMENTOS) return bloqueio('contexto-excede-limite', { detalhe: `${deps.length} documentos; máximo ${LIMITES.MAX_DOCUMENTOS}` });
      const docs = [];
      let total = 0;
      for (const d of deps) {
        const prod = (exe.etapas || []).find((x) => x.id === d);
        if (!prod) return bloqueio('dependencia-inexistente', { dependencia: d });
        const s = await situacao(banco, exe, etapa, prod);
        if (!s.ok) return bloqueio(s.motivo, Object.assign({ dependencia: d }, s.versaoAtual ? { versaoAtual: s.versaoAtual } : {}, s.insumo ? { insumo: s.insumo } : {}));
        let lido;
        try { lido = await entregas.lerParaConsumo(banco, s.entrega.id, s.versao.n); } catch (e) {
          if (e.codigo === 'integridade') return bloqueio('integridade-falhou', { dependencia: d });
          throw e;
        }
        const bytes = Buffer.byteLength(lido.texto, 'utf8');
        if (bytes > LIMITES.MAX_BYTES_DOCUMENTO) return bloqueio('contexto-excede-limite', { dependencia: d, detalhe: `${bytes} bytes; máximo ${LIMITES.MAX_BYTES_DOCUMENTO} por documento` });
        total += bytes;
        docs.push({
          etapaId: d, agenteProdutor: prod.agenteId, documento: s.entrega.documento || null, entregaId: s.entrega.id, versao: s.versao.n, hash: s.versao.hash,
          autorizacao: s.autorizacao, texto: lido.texto,
        });
      }
      if (total > LIMITES.MAX_BYTES_TOTAL) return bloqueio('contexto-excede-limite', { detalhe: `${total} bytes no total; máximo ${LIMITES.MAX_BYTES_TOTAL}` });
      const tokens = docs.reduce((n, x) => n + tokensDe(x.texto), 0);
      if (tokens > LIMITES.MAX_TOKENS_ESTIMADOS) return bloqueio('contexto-excede-limite', { detalhe: `~${tokens} tokens estimados; máximo ${LIMITES.MAX_TOKENS_ESTIMADOS}` });
      return { documentos: docs, bloqueio: null };
    },

    // Os insumos que ficam registrados na entrega produzida (sem conteúdo).
    insumosDe: (docs, etapa) => docs.map((x) => ({ entregaId: x.entregaId, versao: x.versao, hash: x.hash, etapaProdutora: x.etapaId, etapaConsumidora: etapa.id, documento: x.documento, autorizacao: x.autorizacao, em: relogio() })),

    // Na transação da gravação: nada mudou desde a leitura? (senão, conflito "dependencia-mudou")
    async reconferir(t, exe, etapa, docs) {
      for (const x of docs) {
        const prod = (exe.etapas || []).find((y) => y.id === x.etapaId);
        const s = prod ? await situacao(t, exe, etapa, prod) : { ok: false, motivo: 'dependencia-inexistente' };
        if (!s.ok || s.versao.n !== x.versao || s.versao.hash !== x.hash) throw erro('conflito', 'Um documento recebido mudou durante a etapa: nada foi gravado', { motivo: 'dependencia-mudou', dependencia: x.etapaId, situacao: s.ok ? 'outra-versao' : s.motivo });
      }
    },

    // Retomada pelo Super Admin: fixa a versão ATUAL (se utilizável) de cada entrega que mudou
    // e manda refazer tudo que dependia da versão antiga. → { etapas, refeitas: [ids], fixadas: [{etapa, de, para}] }
    async reprocessar(exe) {
      const etapas = (exe.etapas || []).map((x) => Object.assign({}, x));
      const fixadas = [];
      for (const e of etapas) {
        const pino = e.status === 'concluida' && e.resultado && e.resultado.entrega;
        if (!pino) continue;
        const ent = await banco.obter(caminhos.entrega(pino.id));
        if (!ent || ent.versaoAtual === pino.versao) continue;
        const v = await banco.obter(caminhos.versaoEntrega(pino.id, ent.versaoAtual));
        if (!v || RUINS.includes(v.estado)) continue; // a versão atual também não serve: continua bloqueado
        e.resultado = Object.assign({}, e.resultado, { entrega: { id: pino.id, versao: ent.versaoAtual, hash: v.hash } });
        fixadas.push({ etapa: e.id, de: pino.versao, para: ent.versaoAtual });
      }
      // tudo que dependia (direta ou indiretamente) de uma entrega refixada é refeito
      const mudou = new Set(fixadas.map((f) => f.etapa));
      const refeitas = [];
      let andou = true;
      while (andou) {
        andou = false;
        for (const e of etapas) {
          if (e.status === 'concluida' && !refeitas.includes(e.id) && !mudou.has(e.id) && e.dependeDe.some((d) => mudou.has(d) || refeitas.includes(d))) {
            refeitas.push(e.id);
            Object.assign(e, { status: 'pendente', tentativas: 0, tentativasQualidade: 0, aprovacoes: [], motivoRevisao: `um documento recebido mudou (${fixadas.map((f) => `${f.etapa} v${f.de}→v${f.para}`).join(', ')})` });
            andou = true;
          }
        }
      }
      return { etapas, refeitas, fixadas };
    },
  };
}

module.exports = { criarCompartilhamento, LIMITES_COMPARTILHAMENTO: LIMITES };
