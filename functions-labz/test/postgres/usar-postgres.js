// Carregado ANTES dos testes (node --require) por test/postgres/rodar.js: troca o banco em
// memória dos testes pelo banco PostgreSQL, sem mudar nenhum teste. Cada banco criado
// ganha um schema próprio, criado com a MESMA migração de produção (postgres-migracao.js).
const postgres = require('postgres');
const memoria = require('../../src/armazenamento/banco-memoria');
const { criarBancoPostgres } = require('../../src/armazenamento/banco-postgres');
const { sqlMigracao } = require('../../src/armazenamento/postgres-migracao');

const URL = process.env.LABZ_PG_URL;
if (!URL) throw new Error('LABZ_PG_URL não definido (use npm run test:postgres)');
// idle_timeout curto: sem conexões abertas, o processo de cada arquivo de teste termina sozinho
const sql = postgres(URL, { max: 6, idle_timeout: 1, onnotice: () => {} });
let n = 0;
memoria.criarBancoMemoria = function criarBancoDeTeste() {
  const schema = `t_${process.pid}_${++n}`;
  return criarBancoPostgres({ sql, schema, preparar: () => sql.unsafe(sqlMigracao(schema)) });
};
memoria.criarBancoMemoria.postgres = true;
