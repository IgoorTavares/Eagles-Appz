// Afirmações mínimas (sem baixar a biblioteca padrão do Deno: os testes não dependem da rede).
export function assert(cond: unknown, msg = 'falhou'): asserts cond {
  if (!cond) throw new Error(msg);
}
export function assertEquals(a: unknown, b: unknown, msg = '') {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg ? `${msg}: ` : ''}esperava ${y}, veio ${x}`);
}
