#!/usr/bin/env node
// LABZ AI — Etapa 12: copia o nucleo.js para dentro da página offline (entre as marcas
// NUCLEO-INICIO e NUCLEO-FIM). Rode depois de mudar o núcleo: node supabase/backup/sincronizar-pagina.mjs
// (o teste test/backup.test.js falha se a página e o núcleo estiverem diferentes).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PASTA = path.dirname(fileURLToPath(import.meta.url));
const INICIO = '// NUCLEO-INICIO (cópia exata de nucleo.js; um teste confere)\n';
const FIM = '// NUCLEO-FIM\n';

export function montarPagina(html, nucleo) {
  const i = html.indexOf(INICIO);
  const f = html.indexOf(FIM);
  if (i < 0 || f < i) throw new Error('Marcas NUCLEO-INICIO/NUCLEO-FIM não encontradas na página.');
  return html.slice(0, i + INICIO.length) + nucleo + html.slice(f);
}

export function nucleoDaPagina(html) {
  const i = html.indexOf(INICIO);
  const f = html.indexOf(FIM);
  if (i < 0 || f < i) throw new Error('Marcas NUCLEO-INICIO/NUCLEO-FIM não encontradas na página.');
  return html.slice(i + INICIO.length, f);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arq = path.join(PASTA, 'labz-backup.html');
  const novo = montarPagina(fs.readFileSync(arq, 'utf8'), fs.readFileSync(path.join(PASTA, 'nucleo.js'), 'utf8'));
  fs.writeFileSync(arq, novo);
  console.log('labz-backup.html atualizada com o nucleo.js');
}
