# LABZ AI — Plano da próxima fase: ativação dos 8 agentes de IA reais (versão 2, revisada)

> **Situação: PLANEJAMENTO para aprovação do Igor. Nada deste plano está autorizado.**
> A direção geral foi aprovada pelo Igor; a R1 e qualquer API real **não** estão autorizadas.
> Nenhuma conta de provedor foi criada, nenhuma chave cadastrada, nenhum modelo pago chamado e nenhum código
> desta fase escrito. Cada etapa (R0 a R8) só começa com autorização própria.
> Pré-requisito: a I4-B encerrada. **O backup pós-publicação da I4-B continua PENDENTE** até a confirmação do Igor.

## 0. Decisões preliminares da R0 (Igor, 09/11/2026)

| Decisão | Preliminar |
|---|---|
| D1 — provedor | Claude como provedor inicial; GPT, Gemini e Grok continuam previstos na arquitetura |
| D2 — orçamento | US$ 10/mês, sujeito à confirmação do limite na conta do provedor |
| D3 — piloto | Roteirista |
| D4 — conta do provedor | sob controle do Igor (ele cria, paga e define o limite; nada passa pelo chat) |
| D5 — dados | nenhum dado pessoal de clientes; só informações profissionais autorizadas |
| D6 — lotes | processamento em lote permitido quando apropriado (critérios na seção 6) |

## 1. Objetivo e o que não muda

Trocar o "modelo simulado" dos 8 agentes por modelos reais, **sem mudar**: o motor, a fila, o worker, o crachá do
executor, as aprovações do Super Admin, o Memory Engine, os limites de custo (reserva antes da chamada; custo
desconhecido nunca vira zero) e a autenticação da v4. Só muda o **transporte** (simulado/bloqueado → real),
ligado agente por agente.

## 2. Arquitetura

### 2.1 Textos (os 8 agentes)

```
Tela do Super Admin ──► labz-api ──► banco labz          (a labz-api nunca chama modelos)
                                       │
            pg_cron + gatilho da fila ─┘ acionamento assinado (HMAC, 120 s, uso único)
                                       ▼
                                 labz-worker
                                 1. pega 1 etapa (crachá do executor)
                                 2. monta o contexto pela porta de memória
                                 3. filtra dados pessoais (D5)
                                 4. RESERVA o custo máximo da chamada
                                 5. grava a "chamada em andamento" (chave única)
                                 6. chama o provedor (transporte real, só endereços oficiais)
                                 7. confere a resposta (formato, documento, qualidade)
                                 8. registra entrega + custo real e devolve a sobra da reserva
                                    (tudo na transação do crachá)
```

- **Chaves dos provedores:** só nos segredos do worker (`LABZ_ANTHROPIC_API_KEY`; depois `LABZ_OPENAI_API_KEY`,
  `LABZ_GOOGLE_API_KEY`, `LABZ_XAI_API_KEY`), cadastradas pelo Igor no painel. Nunca na `labz-api`, no banco, no
  navegador, no chat ou no GitHub.
- **Transporte real:** `fetch` HTTPS só para uma lista fechada de endereços oficiais, `redirect: 'error'`,
  tempo-limite e cancelamento. Sem autorização, o transporte é o **bloqueado** (padrão).
- **Interruptores:** geral (`labz_config/worker`, já existe), por provedor (`labz_config/provedores`, novo) e por
  agente (`labz_agentes/{id}.configModelo.uso`: `simulado` ou `real`).
- **Limites do Supabase grátis:** 150 s de relógio e 2 s de CPU por chamada do worker → 1 etapa por chamada,
  tempo-limite de 110 s por chamada ao modelo, respostas em fluxo (streaming), teto de tamanho de resposta.

### 2.2 Imagens (separadas dos textos)

A geração de imagens é **outro caminho**, com riscos e custos diferentes:

| | Textos | Imagens |
|---|---|---|
| Quem pede | os 8 agentes, nas etapas do plano | só o Designer e o Carrosséis, a partir de um **briefing de design aprovado** |
| Fila | `labz_fila` (atual) | fila própria (`labz_fila_imagens`), com interruptor próprio |
| Provedor | Claude (D1) | Claude **não gera imagens**: Gemini ou modelo de imagem da OpenAI (a escolher na R6) |
| Custo | por token | por imagem; limite próprio (quantidade por dia e valor) |
| Armazenamento | no banco (até 200 KB por conteúdo) | Supabase Storage, pasta **privada**, link temporário; nunca no banco nem no site |
| Aprovação | entrega aprovada pelo Super Admin | **toda imagem** aprovada antes de uso; nenhuma publicação automática |
| Riscos próprios | — | rosto de pessoa real, marca de terceiros, direitos autorais: proibidos no briefing e conferidos na aprovação |

