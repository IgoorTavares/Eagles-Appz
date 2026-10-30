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
| Nomes reservados das empresas (nome normalizado único) | `labz_nomes/{slug}` |
| Memória global / do agente / da empresa / de desempenho / da tarefa | `labz_memoria_global/{id}`, `labz_agentes/{agenteId}/labz_memorias/{id}`, `labz_empresas/{empresaId}/labz_memorias/{id}`, `labz_empresas/{empresaId}/labz_desempenho/{id}`, `labz_tarefas/{tarefaId}/labz_memorias/{id}` |
| Versões (memória e skill) | `.../{id}/labz_versoes/{n}` |
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
- **Fonte oficial: Firestore.** Documento base em `caminhos.memoria(...)` e versões imutáveis em `{base}/labz_versoes/{n}`.
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
- **Agentes (3D):** `perfilMemoria(agente)` deriva do catálogo o que cada um dos 8 lê e propõe (com `prioridadesMemoria`, que só
  mudam a ORDEM do ranking); nenhum aprova. D4: o Especialista em Carrosséis lê desempenho, mas não propõe.
  - **Porta de memória** (`src/agentes/memoria-agente.js`, uso interno, fora da API): `abrir(agenteId, execucaoId)` → `consultar`
    e `propor`. Escopo e alvo vêm da execução e do contrato (empresa da execução; memória de agente só a própria). O agente
    precisa fazer parte da execução. `propor` (base: tarefa, correção, feedback ou desempenho) grava SEMPRE rascunho, pelo
    `ATOR_SISTEMA` (que não aprova, não envia, não confirma e não grava memória de tarefa).
  - **Preparação por etapa** (`src/execucao/preparacao.js`): `prepararEtapa` monta o contexto de um agente para a execução;
    `planejarContextos` (Estrategista, modo orquestrado) define os agentes do plano e monta um contexto POR agente. Na execução
    fica só o resumo (ids e versões). API: `execucoes.prepararEtapa`, `execucoes.planejarContextos`. Nenhum agente é executado.
  - **Contexto (10 blocos):** segurança, especialidade e limites/permissões (os únicos confiáveis); tarefa (identificação,
    empresa e objetivo), memórias e briefing são DADOS, delimitados no texto (`dados_da_tarefa`, `dados_aprovados`,
    `dados_do_usuario`), com a referência de cada memória; nenhum dado consegue abrir ou fechar um delimitador.

## Correções da auditoria (Fase 3E)
- **Nomes:** as subcoleções são `labz_memorias`, `labz_desempenho` e `labz_versoes` (`caminhos.subcolecoes`), para que índices e
  isenções do Firestore (que valem por nome de coleção) nunca alcancem o CRM/ERP.
- **F1** reativar passa pela mesma verificação de conflito da aprovação, na transação (`confirmacaoConflitos`).
- **F2** busca por palavras: se a consulta lota o limite, uma 2ª consulta com os termos que a palavra comum "abafou";
  o resultado diz `completa: false` quando é uma seleção limitada.
- **F3** `correcoes.aprovar` reserva a proposta numa transação (`emAprovacao`, vence em 2 min).
- **F4** nome normalizado único por reserva transacional `labz_nomes/{slug}` (só empresas da LABZ AI).
- **F5** delimitadores com o código do contexto (`codigo="…"`) + limpeza ampla de marcadores dentro dos dados.
- **F6** fila, auditoria, execuções e empresas em consultas limitadas e paginadas; cursor preso à empresa
  (`cursorMesmoFiltro`); 3 índices de operação em `src/armazenamento/indices-operacao.js` (não publicados).
- **F7** empresa arquivada: sem contexto, sem porta de memória, sem avançar execução (encerrar continua possível).

## Motor de execução (Fase 4A) — agentes SIMULADOS
Nenhum modelo de IA, nenhuma API paga e nenhuma ferramenta real. Tudo o que o "agente" devolve vem de
`src/motor/adaptador-simulado.js`, marcado com `simulado: true` e texto começando com `[SIMULADO]`.
- **Planejador** (`motor/planejador.js`): especialista = 1 etapa; orquestrado = etapas do plano (do Super Admin ou de um
  adaptador simulado) com dependências validadas (agentes, ids únicos, sem ciclo, até 8) + etapa final `consolidacao` do Estrategista.
