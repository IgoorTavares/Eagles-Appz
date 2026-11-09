# Testes de várias pessoas ao mesmo tempo (v157)

Abre o sistema **de verdade** (o `script.js` do repositório) em vários navegadores, cada um logado como uma pessoa diferente, todos ligados ao **simulador** do Firebase (Firestore + login), com o `firestore.rules` real. Nada aqui fala com o Firebase de produção: o `firebase-config.js` é trocado, só nos testes, por um que aponta para `127.0.0.1`.

## Como rodar

Precisa de Node 20+, Java 21 e do Chromium do Playwright.

```bash
cd testes-concorrencia && npm ci && npx playwright install chromium && npm run simulador
```

No GitHub, rodam sozinhos a cada envio que mexe em `script.js`, `firestore.rules`, `crm.html` ou nesta pasta (`.github/workflows/concorrencia.yml`). Leva de 15 a 25 minutos.

## O que é conferido (`concorrencia.test.mjs`)

| # | Cenário | Como |
|---|---|---|
| 1 | **Antes (v155)**: a perda acontece | o `script.js` do commit `a340d03` |
| 2 | 2 pessoas no **CRM inteiro** (`crm.html`): anotações, contatos e links pelos botões reais | `crm.html` |
| 3 | **20, 30 e 50** pessoas ao mesmo tempo: anotações, contatos, links de clientes diferentes e do mesmo cliente (com grafias diferentes) | página leve |
| 4 | O valor inicial não apaga dado real (aparelho que abre sem internet e sem o documento) | v155 × v157 |
| 5 | Migração: completa, uma vez só, sem alterar a lista antiga; item excluído não volta | 20 pessoas abrindo juntas |
| 5b | Arquivos publicados **antes** das regras: nada é apagado nem sobrescrito | regras da v155 |
| 6 | **Convivência** v155 + v157 abertas juntas (anotações e links) | as duas versões |
| 7 | Sem internet e reconexão | navegador sem rede |
| 8 | Permissões (Financeiro só lê) e isolamento entre empresas | 2 empresas |
| 9 | Voltar atrás para a v155 sem perder nada | `ponteVoltarParaListaAntiga` |

**Página leve (`/__leve.html`, só nos testes).** O CRM inteiro abre cerca de 70 escutas do banco por aba. O simulador do Firebase roda num núcleo só e, com 20 abas assim, para de responder. Isso é um limite do simulador, não do Firebase de verdade. Para 20, 30 e 50 pessoas, a página leve carrega o **mesmo `script.js`**, faz o login real (`resolverTenantDoUsuario`) e chama as **mesmas funções de início** das partes testadas (`crmNegocioIniciarSubcolecoes` e `portalIniciarDados`). Os campos da tela de anotação e de contato têm os mesmos ids do `crm.html`.

**Endereços locais.** Cada navegador fala com o simulador por um endereço próprio (`127.0.0.12`, `127.0.0.13`...), porque o Chromium abre no máximo 6 conexões por endereço. Por isso o simulador escuta em `0.0.0.0` (`firebase.teste.json`), **só durante os testes**, e só com dados fictícios.

## Como as correções funcionam

**Anotações e contatos dos negócios.** Passaram para "um documento por item" (`CHAVES_COLECAO`: `crm_negocio_anotacoes` e `crm_negocio_contatos`), como os outros cadastros desde a v133.

**Migração ("ponte").** Vale só para as chaves em `CHAVES_COLECAO_PONTE`:
- a v157 lê a lista antiga (`dados/{chave}`) e copia para a coleção o que ainda não foi copiado;
- cada parte é uma transação que confere a lista de ids já copiados (`dados/{chave}_importados`), **não sobrescreve** item que já existe na coleção e anota os ids;
- um item excluído depois da cópia **não volta**;
- a lista antiga **nunca** é alterada nem apagada pela v157;
- se a cópia falhar (sem internet ou sem as regras novas), nada muda e ela tenta de novo mais tarde;
- enquanto não copia, a tela já mostra os itens antigos (nada some).

**Convivência com a v155.** Um aparelho ainda aberto com a v155 continua gravando a lista antiga; a v157 copia o que aparecer lá.
- O que a v155 **excluir** continua existindo na v157: é o lado seguro, nada some.
- A v155 não enxerga o que foi criado na v157 até recarregar.
- Entre dois aparelhos **antigos** ao mesmo tempo, a perda é a da própria v155. Por isso é importante pedir para todos recarregarem depois da publicação.

**Links do portal.**
- Cada cliente tem uma **reserva** própria (`dados/eagles_portal_links_v1__r_…`, onde as regras atuais já permitem gravar). Numa transação (`cloudTransacao`: novas tentativas com espera crescente, prazo de 45 s, desiste na hora sem internet), quem chega primeiro cria o código, e quem chega depois, com qualquer grafia (maiúsculas, acentos, espaços), recebe o **mesmo** código.
- O mapa de links recebe **só o campo daquele cliente**, sem ler o mapa inteiro. Por isso links de clientes diferentes criados juntos não se apagam nem disputam entre si.
- Links de antes da v157 (já no mapa) continuam valendo como estão.
- "Link novo" apaga primeiro o retrato público do código antigo e só troca se o código no banco ainda for o antigo.
- **Proteção na troca de versão** (`portalConferirPerdas`): a v157 lembra os links que viu. Se um aparelho antigo, com a lista desatualizada, apagar um link ou devolver um código já trocado, a v157 devolve o código certo: o da reserva; para links de antes da v157, o que continua publicado. Se o aparelho antigo usou "link novo" **de propósito** (o retrato público do código anterior foi apagado), a troca vale e a reserva passa a acompanhar o código novo. Se ele trocou um código que nem valia mais (lista desatualizada), o link vigente, ainda publicado, é mantido.

