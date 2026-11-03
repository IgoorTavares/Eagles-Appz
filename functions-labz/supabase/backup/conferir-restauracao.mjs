// LABZ AI — Etapa 12.5: CONFERÊNCIA de uma restauração no banco LOCAL (só leitura).
// Mostra só RESULTADOS (números, impressões digitais, sim/não). Nunca mostra o conteúdo de documentos.
// Confere:
//  1. total, contagem por coleção e impressão digital no banco = as do backup;
//  2. todos os documentos íntegros (JSON objeto; coluna de busca igual ao conteúdo);
//  3. a tarefa informada: existe, COMPLETED, sem executor preso, empresa presente;
//  4. as entregas da tarefa: a quantidade esperada, todas as versões presentes e o conteúdo de cada
//     versão conferido pelo sha256 com a MESMA função do backend (src/entregas/armazenamento.js);
//  5. proteções: RLS ligado e forçado; anon/authenticated/service_role sem acesso ao schema, às tabelas
//     e às funções; estrutura igual à da produção (retrato de referência);
//  6. nada saiu do banco local: 0 acionamentos, 0 pedidos HTTP e Vault local vazio.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { conectarLocal } from './local.mjs';
import { compararRetratos, lerRetrato } from './comparar-estrutura.mjs';

const require = createRequire(import.meta.url);
const N = require('./nucleo.js');
const arm = require('../../src/entregas/armazenamento.js');
const PASTA = path.dirname(fileURLToPath(import.meta.url));
const ler = (f) => fs.readFileSync(path.join(PASTA, f), 'utf8');
const PAPEIS_EXTERNOS = ['anon', 'authenticated', 'service_role'];