- **Motor** (`motor/motor.js`): Workflow Engine + Agent Router + Execution Monitor. `planejar` (CREATED → PLANNING → READY),
  `trabalhar` (fila.reservar → READY → RUNNING com o **crachá** `execucaoAtual.token` → etapas em ordem → COMPLETED |
  WAITING_APPROVAL | REVISION_REQUIRED | READY com espera | FAILED), `decidirAprovacao`, `retomar`, `diagnosticar`, `varrer`.
  Toda gravação confere o crachá e o estado RUNNING: cancelada ou assumida por outro, o executor para e descarta o resultado.
- **Contexto só pela porta de memória** (`porta.montarContexto`); resultados de etapas anteriores entram como DADO no briefing.
- **Quality Gate** (`motor/qualidade.js`): só estrutural (presença, simulado, agente/etapa, formato, referências do contexto,
  ações autorizadas pelo catálogo, limites). Não avalia qualidade criativa.
- **Aprovação de ações** (`motor/aprovacoes.js`): pedido em `labz_tarefas/{id}/labz_aprovacoes`, assinatura presa à ação exata
  e à tentativa da etapa; só o Super Admin decide; recusa = ação não executada; aprovada = executada **só em simulação**.
- **Custos** (`motor/custos.js`): consumo **simulado** em "unidade simulada" (não é preço de provedor); limites por execução
  (`limites.tokens`, `custoSimulado`, `etapas`) bloqueiam ANTES de chamar o agente → REVISION_REQUIRED; `retomar` aceita limites novos.
- **Tool Executor** (`motor/ferramentas-simuladas.js`): só contrato + simulação; autorização pelo catálogo de ferramentas.
- **Estados:** os 9 de sempre; acréscimo **REVISION_REQUIRED → READY** (volta para a fila depois da revisão humana).
- **Eventos** `execucao.*`: planejamento_iniciado, agente_selecionado, etapa_iniciada/concluida/falhou/descartada, nova_tentativa,
  aprovacao_solicitada/decidida/desatualizada, acao_simulada/recusada, custo_bloqueado, qualidade_reprovada, retomada, concluida
  (+ transicao). Só ids, contagens e motivos.
- **API:** `execucoes.planejar`, `execucoes.aprovacoes`, `execucoes.decidirAprovacao`, `execucoes.retomar`, `execucoes.diagnostico`.
  O executor (`motor.trabalhar`) **não** sai pela API e não está agendado (Fase 4B).
- **Índices:** nenhum composto novo. Isenções adicionais propostas à parte (não aplicadas): `labz_resultados.texto` e `labz_tarefas.etapas`.

## Fase 4B — adaptadores de IA, executor automático local e custos (tudo SIMULADO)
Nenhuma chamada real a OpenAI, Anthropic ou Google; nenhuma chave; nada agendado em produção; nada publicado.
- **Provedores** (`src/ia/`): contrato comum (`contrato.js`: resposta normalizada, `ErroProvedor` com tipos transitório,
  revisável ou definitivo) e um adaptador por provedor (`provedores/openai.js`, `anthropic.js`, `google.js`, `simulado.js`),
  cada um no SEU formato (os provedores não são iguais). Os formatos vêm da documentação pública e **precisam ser
  conferidos na documentação oficial antes de ligar um modelo real**.
- **Transporte** (`ia/transporte.js`): só o **simulado** (`simulacao/modelo-simulado.js` responde no formato de cada provedor)
  e o **bloqueado**. O transporte real **não existe**. Limitador local de requisições por provedor.
- **Modelo por agente** (`ia/config-modelos.js`): `labz_agentes/{id}.configModelo` (provedor, modelo, uso, recursos, timeout,
  saída máxima). Padrão = simulado. `uso: "real"` é **recusado** (`USO_REAL_AUTORIZADO = false`). Validada ao salvar e antes
  de cada execução. Permissões continuam só no catálogo.
