// LABZ AI — Etapa 12: trava "SÓ BANCO LOCAL" das ferramentas de backup.
// Qualquer endereço que não seja este computador (127.0.0.1, localhost ou ::1) é RECUSADO antes de
// qualquer conexão. A conexão é aberta com host/porta explícitos (variáveis PGHOST etc. não valem).
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); // functions-labz
const HOSTS_LOCAIS = new Set(['127.0.0.1', 'localhost', '::1']);

export class RecusaLocal extends Error {}

// Devolve as opções de conexão; recusa (lança RecusaLocal) tudo o que não for local.
export function exigirBancoLocal(url) {
  let u;
  try { u = new URL(String(url)); } catch (e) { throw new RecusaLocal('Endereço do banco inválido.'); }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') throw new RecusaLocal('Só aceito endereços postgresql://.');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!HOSTS_LOCAIS.has(host)) throw new RecusaLocal(`RECUSADO: "${host}" não é este computador. A restauração só roda num banco LOCAL (127.0.0.1, localhost ou ::1).`);
  if (u.search || u.hash) throw new RecusaLocal('RECUSADO: o endereço não pode ter opções (?...), que poderiam trocar o servidor.');
  const porta = u.port ? Number(u.port) : 5432;
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) throw new RecusaLocal('Porta inválida.');
  return {
    host: host === '::1' ? '::1' : host,
    port: porta,
    database: decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres',
    username: decodeURIComponent(u.username || 'postgres'),
    password: decodeURIComponent(u.password || ''),
    ssl: false,
  };
}

// Endereço do Supabase local (supabase status), ou o --db informado. Sempre passa pela trava.
export function urlLocal(argDb) {
  if (argDb) return argDb;
  const cli = process.env.SUPABASE_CLI || 'supabase';
  const s = JSON.parse(execFileSync(cli, ['status', '-o', 'json'], { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  return s.DB_URL;
}

export function conectarLocal(url, extra = {}) {
  const opcoes = exigirBancoLocal(url);
  const postgres = require('postgres');
  return postgres({ ...opcoes, max: 1, onnotice: () => {}, connection: { application_name: 'labz-backup-local' }, ...extra });
}
