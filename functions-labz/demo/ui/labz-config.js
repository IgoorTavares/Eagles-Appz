// LABZ AI — configuração PÚBLICA da interface (Fase S4). Não é segredo: é só o endereço da função.
// Vazio = servidor não ligado (a tela avisa e não chama nada). v155 (I3): o projeto labz-ai do Supabase.
// Um teste confere que este endereço é https, termina em /functions/v1/labz-api e está liberado na CSP.
// Só endereços https:// são aceitos (http só para 127.0.0.1/localhost, nos testes locais).
// NUNCA coloque aqui chave, senha, token ou a chave "service_role" do Supabase.
const LABZ_API_URL = 'https://ducvpgrtsguaxqhnnupd.supabase.co/functions/v1/labz-api';
