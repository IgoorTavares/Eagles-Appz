// LABZ AI — Fase S1: banco de documentos sobre PostgreSQL (Supabase), com a MESMA
// interface do banco em memória e do adaptador do Firestore:
//   obter(caminho) → objeto | null
//   gravar(caminho, dados)                  (substitui)
//   atualizar(caminho, campos)              (junta os campos; falha se não existir)
//   listar(colecao, filtro?) → [{ id, ...dados }]   (só a coleção direta)
//   consultar(colecao, { onde, ordenar, limite, depoisDe, cursorMesmoFiltro }) → consulta LIMITADA
//   transacao(fn) → fn recebe a mesma interface (emTransacao: true); tudo ou nada
// Transações em SERIALIZABLE: se duas se cruzarem, o Postgres recusa uma (40001) e ela é
// REPETIDA aqui (até `tentativas` vezes, com espera aleatória) — o mesmo modelo otimista
// do Firestore, de que o crachá do executor e as aprovações dependem. Dentro da transação,
// o que foi gravado já é lido de volta (como no banco em memória).
// `sql` é um cliente do pacote "postgres" (postgres.js), criado por quem chama.
const { erro } = require('../nucleo/erros');
const { validarConsultaBanco } = require('../contratos/recuperacao');
const { NOME_VALIDO } = require('./postgres-migracao');

const REPETIVEIS = new Set(['40001', '40P01']); // serialização e deadlock
const copia = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function partes(caminho) {
  const p = String(caminho || '').split('/');
  if (p.length < 2 || p.length % 2 !== 0 || p.some((x) => !x)) throw erro('invalido', `caminho de documento inválido: ${caminho}`);
  return { colecao: p.slice(0, -1).join('/'), id: p[p.length - 1] };
}
function validarColecao(colecao) {
  const p = String(colecao || '').split('/');
  if (p.length % 2 !== 1 || p.some((x) => !x)) throw erro('invalido', `coleção inválida: ${colecao}`);
}
const caminhoCampo = (campo) => String(campo).split('.');
const valorCampo = (doc, campo) => (campo === 'id' ? doc.id : campo.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc));

