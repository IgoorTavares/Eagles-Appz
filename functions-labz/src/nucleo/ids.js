// IDs estáveis e datas. O relógio é injetável para os testes.
const { randomUUID } = require('node:crypto');

const novoId = (prefixo) => `${prefixo}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

function slugDe(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

const relogioPadrao = () => new Date().toISOString();

module.exports = { novoId, slugDe, relogioPadrao };
