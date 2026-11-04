#!/usr/bin/env node
// LABZ AI — Etapa 12.5: ENSAIO do teste de restauração com DADOS FICTÍCIOS (Supabase local).
//   SUPABASE_CLI=supabase node supabase/backup/ensaiar-etapa12-5.mjs   (ou: npm run backup:ensaio-restauracao)
// Reproduz o que o Igor fará: o backend DE VERDADE cria empresa + tarefa COMPLETED + entregas; a mesma
// consulta do SQL Editor exporta; o núcleo da página cifra; o comando guiado (teste-restauracao.mjs)
// restaura e confere. Depois: falhas (arquivo sem senha, adulterado, senha errada, projeto ligado a um
// remoto), senha colada num terminal de verdade, e a conferência pegando dados estragados de propósito.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { RAIZ, conectarLocal, urlLocal } from './local.mjs';
import { conferirRestauracao } from './conferir-restauracao.mjs';
import { SERVICOS_DESLIGADOS, subirComRepeticao, prepararRedeLocal, REDE_LOCAL } from './teste-restauracao.mjs';

const require = createRequire(import.meta.url);
const N = require('./nucleo.js');
const { montarApi, montarWorker } = require('../../src/borda/montagem');
const { PROJETO, emitir, obterChaves } = require('../../test/ajuda-token');
const PASTA = path.dirname(fileURLToPath(import.meta.url));
const CLI = process.env.SUPABASE_CLI;
if (!CLI) { console.error('Defina SUPABASE_CLI com o caminho do Supabase CLI.'); process.exit(2); }
const SENHA = `ensaio-125-${crypto.randomBytes(8).toString('hex')}`; // fictícia
const SEGREDO = crypto.randomBytes(32).toString('hex'); // fictício
const NOME_EMPRESA = 'Empresa Ficticia do Ensaio 12.5';
const OBJETIVO = 'Escrever as legendas da semana.';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'labz-ensaio125-'));
let falhas = 0;
let total = 0;
const conferir = (c, nome, extra = '') => { total++; console.log(`${c ? 'ok    ' : 'FALHOU'} ${nome}${extra ? ` — ${extra}` : ''}`); if (!c) falhas++; };
const cli = (args) => spawnSync(CLI, args, { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const orquestrar = (args, env = {}) => spawnSync(process.execPath, [path.join(PASTA, 'teste-restauracao.mjs'), ...args], { cwd: RAIZ, encoding: 'utf8', env: { ...process.env, ...env } });
const csvCampo = (s) => `"${String(s).replace(/"/g, '""')}"`;

try {
  // 1. banco local do zero + dados fictícios criados pelo backend de verdade
  prepararRedeLocal();
  if (!subirComRepeticao((args) => cli(args).status === 0) || cli(['db', 'reset', '--network-id', REDE_LOCAL]).status !== 0) throw new Error('Supabase local não subiu');
  const url = urlLocal();
  const sql = conectarLocal(url, { max: 10 });
  let tarefa;
  let nEntregas;
  try {
    const { handler: api, banco } = montarApi({ sql, config: { uidsSuperAdmin: 'sa', projetoFirebase: PROJETO, origens: 'https://eagleslabz.com.br' }, obterChaves });
    await banco.gravar('labz_usuarios/sa', { role: 'SuperAdmin' });
    await banco.gravar('labz_config/acesso', { uids: ['sa'] });
    const chamar = async (acao, dados) => {
      const r = await api(new Request('http://local/labz-api', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${emitir()}`, origin: 'https://eagleslabz.com.br' }, body: JSON.stringify({ acao, dados }) }));
      const c = await r.json();
      if (r.status !== 200) throw new Error(`${acao}: ${r.status}`);
      return c.resultado;
    };
    const emp = await chamar('empresas.criar', { empresa: { nome: NOME_EMPRESA } });
    tarefa = (await chamar('execucoes.pedido', { empresaId: emp.id, objetivo: OBJETIVO })).id;
    const { handler: wk } = montarWorker({ sql, config: { segredoWorker: SEGREDO } });
    const a = (await sql`select * from labz.criar_acionamento('fila', ${SEGREDO})`)[0];
    await wk(new Request('http://local/labz-worker', { method: 'POST', headers: { 'content-type': 'application/json', 'x-labz-acionamento': a.id, 'x-labz-tempo': String(a.tempo), 'x-labz-motivo': a.motivo, 'x-labz-assinatura': `v1=${a.assinatura}` }, body: '{}' }));
    const estado = (await chamar('execucoes.obter', { execucaoId: tarefa })).estado;
    nEntregas = (await sql`select count(*)::int as n from labz.docs where colecao = 'labz_entregas' and dados->>'execucaoId' = ${tarefa}`)[0].n;
    await sql`update labz.docs set dados = '{"ativo":true}'::json where caminho = 'labz_config/worker'`; // como na produção
    await sql`delete from labz.acionamentos`; // os bilhetes não entram no backup
    conferir(estado === 'COMPLETED' && nEntregas === 2, 'dados fictícios criados pelo backend: tarefa COMPLETED com 2 entregas', `${estado}, ${nEntregas} entregas`);

    // 2. exportação (a mesma consulta do SQL Editor) → CSV → cifrado (o mesmo núcleo da página)
    const linhas = await sql.unsafe(fs.readFileSync(path.join(PASTA, 'exportar-dados.sql'), 'utf8'));
    const csv = `﻿ordem,linha\r\n${linhas.map((r) => `${csvCampo(r.ordem)},${csvCampo(r.linha)}`).join('\r\n')}\r\n`;
    fs.writeFileSync(path.join(TMP, 'exportado.csv'), csv);
    const doc = N.abrirArquivo(csv).doc;
    conferir((await N.conferir(doc)).ok, 'exportação conferida', `${doc.cabecalho.total} documentos`);
    fs.writeFileSync(path.join(TMP, 'b.cifrado.json'), JSON.stringify(await N.cifrar(doc, SENHA)));
  } finally { await sql.end({ timeout: 2 }); }
  const cifrado = path.join(TMP, 'b.cifrado.json');

  // 3. o comando guiado, de ponta a ponta (remonta o banco do zero, restaura, confere e apaga)
  const r = orquestrar([cifrado, '--tarefa', tarefa, '--entregas', String(nEntregas)], { SUPABASE_CLI: CLI, LABZ_BACKUP_SENHA: SENHA });
  const saida = `${r.stdout}${r.stderr}`;
  conferir(r.status === 0 && /RESULTADO: APROVADO \((\d+) de \1 conferências\)/.test(saida), 'comando guiado: APROVADO', (saida.match(/RESULTADO: .*/) || ['sem resultado'])[0]);
  for (const linha of saida.split('\n').filter((l) => /^(ok    |FALHOU) /.test(l) && !/backup íntegro|projeto sem|banco LOCAL|relógio local|restaurados/.test(l))) console.log(`         ${linha}`);
  conferir(!saida.includes(NOME_EMPRESA) && !saida.includes(OBJETIVO) && !saida.includes('[SIMULADO]') && !saida.includes(SENHA), 'a saída não mostra nome da empresa, objetivo, conteúdo das entregas nem a senha');
  conferir(/banco local apagado/.test(saida) && cli(['status', '-o', 'json']).status !== 0, 'no fim, o Supabase local foi desligado e os dados restaurados apagados');

  // 4. falhas que param ANTES de tocar em qualquer banco
  const parouCedo = (x) => !/\[3\/7\]/.test(`${x.stdout}${x.stderr}`);
  const semSenha = orquestrar([path.join(TMP, 'exportado.csv')], { SUPABASE_CLI: CLI });
  conferir(semSenha.status === 3 && /só aceita o backup CIFRADO/.test(semSenha.stderr) && parouCedo(semSenha), 'arquivo SEM senha (CSV) → recusado');
  const adult = JSON.parse(fs.readFileSync(cifrado, 'utf8'));
  const bytes = Buffer.from(adult.dados, 'base64'); bytes[50] ^= 1; adult.dados = bytes.toString('base64');
  fs.writeFileSync(path.join(TMP, 'adulterado.cifrado.json'), JSON.stringify(adult));
  const ad = orquestrar([path.join(TMP, 'adulterado.cifrado.json')], { SUPABASE_CLI: CLI, LABZ_BACKUP_SENHA: SENHA });
  conferir(ad.status === 1 && /senha está errada ou o arquivo foi alterado/.test(ad.stderr) && parouCedo(ad), 'arquivo adulterado (1 bit) → recusado antes de subir o banco');
  const errada = orquestrar([cifrado], { SUPABASE_CLI: CLI, LABZ_BACKUP_SENHA: 'senha-errada-do-ensaio' });
  conferir(errada.status === 1 && parouCedo(errada), 'senha errada → recusado antes de subir o banco');
  const ref = path.join(RAIZ, 'supabase', '.temp', 'project-ref');
  fs.writeFileSync(ref, 'projetoficticio');
  try {
    const lig = orquestrar([cifrado], { SUPABASE_CLI: CLI, LABZ_BACKUP_SENHA: SENHA });
    conferir(lig.status === 3 && /ligada a um projeto Supabase remoto/.test(lig.stderr) && parouCedo(lig), 'pasta ligada a um projeto remoto → recusado');
  } finally { fs.rmSync(ref, { force: true }); }

  // 5. senha COLADA num terminal de verdade (tudo de uma vez, com o Enter no fim)
  // Como uma pessoa: espera aparecer "Senha do backup" e só então cola (tudo de uma vez, com o Enter no fim).
  // `lixo`: o que o terminal manda sozinho logo depois do pedido (achado no Windows do Igor: o pedido
  // terminou antes de ele colar). Tem de ser ignorado; e há até 3 tentativas.
  const pty = (tentativas, { lixo = null } = {}) => new Promise((resolve) => {
    const p = spawn('script', ['-qec', `${process.execPath} ${path.join(PASTA, 'restaurar-local.mjs')} ${cifrado} --so-conferir`, '/dev/null'], { env: { ...process.env, LABZ_BACKUP_SENHA: '' } });
    let out = '';
    let pedidos = 0;
    const t = setTimeout(() => p.kill(), 90000);
    p.stdout.on('data', (d) => {
      out += d;
      const n = (out.match(/Senha do backup/g) || []).length;
      while (pedidos < n) {
        const senha = tentativas[pedidos];
        if (pedidos === 0 && lixo) setTimeout(() => p.stdin.write(lixo), 50);
        if (senha !== undefined) setTimeout(() => p.stdin.write(`${senha}\r`), 900);
        pedidos++;
      }
    });
    p.on('close', (status) => { clearTimeout(t); resolve({ status, stdout: out }); });
  });
  const p1 = await pty([SENHA]);
  conferir(p1.status === 0 && /Backup íntegro/.test(p1.stdout) && !p1.stdout.includes(SENHA), 'terminal: senha colada de uma vez (depois do pedido) → abre, e a senha não aparece na tela');
  const p3 = await pty([SENHA], { lixo: '\u001b[13;28;13;1;0;1_\r' });
  conferir(p3.status === 0 && /Backup íntegro/.test(p3.stdout) && !/tentativa 2/.test(p3.stdout), 'terminal: o que o terminal manda sozinho logo após o pedido é ignorado (o caso do Windows)');
  const p4 = await pty(['senha-errada-colada', SENHA]);
  conferir(p4.status === 0 && /tentativa 2 de 3/.test(p4.stdout) && /Backup íntegro/.test(p4.stdout) && !p4.stdout.includes('senha-errada-colada'), 'terminal: errou a 1ª vez → pede de novo e abre na 2ª');
  const p2 = await pty(['errada-1', 'errada-2', 'errada-3']);
  conferir(p2.status === 1 && /senha está errada/.test(p2.stdout) && /tentativa 3 de 3/.test(p2.stdout) && !p2.stdout.includes('errada-1'), 'terminal: 3 senhas erradas → não abre (e nenhuma aparece)');

  // 6. a conferência pega dados estragados de propósito (com --manter, para mexer no banco local)
  const m = orquestrar([cifrado, '--tarefa', tarefa, '--entregas', String(nEntregas), '--manter'], { SUPABASE_CLI: CLI, LABZ_BACKUP_SENHA: SENHA });
  conferir(m.status === 0, 'restauração mantida para os testes de estrago');
  const u2 = urlLocal();
  const backupCab = N.abrirArquivo(fs.readFileSync(path.join(TMP, 'exportado.csv'), 'utf8')).doc.cabecalho;
  const referencia = JSON.parse(fs.readFileSync(path.join(PASTA, 'retratos', 'producao-2026-11-03.json'), 'utf8'));
  const falhou = async (nome) => (await conferirRestauracao(u2, { cabecalho: backupCab, tarefa, entregasEsperadas: nEntregas, referencia, cronPausado: true })).filter((x) => !x.ok).map((x) => x.nome).join(' | ') || `(${nome}: nada acusado)`;
  const s2 = conectarLocal(u2);
  try {
    let msg = await falhou('esperado: nada');
    conferir(msg.startsWith('(esperado'), 'antes do estrago: conferência toda aprovada');
    await s2`update labz.docs set dados = json_build_object('texto', 'adulterado', 'hash', dados->>'hash', 'tamanho', dados->'tamanho', 'formato', dados->>'formato', 'criadoEm', dados->>'criadoEm') where colecao like 'labz_tarefas/%/labz_conteudos' and caminho = (select min(caminho collate "C") from labz.docs where colecao like 'labz_tarefas/%/labz_conteudos')`;
    msg = await falhou('conteúdo');
    conferir(/impressão digital/.test(msg) && /entregas íntegras/.test(msg), 'conteúdo de entrega alterado → acusa impressão digital e entrega', msg);
    await s2`grant usage on schema labz to anon`;
    msg = await falhou('permissão');
    conferir(/anon, authenticated e service_role/.test(msg) && /estrutura igual/.test(msg), 'permissão aberta para o navegador → acusada', msg);
    await s2`revoke usage on schema labz from anon`;
    await s2`update labz.docs set dados = '{"estado":"RUNNING"}'::json where caminho = ${`labz_tarefas/${tarefa}`}`;
    msg = await falhou('tarefa');
    conferir(/COMPLETED/.test(msg), 'tarefa fora de COMPLETED → acusada', msg);
    const ruim = await conferirRestauracao(u2, { cabecalho: backupCab, tarefa, entregasEsperadas: nEntregas + 1 });
    conferir(ruim.some((x) => !x.ok && /quantidade de entregas/.test(x.nome)), 'quantidade de entregas diferente da esperada → acusada');
  } finally {
    await s2.end({ timeout: 2 });
    cli(['stop', '--no-backup', '--network-id', REDE_LOCAL]);
  }
} catch (e) {
  falhas++;
  console.error('erro no ensaio:', e.stack || e.message);
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(falhas ? `\n${falhas} de ${total} conferência(s) falharam` : `\nEnsaio da Etapa 12.5: ${total} de ${total} conferências aprovadas`);
process.exit(falhas ? 1 : 0);