function criarBancoPostgres({ sql, schema = 'labz', tentativas = 12, preparar } = {}) {
  if (!sql) throw new Error('criarBancoPostgres: falta o cliente sql');
  if (!NOME_VALIDO.test(schema)) throw new Error('nome de schema inválido');
  const T = sql(`${schema}.docs`);
  const pronto = preparar ? Promise.resolve().then(preparar) : Promise.resolve();
  const est = { listar: { chamadas: 0, documentos: 0 }, consultar: { chamadas: 0, documentos: 0 }, porColecao: {}, repeticoes: 0 };
  const contar = (tipo, colecao, n) => {
    est[tipo].chamadas++; est[tipo].documentos += n;
    const pc = est.porColecao[colecao] = est.porColecao[colecao] || { listar: 0, consultar: 0, documentos: 0 };
    pc[tipo]++; pc.documentos += n;
  };

  // caminhos gravados POR ESTA INSTÂNCIA (só diagnóstico e testes, como _caminhos() do banco em memória)
  const conhecidos = new Set();
  // ordem igual à do Firestore/banco em memória: valor do campo (número como número,
  // texto em ordem de código, sem regras de idioma) e, no empate, o id — na mesma direção.
  const chaveNum = (p) => sql`(case when jsonb_typeof(busca #> ${p}::text[]) = 'number' then (busca #>> ${p}::text[])::numeric end)`;
  const chaveTxt = (p) => sql`(case when jsonb_typeof(busca #> ${p}::text[]) in ('string', 'boolean') then (busca #>> ${p}::text[]) end) collate "C"`;
  const juntarE = (frags) => frags.reduce((a, f) => sql`${a} and ${f}`);

  function condicao(c) {
    if (c.campo === 'id') {
      if (c.op === '==') return sql`id = ${String(c.valor)}`;
      if (c.op === 'in') return sql`id = any(${c.valor.map(String)}::text[])`;
      throw erro('invalido', `operação ${c.op} não suportada no id`);
    }
    const p = caminhoCampo(c.campo);
    const v = sql`(busca #> ${p}::text[])`;
    // valores sempre como jsonb (o null do JSON vira 'null'::jsonb, não o NULL do SQL)
    const J = (x) => (x === null ? sql`'null'::jsonb` : sql`${sql.json(x)}`);
    const umDe = (lista, alvo) => sql`exists (select 1 from jsonb_array_elements(${sql.json(lista)}) w(y) where w.y = ${alvo})`;
    const elementos = sql`jsonb_array_elements(case when jsonb_typeof(${v}) = 'array' then ${v} else '[]'::jsonb end)`;
    switch (c.op) {
      case '==': return sql`${v} = ${J(c.valor)}`;
      case 'in': return umDe(c.valor, v);
      case 'array-contains': return sql`exists (select 1 from ${elementos} e(x) where e.x = ${J(c.valor)})`;
      case 'array-contains-any': return sql`exists (select 1 from ${elementos} e(x) where ${umDe(c.valor, sql`e.x`)})`;
      default: throw erro('invalido', `operação ${c.op} não suportada`);
    }
  }

  function construir(ex, emTransacao, gravados) {
    const lerDoc = async (caminho) => {
      const r = await ex`select dados from ${T} where caminho = ${caminho}`;
      return r.length ? r[0].dados : null;
    };
    const api = {
      async obter(caminho) { await pronto; partes(caminho); return copia(await lerDoc(caminho)); },
      async gravar(caminho, dados) {
        await pronto;
        const { colecao, id } = partes(caminho);
        const d = copia(dados);
        if (!d || typeof d !== 'object' || Array.isArray(d)) throw erro('invalido', 'documento precisa ser um objeto');
        await ex`insert into ${T} (caminho, colecao, id, dados) values (${caminho}, ${colecao}, ${id}, ${JSON.stringify(d)}::text::json)
                 on conflict (caminho) do update set dados = excluded.dados, atualizado_em = now()`;
        (gravados || conhecidos).add(caminho);
      },
      async atualizar(caminho, campos) {
        await pronto;
        partes(caminho);
        // junta em JS (Object.assign, como o banco em memória) para PRESERVAR a ordem das chaves;
        // a linha fica travada (for update) até gravar, então ninguém se perde no meio
        const juntar = async (x) => {
          const r = await x`select dados from ${T} where caminho = ${caminho} for update`;
          if (!r.length) throw erro('nao-encontrado', `documento não existe: ${caminho}`);
          const novo = Object.assign(r[0].dados, copia(campos));
          await x`update ${T} set dados = ${JSON.stringify(novo)}::text::json, atualizado_em = now() where caminho = ${caminho}`;
        };
        if (emTransacao) await juntar(ex);
        else await sql.begin((tx) => juntar(tx));
      },
      async listar(colecao, filtro) {
        await pronto;
        validarColecao(colecao);
        const linhas = await ex`select id, dados from ${T} where colecao = ${colecao}`;
        contar('listar', colecao, linhas.length);
        return linhas.map((l) => Object.assign({ id: l.id }, l.dados)).filter((x) => !filtro || filtro(x)).sort((a, b) => a.id.localeCompare(b.id));
      },
      async consultar(colecao, opcoes) {
        await pronto;
        validarConsultaBanco(colecao, opcoes);
        validarColecao(colecao);
        const conds = [sql`colecao = ${colecao}`, ...(opcoes.onde || []).map(condicao)];
        const ord = opcoes.ordenar;
        const desc = ord && ord.direcao === 'desc';
        const porCampo = ord && ord.campo !== 'id';
        const p = porCampo ? caminhoCampo(ord.campo) : null;
        if (porCampo) conds.push(sql`(busca #> ${p}::text[]) is not null`); // como o Firestore: sem o campo, fica de fora
        if (opcoes.depoisDe) {
          const cur = await ex`select id, dados from ${T} where caminho = ${`${colecao}/${opcoes.depoisDe}`}`;
          if (!cur.length) throw erro('invalido', 'Cursor de paginação inválido');
          const ref = Object.assign({ id: cur[0].id }, cur[0].dados);
          (opcoes.cursorMesmoFiltro || []).forEach((campo) => {
            const f = (opcoes.onde || []).find((c) => c.campo === campo && c.op === '==');
            if (f && !igual(valorCampo(ref, campo), f.valor)) throw erro('invalido', 'Cursor de paginação de outro escopo');
          });
          if (porCampo) {
            const vc = valorCampo(ref, ord.campo);
            const cn = typeof vc === 'number' ? vc : 0;
            const cs = typeof vc === 'string' || typeof vc === 'boolean' ? String(vc) : '';
            const tupla = sql`(coalesce(${chaveNum(p)}, 0), coalesce(${chaveTxt(p)}, '') collate "C", id collate "C")`;
            const alvo = sql`(${cn}::numeric, ${cs}::text collate "C", ${ref.id}::text collate "C")`;
            conds.push(desc ? sql`${tupla} < ${alvo}` : sql`${tupla} > ${alvo}`);
          } else {
            conds.push(desc ? sql`id collate "C" < ${ref.id}::text collate "C"` : sql`id collate "C" > ${ref.id}::text collate "C"`);
          }
        }
        const ordem = porCampo
          ? (desc ? sql`${chaveNum(p)} desc, ${chaveTxt(p)} desc, id collate "C" desc` : sql`${chaveNum(p)} asc, ${chaveTxt(p)} asc, id collate "C" asc`)
          : (desc ? sql`id collate "C" desc` : sql`id collate "C" asc`);
        const linhas = await ex`select id, dados from ${T} where ${juntarE(conds)} order by ${ordem} limit ${opcoes.limite}`;
        contar('consultar', colecao, linhas.length);
        return linhas.map((l) => Object.assign({ id: l.id }, l.dados));
      },
      estatisticas: () => JSON.parse(JSON.stringify(est)),
      zerarEstatisticas() { est.listar = { chamadas: 0, documentos: 0 }; est.consultar = { chamadas: 0, documentos: 0 }; est.porColecao = {}; },
      _caminhos: () => [...conhecidos].sort(),
      async _caminhosAsync() { await pronto; return (await ex`select caminho from ${T} order by caminho collate "C"`).map((l) => l.caminho); },
    };
    if (emTransacao) {
      api.emTransacao = true;
      api.transacao = async () => { throw new Error('transação dentro de transação não é permitida'); };
      return Object.freeze(api);
    }
    api.transacao = async (fn) => {
      await pronto;
      for (let i = 0; ; i++) {
        try {
          const gravados = new Set();
          const r = await sql.begin('isolation level serializable', (tx) => fn(construir(tx, true, gravados)));
          gravados.forEach((c) => conhecidos.add(c)); // só depois de confirmada
          return r;
        } catch (e) {
          if (REPETIVEIS.has(e && e.code) && i < tentativas) {
            est.repeticoes++;
            await espera(Math.floor(Math.random() * (8 + i * 12)));
            continue;
          }
          throw e;
        }
      }
    };
    return api;
  }
  return construir(sql, false);
}

module.exports = { criarBancoPostgres };
