// Índices compostos das consultas de OPERAÇÃO (Fase 3E, F6): fila de trabalho e
// auditoria filtrada por tipo. Igual a INDICES_NECESSARIOS (recuperador.js):
// declarados aqui, conferidos por teste e NÃO publicados (firestore.indexes.json
// só muda com autorização). Execuções, empresas e as reservas da fila por id usam
// só igualdade + ordem por id: o Firestore resolve com os índices automáticos.
const INDICES_OPERACAO = Object.freeze([
  { collectionGroup: 'labz_fila', queryScope: 'COLLECTION', fields: [{ fieldPath: 'estado', order: 'ASCENDING' }, { fieldPath: 'disponivelEm', order: 'ASCENDING' }] },
  { collectionGroup: 'labz_fila', queryScope: 'COLLECTION', fields: [{ fieldPath: 'estado', order: 'ASCENDING' }, { fieldPath: 'travadoAte', order: 'ASCENDING' }] },
  { collectionGroup: 'labz_eventos', queryScope: 'COLLECTION', fields: [{ fieldPath: 'tipo', order: 'ASCENDING' }, { fieldPath: 'em', order: 'DESCENDING' }] },
]);

module.exports = { INDICES_OPERACAO };