Até a R6, o Designer e o Carrosséis produzem só **documentos** (briefing de design, estrutura do carrossel), em
texto. As imagens são uma etapa separada, com autorização separada.

## 3. Os 8 agentes: responsabilidades, ferramentas, permissões e qualidade

**Ferramentas nesta fase:** só três funcionam, e quem as executa é o **sistema**, não o modelo:
consultar memória (pela porta de memória, ao montar o contexto), propor memória (nasce em rascunho) e salvar a
entrega (pelo motor). As outras ferramentas do catálogo continuam **desligadas** (o modelo não recebe nenhuma
ferramenta para chamar): `crm.ler_cliente`, `drive.ler_arquivos`, `referencia.analisar`, `imagem.gerar`,
`render.peca`, `crm.enviar_conteudo`, `github.propor_mudanca`, `codigo.testar`, `web.publicar`,
`meta.ler_metricas`, `meta.publicar`, `google_ads.ler_metricas`, `google_analytics.ler_metricas`,
`pixel.checar`, `tarefa.delegar` e `qualidade.auditar`. Cada uma, se um dia for ligada, terá etapa e autorização próprias
(as que **agem fora do sistema**, como publicar, ficam fora desta fase).

**Permissões de memória** (do catálogo atual; nenhum agente aprova memória):

| Agente | Lê os escopos | Pode propor em |
|---|---|---|
| 01 Guia da Marca | global, agente, cliente, tarefa | cliente, agente |
| 02 Designer | global, agente, cliente, tarefa | agente, cliente |
| 03 Carrosséis | global, agente, cliente, tarefa, desempenho | agente, cliente |
| 04 Roteirista | global, agente, cliente, tarefa | agente, cliente |
| 05 Dev Web | global, agente, cliente, tarefa | agente, cliente |
| 06 Engenheiro | global, agente, cliente, tarefa | agente, cliente |
| 07 Tráfego | global, agente, cliente, tarefa, desempenho | agente, cliente, desempenho |
| 08 Estrategista | global, agente, cliente, tarefa, desempenho | global, agente, cliente, desempenho |

**Responsabilidades e critérios de qualidade.** Os critérios "do sistema" são conferidos pelo backend antes de virar
entrega (falhou → nova tentativa ou revisão interna). Os critérios "do Super Admin" entram na avaliação (seção 9) e na
aprovação.

| Agente | Responsabilidade | Documento que entrega | Critérios do sistema (objetivos) | Critérios do Super Admin (nota de 1 a 5) |
|---|---|---|---|---|
| 08 Estrategista | entende o pedido, divide em etapas, escolhe os agentes, consolida | `plano-estrategico`, `consolidacao-final` | plano válido no validador (agentes do catálogo, dependências sem ciclo, no máximo 8 etapas, projeto grande → "divida"); consolidação cita só documentos já conferidos | o plano resolve o pedido? etapas na ordem certa? nada inventado? |
| 01 Guia da Marca | diretrizes de marca a partir do briefing e das memórias da empresa | `diretrizes-marca` | estrutura do catálogo; sem dado pessoal; tamanho dentro do limite | coerente com a marca? útil para os outros agentes? |
| 04 Roteirista | roteiros e legendas | `roteiro-reels`, `legenda-social` | estrutura; legenda dentro do limite de caracteres; português; sem links ou contatos inventados | tom de voz certo? gancho nos primeiros segundos? chamada para ação clara? |
| 03 Carrosséis | estrutura de carrossel (texto por lâmina) | `estrutura-carrossel` | número de lâminas dentro do pedido (2 a 10); texto por lâmina dentro do limite | sequência lógica? 1ª lâmina prende? |
| 02 Designer | briefing de design (até a R6, sem imagem) | `briefing-design` | estrutura; cores em hexadecimal; nenhuma pessoa real ou marca de terceiro pedida | o briefing é executável por um designer? |
| 07 Tráfego | plano de tráfego (documento sensível; **nenhuma ação em anúncio**) | `plano-trafego` | estrutura; orçamento só com valores informados no pedido; nenhum número de resultado inventado como fato | estratégia faz sentido? riscos ditos? |
| 05 Dev Web | documentação de página/site (código só como texto no documento) | `documentacao-tecnica` | estrutura; código dentro de bloco; nenhuma chave ou endereço interno | funciona como guia? código legível? |
| 06 Engenheiro | relatório técnico e revisão de solução | `relatorio-tecnico`, `documentacao-tecnica` | estrutura; riscos listados; nenhuma ação executada | diagnóstico correto? riscos realistas? |

