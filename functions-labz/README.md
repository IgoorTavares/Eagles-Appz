# LABZ AI — backend (Fase 2: Servidor seguro)

Ferramenta exclusiva do Super Admin dentro do Eagles Labz. Esta pasta tem o backend da LABZ AI:
contratos, os 8 agentes, as ferramentas, o motor de memória (5 escopos), o cadastro de empresas,
as execuções persistentes com fila e a API interna (`labzApi`). **Nada aqui está publicado**:
publicar exige o plano Blaze, os segredos no Google Cloud e o codebase `labz` no `firebase.json`.

> Este repositório é público e o GitHub Pages publica todos os arquivos. Por isso aqui só há
> **estrutura e código**: o conteúdo das skills, os prompts e as memórias ficam **privados no banco**
> (coleções `labz_*`), e as credenciais ficam no **Secret Manager**. Há testes que conferem.

## Como rodar os testes
```
cd functions-labz
npm install
npm test                 # testes rápidos, sem servidor (banco em memória)
npm run test:emulador    # integração no simulador do Firebase (precisa de Java e do firebase-tools)
```
O `test:emulador` sobe login + banco + função no projeto de demonstração `demo-labz` (nunca toca o
projeto real), cria um `.secret.local` **temporário só com valores fictícios** e uma cópia temporária
das regras reais (`../firestore.rules`), e apaga os dois no fim.
As regras do banco também são testadas em `testes-regras/`.

## Segurança da API (`labzApi`)
Toda chamada passa, nesta ordem, por:
1. o Firebase confere a assinatura do token de login (no servidor real);
2. `verificarToken` (index.js) confere de novo com `checkRevoked`: conta desativada ou sessões revogadas perdem o acesso na hora;
3. `exigirSuperAdmin`: `usuarios/{uid}.role` exatamente `SuperAdmin` + UID no segredo `LABZ_SUPERADMIN_UIDS`
   **e** em `labz_config/acesso` (as duas listas precisam concordar) + conta não bloqueada por senhas erradas;
4. a ação precisa estar na lista fechada (`src/api/labz-api.js`), com dados validados e tamanho máximo de 200 KB;
5. o serviço valida pelo esquema dele e grava a auditoria.

As respostas nunca levam segredos (`sistema.status` diz só "configurado"/"não configurado").
Não existe ação para ler segredo nem para apagar dados.

## Organização
```
functions-labz/
├── index.js                     liga a API ao Firebase (onCall), ao Firestore e ao Secret Manager
├── firebase.emulador.json       configuração SÓ para o simulador (o firebase.json do projeto não muda)
├── src/
│   ├── servicos.js              criarLabz({ banco }) monta todos os serviços
│   ├── api/labz-api.js          lista fechada de ações + tradução de erros
│   ├── nucleo/                  validador de esquemas, erros, ids, versionamento
│   ├── contratos/               agente (+ perfil de memória), ferramenta, execução (9 estados), memória (5 escopos,
│   │                            estados, modelo canônico), recuperação (busca e contexto), empresa
│   ├── agentes/catalogo.js      os 8 agentes
│   ├── ferramentas/             registro das ferramentas + verificação de permissão
│   ├── auth/super-admin.js      autorização no servidor
│   ├── segredos/provedores.js   nomes dos segredos dos provedores; só informa se estão configurados
│   ├── armazenamento/           caminhos, banco em memória (testes) e adaptador do Firestore
│   ├── auditoria/eventos.js     trilha de auditoria (só acrescenta)
│   ├── empresas/servico.js      cadastro de empresas (vínculo opcional com tenant/cliente do CRM)
│   ├── memoria/                 registro, correções → aprendizados, Context Builder, auditor
│   ├── skills/registro.js       conteúdo privado e versionado das skills
│   └── execucao/                execuções persistentes e fila persistente
├── test/                        testes rápidos (node:test)
└── integracao/                  testes no simulador do Firebase + executor
```