- **Prompt seguro** (`ia/prompt.js`): instruções (1 segurança, 2 contrato, 3 permissões, 8 formato) separadas dos DADOS
  (4 objetivo, 5 cliente, 6 memórias, 7 etapas anteriores/briefing), com marcadores com código e filtro de credenciais
  (`ia/credenciais.js`). Isso reduz, mas não elimina, o risco de prompt injection: o backend confere tudo o que volta.
- **Ponte** (`ia/adaptador-modelos.js`): mesma interface do adaptador da 4A; timeout, cancelamento, JSON conferido,
  campos a mais descartados, uso informado ou ESTIMADO (marcado).
- **Plano do Estrategista** (`motor/validar-plano.js`): o modelo propõe; o backend valida agentes, modo, ações previstas,
  ids, dependências e ciclos, critérios, formato, campos proibidos (cliente, limites, permissões, tentativas, aprovações),
  limite de etapas (projeto grande → "divida o projeto") e consumo estimado. Plano recusado não muda o estado (até 3 vezes).
  `motor.pedido` (API `execucoes.pedido`) = criar + planejar. Estrategista simulado: `ia/simulacao/estrategista-simulado.js`.
- **Revisões internas** (`motor.js`): a consolidação pode pedir `revisoes: [{ etapaId, motivo }]`; até 2 por execução;
  resultados anteriores guardados em `labz_resultados/{etapa}_revN`; acima do limite → REVISION_REQUIRED.
- **Executor automático local** (`motor/executor-local.js`) e **monitor da fila** (`motor/monitor-fila.js`): ciclos com
  concorrência, parada que cancela a chamada em curso sem gastar tentativa, recuperação de interrompidas sem retomada
  dupla (versão conferida), reservas vencidas sem tentativa encerradas, itens de execuções encerradas descartados.
  Só local (testes e simulador); não sai pela API e não é agendado.
- **Consumo** (`motor/consumo.js`): por dia, global, por agente, por empresa e por provedor, com reserva ANTES da chamada
  (bloqueio preventivo) e liquidação depois. Tokens, uso informado, estimativas, custo estimado (só com preço cadastrado
  pelo Super Admin em `labz_config/precos`), custo desconhecido (nunca zero) e custo confirmado (null) ficam separados.
  Limite de custo + preço desconhecido = bloqueio. `cobrancaReal` é sempre `false`.
- **API nova:** `execucoes.pedido`, `modelos.listar`, `modelos.configurar`, `modelos.remover`, `custos.limites`,
  `custos.definirLimites`, `custos.definirPreco`, `custos.consumo`.
- **Índices:** nenhum composto novo. Isenções adicionais propostas à parte (não aplicadas): `labz_consumo.reservas`,
  `.agentes`, `.empresas`, `.provedores` e `labz_tarefas.custos`.

## Limitações que continuam (não resolvidas)
1. A aprovação (e o rollback e a reativação) ainda lê o escopo inteiro na transação, para preservar a consistência (decisão da 3B).
2. A busca trabalha com candidatos limitados (até 100 por escopo, com a consulta complementar) e **não garante recuperação exaustiva**; avisa com `completa: false`.
3. A reserva da aprovação de correção (F3) vale por **2 minutos**.
4. O Firebase Emulator **não comprova** a disponibilidade dos índices no Firebase real.
5. A proteção contra prompt injection (marcadores com código, limpeza, blocos `confiavel`) depende também do tratamento seguro dos dados pelo futuro executor de modelos (Fase 4/6).
6. Os agentes **ainda não executam** tarefas reais: na Fase 4B o motor usa só modelos simulados (transporte simulado) e o executor só roda localmente.
7. Os **28 índices** compostos e as **27 isenções** propostos **ainda não foram publicados** (`firestore.indexes.json` não mudou).

## O que falta (fases seguintes)
- Fase 3E (feita): auditoria e correções F1–F7 (ver abaixo). Publicar os 28 índices e as 27 isenções só com autorização.
- Fase 4: o trabalhador que executa os agentes (usa a porta de memória e a preparação por etapa).
- Fase 4: motor de orquestração (trabalhador da fila, planner, quality gate, custos).
- Fases 5–8: conteúdo das skills, provedores de IA, interface e integrações.
