// Apoio dos testes no Deno (Fase S3). Tudo FICTÍCIO: tokens assinados por uma chave gerada na hora
// (injetada no verificador SÓ aqui; o index.ts de produção não aceita chave injetada), segredo de
// teste e um banco PostgreSQL temporário criado e apagado pelo próprio teste.
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import * as L from '../../supabase/functions/labz-api/labz.mjs';

export { L };
export const PROJETO = 'labz-18246';
export const SEGREDO = 'segredo-de-teste-ficticio-com-mais-de-32-caracteres';
export const ORIGEM = 'https://eagleslabz.com.br';
const SENHA = 'teste-local-ficticio';
const PAPEL = 'labz_borda_teste';

const b64url = (b: Uint8Array | string) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const par = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = par.publicKey.export({ type: 'spki', format: 'pem' }) as string;
export const obterChaves = async () => ({ k1: pem });

export function emitir(carga: Record<string, unknown> = {}) {
  const agora = Math.floor(Date.now() / 1000);
  const h = { alg: 'RS256', kid: 'k1', typ: 'JWT' };
  const c = Object.assign({ iss: `https://securetoken.google.com/${PROJETO}`, aud: PROJETO, sub: 'sa', iat: agora - 60, auth_time: agora - 120, exp: agora + 3000, email: 'sa@teste.local', email_verified: true, firebase: { sign_in_provider: 'password' } }, carga);
  const corpo = `${b64url(JSON.stringify(h))}.${b64url(JSON.stringify(c))}`;
  return `${corpo}.${b64url(crypto.createSign('RSA-SHA256').update(corpo).sign(par.privateKey))}`;
}

const MIGRACOES = new URL('../../supabase/migrations/', import.meta.url);
export async function migracoesPortaveis() {
  return [await Deno.readTextFile(new URL('20261031000000_labz_inicial.sql', MIGRACOES)), await Deno.readTextFile(new URL('20261101000000_labz_acionamentos.sql', MIGRACOES))];
}

// Cria um banco temporário, aplica as migrações 1 e 2 e devolve: admin (superusuário de teste) e
// app (LOGIN de teste membro de labz_app = a conexão que a Edge Function usa).
// deno-lint-ignore no-explicit-any
export async function bancoTemporario(): Promise<{ admin: any; app: any; nome: string; url: string; fim: () => Promise<void> }> {
  const base = Deno.env.get('LABZ_PG_URL');
  if (!base) throw new Error('defina LABZ_PG_URL (um PostgreSQL de TESTE)');
  const nome = `labz_deno_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const raiz = L.postgres(base, { max: 1, onnotice: () => {} });
  await raiz.unsafe(`create database ${nome}`);
  const u = new URL(base); u.pathname = `/${nome}`;
  const admin = L.postgres(u.toString(), { max: 10, idle_timeout: 1, onnotice: () => {} });
  for (const p of ['anon', 'authenticated']) await admin.unsafe(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${p}') then create role ${p} nologin; end if; end $$;`);
  for (const m of await migracoesPortaveis()) await admin.unsafe(m);
  await admin.unsafe(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = '${PAPEL}') then create role ${PAPEL} login password '${SENHA}' in role labz_app; end if;
  exception when duplicate_object or unique_violation then null; end $$;`);
  const ua = new URL(u.toString()); ua.username = PAPEL; ua.password = SENHA;
  const app = L.postgres(ua.toString(), { max: 10, idle_timeout: 1, prepare: false, onnotice: () => {} });
  return {
    admin, app, nome, url: ua.toString(),
    fim: async () => {
      await app.end({ timeout: 2 });
      await admin.end({ timeout: 2 });
      await raiz.unsafe(`drop database if exists ${nome} with (force)`);
      await raiz.end({ timeout: 2 });
    },
  };
}

// deno-lint-ignore no-explicit-any
export async function criarAcionamento(admin: any, motivo = 'fila') {
  return (await admin`select * from labz.criar_acionamento(${motivo}, ${SEGREDO})`)[0];
}
// deno-lint-ignore no-explicit-any
export function chamarWorker(handler: (r: Request) => Promise<Response>, a: any) {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (a) Object.assign(h, { 'x-labz-acionamento': a.id, 'x-labz-tempo': String(a.tempo), 'x-labz-motivo': a.motivo, 'x-labz-assinatura': `v1=${a.assinatura}` });
  return handler(new Request('http://local/functions/v1/labz-worker', { method: 'POST', headers: h, body: '{}' }));
}

// transporte simulado que conta as chamadas (gancho opcional por chamada)
// deno-lint-ignore no-explicit-any
export function transporteContado(gancho: (x: any) => any = () => null) {
  const modelo = L.criarModeloSimulado({});
  // deno-lint-ignore no-explicit-any
  return L.criarTransporteSimulado(async (x: any) => (await gancho(x)) || modelo(x));
}
