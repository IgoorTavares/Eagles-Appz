// Trava da memória Global (D3, Fase 3B). A memória Global vale para TODAS as
// marcas, então ela tem que ser genérica e não confidencial. Política
// conservadora: na dúvida, bloqueia e manda para revisão humana.
//
// Na criação, numa nova versão, na aprovação e no rollback de uma memória
// Global o sistema confere:
//  (a) origem ligada a uma empresa (tarefa de uma empresa, correção ou
//      desempenho) → exige a confirmação explícita "confirmoSemDadosDeCliente";
//  (b) o texto cita o nome de uma empresa da LABZ AI ou do tenant/cliente do
//      CRM vinculado a ela (sem acento e sem diferença de maiúsculas) → recusa;
//  (c) o texto parece ter dado identificável ou comercial (e-mail, telefone,
//      CPF/CNPJ, endereço web, valor em R$) → recusa.
// Lê só os NOMES das empresas e dos vínculos (nada é copiado do CRM).
// Limitação: filtros automáticos não garantem a ausência de segredos escritos
// de outro jeito; a aprovação humana continua sendo a última barreira.
const { caminhos } = require('../armazenamento/caminhos');
const { normalizar } = require('./verificacoes');

const PADROES_SENSIVEIS = [
  { motivo: 'e-mail', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/ },
  { motivo: 'CNPJ', re: /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/ },
  { motivo: 'CPF', re: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/ },
  { motivo: 'telefone', re: /(\+?55[\s-]?)?\(?\b\d{2}\)?[\s-]?9?\d{4}[\s-]?\d{4}\b/ },
  { motivo: 'endereço web', re: /\bhttps?:\/\/|\bwww\.[a-z0-9-]+\./i },
  { motivo: 'valor em reais', re: /R\$\s?\d/ },
];

const contemNome = (textoNorm, nome) => {
  const n = normalizar(nome);
  return n.length >= 3 && ` ${textoNorm} `.includes(` ${n} `);
};

function criarProtecaoGlobal({ banco }) {
  // Nomes protegidos: empresas da LABZ AI (ativas ou arquivadas) e o que
  // estiver vinculado a elas (empresa do sistema ou cliente do CRM).
  async function nomesProtegidos() {
    const nomes = new Set();
    const empresas = await banco.listar(caminhos.colecoes.empresas);
    for (const e of empresas) {
      if (e.nome) nomes.add(e.nome);
      const v = e.vinculo;
      if (v && v.tipo === 'tenant' && v.tenantId) {
        const t = await banco.obter(`tenants/${v.tenantId}`);
        if (t && t.nomeEmpresa) nomes.add(t.nomeEmpresa);
      } else if (v && v.tipo === 'crm_cliente' && v.tenantId && v.clienteId) {
        const c = await banco.obter(`tenants/${v.tenantId}/crm_clientes/${v.clienteId}`);
        if (c && c.nome) nomes.add(c.nome);
      }
    }
    return [...nomes];
  }

  // A origem está ligada a uma empresa?
  async function origemDeEmpresa(origem) {
    if (!origem) return false;
    if (origem.tipo === 'desempenho') return true;
    if (origem.tarefaId) {
      const t = await banco.obter(caminhos.tarefa(origem.tarefaId));
      if (!t || t.empresaId) return true; // tarefa desconhecida também conta (conservador)
    }
    return false;
  }

  return {
    nomesProtegidos,

    // versao: { titulo, conteudo, tags, origem }. Devolve os motivos de bloqueio
    // separados: "confirmacao" (resolve com a confirmação) e "conteudo" (não resolve).
    async verificar(versao, { confirmoSemDadosDeCliente = false } = {}) {
      const texto = [versao.titulo, versao.conteudo, ...(versao.tags || [])].join(' \n ');
      const norm = normalizar(texto);
      const conteudo = [];
      (await nomesProtegidos()).forEach((n) => { if (contemNome(norm, n)) conteudo.push(`cita o nome "${n}"`); });
      PADROES_SENSIVEIS.forEach((p) => { if (p.re.test(texto)) conteudo.push(`parece conter ${p.motivo}`); });
      const confirmacao = [];
      if (await origemDeEmpresa(versao.origem) && confirmoSemDadosDeCliente !== true) {
        confirmacao.push('a origem é de uma empresa: confirme que o texto não tem dados do cliente (confirmoSemDadosDeCliente)');
      }
      return { ok: !conteudo.length && !confirmacao.length, conteudo, confirmacao };
    },
  };
}

module.exports = { criarProtecaoGlobal, PADROES_SENSIVEIS };
