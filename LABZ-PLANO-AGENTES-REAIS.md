# LABZ AI — Plano da próxima fase: ativação dos 8 agentes de IA reais

> **Situação: PLANEJAMENTO para aprovação do Igor (09/11/2026). Nada deste plano está autorizado.**
> Nenhuma conta de provedor foi criada, nenhuma chave cadastrada, nenhum modelo pago chamado e nenhum código
> desta fase escrito. Cada etapa abaixo (R0 a R8) só começa com autorização própria.
> Pré-requisito: a I4-B encerrada (falta o backup pós-publicação).

## 1. Objetivo

Trocar o "modelo simulado" dos 8 agentes por modelos de IA de verdade (Claude, GPT e Gemini; Grok só como
previsão), **sem mudar o que já funciona**:

- o motor de execução, a fila, o worker e o crachá do executor (Fases 4A a 4C.2);
- as aprovações do Super Admin (planos, entregas e documentos sensíveis);
- o Memory Engine (Fases 3A a 3E): memórias com versões, aprovação e rollback;
- os limites de custo (Fase 4B: reserva antes da chamada, custo desconhecido nunca vira zero);
- a autenticação da v4 (Firebase + lista do Super Admin + conta ativa).

O que muda é só o **transporte**: hoje ele é "simulado" ou "bloqueado"; passa a existir um transporte
**real** (HTTPS até o provedor), ligado agente por agente, com limite de gasto.

## 2. Arquitetura

```
Tela do Super Admin ──► labz-api (Edge Function)          ──► banco labz (Postgres)
                         • nunca chama modelos                 • tarefas, fila, memórias,
                         • cria tarefas, aprova, consulta        entregas, consumo, eventos
                                                                    │
                         pg_cron (1/min) + gatilho da fila ─────────┘
                                   │ acionamento assinado (HMAC, 120 s, uso único)
                                   ▼
                         labz-worker (Edge Function)
                         • executa 1 etapa por vez (motor.trabalhar)
                         • monta o contexto pela porta de memória
                         • RESERVA o custo antes da chamada
                         • chama o provedor pelo transporte REAL  ──► Anthropic / OpenAI / Google
                         • confere a resposta (JSON, documento, qualidade)
                         • registra entrega + consumo real na transação do crachá
```

Decisões de arquitetura propostas:

1. **Só o worker chama modelos.** A `labz-api` nunca recebe as chaves dos provedores. As chaves ficam nos
   segredos das Edge Functions (`LABZ_ANTHROPIC_API_KEY`, `LABZ_OPENAI_API_KEY`, `LABZ_GOOGLE_API_KEY`; os
   nomes já existem em `src/segredos/provedores.js`), cadastradas pelo Igor no painel. Nenhum valor passa pelo
   chat nem pelo GitHub.
2. **Transporte real novo** (`functions-labz/src/ia/transporte.js`): `fetch` HTTPS só para os 3 endereços oficiais
   (lista fechada), `redirect: 'error'`, tempo-limite por chamada e cancelamento. Continua existindo o
   transporte bloqueado: é o padrão de qualquer agente sem autorização.
3. **Interruptores em 3 níveis:**
   - geral: o interruptor do worker (`labz_config/worker`), que já existe;
   - por provedor: `labz_config/provedores` (novo), por exemplo `{"anthropic": true, "openai": false}`;
   - por agente: `labz_agentes/{id}.configModelo.uso` = `"simulado"` ou `"real"` (hoje `"real"` é recusado
     de propósito; passa a ser aceito só com o provedor ligado e o limite cadastrado).
4. **Limites do plano grátis do Supabase:** cada chamada do worker tem até 150 s de relógio e 2 s de CPU
   (esperar o provedor não gasta CPU). Por isso:
   - 1 etapa por chamada do worker (já é assim);
   - tempo-limite de 120 s por chamada ao modelo e respostas em fluxo (streaming);
   - teto de tamanho de resposta por agente (o motor já pede para "dividir" projetos grandes);
   - modo econômico opcional: a API de lotes (Batch) da Anthropic e da OpenAI cobra cerca de 50% menos e
     responde em minutos; o tique de 1 minuto busca o resultado. Bom para tarefas sem pressa.
