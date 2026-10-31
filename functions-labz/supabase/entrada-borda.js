// LABZ AI — Fase S3: o que vai para dentro do pacote das Edge Functions (labz.mjs).
// Só a montagem da borda (que puxa o backend em src/) e o driver do PostgreSQL.
// firebase-admin e firebase-functions NUNCA entram (o empacotador recusa).
const postgres = require('postgres');
const { montarApi, montarWorker } = require('../src/borda/montagem');
const { assinar } = require('../src/borda/acionamento');
// só para os testes no Deno (simulação; nenhum transporte real existe)
const { criarTransporteSimulado } = require('../src/ia/transporte');
const { criarModeloSimulado } = require('../src/ia/simulacao/modelo-simulado');

module.exports = { postgres, montarApi, montarWorker, assinar, criarTransporteSimulado, criarModeloSimulado };
