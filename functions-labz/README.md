# LABZ AI — backend (Fase 1: Fundação)

Ferramenta exclusiva do Super Admin dentro do Eagles Labz. Esta pasta é a **base** do backend:
contratos, os 8 agentes, as ferramentas, o motor de memória (5 escopos), o cadastro de empresas
e a autorização do Super Admin. **Nada aqui está publicado** e não há funções do Firebase
exportadas ainda (isso é a Fase 2, que depende do plano Blaze).

> Este repositório é público e o GitHub Pages publica todos os arquivos. Por isso aqui só há
> **estrutura**: o conteúdo das skills, os prompts e as memórias ficam **privados no banco**
> (coleções `labz_*`), nunca em arquivos. Não há chaves nem segredos nesta pasta (há um teste que confere).

## Como rodar os testes
```
cd functions-labz
npm test            # Node 20+, sem instalar nada (não há dependências)
```
As regras do banco (`firestore.rules`, incluindo as coleções `labz_*` e a proteção do Super Admin)
são testadas em `testes-regras/` (simulador do Firebase, precisa de Java).

## Organização
```
functions-labz/
├── index.js                     criarLabz({ banco }) monta todos os serviços
├── src/
│   ├── nucleo/                  validador de esquemas, erros, ids, versionamento
│   ├── contratos/               agente, ferramenta, execução (9 estados), memória (5 escopos), empresa
│   ├── agentes/catalogo.js      os 8 agentes (responsabilidades, skills, ferramentas, permissões, qualidade)
│   ├── ferramentas/             registro das ferramentas + verificação de permissão
│   ├── auth/super-admin.js      2ª camada: role exato + lista de UIDs + conta não bloqueada
│   ├── armazenamento/           caminhos do Firestore + banco em memória (dublê dos testes)
│   ├── auditoria/eventos.js     trilha de auditoria (só acrescenta)
│   ├── empresas/servico.js      cadastro de empresas da LABZ AI (vínculo opcional com tenant/cliente do CRM)
│   ├── memoria/                 registro (versões, aprovação, rollback, arquivo), correções → aprendizados,
│   │                            Context Builder e auditor
│   └── skills/registro.js       conteúdo privado e versionado das skills; seleção por gatilho
└── test/                        testes automáticos (node:test)
```

## Onde cada dado mora (Firestore)
| Dado | Caminho |
|---|---|
| Lista de Super Admins autorizados (lida pelas regras) | `labz_config/acesso` → `{ uids: [...] }` |
| Empresas da LABZ AI | `labz_empresas/{empresaId}` |
| Vínculos únicos (tenant / cliente do CRM) | `labz_vinculos/{chave}` |
| Memória global | `labz_memoria_global/{id}` |
| Memória do agente | `labz_agentes/{agenteId}/memorias/{id}` |
| Memória da empresa | `labz_empresas/{empresaId}/memorias/{id}` |
| Memória de desempenho | `labz_empresas/{empresaId}/desempenho/{id}` |
| Memória da tarefa | `labz_tarefas/{tarefaId}/memorias/{id}` |
| Versões (memória e skill) | `.../{id}/versoes/{n}` |
| Skills (conteúdo privado) | `labz_skills/{agenteId}__{ARQUIVO}` |
| Correções e propostas de aprendizado | `labz_correcoes/{id}`, `labz_aprendizados/{id}` |
| Auditoria | `labz_eventos/{id}` |

Regras: só o Super Admin que está em `labz_config/acesso` **lê**; **ninguém grava pelo navegador**
(quem grava é o servidor, com o Admin SDK, depois de `exigirSuperAdmin`).

## O que falta (fases seguintes)
- Fase 2: adaptador do Firestore (Admin SDK) com a mesma interface do banco em memória, funções `onCall`,
  segredo `LABZ_SUPERADMIN_UIDS`, codebase `labz` no `firebase.json`. Depende do plano Blaze para publicar.
- Fase 3: classificação de correções sugerida por IA, índices e busca semântica.
- Fase 4: motor de orquestração (fila, estados, quality gate, custos).
- Fases 5–8: conteúdo das skills, provedores de IA, interface e integrações.