## 4. Modelos por complexidade e custo

**Regra:** cada etapa começa no modelo **mais barato que passa na avaliação** (seção 9). Subir de modelo só por um
critério escrito, nunca por padrão. O modelo mais caro (Fable) **não** é usado nesta fase.

| Nível | Modelo (conferido na documentação oficial) | Usar para | Esforço (`effort`) |
|---|---|---|---|
| 1 — econômico | **Claude Haiku 5.5** (`claude-haiku-5-5`) | legendas, estrutura de carrossel, resumos, conferências internas | `low` |
| 2 — padrão | **Claude Sonnet 5.5** (`claude-sonnet-5-5`) | roteiros, diretrizes de marca, plano estratégico comum, plano de tráfego, documentação técnica | `low` ou `medium` |
| 3 — complexo | **Claude Opus 5.5** (`claude-opus-5-5`) | só quando um critério de subida acontecer (abaixo) | `medium` |

**Proposta inicial por agente** (a ajustar pela avaliação):

| Agente | Começa em | Sobe para o nível 3 quando |
|---|---|---|
| 04 Roteirista (piloto) | Haiku 5.5 (legenda) / Sonnet 5.5 (roteiro) | nunca nesta fase |
| 03 Carrosséis | Haiku 5.5 | nunca nesta fase |
| 01 Guia da Marca | Sonnet 5.5 | nunca nesta fase |
| 07 Tráfego | Sonnet 5.5 | nunca nesta fase |
| 02 Designer (documento) | Sonnet 5.5 | nunca nesta fase |
| 08 Estrategista | Sonnet 5.5 | plano com mais de 5 etapas, ou 2 planos recusados seguidos pelo validador |
| 05 Dev Web | Sonnet 5.5 | documentação com mais de 3 arquivos de código |
| 06 Engenheiro | Sonnet 5.5 | relatório técnico de revisão de segurança ou arquitetura |

A subida é registrada no evento da etapa (motivo + modelo) e conta no mesmo limite de custo.

**Preços oficiais da Anthropic** (conferidos em 09/11/2026 em `platform.claude.com/docs/en/about-claude/pricing` e nas
páginas de cada modelo; US$ por milhão de tokens; 1 milhão de tokens ≈ 750 mil palavras):

| Modelo | Entrada | Saída | Leitura de cache | Lote (entrada / saída) | Contexto | Saída máxima |
|---|---|---|---|---|---|---|
| Haiku 5.5 (pedido até 100 mil tokens) | 0,10 | 0,50 | 0,01 | 0,05 / 0,25 | 1 milhão | 128 mil |
| Haiku 5.5 (pedido acima de 100 mil tokens) | 0,50 | 2,50 | 0,05 | 0,25 / 1,25 | | |
| Sonnet 5.5 | 2 | 10 | 0,10 | 1 / 5 | 1 milhão | 128 mil |
| Opus 5.5 | 4 | 20 | 0,20 | 2 / 10 | 1 milhão | 128 mil |

Os três aceitam imagem como **entrada** (o Guia da Marca poderia ler um logotipo) e nenhum **gera** imagem.

**Outros provedores (NÃO conferidos):** as páginas oficiais da OpenAI, do Google e da xAI não abrem neste ambiente
(a rede bloqueia esses endereços). Os números da versão 1 deste plano vinham de sites de comparação e **foram retirados**.
Antes da R6 (segundo provedor e imagens): conferir nas páginas oficiais (`openai.com/api/pricing`,
`ai.google.dev/gemini-api/docs/pricing`, `docs.x.ai`), pelo Igor no navegador ou liberando esses endereços no ambiente
com autorização.

