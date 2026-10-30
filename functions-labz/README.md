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
│   ├── contratos/               agente, ferramenta, execução (9 estados), memória (5 escopos), empresa
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

## O que falta (fases seguintes)
- Fase 3: classificação de correções sugerida por IA, índices e busca semântica.
- Fase 4: motor de orquestração (trabalhador da fila, planner, quality gate, custos).
- Fases 5–8: conteúdo das skills, provedores de IA, interface e integrações.
