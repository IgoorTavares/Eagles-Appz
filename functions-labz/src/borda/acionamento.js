// LABZ AI — Fase S3: autenticação de CADA chamada ao worker (labz-worker).
// O worker não tem usuário: quem o chama é o próprio banco (gatilho da fila e pg_cron).
// Cada chamada precisa passar por TRÊS travas, nesta ordem:
//   1. cabeçalhos no formato certo (id do acionamento, tempo, motivo, assinatura);
//   2. assinatura HMAC-SHA256 com o segredo do worker (comparação em tempo constante) e
//      tempo dentro da janela (padrão 120 s): uma chamada velha ou forjada é recusada;
//   3. o acionamento EXISTE no banco, com o mesmo tempo e motivo, ainda não foi usado e é
//      recente — e é CONSUMIDO nessa hora, numa única instrução (uma vez só: repetir a mesma
//      chamada, mesmo com a assinatura certa, é recusado).
// Assim, nem o segredo nem a URL bastam: sem o registro criado pelo banco, nada roda.
// Só node:crypto (Node e Deno). O consumo no banco é recebido de fora (consumirPostgres).
const crypto = require('node:crypto');
const { erro } = require('../nucleo/erros');

const MOTIVOS = ['cron', 'fila', 'manual'];
const RE_ID = /^acn_[0-9a-f]{32}$/;
const RE_TEMPO = /^[0-9]{9,12}$/;
const RE_ASSINATURA = /^v1=([0-9a-f]{64})$/;
const MENSAGEM = 'Chamada do worker recusada.';

const mensagemAcionamento = (id, tempo, motivo) => `labz-worker.v1.${tempo}.${id}.${motivo}`;
const assinar = (segredo, id, tempo, motivo) => crypto.createHmac('sha256', segredo).update(mensagemAcionamento(id, tempo, motivo)).digest('hex');

// cabecalho(nome) → valor (ex.: (n) => request.headers.get(n))
function lerCabecalhos(cabecalho) {
  const v = (n) => { const x = cabecalho(n); return typeof x === 'string' ? x.trim() : ''; };
  return { id: v('x-labz-acionamento'), tempo: v('x-labz-tempo'), motivo: v('x-labz-motivo'), assinatura: v('x-labz-assinatura') };
}

// consumir({ id, tempo, motivo, por, janelaSeg }) → true só se o acionamento existia, era recente e ainda não usado.
function criarVerificadorAcionamento({ segredo, consumir, agoraSeg = () => Math.floor(Date.now() / 1000), janelaSeg = 120 } = {}) {
  if (typeof segredo !== 'string' || segredo.length < 32) throw new Error('segredo do worker ausente ou curto (mínimo 32 caracteres)');
  if (typeof consumir !== 'function') throw new Error('criarVerificadorAcionamento: falta consumir()');
  const negar = (motivo) => { throw Object.assign(erro('nao-autenticado', MENSAGEM), { motivo }); };
  return async function verificarAcionamento(cabecalho, { por = 'worker' } = {}) {
    const c = lerCabecalhos(cabecalho);
    if (!RE_ID.test(c.id) || !RE_TEMPO.test(c.tempo) || !MOTIVOS.includes(c.motivo)) return negar('formato');
    const m = RE_ASSINATURA.exec(c.assinatura);
    if (!m) return negar('formato');
    const tempo = Number(c.tempo);
    if (Math.abs(agoraSeg() - tempo) > janelaSeg) return negar('fora-da-janela');
    const esperado = Buffer.from(assinar(segredo, c.id, tempo, c.motivo), 'hex');
    const recebido = Buffer.from(m[1], 'hex');
    if (recebido.length !== esperado.length || !crypto.timingSafeEqual(recebido, esperado)) return negar('assinatura');
    const ok = await consumir({ id: c.id, tempo, motivo: c.motivo, por: String(por).slice(0, 80), janelaSeg });
    if (ok !== true) return negar('nao-registrado-ou-usado');
    return Object.freeze({ id: c.id, tempo, motivo: c.motivo });
  };
}

// Consumo no PostgreSQL (tabela labz.acionamentos da migração 2), numa instrução só (atômica).
function consumirPostgres(sql, schema = 'labz') {
  if (!/^[a-z_][a-z0-9_]{0,40}$/.test(schema)) throw new Error('schema inválido');
  const T = sql(`${schema}.acionamentos`);
  return async ({ id, tempo, motivo, por, janelaSeg }) => {
    const r = await sql`update ${T} set consumido_em = now(), consumido_por = ${por}
      where id = ${id} and tempo = ${tempo} and motivo = ${motivo} and consumido_em is null
        and criado_em > now() - make_interval(secs => ${janelaSeg})
      returning id`;
    return r.length === 1;
  };
}

module.exports = { criarVerificadorAcionamento, consumirPostgres, mensagemAcionamento, assinar, MOTIVOS };