5. **Sem ferramentas que agem no mundo nesta fase.** Os agentes produzem **documentos** (o contrato
   "documento ≠ ação" da 4C.2 continua): nada de publicar post, mexer em anúncio, enviar e-mail ou alterar o
   CRM/ERP. Ações reais seriam outra fase, com outra autorização.

## 3. Modelos por agente (proposta)

Critério: o modelo mais capaz onde a qualidade decide (planejar, consolidar, código), um modelo médio para
textos do dia a dia, e o mais barato para conferências internas. Provedor principal proposto: **Anthropic
(Claude)**, porque o motor já fala o formato dela e um provedor só simplifica custo, cache e testes. GPT e
Gemini entram como **segunda opção** (reserva e comparação), e o Gemini é a opção para gerar imagens.

| Agente | Precisa de | Modelo principal (proposta) | Reserva |
|---|---|---|---|
| 08 Estrategista | planejar, saída estruturada, consolidar | Claude Opus 5.5 (esforço médio) | GPT-6.1 Sol |
| 01 Guia da Marca | texto, leitura de imagem, estrutura | Claude Sonnet 5.5 | Gemini (Pro) |
| 04 Roteirista | texto em português | Claude Sonnet 5.5 | GPT-6.1 Terra |
| 03 Carrosséis | texto curto, estrutura | Claude Sonnet 5.5 | Gemini Flash |
| 07 Tráfego | estrutura, números (só documento) | Claude Sonnet 5.5 | GPT-6.1 Terra |
| 05 Dev Web | código | Claude Sonnet 5.5 (Opus 5.5 nos grandes) | GPT-6.1 Sol |
| 06 Engenheiro | código, revisão técnica | Claude Opus 5.5 | GPT-6.1 Sol |
| 02 Designer | **gerar imagem** | Gemini (modelo de imagem) ou modelo de imagem da OpenAI | — |
| Conferências internas (qualidade, resumo) | rápido e barato | Claude Haiku 5.5 | Gemini Flash-Lite |
| Grok (xAI) | — | **só previsão**: avaliar na etapa R6; nenhum adaptador agora | — |

Observações técnicas (para a implementação):

- Os modelos Claude atuais **recusam `temperature`** (erro 400) e usam "pensamento adaptativo" com nível de
  esforço (`output_config.effort`). O adaptador atual (`functions-labz/src/ia/provedores/anthropic.js`, da Fase 4B) ainda
  envia `temperature`: **precisa ser atualizado antes de qualquer chamada real** (etapa R1).
- Tratar a recusa do modelo (`stop_reason: "refusal"`) como "recusada" (já existe no contrato) e, quando o
  Igor aprovar, usar o modelo reserva do próprio provedor.
- Cache de prompt: as partes fixas (segurança, especialidade, permissões) vão primeiro e com cache; leitura em
  cache custa cerca de 10% do preço normal.
- Os nomes e preços dos modelos de outros provedores **mudam com frequência**: conferir na página oficial de
  cada um no dia da ativação (ver a seção 5).
- O Designer depende de onde guardar imagens (Supabase Storage tem 1 GB no plano grátis): fica para a etapa
  R5, separado dos agentes de texto.

## 4. Memória dos agentes

O Memory Engine já existe e continua igual. Com modelos reais:

1. **Leitura:** cada etapa recebe o contexto montado pela porta de memória (10 blocos; só segurança,
   especialidade e permissões são "confiáveis"; tarefa, memórias e briefing vão **delimitados como dados**,
   nunca como instrução). Nada muda aqui.
2. **Aprendizado:** o agente só pode **propor** memória (nasce em rascunho). Quem aprova é sempre o Super
   Admin. As travas da Global (nomes de clientes, e-mail, telefone, CPF/CNPJ, links e valores bloqueiam)
   continuam.
3. **Correções do Super Admin** viram propostas de aprendizado (já existe).
4. **Busca por significado (opcional, etapa R7):** hoje a busca é por termos. Uma busca semântica precisaria
   de "embeddings" (outro tipo de chamada paga) e da extensão `pgvector` no Supabase. Só se a busca por termos
   mostrar limites na prática.
5. **Proteção contra "prompt injection":** briefing e memórias nunca viram instrução; a saída é conferida
   pelo backend (formato, documento do catálogo, agente permitido) antes de virar entrega.

