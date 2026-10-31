// LABZ AI — Edge Function "labz-api" (Fase S3; NÃO publicada).
// A tela do Super Admin chama esta função com o ID token do Firebase. Tudo o que importa
// (token, Super Admin, limites, validação, auditoria) está no backend empacotado (_labz/labz.mjs).
// Segredos lidos do ambiente (Supabase Secrets; nunca no Git):
//   LABZ_DB_URL            conexão com o papel de LOGIN da LABZ AI (membro de labz_app)
//   LABZ_SUPERADMIN_UIDS   UIDs do Super Admin, separados por vírgula
//   LABZ_FIREBASE_PROJETO  projeto do Firebase (labz-18246)
//   LABZ_ORIGENS           (opcional) origens do navegador permitidas, separadas por vírgula
import { montarApi, postgres } from '../_labz/labz.mjs';

const env = (k: string) => Deno.env.get(k) ?? '';

// prepare: false → funciona atrás do pooler do Supabase em modo transação
const sql = postgres(env('LABZ_DB_URL'), { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10 });

const { handler } = montarApi({
  sql,
  config: {
    uidsSuperAdmin: env('LABZ_SUPERADMIN_UIDS'),
    projetoFirebase: env('LABZ_FIREBASE_PROJETO'),
    origens: env('LABZ_ORIGENS') || undefined,
  },
  // a ÚNICA rede da API: baixar as chaves públicas do Google (para conferir o token do Firebase)
  buscar: (url: string) => fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) }),
  registrarErro: (e: unknown) => console.error('labz-api: erro interno', e instanceof Error ? e.message : 'desconhecido'),
});

Deno.serve(handler);