## 5. Correção do adaptador da Anthropic (especificação da R1)

O adaptador da Fase 4B (`functions-labz/src/ia/provedores/anthropic.js`) foi escrito para uma versão antiga da API.
Mudanças necessárias, todas testadas **sem rede**:

1. **Tirar `temperature`, `top_p` e `top_k`** do pedido (a documentação do Sonnet 5.5 diz que enviar qualquer um dá erro
   400; a do Haiku 5.5 manda omitir). O contrato comum do motor continua aceitando "temperatura", mas o adaptador da
   Anthropic a ignora (e um teste garante que ela nunca vai no corpo).
2. **Esforço** em `output_config.effort` (`low`/`medium`/`high`), vindo da configuração do agente. O pensamento do modelo
   fica no modo adaptativo padrão: **não** enviar `thinking: {type: "disabled"}` nem orçamento de pensamento (dão 400
   nesses modelos).
3. **Saída estruturada** dos documentos por `output_config.format` com o esquema JSON do catálogo (em vez de pedir JSON
   só no texto). O backend continua conferindo o documento.
4. **Sem "prefill"** (resposta começada pelo sistema) e **sem forçar ferramenta** (`tool_choice` `any`/`tool` dá 400).
5. **Recusa:** `stop_reason: "refusal"` → fim "recusada", guardando só a categoria (`stop_details.category`), nunca o
   texto. O modelo reserva automático do provedor ("fallbacks") só com aprovação do Igor.
6. **Fim cortado** (`max_tokens`) → "incompleta" (já existe); `pause_turn` e `tool_use` → "incompleta" (nesta fase não há
   ferramentas).
7. **Uso e custo:** somar `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` e `output_tokens`, cada
   um com o seu preço cadastrado; o pensamento do modelo é cobrado como saída.
8. **Cabeçalhos:** `x-api-key` (do segredo), `anthropic-version` fixado e testado; guardar o `request-id` da resposta no
   evento (ajuda o suporte), nunca a chave.
9. **Erros:** 400/401/403/404 → não repetir; 429 → repetir respeitando `retry-after`; 500/529 (sobrecarga) e queda de
   conexão → repetir com espera crescente (seção 6).
10. **Fluxo (streaming)** para respostas longas, montando a mensagem final só no fim.
11. **Cache de prompt:** blocos fixos (segurança, especialidade, permissões) primeiro, com `cache_control`.

Antes de escrever o código, conferir de novo a página oficial da API (nomes de campos e versão), porque a API muda.

## 6. Gastos, chamadas duplicadas, tentativas e interrupção

### 6.1 Limites de gasto (camadas)

| Camada | Proposta inicial (D2: US$ 10/mês) | Quem controla |
|---|---|---|
| Conta do provedor | limite mensal de **US$ 10** e alerta em 50% | Igor, no painel da Anthropic |
| Sistema — por mês | US$ 9 (folga de 10% para o arredondamento do provedor) | Super Admin (`custos.definirLimites`) |
| Sistema — por dia | US$ 0,50 | idem |
| Sistema — por tarefa | US$ 0,30 (passou → a tarefa para e pede decisão) | idem |
| Sistema — por agente/dia | US$ 0,20 (piloto: só o Roteirista) | idem |
| Sistema — por empresa/dia | US$ 0,30 | idem |
| Por chamada | teto de tokens de saída por agente (ex.: legenda 1.500; roteiro 4.000; plano 6.000) | configuração do agente |

- **Reserva antes da chamada:** reserva o custo máximo possível (entrada estimada + teto de saída, no preço cadastrado); sem preço cadastrado ou sem saldo, **não chama**. Depois devolve a sobra (já existe desde a 4B).
- **Avisos:** 50% e 80% do dia e do mês no painel "Esperando você".
- **Estimativa com os preços oficiais:** legenda no Haiku ≈ US$ 0,002; roteiro no Sonnet ≈ US$ 0,03 a 0,05;
  tarefa comum (Estrategista + 3 especialistas, Sonnet/Haiku, com pensamento) ≈ US$ 0,15 a 0,30 → **US$ 10 ≈ 30 a 60
  tarefas por mês**. No lote, cerca de metade.

### 6.2 Prevenção de chamadas duplicadas

