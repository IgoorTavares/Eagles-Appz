// R1 (decisão D5 do Igor): NENHUM dado pessoal de cliente vai para um provedor de IA.
// Antes de qualquer chamada a um provedor de verdade, o texto que sai da máquina (instruções,
// briefing, memórias, documentos recebidos) passa por aqui: CPF, e-mail, telefone, CEP e
// endereço viram marcas ("[e-mail removido]"). Só a CONTAGEM do que foi removido é registrada.
// CNPJ não é dado pessoal (é da empresa): continua, como informação profissional.
// É uma rede de segurança: a regra é não colocar dado pessoal no briefing nem nas memórias.
const REGRAS = [
  // e-mail (qualquer um: mesmo o "profissional" pode ser de uma pessoa)
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[e-mail removido]'],
  // CPF com ou sem pontuação (000.000.000-00 ou 00000000000), sem engolir um CNPJ (14 dígitos)
  // (o ponto final da frase logo depois do CPF não impede a remoção)
  ['cpf', /(?<![\d/-]|\d\.)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?![\d/-]|\.\d)/g, '[CPF removido]'],
  // CEP (00000-000 ou 00.000-000)
  ['cep', /(?<!\d)\d{2}\.?\d{3}-\d{3}(?!\d)/g, '[CEP removido]'],
  // telefone brasileiro: +55, DDD entre parênteses ou não, fixo (8) ou celular (9 dígitos)
  ['telefone', /(?<![\d])(?:\+?55[\s.-]?)?(?:\(?\d{2}\)?[\s.-]?)?(?:9[\s.-]?)?\d{4}[\s.-]?\d{4}(?!\d)/g, '[telefone removido]'],
  // endereço: logradouro + nome + número ("Rua das Flores, 123", "Av. Brasil 4500")
  ['endereco', /\b(?:rua|r\.|avenida|av\.?|travessa|tv\.|alameda|al\.|rodovia|estrada|praça|praca|largo)\s+[^\n,;]{2,60}?,?\s*(?:n[ºo°.]?\s*)?\d{1,6}\b/gi, '[endereço removido]'],
];

function removerDadosPessoais(texto) {
  let t = String(texto === undefined || texto === null ? '' : texto);
  const removidos = {};
  for (const [nome, re, marca] of REGRAS) {
    t = t.replace(re, (m) => {
      // telefone: sequências curtas de dígitos que não parecem telefone (ex.: anos, valores) ficam
      if (nome === 'telefone' && m.replace(/\D/g, '').length < 8) return m;
      removidos[nome] = (removidos[nome] || 0) + 1;
      return marca;
    });
  }
  const total = Object.values(removidos).reduce((a, b) => a + b, 0);
  return { texto: t, removidos, total };
}

module.exports = { removerDadosPessoais };
