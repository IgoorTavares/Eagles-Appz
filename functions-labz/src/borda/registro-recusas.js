// LABZ AI — S5B, Etapa 6: registro das RECUSAS da labz-api, só no LOG da Edge Function (nunca no banco).
// Por quê: com a função aberta na internet, cada chamada recusada que gravasse no PostgreSQL
// seria um jeito de encher o banco (500 MB no plano grátis, sem backup) sem login nenhum.
// O que vai para o log: só a ETAPA da recusa (lista fechada) e o MOTIVO técnico (código curto).
// Nunca: token, cabeçalho, e-mail, UID, IP, origem, corpo do pedido ou URL de conexão.
// Controle de volume: no máximo `maxPorMinuto` linhas por minuto por instância; o que passar
// disso vira UMA linha de resumo ("suprimidas: N") quando o minuto vira.
const ETAPAS = Object.freeze(['origem', 'token', 'lista-servidor']);
const RE_MOTIVO = /^[a-z0-9-]{1,40}$/;

function criarRegistroRecusas({ escrever, maxPorMinuto = 20, agoraMs = () => Date.now() } = {}) {
  if (typeof escrever !== 'function') return () => {};
  if (!Number.isInteger(maxPorMinuto) || maxPorMinuto < 1 || maxPorMinuto > 1000) throw new Error('criarRegistroRecusas: maxPorMinuto inválido');
  let janela = -1;
  let escritas = 0;
  let suprimidas = 0;
  const emitir = (linha) => { try { escrever(JSON.stringify(linha)); } catch (e) { /* o log nunca derruba a resposta */ } };
  return function registrarRecusa({ etapa, motivo } = {}) {
    const minuto = Math.floor(agoraMs() / 60000);
    if (minuto !== janela) {
      if (suprimidas > 0) emitir({ evento: 'labz-api.recusas_suprimidas', n: suprimidas });
      janela = minuto;
      escritas = 0;
      suprimidas = 0;
    }
    if (escritas >= maxPorMinuto) { suprimidas++; return; }
    escritas++;
    emitir({
      evento: 'labz-api.recusa',
      etapa: ETAPAS.includes(etapa) ? etapa : 'outra',
      motivo: RE_MOTIVO.test(String(motivo || '')) ? motivo : 'outro',
    });
  };
}

module.exports = { criarRegistroRecusas, ETAPAS };