## 5. Custos estimados

**Preços de referência** (por milhão de tokens; 1 milhão de tokens ≈ 750 mil palavras). Os preços da
Anthropic são os da tabela oficial que eu conheço (out/2026). Os da OpenAI, Google e xAI vêm de sites que
comparam preços (nov/2026), **não das páginas oficiais**, e os sites discordam entre si. Tudo precisa ser
conferido na página oficial e cadastrado pelo Super Admin (`custos.definirPreco`) antes de ligar.

| Provedor | Modelo | Entrada | Saída |
|---|---|---|---|
| Anthropic | Claude Opus 5.5 | US$ 4 | US$ 20 |
| Anthropic | Claude Sonnet 5.5 | US$ 2 | US$ 10 |
| Anthropic | Claude Haiku 5.5 | US$ 0,10 | US$ 0,50 |
| OpenAI (a confirmar) | GPT-6 Astra / GPT-6.1 Sol / GPT-6.1 Terra / GPT-6 Luna | ~US$ 10 / 2 / 1 / 0,10 | ~US$ 50 / 10 / 5 / 0,50 |
| Google (a confirmar) | Gemini 4 Argon / 3.8 Flash / 3.1 Flash-Lite | ~US$ 2–4 / 0,75 / 0,25 | ~US$ 10–20 / 3,75 / 1,50 |
| xAI (a confirmar) | Grok 4.7 | ~US$ 2 | ~US$ 6 |

**Estimativa por tarefa** (planejamento + 3 etapas de especialistas + consolidação, uma revisão interna):

| Peça | Tokens (aprox.) | Custo (Claude) |
|---|---|---|
| Estrategista (planejar + consolidar), Opus 5.5 | 16 mil de entrada + 6 mil de saída | ~US$ 0,18 |
| 3 especialistas, Sonnet 5.5 | 24 mil de entrada + 8 mil de saída | ~US$ 0,13 |
| Pensamento do modelo (cobrado como saída) | +50% a +100% da saída | ~US$ 0,10 a 0,20 |
| **Total por tarefa** | | **~US$ 0,40 a 0,60** (com revisões, até ~US$ 1,20) |

Comparação: as 2 tarefas simuladas de hoje usaram ~15,7 mil tokens em 11 chamadas; com modelos reais, as
respostas tendem a ser maiores.

**Por mês:** 50 tarefas ≈ US$ 20 a 60; 200 tarefas ≈ US$ 80 a 240. No modo econômico (lotes), cerca de metade.
A conversão para reais depende do câmbio do dia.

**Proteções de custo** (as 3 primeiras já existem desde a Fase 4B):
1. Limites diários global, por agente, por empresa e por provedor, com **reserva antes da chamada**.
2. Custo desconhecido nunca vira zero; sem preço cadastrado, a chamada é recusada.
3. Teto de tokens de saída por agente.
4. **Novo:** limite de gasto na própria conta de cada provedor (painel do provedor), como segunda trava;
   proposta inicial: US$ 10/mês no piloto.
5. **Novo:** aviso ao Super Admin quando o dia passar de 50% e de 80% do limite.

## 6. Segurança

| Risco | Proteção |
|---|---|
| Vazamento das chaves dos provedores | só nos segredos do worker; nunca na `labz-api`, no banco, no navegador, no chat ou no GitHub; filtro de credenciais nos registros (já existe) |
| Gasto descontrolado (erro ou abuso) | limites diários com reserva; limite na conta do provedor; interruptores por provedor e por agente; só o Super Admin cria tarefas (60/min e 20 tarefas/h por UID) |
| Prompt injection pelo briefing ou por memórias | dados delimitados, nunca instrução; saída conferida pelo backend; documento ≠ ação (nenhuma ação externa) |
| Dados de clientes enviados aos provedores (LGPD) | **decisão do Igor (D5)**: o que pode ir no briefing; proposta: só o necessário, sem CPF/CNPJ, e-mail ou telefone; conferir a política de retenção de dados de cada provedor |
| Resposta cortada, recusada ou fora do formato | já tratado no contrato (incompleta, recusada, JSON inválido → nova tentativa ou revisão) |
| Provedor fora do ar | tempo-limite, novas tentativas com espera, desistência registrada; reserva de outro provedor só com aprovação |
| Agente executando duas vezes | crachá do executor e consumo de acionamento único (já existe) |

