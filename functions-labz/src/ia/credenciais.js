// Fase 4B: nenhuma credencial pode sair em log, auditoria, diagnóstico, erro
// ou prompt. Este filtro troca qualquer coisa com cara de chave ou token por
// "[credencial removida]". É uma rede de segurança: as chaves de verdade
// ficam só no Secret Manager e nem chegam aos adaptadores nesta fase.
const PADROES = [
  /\bsk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{10,}/g, // estilo OpenAI/Anthropic
  /\bAIza[0-9A-Za-z_-]{20,}/g, // chave de API do Google
  /\bya29\.[0-9A-Za-z._-]{10,}/g, // token OAuth do Google
  /\bBearer\s+[A-Za-z0-9._~+/-]{10,}=*/gi,
  /\b(?:x-api-key|x-goog-api-key|api[_-]?key|authorization|access[_-]?token|secret)\s*["']?\s*[:=]\s*["']?[^\s"',}]{6,}/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, // JWT (token de login)
  /\bLABZ_[A-Z_]+_API_KEY\s*[:=]\s*\S+/g,
];
const MARCA = '[credencial removida]';

function limparCredenciais(texto) {
  let t = String(texto === undefined || texto === null ? '' : texto);
  PADROES.forEach((p) => { t = t.replace(p, MARCA); });
  return t;
}
const contemCredencial = (texto) => limparCredenciais(texto) !== String(texto === undefined || texto === null ? '' : texto);

// Mensagem curta e limpa para gravar (erros de provedor, diagnósticos).
const mensagemSegura = (texto, max = 200) => limparCredenciais(texto).slice(0, max);

module.exports = { limparCredenciais, contemCredencial, mensagemSegura, MARCA_CREDENCIAL: MARCA };