export async function conferirRestauracao(url, { cabecalho, tarefa, entregasEsperadas, referencia, cronPausado = false } = {}) {
  const r = [];
  const item = (ok, nome, detalhe = '') => r.push({ ok: !!ok, nome, detalhe });
  const sql = conectarLocal(url);
  try {
    await sql.begin('read only', async (tx) => {
      // 1. contagem e impressão digital
      const [{ cabecalho: t }] = await tx.unsafe(ler('impressao-digital.sql'));
      const banco = JSON.parse(t);
      item(banco.total === cabecalho.total, 'total de documentos igual ao do backup', `${banco.total} × ${cabecalho.total}`);
      item(N.mesmaContagem(banco.contagem, cabecalho.contagem), 'contagem por coleção igual à do backup', `${Object.keys(banco.contagem).length} coleções`);
      item(banco.sha256 === cabecalho.sha256, 'impressão digital do banco igual à do backup', banco.sha256);
      // 2. integridade de cada documento
      const [{ ruins }] = await tx.unsafe(`select count(*)::int as ruins from labz.docs
        where json_typeof(dados) <> 'object' or busca is distinct from dados::jsonb or caminho <> colecao || '/' || id`);
      item(ruins === 0, 'todos os documentos íntegros (objeto JSON, caminho e busca coerentes)', `${ruins} com problema`);
      // 3. a tarefa
      if (tarefa) {
        const linha = await tx.unsafe('select dados::text as d from labz.docs where caminho = $1', [`labz_tarefas/${tarefa}`]);
        const exe = linha.length ? JSON.parse(linha[0].d) : null;
        item(!!exe, `tarefa ${tarefa} presente`);
        item(exe && exe.estado === 'COMPLETED', 'tarefa no estado COMPLETED', exe ? exe.estado : 'ausente');
        item(exe && !exe.execucaoAtual, 'tarefa sem executor preso', '');
        const emp = exe && exe.empresaId ? await tx.unsafe('select 1 from labz.docs where caminho = $1', [`labz_empresas/${exe.empresaId}`]) : [];
        item(emp.length === 1, 'empresa da tarefa presente');
        // 4. as entregas da tarefa, com o conteúdo de cada versão conferido pelo hash
        const ents = await tx.unsafe(`select id, dados::text as d from labz.docs where colecao = 'labz_entregas' and dados->>'execucaoId' = $1 order by id collate "C"`, [tarefa]);
        if (Number.isInteger(entregasEsperadas)) item(ents.length === entregasEsperadas, 'quantidade de entregas da tarefa', `${ents.length} (esperado ${entregasEsperadas})`);
        const leitor = { obter: async (c) => { const x = await tx.unsafe('select dados::text as d from labz.docs where caminho = $1', [c]); return x.length ? JSON.parse(x[0].d) : null; } };
        let versoes = 0;
        let falhas = 0;
        for (const { id, d } of ents) {
          const e = JSON.parse(d);
          if (e.empresaId !== exe.empresaId) falhas++;
          for (let n = 1; n <= (e.ultimaVersao || 0); n++) {
            const v = await leitor.obter(`labz_entregas/${id}/labz_versoes_entrega/${n}`);
            versoes++;
            try {
              if (!v) throw new Error('versão ausente');
              const c = await arm.lerConteudo(leitor, v.conteudoRef, e.execucaoId); // o backend confere o sha256
              if (c.hash !== v.hash || crypto.createHash('sha256').update(c.texto, 'utf8').digest('hex') !== v.hash) throw new Error('hash');
              const md = v.representacoes && v.representacoes.markdown;
              if (md) await arm.lerConteudo(leitor, md.conteudoRef, e.execucaoId);
            } catch (er) { falhas++; }
          }
        }
        item(ents.length > 0 && falhas === 0, 'entregas íntegras (todas as versões presentes e conteúdo conferido pelo sha256)', `${ents.length} entregas, ${versoes} versões, ${falhas} falhas`);
      }
      // 5. proteções
      const rls = await tx.unsafe(`select relname, relrowsecurity as l, relforcerowsecurity as f from pg_class where relnamespace = 'labz'::regnamespace and relkind = 'r'`);
      item(rls.length === 2 && rls.every((x) => x.l && x.f), 'RLS ligado e forçado nas 2 tabelas');
      let abertos = 0;
      for (const p of PAPEIS_EXTERNOS) {
        const [x] = await tx.unsafe(`select has_schema_privilege($1, 'labz', 'USAGE') as s,
          (select count(*)::int from pg_class c where c.relnamespace = 'labz'::regnamespace and c.relkind = 'r'
             and (has_table_privilege($1, c.oid, 'SELECT') or has_table_privilege($1, c.oid, 'INSERT') or has_table_privilege($1, c.oid, 'UPDATE') or has_table_privilege($1, c.oid, 'DELETE'))) as t,
          (select count(*)::int from pg_proc f where f.pronamespace = 'labz'::regnamespace and has_function_privilege($1, f.oid, 'EXECUTE')) as f`, [p]);
        abertos += (x.s ? 1 : 0) + x.t + x.f;
      }
      item(abertos === 0, 'anon, authenticated e service_role sem acesso ao schema, às tabelas e às funções', `${abertos} acessos encontrados`);
      if (referencia) {
        const local = JSON.parse((await tx.unsafe(ler('retrato-estrutura.sql')))[0].retrato);
        let dif = compararRetratos(lerRetrato(JSON.stringify(referencia)), local);
        // o relógio local é pausado DE PROPÓSITO no teste (para não mexer nos dados restaurados)
        if (cronPausado) dif = dif.filter((d) => !(d.secao === 'cron' && /"nome":"labz-worker-tique"/.test(d.item)));
        const secoes = Object.keys(local.comparavel).length;
        item(dif.length === 0, `estrutura igual à da produção (${secoes} seções${cronPausado ? '; relógio local pausado de propósito' : ''})`, dif.length ? [...new Set(dif.map((d) => d.secao))].join(', ') : `${secoes} de ${secoes}`);
      }
      // 6. nada saiu do banco local
      const [o] = await tx.unsafe(`select (select count(*)::int from labz.acionamentos) as a,
        (select count(*)::int from net.http_request_queue) + (select count(*)::int from net._http_response) as h,
        (select count(*)::int from vault.secrets) as v`);
      item(o.a === 0 && o.h === 0, 'nenhum acionamento e nenhum pedido HTTP no banco local', `${o.a} acionamentos, ${o.h} pedidos`);
      item(o.v === 0, 'Vault local vazio (o banco local não tem como chamar nada)', `${o.v} segredos`);
    });
  } finally {
    await sql.end({ timeout: 2 });
  }
  return r;
}

export const imprimir = (r) => r.forEach((x) => console.log(`${x.ok ? 'ok    ' : 'FALHOU'} ${x.nome}${x.detalhe ? ` — ${x.detalhe}` : ''}`));