**Valor inicial.** `cloudCriarSeAusente` grava o valor inicial numa transação, **só se o documento continuar não existindo**. Sem internet, não grava nada.

**Backup.** As duas coleções novas entram no backup completo (`BKP_SUBCOLECOES`) e na contagem de uso (`USO_SUBS`).

## Voltar atrás (se for preciso voltar para a v155)

1. Com a v157 aberta, logado como Diretor ou Super Admin, rode no console do navegador:
   ```js
   await ponteVoltarParaListaAntiga('eagles_crm_negocio_anotacoes_v1')
   ```
   ```js
   await ponteVoltarParaListaAntiga('eagles_crm_negocio_contatos_v1')
   ```
   Isso grava na lista antiga tudo o que está na coleção, mais o que ainda não tinha sido copiado. A coleção e a lista de importados continuam.
2. Publique os arquivos da v155. As regras da v157 podem ficar: elas só **acrescentam** duas coleções.
3. Se depois voltar para a v157, o que a v155 excluiu nesse meio-tempo reaparece (lado seguro). Nada se perde.

## Auditoria das outras listas compartilhadas (sem mudança nesta versão)

As chaves abaixo continuam gravadas inteiras (`cloudSet` → `dados/{chave}`): quando duas pessoas salvam a **mesma** chave no mesmo instante, fica a gravação de quem salvou por último. A v157 só corrigiu o valor inicial delas.

| Risco | Chave | O que é | Por quê |
|---|---|---|---|
| **Médio** | `eagles_portal_clientes_v1` | ajustes do portal por cliente | a equipe ajusta clientes diferentes; dois ajustes juntos, um some |
| **Médio** | `eagles_atend_programadas_v1` | mensagens programadas do atendimento | várias pessoas programam no dia a dia |
| **Médio** | `eagles_ia_analista_v1`, `eagles_ia_analista_erp_v1`, `eagles_fin_ia_analista_v1`, `eagles_fin_ia_analista_erp_v1`, `eagles_ia_copy_v1`, `eagles_ia_design_v1` | históricos dos agentes de IA | cada uso acrescenta um item; dois usos juntos, um some do histórico |
| Baixo | `eagles_kanban_modelos_v1`, `eagles_conteudos_modelos_v1`, `eagles_crm_modelos_contrato_v1`, `eagles_erp_modelos_contrato_v1`, `eagles_crm_templates_briefing_v1`, `eagles_kanban_automacoes_v1` | modelos e automações | editados de vez em quando, quase sempre por uma pessoa |
| Baixo | `eagles_fin_categorias_v1`, `eagles_fin_caixas_v1`, `eagles_fin_pix_v1`, `eagles_fin_tributos_v1`, `eagles_fin_metas_v1`, `eagles_crm_metas_v1` | configuração do financeiro e metas | só quem vê o financeiro; raramente juntos (o saldo do caixa é calculado dos lançamentos, não gravado) |
| Baixo | `eagles_servicos_categorias_v1`, `eagles_planos_v1`, `eagles_planos_pagina_v1`, `eagles_pagina_publica_v1`, `eagles_paginas_extras_v1`, `eagles_integracao_pixels_v1` | serviços, planos e páginas públicas | configuração; uma pessoa por vez |
| Baixo | `eagles_kanban_config_v1`, `eagles_conteudos_config_v1`, `eagles_cfg_*`, `eagles_sistema_config_v1`, `eagles_ia_config_v1`, `eagles_emails_config_v1`, `eagles_atend_config_v1`, `eagles_crm_pagina_aprovacao_v1`, `eagles_perfil_operacao_v1`, `eagles_backup_meta_v1` | configurações | Diretor; raramente juntos |
| Nenhum | `eagles_perfil_empresa_v1` | dados da empresa | já grava só os campos alterados (`cloudSalvarCampos`, v154) |
| Nenhum | `eagles_fin_ciclos_v1` | ciclos do financeiro | já grava só o mês alterado (`merge`) |

**Recomendação para uma etapa futura** (precisa de autorização):
- `eagles_portal_clientes_v1`: gravar só o cliente alterado, com a mesma técnica dos links (sem mudar as regras);
- mensagens programadas e históricos de IA: passar para "um documento por item" (precisa mudar as regras).

**Outro risco conhecido, que já existia e não mudou:** um aparelho que abre **sem internet** e sem nada guardado de uma chave mostra o valor inicial. Se a pessoa salvar ali, essa gravação substitui a da nuvem quando a internet volta. As listas em `CHAVES_COLECAO` não têm esse problema.
