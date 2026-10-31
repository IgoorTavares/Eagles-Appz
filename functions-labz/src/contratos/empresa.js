// Empresa da LABZ AI: cadastro PRÓPRIO (decisão do Super Admin na Fase 0),
// com vínculo opcional a uma empresa do sistema (tenant) ou a um cliente do
// CRM de uma empresa. O vínculo é só uma referência: a LABZ AI não copia
// nem altera dados do CRM.
const ID_SEGURO = /^[A-Za-z0-9_-]{1,80}$/;

const ESQUEMA_VINCULO = {
  tipo: 'objeto', nulo: true, extras: false,
  campos: {
    tipo: { tipo: 'texto', obrigatorio: true, valores: ['tenant', 'crm_cliente'] },
    tenantId: { tipo: 'texto', obrigatorio: true, padrao: ID_SEGURO },
    clienteId: { tipo: 'texto', padrao: ID_SEGURO },
  },
};

const ESQUEMA_NOVA_EMPRESA = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    nome: { tipo: 'texto', obrigatorio: true, min: 2, max: 120 },
    observacoes: { tipo: 'texto', max: 2000 },
    vinculo: ESQUEMA_VINCULO,
  },
};

const ESQUEMA_ALTERAR_EMPRESA = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    nome: { tipo: 'texto', min: 2, max: 120 },
    observacoes: { tipo: 'texto', max: 2000 },
  },
};

const STATUS_EMPRESA = ['ativa', 'arquivada'];

module.exports = { ESQUEMA_VINCULO, ESQUEMA_NOVA_EMPRESA, ESQUEMA_ALTERAR_EMPRESA, STATUS_EMPRESA };