Emergência (vale desde o primeiro dia): desligar o interruptor do worker (`{"ativo":false}`), desligar o
provedor em `labz_config/provedores` ou religar o Verify JWT da `labz-api`.

## 7. Testes

1. **Sem rede, sem custo (sempre):** os testes atuais (377 + PostgreSQL + Deno + interface) continuam
   passando; testes novos do adaptador atualizado com respostas gravadas no formato oficial de cada
   provedor (sucesso, recusa, corte, erro 429/500, fluxo/streaming); teste que garante que nenhuma chave
   aparece em registro, evento ou erro.
2. **Testes de custo:** reserva antes da chamada, devolução depois, recusa sem preço cadastrado, limite
   atingido no meio da tarefa.
3. **Mutações:** como nas fases anteriores (ex.: tirar a reserva, aceitar `uso: "real"` sem provedor ligado).
4. **Piloto real controlado (só com autorização):** 1 agente, 1 tarefa, empresa de teste, limite de US$ 1 no
   dia; conferir resposta, consumo registrado e consumo no painel do provedor.
5. **Avaliação de qualidade:** 10 briefings de exemplo por agente (fictícios), com critérios escritos (tom,
   estrutura, português, aderência à marca), notas do Super Admin; repetir ao trocar de modelo.
6. **Regressão do CRM/ERP:** as 37 páginas no navegador, como na I1–I3.

## 8. Etapas propostas (cada uma com autorização própria)

| Etapa | O que é | Custo com modelos | Produção |
|---|---|---|---|
| **R0** | Decisões do Igor (D1–D6); o Igor cria a conta no provedor e define o limite de gasto lá | nenhum | nada muda |
| **R1** | Transporte real + adaptador Claude atualizado (sem `temperature`, esforço, recusa, fluxo) + interruptor por provedor + testes sem rede | nenhum | nada muda |
| **R2** | Preços e limites cadastrados; chave cadastrada pelo Igor; nova versão do worker com tudo **desligado** | nenhum | worker novo, desligado |
| **R3** | **Piloto:** 1 agente real (proposta: Roteirista), 1 tarefa de teste, limite de US$ 1/dia | centavos | 1 agente ligado |
| **R4** | Estrategista real + especialistas de texto (Guia da Marca, Carrosséis, Tráfego), um de cada vez | baixo, limitado | agentes ligados aos poucos |
| **R5** | Dev Web e Engenheiro (código) | baixo, limitado | idem |
| **R6** | Designer (imagens) + armazenamento; segundo provedor (GPT ou Gemini) como reserva; avaliar o Grok | a definir | idem |
| **R7** | Aprendizado com memórias em uso real; busca semântica só se necessária | a definir | idem |
| **R8** | Auditoria, backup, documentação e encerramento | nenhum | — |

Cada etapa termina com testes, relatório e conferência só de leitura da produção. Volta atrás em qualquer
ponto: desligar o agente (`uso: "simulado"`), o provedor ou o worker; publicar a versão anterior do worker.

## 9. Decisões do Igor (antes da R1)

- **D1 — provedor principal:** proposta: Anthropic (Claude), com GPT e Gemini como reserva.
- **D2 — orçamento:** proposta: US$ 10/mês no piloto (R3–R4), depois rever com os números reais.
- **D3 — agente piloto:** proposta: Roteirista (só texto, sem imagem nem código, fácil de avaliar).
- **D4 — contas e pagamento:** a conta do provedor fica no nome de quem? (o Igor cria e cadastra o cartão;
  nada disso passa pelo chat).
- **D5 — dados de clientes:** o que pode ir para o provedor no briefing (proposta: nada de dado pessoal).
- **D6 — modo econômico (lotes):** usar para tarefas sem pressa? (cerca de metade do preço, resposta em minutos).

## 10. O que fica de fora desta fase

- Ações reais fora do sistema (publicar, anunciar, enviar mensagens, mexer no CRM/ERP).
- Agendamento automático de tarefas sem pedido do Super Admin.
- Acesso de outros usuários à LABZ AI (continua só o Super Admin).
- Plano pago do Supabase (só se os limites do grátis apertarem; decisão do Igor).
