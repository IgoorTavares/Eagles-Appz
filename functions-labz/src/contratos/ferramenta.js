// Contrato de uma ferramenta. A permissão vem SEMPRE deste registro, nunca
// do texto devolvido pelo modelo: o modelo só PEDE; o código decide.
const DISPONIBILIDADE = ['planejada', 'nao-configurada', 'disponivel', 'indisponivel'];
const RISCOS = ['baixo', 'medio', 'alto'];
const OPERACOES = ['ler', 'criar', 'alterar', 'publicar', 'gastar', 'excluir'];

const ESQUEMA_FERRAMENTA = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    id: { tipo: 'texto', obrigatorio: true, padrao: /^[a-z_]+\.[a-z_]+$/ },
    nome: { tipo: 'texto', obrigatorio: true, min: 3, max: 80 },
    capacidades: { tipo: 'lista', obrigatorio: true, min: 1, itens: { tipo: 'texto', min: 3, max: 120 } },
    agentesAutorizados: { tipo: 'lista', obrigatorio: true, min: 1, itens: { tipo: 'texto', padrao: /^0[1-8]-[a-z-]+$/ } },
    escopos: { tipo: 'lista', obrigatorio: true, min: 1, itens: { tipo: 'texto', min: 3, max: 60 } },
    operacoes: { tipo: 'lista', obrigatorio: true, min: 1, itens: { tipo: 'texto', valores: OPERACOES } },
    risco: { tipo: 'texto', obrigatorio: true, valores: RISCOS },
    exigeAprovacao: { tipo: 'booleano', obrigatorio: true },
    limites: {
      tipo: 'objeto', obrigatorio: true, extras: false,
      campos: {
        porExecucao: { tipo: 'inteiro', obrigatorio: true, min: 1 },
        porDia: { tipo: 'inteiro', obrigatorio: true, min: 1 },
      },
    },
    disponibilidade: { tipo: 'texto', obrigatorio: true, valores: DISPONIBILIDADE },
    dependeDe: { tipo: 'lista', obrigatorio: true, itens: { tipo: 'texto', min: 3, max: 120 } },
  },
};

module.exports = { ESQUEMA_FERRAMENTA, DISPONIBILIDADE, RISCOS, OPERACOES };
