// Confere que nenhum valor de segredo (lido das variáveis de ambiente) aparece nos arquivos de dados gerados.
// Imprime só o NOME do segredo e do arquivo, nunca o valor. Uso: node conferir-segredos.mjs <pasta>
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const pasta = process.argv[2] || 'inv/dados';
const nomes = ['FRED_API_KEY', 'SEC_CONTACT_EMAIL', 'BLS_API_KEY', 'BRAPI_TOKEN', 'DADOS_DEPLOY_KEY'];
let achou = 0;
for (const arq of readdirSync(pasta)) {
  const txt = readFileSync(join(pasta, arq), 'utf8');
  for (const n of nomes) { const v = process.env[n]; if (v && v.length >= 4 && txt.includes(v)) { console.error(`SEGREDO ${n} encontrado em ${arq}`); achou++; } }
}
if (achou) process.exit(1);
console.log('ok: nenhum segredo nos arquivos de', pasta);