## Onde cada dado mora (Firestore)
| Dado | Caminho |
|---|---|
| Lista de Super Admins autorizados (lida pelas regras e pelo servidor) | `labz_config/acesso` → `{ uids: [...] }` |
| Empresas da LABZ AI | `labz_empresas/{empresaId}` |
| Vínculos únicos (tenant / cliente do CRM) | `labz_vinculos/{chave}` |
| Memória global / do agente / da empresa / de desempenho / da tarefa | `labz_memoria_global/{id}`, `labz_agentes/{agenteId}/memorias/{id}`, `labz_empresas/{empresaId}/memorias/{id}`, `labz_empresas/{empresaId}/desempenho/{id}`, `labz_tarefas/{tarefaId}/memorias/{id}` |
| Versões (memória e skill) | `.../{id}/versoes/{n}` |
| Skills (conteúdo privado) | `labz_skills/{agenteId}__{ARQUIVO}` |
| Execuções (produções) | `labz_tarefas/{id}` (estado, versão, histórico, tentativas, sinal de vida) |
| Fila persistente | `labz_fila/{id}` |
| Correções e propostas de aprendizado | `labz_correcoes/{id}`, `labz_aprendizados/{id}` |
| Auditoria | `labz_eventos/{id}` |

## Segredos (Secret Manager) — criados só na hora de publicar
| Nome | Para quê |
|---|---|
| `LABZ_SUPERADMIN_UIDS` | lista de UIDs autorizados (separados por vírgula) |
| `LABZ_ANTHROPIC_API_KEY`, `LABZ_OPENAI_API_KEY`, `LABZ_GOOGLE_API_KEY` | chaves dos provedores (Fase 6) |

## Para publicar (NÃO feito; só com autorização)
1. Plano Blaze com orçamento e alerta de gasto.
2. Publicar o `firestore.rules` (antes de qualquer outra coisa).
3. Criar `labz_config/acesso` com o seu UID (pelo console).
4. Criar os segredos (`firebase functions:secrets:set ...`).
5. Acrescentar ao `firebase.json` o codebase `{ "source": "functions-labz", "codebase": "labz" }` e publicar só ele.

## Memory Engine (Fases 3A e 3B)
- **Fonte oficial: Firestore.** Documento base em `caminhos.memoria(...)` e versões imutáveis em `{base}/versoes/{n}`.
  `ESQUEMA_DOC_MEMORIA`/`ESQUEMA_DOC_VERSAO` + `conferirRegistroMemoria`/`conferirVersaoMemoria` (`src/contratos/memoria.js`).
- **Ciclo da versão (3B):** `rascunho` (DRAFT) → `pendente` (PENDING_REVIEW) → `aprovada` (APPROVED) | `rejeitada` (REJECTED, com motivo)
  | `precisa-revisao` (NEEDS_REVISION, com motivo; a correção é uma versão nova); a aprovada vira `substituida` quando outra é aprovada.
  Memória: `pendente` → `ativa` ⇄ `arquivada` (ARCHIVED). Proposta de agente nasce em rascunho. Só entra no contexto a versão
  aprovada vigente de uma memória `ativa` (`memoriaVigente`).
- **Aprovação:** um lugar só (`src/memoria/registro.js`; as correções usam ele). Exige o ator do Super Admin (`exigirSuperAdmin`
  na API); agente nunca aprova, rejeita, pede revisão nem volta versão. Texto com sinal de instrução escondida só é aprovado com
  `confirmoSinais`. Toda decisão vai para `labz_eventos` (sem o conteúdo).
- **Versões:** cada versão guarda `baseVersao` (a vigente quando foi criada); aprovar uma versão criada sobre uma vigente antiga
  recusa com "conflito". Rollback = versão nova já aprovada (`origem: rollback, versaoDe`), nada é apagado.
- **Origem:** tarefa/correção/aprendizado citados precisam existir e ser da mesma empresa (e da mesma tarefa).
- **Trava da memória Global (D3)** (`src/memoria/protecao-global.js`), na criação, nova versão, aprovação e rollback: recusa texto
  com nome de empresa da LABZ AI ou do tenant/cliente do CRM vinculado, e-mail, telefone, CPF/CNPJ, endereço web ou valor em R$;
  origem de empresa exige `confirmoSemDadosDeCliente`. Problema achado na aprovação devolve a versão para revisão. Filtros não
  garantem sozinhos: a aprovação humana continua sendo a última barreira.