1. **Crachá do executor** (já existe): só um worker trabalha numa tarefa.
2. **Acionamento de uso único** (já existe): o mesmo acionamento não roda duas vezes.
3. **Novo — registro "chamada em andamento"** com chave única `tarefa + etapa + tentativa`, gravado **antes** de chamar o
   provedor, na transação do crachá. Se já existir para aquela tentativa, não chama de novo.
4. **Se o worker cair depois de chamar e antes de registrar:** a reserva fica contada como gasto (conservador) e a etapa
   vai para "precisa de decisão" no painel; **não há nova chamada automática** para a mesma tentativa.
5. Lote: o identificador do pedido de lote é gravado antes do envio; o tique só busca resultado, nunca reenvia.

### 6.3 Tentativas automáticas

| Situação | Repete sozinho? | Como |
|---|---|---|
| 429 (limite do provedor) | sim, até 2 vezes | espera o `retry-after` (no máximo 60 s; mais que isso → volta para a fila com espera) |
| 500 / 529 / queda de conexão / tempo-limite | sim, até 2 vezes | espera 2 s e depois 8 s; cada tentativa com reserva própria |
| 400 / 401 / 403 / 404 | não | erro registrado; 401/403 desliga o provedor e avisa (chave errada ou revogada) |
| Recusa do modelo | não | etapa vai para decisão do Super Admin |
| Resposta fora do formato | sim, 1 revisão interna | já existe (até 2 revisões por execução) |
| Limite de gasto atingido | não | tarefa pausada; decisão do Super Admin |

No máximo **3 chamadas pagas por etapa** (1 + 2 repetições) e 2 revisões internas por execução.

### 6.4 Procedimentos de interrupção

| Nível | Ação | Efeito | Quem |
|---|---|---|---|
| 1 | agente em `uso: "simulado"` | aquele agente volta ao simulado | Super Admin (API) |
| 2 | provedor desligado em `labz_config/provedores` | nenhuma chamada àquele provedor | SQL de uma linha |
| 3 | interruptor do worker `{"ativo":false}` | nenhuma tarefa avança (a rodada em curso termina em até ~2 min) | SQL de uma linha |
| 4 | apagar a chave do provedor nos segredos | impossível chamar, mesmo com erro de código | Igor, no painel |
| 5 | revogar a chave no painel da Anthropic | corta na origem | Igor |
| 6 | religar o Verify JWT da `labz-api` | ninguém cria tarefa nova | Igor, no painel |

Tarefas em andamento podem ser encerradas com `execucoes.transicionar` → `CANCELLED`.

## 7. Memória real

1. **Separação por cliente:** cada empresa tem o seu escopo `cliente` (`labz_empresas/{id}`). O contexto de uma etapa só
   recebe as memórias **da empresa da tarefa** (mais global, agente e tarefa). O cursor de busca é preso à empresa
   (Fase 3E, F6). Empresa arquivada não monta contexto (F7). Um teste novo garante que o texto enviado ao provedor nunca
   contém memória de outra empresa.
2. **Global sem dados de cliente:** a trava da Global (nomes de empresas, e-mail, telefone, CPF/CNPJ, links e valores) continua.
3. **Aprovação:** o agente só **propõe** (rascunho); o Super Admin aprova, rejeita (com motivo) ou pede revisão.
   Duplicidade ou conflito com memória vigente **bloqueia** até a decisão (Fase 3B).
4. **Versões:** cada aprovação é uma versão nova, com `baseVersao`; rollback = versão nova; nada é apagado.
5. **O que vai para o provedor:** só as memórias **vigentes e aprovadas** do escopo permitido ao agente, delimitadas como
   dado (nunca como instrução), dentro do limite de tamanho do contexto. Rascunhos e rejeitadas nunca vão.
6. **D5 — dados pessoais:** antes da chamada, um filtro novo troca CPF, CNPJ de pessoa física, e-mail, telefone e
   endereço por marcas (`[e-mail removido]`) no briefing e nas memórias; o evento registra só quantos itens foram
   removidos. Só informação profissional autorizada segue.
7. **Retenção:** conferir a política de retenção de dados da Anthropic para a API na conta do Igor (R0).
8. **Busca por significado:** fora desta fase (precisaria de outra chamada paga e da extensão `pgvector`).

## 8. Testes (resumo)

