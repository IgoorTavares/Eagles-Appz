// LABZ AI — Edge Function "labz-api" (S3; publicada na S5B, Etapa 6, pelo painel do Supabase).
// A tela do Super Admin chama esta função com o ID token do Firebase. Tudo o que importa
// (token, Super Admin, limites, validação, auditoria) está no backend empacotado (labz-<versão>.mjs, nesta mesma pasta; o nome muda a cada versão).
// Segredos lidos do ambiente (Supabase Secrets; nunca no Git):
//   LABZ_DB_URL            conexão com o papel de LOGIN da LABZ AI (membro de labz_app)
//   LABZ_SUPERADMIN_UIDS   UIDs do Super Admin, separados por vírgula
//   LABZ_FIREBASE_PROJETO  projeto do Firebase (labz-18246)
//   LABZ_ORIGENS           (opcional) origens do navegador permitidas, separadas por vírgula
//   LABZ_FIREBASE_API_KEY  (v4, OBRIGATÓRIO) a apiKey PÚBLICA do Firebase (a mesma do firebase-config.js; não é
//                          segredo), para conferir conta desativada / sessão revogada. Sem ela, a função não liga.
import { montarApi, postgres, criarRegistroRecusas } from './labz-b49c379e0336.mjs';

const env = (k: string) => Deno.env.get(k) ?? '';

// prepare: false → funciona atrás do pooler do Supabase em modo transação
const sql = postgres(env('LABZ_DB_URL'), { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10 });

const { handler } = montarApi({
  sql,
  config: {
    uidsSuperAdmin: env('LABZ_SUPERADMIN_UIDS'),
    projetoFirebase: env('LABZ_FIREBASE_PROJETO'),
    origens: env('LABZ_ORIGENS') || undefined,
    firebaseApiKey: env('LABZ_FIREBASE_API_KEY'),
    exigirContaAtiva: true,
  },
  // a rede da API (só Google): as chaves públicas do Firebase e, na v4, o Firebase Auth (conta ativa)
  buscar: (url: string) => fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) }),
  buscarConta: (url: string, op: RequestInit) => fetch(url, { ...op, redirect: 'error' }),
  registrarErro: (e: unknown) => console.error('labz-api: erro interno', e instanceof Error ? e.message : 'desconhecido'),
  // recusas (origem, login, fora da lista): SÓ no log, com etapa e motivo, no máximo 20 linhas por minuto
  registrarRecusa: criarRegistroRecusas({ escrever: (linha: string) => console.warn(linha), maxPorMinuto: 20 }),
});

Deno.serve(handler);