- **Markdown** (`src/memoria/markdown.js`): gerado na hora a partir de UMA versão aprovada/substituída, determinístico, cabeçalho
  YAML (valores em JSON) + `sha256` do conteúdo; o conteúdo vai num bloco literal. Não é gravado em lugar nenhum. Importação: não existe.
- **Verificações** (`src/memoria/verificacoes.js`): similaridade, duplicidade, conflito por chave e sinais de injeção (usadas pelo
  registro, pelas correções e pelo auditor).
- **Duplicidade e conflito (decisão do Igor):** a proposta é registrada (com `alertas`), mas **aprovar** (ou voltar versão) com
  memória vigente duplicada ou com a mesma chave fica **bloqueado** ("conflito", com `motivo: decisao-necessaria`, os itens e uma
  `assinatura`). O Super Admin vê a situação com `memoria.avaliarConflitos` e aprova mandando
  `confirmacaoConflitos: { assinatura, justificativa }`. A assinatura (sha256) prende a decisão à proposta (memória, versão,
  conteúdo) e a cada memória envolvida com a versão vigente dela: se algo mudar, a decisão fica desatualizada e é preciso avaliar
  de novo. A reavaliação acontece DENTRO da transação da aprovação (o adaptador do Firestore lê a coleção com `tx.get`; o banco de
  teste faz uma transação de cada vez), então duas aprovações simultâneas não passam juntas. A decisão fica na versão
  (`confirmacoes.conflitos`) e na auditoria; tentativas barradas geram `memoria.conflito_bloqueado`. Agente não decide.
- **Busca e recuperação (3C)** (`src/memoria/recuperador.js`, `indice.js`, `ranqueador.js`):
  - **Índice:** na mesma transação que torna uma versão vigente (aprovação, rollback, tarefa), o documento da memória ganha
    `termos` (até 40: sem acento, sem palavras vazias, plural simples), `aprovadaEm` e `indiceVersao`. Pendente/rascunho/revisão/
    rejeitada nunca indexam; arquivar troca o status (a busca filtra). `memoria.reindexar` recalcula registros sem índice, por páginas.
  - **Consultas** (`banco.consultar`, nos dois bancos, com as restrições do Firestore e limite obrigatório): sempre na coleção do
    alvo (nada de collectionGroup), com `status == 'ativa'` NA consulta, `termos array-contains-any` (até 30), `categoria`/`chave` ==,
    `orderBy aprovadaEm desc`, até 50 candidatos; metadados paginam com cursor (`depoisDe`). Ranking determinístico (cobertura 0,45,
    categoria 0,25, evidência 0,10, atualidade 0,10, escopo 0,10; desempate versão desc → id), com as notas por critério.
  - **Contexto:** por escopo, até 50 pelas palavras do briefing + até 20 recentes; evento `memoria.contexto_montado` com ids,
    versões e métricas (sem conteúdo). Busca pela API: `memoria.buscar` (evento `memoria.busca_realizada` sem o texto).
  - **Paginação:** `memoria.listar`, `memoria.auditar` e `correcoes.pendentes` (até 100 por página); a trava da Global lê as
    empresas por páginas (acima de 2.000, bloqueia).
  - **Aprovação (Fase 3B) não mudou:** a verificação de duplicidade/conflito continua lendo a coleção DENTRO da transação.
  - **Índices compostos:** `INDICES_NECESSARIOS` (25, formato do `firestore.indexes.json`), conferidos por teste e **não
    publicados** (o simulador não exige índices; o Firebase real exige).
  **Busca semântica: indisponível** (`BUSCA_SEMANTICA`); a busca por palavras-chave não é semântica.
- **Agentes:** `perfilMemoria(agente)` deriva do catálogo o que cada um dos 8 lê e propõe; nenhum aprova. Integração operacional: 3D.

## O que falta (fases seguintes)
- Fase 3D–3E: prioridades dos agentes (D4), segurança final e simulador; publicar os índices compostos (com autorização).
- Fase 4: motor de orquestração (trabalhador da fila, planner, quality gate, custos).
- Fases 5–8: conteúdo das skills, provedores de IA, interface e integrações.