- **Sem rede e sem custo, sempre:** todos os testes atuais + os novos do adaptador (respostas gravadas no formato oficial:
  sucesso, recusa, corte, 429 com `retry-after`, 529, 500, queda no meio do fluxo), do filtro D5, da separação por
  cliente, das tentativas, da chave única de chamada e dos limites.
- **Nenhuma chave em registro, evento, erro ou entrega** (teste de varredura).
- **Mutações** (ex.: tirar a reserva; aceitar `uso: "real"` com o provedor desligado; repetir depois de 400; mandar
  `temperature`).
- **Regressão do CRM/ERP** no navegador (37 páginas).

## 9. Avaliação de qualidade

Para cada agente, **10 briefings fictícios** (sem dados reais) com critérios escritos (seção 3). Cada resposta recebe:
(a) aprovação ou recusa dos critérios do sistema; (b) nota de 1 a 5 do Super Admin. **Aprovado** quando: 10 de 10 nos
critérios do sistema e média ≥ 4 do Super Admin, sem nenhuma nota 1. A comparação Haiku × Sonnet (e Sonnet × Opus) usa
os mesmos 10 briefings. O custo da avaliação entra no limite do dia.

## 10. Etapas R0–R8: critérios de aprovação e volta atrás

| Etapa | O que é | Aprovada quando (objetivo) | Volta atrás |
|---|---|---|---|
| **R0** | Igor cria a conta Anthropic, define o limite de US$ 10/mês e o alerta, confere a política de retenção; decisões D1–D6 finais | conta criada; limite e alerta visíveis no painel (foto sem dados sensíveis); decisões registradas | nada a desfazer |
| **R1** | Código: transporte real, adaptador corrigido (seção 5), interruptor por provedor, chave única de chamada, filtro D5, tentativas; **sem chave, sem rede** | todos os testes verdes no GitHub; testes novos da seção 8; mutações detectadas; nenhuma chamada de rede nos testes | reverter o commit (nada foi publicado) |
| **R2** | Merge + worker novo publicado com **tudo desligado**; preços oficiais e limites cadastrados; chave cadastrada pelo Igor | SHA-256 do worker publicado = repositório; tarefa simulada de teste conclui igual a antes; 0 chamadas ao provedor; interruptor do provedor desligado | publicar o worker anterior (zip guardado); apagar a chave |
| **R3** | Piloto: Roteirista real (Haiku/Sonnet), 1 tarefa da empresa de teste, limite de US$ 1 no dia | avaliação da seção 9 aprovada; custo registrado no sistema = custo do painel do provedor (diferença ≤ 5%); 0 chamadas duplicadas; nenhuma chave em registro; nenhum dado pessoal enviado | Roteirista em `simulado`; provedor desligado |
| **R4** | Agentes de texto: Carrosséis, Guia da Marca, Tráfego, Designer (documento), depois o Estrategista; **um por vez** | os mesmos critérios da R3 para cada agente; 1 semana sem passar do limite diário | o agente volta ao `simulado` |
| **R5** | Dev Web e Engenheiro (documentos com código) | critérios da R3; nenhum código executado; nenhuma chave ou endereço interno nas entregas | idem |
| **R6** | Imagens (caminho separado, seção 2.2) e segundo provedor; preços oficiais conferidos; avaliar o Grok | imagens só por briefing aprovado, guardadas privadas, 100% aprovadas antes de uso; limite de imagens respeitado | interruptor da fila de imagens; desligar o provedor |
| **R7** | Aprendizado com memórias em uso real | memórias propostas só em rascunho; nenhuma memória de uma empresa no contexto de outra (teste + amostra real) | rollback das memórias pelo próprio Memory Engine |
| **R8** | Auditoria, backup novo (D5), documentação e encerramento | backup cifrado conferido pelo Igor; relatório de custos e qualidade | — |

Toda etapa termina com: testes, relatório em português simples, conferência só de leitura da produção, e a autorização
do Igor para a seguinte.

## 11. Fora desta fase

Ações reais fora do sistema (publicar, anunciar, enviar mensagens, mexer no CRM/ERP, executar código); agendamento
automático de tarefas; acesso de outros usuários; plano pago do Supabase; modelo Fable.

## 12. Pendências antes de começar

1. **Backup pós-publicação da I4-B** (Igor) e o encerramento formal da I4-B.
2. Decisão do Igor sobre esta versão 2 do plano.
3. R0 (conta, limite e retenção) — só depois da autorização.
