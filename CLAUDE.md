# Eagles Labz — ERP + CRM (white label)

Documento de passagem para o Claude Code. Versão publicada: **v154 — Estabilidade e correções funcionais** (cache `eagles-cache-v154` no `sw.js`), integrada na `main` pelo merge `0f3d208` (PR 9) e publicada no GitHub Pages em 23/10/2026.
Próxima etapa: ainda não definida. Cada nova etapa (planejamento, implementação, commit, push, merge e publicação) depende de autorização explícita do Igor.
A v142 foi uma entrega externa, fora deste repositório (ver item 10).
O dono do projeto (Igor) **não é programador**: explique tudo em português simples, sem jargão, e diga
sempre o que ele precisa fazer (subir arquivos, publicar regras, testar algo).

---

## 1. O que é
- Sistema de gestão vendido para **clientes selecionados** (sem página de vendas, sem cobrança automática).
  O super administrador cria a empresa e libera ou suspende o acesso (tela **Empresas** → Suspender/Reativar).
- Três planos por empresa (`tenants/{id}.plano`): **`erp`**, **`crm`** e **`ambos`**. O menu e as telas mudam conforme o plano.
- Uso principal hoje: agência de marketing (o próprio Igor e clientes dele como Seven, Caniballs etc.).
- Domínio: **eagleslabz.com.br** (GitHub Pages, repositório `Eagles-Appz`, público; ver item 11).

## 2. Tecnologia
- **HTML, CSS e JavaScript puro**, sem framework e sem etapa de build. Tudo roda no navegador.
- **Firebase** (projeto `labz-18246`): Auth (e-mail e senha) + Firestore, com o **SDK compat v10.12.2** carregado por `<script>` do gstatic.
- Bibliotecas por CDN: **Chart.js 4.4.4**, **jsPDF 2.5.1** e html2canvas.
- **PWA**: `manifest.json` + `sw.js`. O service worker guarda em cache pelo nome `CACHE_NAME` → **a cada entrega, suba o número**.
- **Servidor** (`functions/`, Cloud Functions Node): está pronto, mas **ainda não está ligado** (precisa do plano Blaze).
  Funções: `rotinaDiaria` (e-mails de cobrança e o resumo dos Diretores), `boasVindas`, `aoResponderAprovacao` e as da Meta
  (`metaUrlConexao`, `metaOAuthCallback`, `metaSelecionar`, `metaDesconectar`, `metaAtualizarAgora`, `metaSincronizarDiario`, `metaPublicarAgendados`).
  Os guias de instalação estão em `functions/README-INSTALACAO.md` e `functions/README-META.md`.

## 3. Arquivos
- `script.js` (~28 mil linhas): **toda** a lógica do sistema, compartilhada por todas as páginas.
- `style.css` (~5,5 mil linhas): todo o visual. As variáveis do tema ficam no `:root` e no `[data-theme="dark"]`; a cor de destaque é `--blue-strong`.
- Páginas internas (exigem login): `index.html` (Painel), `meu-negocio.html`, `clientes-fornecedores.html`, `produtos.html`,
  `vendedores.html`, `funcionarios.html`, `pedidos-venda.html`, `contratos.html`, `objetos-postagem.html`, `estoque.html`,
  `lancamentos-estoque.html`, `conferencia-estoque.html`, `pedido-compras.html`, `notas-fiscais-entrada.html`, `financeiro.html`,
  `crm.html` (o CRM inteiro, em seções), `funil-vendas.html`, `tarefas.html`, `configuracoes.html`, `usuarios.html`,
  `meu-perfil.html`, `empresas.html` (só o Super Admin), `central-ajuda.html`.
- Páginas públicas (sem login): `login.html`, `portal.html` (portal do cliente), `aprovacao.html` (aprovação avulsa),
  `pagina.html` (Link da Bio, formulários, captura e agendamento), `proposta.html`, `briefing.html`, `planos.html`, `site.html`,
  `privacidade.html`, `termos.html`, `dpa.html` (acordo LGPD) e `suporte.html`.
- `firestore.rules`: as regras do banco (**é aqui que mora a segurança**). `firestore.indexes.json` e `firebase.json` completam a configuração do Firebase.
- `testes-regras/`: 26 testes das regras (19 originais + 7 da LABZ AI Fase 1), rodando no simulador do Firebase. `.github/workflows/regras.yml` roda esses testes no GitHub a cada envio.
- `functions-labz/`: backend da **LABZ AI** (Fase 1, fundação; ainda não publicado, sem dependências). Testes com `cd functions-labz && npm test`; `.github/workflows/labz.yml` roda no GitHub. Ver o `README.md` da pasta.
- `firebase-config.js`: a configuração pública do Firebase (a apiKey do Firebase é pública por natureza; não é segredo).

## 4. Como os dados são guardados
- Tudo de uma empresa fica em **`tenants/{tenantId}/...`**. O usuário fica em `usuarios/{uid}` (com `tenantId`, `role` e `nome`).
- Camada de acesso no `script.js`: **`cloudWatch(chave, padrão, callback)`**, **`cloudSet(chave, valor)`** e **`cloudGetForce(chave)`**.
  - Chave comum → documento `tenants/{id}/dados/{chave}` com o campo `valor`.
  - Chaves listadas em **`CHAVES_COLECAO`** → **um documento por item** numa subcoleção, com gravação só do que mudou e migração automática da lista antiga.
    São elas: os cadastros do ERP (`erp_produtos`, `erp_pedidos_venda`, `erp_clientes_fornecedores`, `erp_contratos`, `erp_pedido_compras`,
    `erp_notas_entrada`, `erp_mov_estoque`, `erp_vendedores`, `erp_funcionarios`, `erp_objetos_postagem`, `erp_conferencia_estoque`)
    e as listas do CRM (`crm_clientes`, `crm_negocios`, `crm_contratos`, `crm_servicos`, `crm_tarefas_dia`, `crm_lembretes`).
- Outras subcoleções da empresa: `kanban_tarefas`, `kanban_projetos`, `fin_lancamentos`, `fin_recorrencias`, `fin_meta`, `conteudos`,
  `agenda`, `portal`, `portal_pedidos`, `vagas`, `meta_agendados`. A conexão da Meta fica em `meta_privado/conexao` (só o servidor lê).
- Coleções públicas (lidas pelas páginas sem login, sempre por um código/token): `propostas_publicas`, `briefings_publicos`,
  `planos_publicos`, `paginas_publicas`, `leads_publicos`, `conteudos_publicos` (a peça para aprovar e a resposta do cliente),
  `portais_publicos` (o retrato do portal de cada cliente), `portal_pedidos_publicos`, `pix_publico`, `agendamentos_publicos`.
- Outras: `erros_app` (o monitoramento de erros, sem dados de cliente) e `tentativas_login/{email}` (o contador de senhas erradas).
- **Modo local** (sem Firebase): os dados ficam no `localStorage` com o prefixo `sem-empresa::`; na nuvem, com o prefixo `{tenantId}::`. Funções úteis: `chaveLocalTenant`, `lsLoad` e `lsSave`.
- `isoHoje()` usa a data **local** (não UTC). Para datas, use sempre `kbIsoLocal` e `isoHoje`, nunca `toISOString()`.

## 5. Níveis de acesso
- `SuperAdmin` (Igor): todas as empresas e a tela Empresas.
- `Diretor`: tudo da própria empresa, inclusive as configurações da empresa.
- `Administrativo`: opera o ERP e o CRM, mas **não vê o caixa** nem as configurações da empresa.
- `Financeiro`: vê o financeiro e o resto, mas **não altera** o operacional.
- `Cliente`: login antigo do portal (hoje o portal abre por link, sem login).
- No JS: `nivelUsuario()`, `nivelPodeOperar()`, `nivelVeFinanceiro()`, `nivelEhDiretor()` e `exigirPodeOperar()`.
- Nas regras: `souMembroAtivo()` (que inclui `empresaAtiva()` e `contaLivre()`), `podeOperar()`, `veFinanceiro()`, `souDiretor()` e `souSuperAdmin()`.

## 6. Módulos e como funcionam
- **Financeiro**: contas a receber e a pagar (`fin_lancamentos`) e recorrências (`fin_recorrencias`).
  - Regra da recorrência (`finAteRecorrencia`): ao criar, aparecem o mês do primeiro vencimento e o seguinte. Pagou ou recebeu → o mês seguinte aparece na hora. Chegou o vencimento sem pagar → aparece também.
  - "Não recebi" pausa a recorrência; ao reativar, os meses parados não são criados.
  - As categorias fixas `fix-pagamentos` e `fix-adiantamentos` alimentam os cartões do painel e não podem ser renomeadas nem excluídas.
  - Há também importação de OFX, PIX e o fluxo de caixa.
- **Kanban** (`KB_*`): colunas globais e colunas próprias por projeto.
  - `kbColunaNoQuadro` e `kbColunaEquivalente` mostram as tarefas de um projeto na coluna equivalente do quadro geral (por nome e sinônimos).
  - `kbStatusParaTarefa` traduz o arrastar no quadro geral.
  - No computador, o quadro tem altura de tela, para a barra de rolar para o lado ficar à vista.
- **Produção de Conteúdo** (projeto `PRD_PJ_ID = 'pj_producao_conteudo'`, com as colunas `prd_afazer`, `prd_producao`, `prd_aprovacao`, `prd_alteracao`, `prd_copy` e `prd_entregue`):
  - Fluxo: Planejamento → "Aprovar e mandar ao Kanban" (A fazer) → **Iniciar** (Design) → **Concluir e mandar para aprovação** → o cliente aprova (Copy → **Concluir copy e publicar** = Publicado) ou pede alteração (Alteração/Revisão → **Concluir alteração** → volta para a aprovação).
  - Funções: `prdIniciar`, `prdAvancar`, `prdBotaoCartao`, `prdAoMoverCartao`, `prdSincronizar`, `prdReconciliarTodos` e `prdConsertarColunas` (conserta cartões presos numa coluna do quadro geral).
  - O projeto só é criado por ação do usuário (`prdGarantirProjeto`): **nunca recrie um projeto apagado** automaticamente (foi um bug).
- **Conteúdos** (`CNT_*`): as colunas padrão são Planejamento, Design, Aprovação, Revisão, Copy e Publicado (`CNT_COLUNAS_PADRAO`).
- **Aprovação do cliente**:
  - `cntEnviarAprovacao` cria `conteudos_publicos/{token}` e manda **o link do portal do cliente abrindo na peça** (`portal.html?p=TOKEN&c=ID`). Sem cliente preenchido, vai a página avulsa `aprovacao.html`, que tem o mesmo visual do portal.
  - O cliente responde gravando `resposta`/`comentario` no `conteudos_publicos`. As regras só deixam responder uma vez por rodada.
  - **Não há servidor ligado**: quem processa as respostas é o **CRM aberto** em algum aparelho da equipe (`aprProcessar`). Fora do CRM, `aprVigiaGlobal` só mostra o aviso.
  - Avisos: "Obaaa! Cliente aprovou 🎉" e "ATENÇÃO: … pediu alterações". As opções `forcar` e `fixo` do `notifRegistrar` fazem o aviso aparecer mesmo quando a resposta chegou antes de abrir a tela.
- **Portal do cliente** (`pc*` no JS; `pv-*` no CSS):
  - `portalPublicarCliente(nome)` grava o retrato em `portais_publicos/{token}`; os tokens ficam na chave `eagles_portal_links_v1`.
  - Os nomes de cliente são comparados com `portalNomeIgual` e `portalChave` (sem diferença de maiúsculas, acentos e espaços).
  - A aparência fica em Configurações → Aparência → Portal (`abrirCfgPortalCliente`); as abas e permissões, em CRM → Portal do cliente → Aparência e padrões.
- **Tarefas diárias** (`CRM_TAREFAS_KEY`): "Não repete" cria também o cartão no Kanban (`kbId`); "É conteúdo" cria o conteúdo (`cntId`).
  A sincronização é feita por `tdSincronizarComKanban`. No Dashboard, as tarefas atrasadas e de hoje têm o ✓ e abrem a tarefa (`dshLinha`, `dshAcaoTarefaDia`).
- **Escalas de plantão** (Funcionários): `escPlantoes`, `escAbrir`, e o PDF e a mensagem de WhatsApp da escala.
- **Imagens**: `linkImagemDireto` converte os links do Google Drive e do Dropbox. `urlImagemSegura` valida as imagens e `urlSegura` bloqueia os links `javascript:` e `data:`.
  Se uma imagem do Drive não abrir, o sistema tenta outros endereços e depois mostra o aviso "Abrir a arte". **O arquivo precisa estar como "Qualquer pessoa com o link"**.
- **Segurança de login**: 5 senhas erradas seguidas bloqueiam a conta (`tentativas_login/{email}`, que só aceita somar 1; regra `contaLivre`).
  O Super Admin desbloqueia em Empresas → Contas bloqueadas (`loginAbrirBloqueadas`). Ao sair (`logout`/`logoutLimparAparelho`), o sistema apaga os dados da empresa do navegador, mas **mantém as preferências** (tema etc.).
- **Tema**: `salvarAparenciaSistema` guarda no `localStorage` (`eagles_aparencia_sistema_v1`). A v142 externa também guardava em `usuarios/{uid}.aparencia` e aplicava ao entrar (`aplicarAparenciaDoCadastro`), mas **esse código não está neste repositório** (nem na v143).
  - v154: ao sair, `logoutLimparAparelho` mantém `eagles_aparencia_` (só preferências do aparelho; os dados da empresa continuam sendo apagados). `definirTema` (botões Claro/Escuro): clicar no modo atual não muda nada; trocar de modo vai para o último tema usado naquele modo (`ultimoClaro`/`ultimoEscuro` na preferência) ou o padrão. A aba Tema do Meu Perfil é um atalho para `configuracoes.html#aparencia-sistema`.
- **Assistente (robozinho)**: `CHATBOT_FAQ` + `CHATBOT_KB`, com a função `chatbotResponder`. As novidades das versões ficam em `CFG_CHANGELOG` (Configurações → Atualizações).

## 7. Regras de entrega (o ritual)
1. Suba o número do `CACHE_NAME` no `sw.js` (v143 → v144...).
2. Escreva a mudança em **`CFG_CHANGELOG`** (no topo da lista) e, se fizer sentido, no Assistente.
3. Teste antes de entregar (ver item 8).
4. **Mudou o `firestore.rules`?** Avise o Igor: **primeiro publicar as regras no console do Firebase, depois subir os arquivos**. Se ele subir os arquivos antes das regras, as telas novas ficam sem permissão.
5. Entregue o projeto inteiro em zip, sem arquivos de teste (`_t_*.html`, `_a*_*.html`, `_x_*.html`) e sem `node_modules`. Guarde a versão anterior como `eagles-labz-vNNN.zip`.
6. Explique o que mudou em português simples, com o que o Igor precisa fazer.

## 8. Testes
- **Incluídos no zip:** `testes-regras/` (`cd testes-regras && npm install && npm run simulador`, precisa de Java; também rodam sozinhos no GitHub Actions) e `functions/teste.js` (testa o servidor com tudo simulado).
- **NÃO incluídos:** durante o desenvolvimento usei cerca de 30 suítes de Playwright (navegador) e jsdom, num ambiente de rascunho fora do projeto. Como funcionavam:
  - cópias das páginas com o Firebase trocado por um falso (ou em modo local, `sem-empresa::`), abertas com `file://` e com o Chart.js e o jsPDF carregados de `node_modules`;
  - um banco Firestore falso em memória (com `onSnapshot` ao vivo), para simular dois aparelhos salvando ao mesmo tempo;
  - uma varredura que abre todas as páginas nos 3 planos (erp, crm e ambos) procurando erros de JavaScript e rolagem para o lado no celular;
  - uma varredura de XSS, que coloca código malicioso em todos os campos e abre todas as telas.
  
  Se for mexer em algo grande, **vale recriar uma base de testes** (Playwright) no repositório.

## 9. Decisões já tomadas (não desfazer sem o Igor pedir)
- **Home Care foi descartado**: não reintroduzir pacientes, PAD e afins. As **escalas de plantão** continuam, porque servem a qualquer empresa.
- A **página de vendas e a assinatura automática foram removidas** (v122). O acesso é manual, pelo Super Admin.
- O link de aprovação **é o portal do cliente** (v135).
- O quadro "Produção de Conteúdo" continua sendo um projeto do Kanban (o Igor escolheu deixar assim).
- **Há uma versão de animações guardada à parte** (`eagles-labz-v142-animacoes.zip`, baseada na v141): aparecer ao rolar, brilho nas caixinhas com a cor do tema, gráficos crescendo, mídia em tela cheia no portal e um Assistente novo com cerca de 70 respostas e botão "Abrir essa tela". **O Igor pediu para ignorá-la por enquanto**; partes dela podem ser reaproveitadas se ele pedir.

## 10. Histórico recente
- v124: escalas de plantão.
- v125: tarefa do "+" vira cartão no Kanban.
- v126: fluxo novo do conteúdo.
- v127: avisos de aprovação e a recorrência que avança ao receber.
- v128: portal do cliente refeito.
- v129: ícone gigante nas Configurações.
- v130: celular (Kanban, sino e lista do portal).
- v131: ✓ nas tarefas do Dashboard e links do Drive.
- v132: projeto excluído que voltava.
- v133: listas do CRM em um documento por item e testes das regras.
- v134: botão do cartão de conteúdo.
- v135: aprovação pelo portal e arte no Kanban.
- v136: nome do cliente no portal.
- v137: altura do Kanban e colunas equivalentes.
- v138: conserto dos cartões presos.
- v139: ícone de link e página avulsa com o visual do portal.
- v140: auditoria de segurança (bloqueio de login, limpeza ao sair, links perigosos, proteção contra abertura dentro de outro site).
- v141: fallback das imagens do Drive.
- v142 (entrega externa, fora deste repositório): o tema não ficava salvo ao sair (passou a ficar também no cadastro). O código dessa correção **não está** no GitHub nem na v143.
- v143: Etapa A do acabamento visual, feita sobre a v141: contraste de botões, valores e etiquetas em todos os temas (texto claro ou escuro escolhido automaticamente sobre a cor de destaque), espaçamento dos formulários e botão desabilitado.
- v144 (publicada em 20/10/2026, merge `22f638c`): Etapa B0 e piloto do Painel (`index.html`) no estilo "Mesa de operação": blocos por pergunta, Resultado do mês em destaque, regras novas só dentro de `.pg-painel`, texto da receita corrigido e títulos do Tutorial alinhados. Nenhum cálculo mudou.
- v145 (publicada em 20/10/2026, merge `f743681`): Meu Negócio na "Mesa de Operação Premium": indicadores em faixa, painéis de uma camada, tabelas que cabem no celular e gráficos nas cores do tema (`mnPaleta`, `mnOpcoesGrafico`). Regras novas só dentro de `.pg-mn`. Os Relatórios dentro do Meu Negócio usam o mesmo código do Financeiro; o estilo do tema só entra lá (`mnRelatorioNoTema`), e as cores das categorias escolhidas pelo usuário são mantidas. "Estoque baixo"/"Sem estoque" só ficam vermelhos acima de zero. Nenhum cálculo mudou.
- v146 (publicada em 20/10/2026, merge `6ef7af9`): Financeiro (`financeiro.html`) na "Mesa de Operação Premium", com regras só dentro de `.pg-fin` (o Financeiro do CRM não muda). Venda Rápida como ação principal, Lançar Despesa secundária com o ícone vermelho, abas com sublinhado, indicadores em faixa com o Lucro do período em destaque, vencidos em faixas neutras com borda lateral, entradas em verde e saídas neutras com o sinal de menos, categorias com ponto na cor do usuário (`--srv-cor`), transações em lista no celular e telas estreitas (320px e zoom de 200%) sem rolar para o lado. Fluxo de caixa e Relatórios com as cores do tema (`finGraficosNoTema`, que vale para `.pg-mn` e `.pg-fin`). Nenhum cálculo mudou.
- v147 (publicada em 21/10/2026, PR 5, merge `83d9206`): Dashboard do CRM (`crm.html`, seção `#crm-secao-dashboard`) na "Mesa de Operação Premium", com regras só dentro de `.pg-crmdash` (as outras seções do CRM não mudam). Indicadores em faixa (rótulo, valor e "Recebido" separado, em `renderCrmDashTopo`), painéis de uma camada, rótulos sem maiúsculas em Entregas, gráfico da Análise financeira nas cores do tema (`renderCrmDashChartFinanceiro` com `mnPaleta`/`mnLinha`: total na cor de destaque, BRL em tinta, USD pontilhado, despesas tracejadas, legenda com o traço). Vermelho só para atraso, alerta e vencimento; cores das etapas do funil mantidas. Em 375, 320 e 188px o que não cabe desce para a linha de baixo; valores em R$ nunca quebram (a letra se ajusta ao cartão, `cdValorLongo` a partir de 1 milhão). A linha principal do gráfico tem contraste mínimo de 3:1 com o fundo realmente desenhado (`cdFundoEfetivo`, `cdCorComContraste`); a área preenchida continua na cor do tema. Nenhum cálculo mudou.
- v148 (publicada e validada em produção em 21/10/2026, PR 6, merge `6bd82ca19d4549544b1bb0586f196d9d8838fb0f`, cache `eagles-cache-v148`): Cadastros do ERP na "Mesa de Operação Premium", nas 8 páginas do motor comum (Produtos, Vendedores, Funcionários, Contratos, Pedido de compras, Notas fiscais de entrada, Objetos de postagem e Lançamentos de estoque), com regras só dentro de `.pg-cad` (Pedidos de venda, Clientes e Fornecedores, Estoque e Inventário não mudam). `renderCadastroTabela` escreve `data-label` em cada célula (no celular a tabela vira lista) e `cad-num` nas colunas marcadas com `num: true`; a situação usa `cadSituacao` (tom ok/alerta/erro/neutro, sem mudar o valor gravado). A busca de Produtos volta a aparecer no celular; as janelas de Novo/Editar ficam acima da barra de baixo e os botões flutuantes somem com uma janela aberta. Textos "Novo(a) …" corrigidos, `${''}` removido de Produtos e o título "Saldo depois" que faltava em Lançamentos de estoque. Segurança: a situação e as datas dessas tabelas passam por `escapeHtml` (`formatDatePt` não mudou). Nenhum cálculo mudou.
- v150 — ERP Premium Completo (publicada em 21/10/2026, PR 7, commit `19c30ef`, merge `0c1e09077b3b50f17dc830c69b3b0800cda02f02`, cache `eagles-cache-v150`; incorpora a v149, decidido pelo Igor em 21/10/2026): Pedidos de venda (lista e editor), Clientes e Fornecedores, Posição de estoque e Inventário na "Mesa de Operação Premium", reaproveitando a base `.pg-cad` da v148. Classes por módulo: `.pg-pv` (na lista, no editor e na janela de parcelas, **não no `<main>`**, para a área de impressão `#print-area` continuar igual), `.pg-cf`, `.pg-est` e `.pg-inv` (no `<main>`). As janelas de estoque e inventário abrem em `#modal-srv` (fora do `<main>`, compartilhada); o estilo delas só vale com `body:has(main.pg-est)` ou `body:has(main.pg-inv)`. Status do pedido com `cadSituacao` (aberto âmbar, faturado verde, cancelado vermelho); situação do estoque com `EST_SIT_TOM`; `data-label` nas tabelas de `estRenderPosicao`, `estHistorico`, `invRender`, `invVer`, `renderClientesFornTabela` e `renderItensPedidoForm`. Ficha do cliente em 4 seções (`secao` em `CLIENTE_FORN_FIELDS` + `renderFichaCampos`; mesmos 22 campos). Filtros de Clientes recolhíveis no celular (`cfAlternarFiltros`, `cfAtualizarIndicadorFiltros`). Busca das páginas `.pg-cad` corrigida entre 861 e 1400px (a regra global da barra superior encolhia o campo). **Nunca criar classes `.pv-*` novas**: o portal do cliente usa `.pv-*` sem escopo. A entrada do `CFG_CHANGELOG` é "21/10/2026 · ERP Premium Completo". Nenhum cálculo mudou.
- v153 — Eagles Labz Premium Experience (publicada em 23/10/2026, PR 8, commit `b2c53ab`, merge `a73018a721ea3066ce223ba3f8a93fee4a344161`, cache `eagles-cache-v153`; unifica v151, v152 e v153, aprovado pelo Igor em 21/10/2026): só visual, acessibilidade e apresentação. Classes por tela: `.pg-login` (na `.login-page`), `.pg-cfg`, `.pg-usr`, `.pg-perfil`, `.pg-emp` e `.pg-tt` (no `<main>`) e `.pg-kb` (na seção `#crm-secao-kanban` do `crm.html`); um bloco só de tokens `--mn-*` para todas elas (`:is(...)`). Barra superior refinada em todas as páginas internas (regras em `.topbar`; setas sem caixinha; até 360px some a palavra LABZ e o nome da empresa). Login: `for` nos rótulos e `role="alert"`/`role="status"` nas mensagens; o logotipo é o PNG original `assets/logo-full.png`, com a transparência dele, nos dois temas (sem fundo por CSS, decisão do Igor); o script do login não mudou. Kanban: a cor de status na visão Projetos também passa por `kbCorSegura`. Usuários e Empresas: `data-label` e `cad-acoes` em `renderUsuariosTenant` e `renderTenantsLista`, situação da empresa com `pm-sit` (o valor `ativo` gravado não muda); no celular viram cartões com todas as ações. Kanban: `kbCorSegura` (só cor hexadecimal; senão cinza) nas cores de coluna desenhadas — **corrigiu um XSS**: uma cor de coluna gravada com código na nuvem executava esse código na v150; ponto colorido ao lado do nome da coluna (`--kb-col-cor`), etiquetas neutras com ponto, "atrasada"/"hoje" por extenso (CSS). `renderTopbar` dá `aria-label` ao "?" (Ajuda). A entrada do `CFG_CHANGELOG` é "23/10/2026 · Premium Experience". Conteúdos, Agenda e as outras seções do CRM não mudaram. Nenhum dado, cálculo, permissão, regra do Firebase ou fluxo de autenticação mudou.
- v154 — Estabilidade e correções funcionais (publicada em 23/10/2026, PR 9, commit funcional `13a2882`, commit dos testes `8df9b96`, merge `0f3d2080bf225b772902e75f72b2ff93f860f392`, cache `eagles-cache-v154`; decisões do Igor D2 a D8 aprovadas em 23/10/2026):
  - F1: `trocarMinhaSenha` limpa os campos pelo id (o `form-trocar-senha` só existe no Meu Perfil), devolve o nome original do botão e avisa quando não há login. Os campos de senha em Configurações ganharam `aria-label`, e o campo de senha da equipe (`eq-senha`) virou `type="password"`.
  - F2: senha mínima de **8** em todos os lugares (Meu Perfil e Empresas diziam 6).
  - F3: `cloudSalvarCampos(chave, campos, aoPendente)` grava só os campos informados com `set({ valor: campos }, { merge: true })` (mesmo documento e formato) e devolve o estado real: `confirmado`, `local`, `sem-permissao`, `nao-pronto` ou `falha`; `aguardarConfirmacaoGravacao` mostra "Ainda não confirmado" sem internet ou com o servidor lento, e "Salvo ✓" só depois da confirmação. No Meu Perfil, `perfilGravar` conta as gravações em andamento (`PERFIL_GRAVACOES_PENDENTES`): "Salvo ✓" só quando todas foram confirmadas; se uma falhou e nenhuma seguinte levou aqueles campos de novo (`PERFIL_CAMPOS_FALHARAM`), o aviso final é de erro. O `cloudSet` não mudou. O Meu Perfil fica só para leitura para Administrativo e Financeiro (`perfilAplicarPermissao`).
  - F4: os vigias de CNPJ/CPF são ligados uma vez só (em `initMeuPerfilPage`), `checarDocumento` limpa a cor vermelha, há um só aviso com um cronômetro (`perfilMostrarAviso`), e "Senha alterada ✓" some em 6 s.
  - F5 (opção B): os dados da empresa ficam só em Meu Perfil (`salvarPerfilEmpresa` grava só os campos alterados, comparando com `PERFIL_FORM_BASE`; uma atualização de outro aparelho não apaga o que está sendo digitado). Configurações → Perfil ficou com e-mail da conta, nome (`usuarios/{uid}.nome`, com confirmação) e Segurança. País, moeda e idioma saíram da tela, e os valores gravados foram preservados. Nenhum dado foi migrado ou apagado.
  - F6/F7: ver o item Tema (6).
  - F8: zoom liberado (sem `user-scalable=no`/`maximum-scale` nas 29 páginas; `bloquearZoomMobile` removida, inclusive a chamada no `login.html`). No celular (até 860px), campos com `calc(16px) !important` (o `calc` impede que "Tamanho da fonte" diminua). O total do pedido continua com 20px.
  - `firestore.rules` e a estrutura do banco não mudaram.
- Planejamento seguinte (cada etapa depende da aprovação do Igor): Conteúdos, Agenda e as outras seções do CRM; os agentes de IA; e só então a expansão do limite de usuários. `vendas.html` e `assinatura.html` (quebradas, sem links) e `funil-vendas.html` (funciona, sem link no menu) **não foram apagadas**; o Igor decide depois.
- Testes das regras (`testes-regras/`): são **19** testes. De 15/10/2026 até a v154, 4 falhavam (7, 9, 10 e 18) por causa do arquivo de teste, não das regras: o login simulado não trazia e-mail (a regra `contaLivre` lê `request.auth.token.email`, que todo login real por e-mail e senha tem) e o teste 18 abria a mesma conexão simulada duas vezes. A correção, só em `regras.test.mjs` (commit `8df9b96`, aprovada pelo Igor), está na `main` desde a v154: 19/19 no GitHub Actions (execuções 40013279193 na branch e 40013814313 na `main`). `firestore.rules` não mudou.
- **LABZ AI — Fase 1 (Fundação)**, branch local `claude/labz-ai-fase1` (a partir da `main` v154; não publicada; autorizada pelo Igor em 29/10/2026):
  - Ferramenta exclusiva do Super Admin, **independente** do CRM/ERP (não substitui os agentes atuais). Backend em `functions-labz/` (Node puro, sem dependências): contratos, 8 agentes, ferramentas (nenhuma disponível ainda), memória em 5 escopos (global, agente, cliente, tarefa, desempenho) com versões, aprovação, rollback e arquivo, correções → propostas de aprendizado, Context Builder, skills privadas versionadas, cadastro próprio de empresas (vínculo opcional com tenant ou cliente do CRM) e `exigirSuperAdmin` (role exato + lista de UIDs + conta não bloqueada).
  - Skills, prompts e memórias são **privados no banco** (coleções `labz_*`), nunca no repositório (é público e o Pages publica tudo).
  - `firestore.rules`: (1) **corrigida uma falha**: o Diretor conseguia rebaixar o Super Admin vinculado à empresa dele (Empresas → Minha empresa grava `tenantId` sem `titular`) e promover um login de Cliente a equipe sem vaga; agora o Diretor só altera quem já é da equipe (`roleDeEmpresa(resource.data.role)`); (2) coleções `labz_*`: leitura só do Super Admin que está em `labz_config/acesso.uids`; gravação pelo navegador sempre negada. **Publicar as regras antes de qualquer arquivo** quando for a hora.
  - Decisões do Igor (Fase 0): empresa = cadastro próprio com vínculo opcional; skills e memórias privadas; Blaze **não** ativado nesta fase.
  - Fase 1 gravada em commit local `66fe592` (autorizado pelo Igor; sem envio ao GitHub).
- **LABZ AI — Fase 2 (Servidor seguro)**, na mesma branch, sem Blaze e sem publicar (autorizada pelo Igor):
  - Uma função chamável `labzApi` (`functions-labz/index.js`, São Paulo) com lista fechada de ações (`src/api/labz-api.js`). Ordem das travas: assinatura do token (Firebase) → `verifyIdToken(..., checkRevoked)` (conta desativada/sessões revogadas) → `exigirSuperAdmin` (role exato + UID no segredo `LABZ_SUPERADMIN_UIDS` **e** em `labz_config/acesso` + conta livre) → validação dos dados → auditoria.
  - Adaptador do Firestore (`banco-firestore.js`) com gravações guardadas até o fim da transação (o Firestore não aceita ler depois de gravar). Execuções persistentes em `labz_tarefas` (estado, versão, histórico, sinal de vida, retomada) e fila persistente `labz_fila` (reserva com prazo, novas tentativas, desistência).
  - Credenciais dos provedores só no Secret Manager (`src/segredos/provedores.js`); a API só diz "configurado/não configurado".
  - Testes: `npm test` (65) e `npm run test:emulador` (14, simulador com login, banco e função; projeto `demo-labz`; `.secret.local` temporário só com valores fictícios). Limitação: o simulador não confere a assinatura do token (registrado no teste).
  - `firebase.json` do projeto **não mudou** (o simulador usa `functions-labz/firebase.emulador.json`).
- **LABZ AI — Fase 3A (contratos do Memory Engine)**, na mesma branch, commit local `e71f3ad` (autorizada pelo Igor em 30/10/2026):
  - Só contratos e validações, sobre os módulos existentes: estados D2 (`rascunho` e `precisa-revisao` reservados na 3A, em uso desde a 3B), transições, `memoriaVigente`, modelo canônico (`ESQUEMA_DOC_MEMORIA`/`ESQUEMA_DOC_VERSAO`), Markdown derivado (indisponível) e `EVENTOS_MEMORIA` em `src/contratos/memoria.js`; `alvoDoEscopo` passou do registro para o contrato (mesma função).
  - `src/contratos/recuperacao.js` (novo): consulta de memória e consulta ao banco validadas, ranking declarado, proveniência, pedido de contexto (o Context Builder recusa pedido inválido) e **busca semântica indisponível** (também informada no contexto). `perfilMemoria` dos 8 agentes em `src/contratos/agente.js` (catálogo sem mudança; D4 fica para a 3D).
  - Testes: `npm test` (82 = 65 + 17 novos em `test/memoria-contratos.test.js`), `test:emulador` (14) e regras (26).
- **LABZ AI — Fase 3B (ciclo de vida, aprovação e versionamento)**, na mesma branch, commit local `0f53662` (autorizada pelo Igor em 30/10/2026):
  - Estados `rascunho` e `precisa-revisao` em uso (`enviarParaAprovacao`, `pedirRevisao`); rejeição e revisão exigem motivo; proposta de agente nasce em rascunho; agente nunca decide. Aprovação só no `registro.js` (as correções usam ele).
  - `baseVersao` em cada versão: aprovar sobre uma vigente antiga dá "conflito". Rollback continua sendo versão nova. Origem conferida (mesma empresa/tarefa).
  - Trava da Global (`protecao-global.js`): nomes de empresas/tenant/cliente vinculado, e-mail, telefone, CPF/CNPJ, links e R$ bloqueiam; origem de empresa exige `confirmoSemDadosDeCliente`.
  - Markdown derivado (`markdown.js`): só de versão aprovada, determinístico, YAML + sha256, conteúdo em bloco literal; não é gravado. `verificacoes.js` reúne similaridade, duplicidade, conflito e sinais de injeção.
  - API: `memoria.enviarParaAprovacao`, `memoria.pedirRevisao`, `memoria.exportarMarkdown`; `memoria.rejeitar` passou a exigir motivo.
  - Decisão do Igor (30/10): duplicidade/conflito com memória vigente **bloqueia a aprovação** (e o rollback) até o Super Admin decidir: `memoria.avaliarConflitos` → `confirmacaoConflitos: { assinatura, justificativa }`. A assinatura prende a decisão à proposta e à versão vigente de cada memória envolvida (decisão velha não vale); a reavaliação é feita dentro da transação (Firestore: `tx.get` da coleção; banco de teste: uma transação por vez). Correção barrada reaproveita a memória gerada (`memoriaGerada`) na nova tentativa.
  - Testes: `npm test` (110 = 82 + 28 em `test/memoria-ciclo.test.js`), `test:emulador` (17) e regras (26). `firestore.rules`, índices, `firebase.json` e `functions/` não mudaram.
- **LABZ AI — Fase 3C (busca, indexação e recuperação)**, na mesma branch, commit local `ab16bce` (autorizada pelo Igor em 30/10/2026):
  - `banco.consultar` (limite obrigatório, regras do Firestore) nos dois bancos; `indice.js` (termos gravados na mesma transação da vigente), `ranqueador.js` (determinístico, notas por critério), `recuperador.js` (status `ativa` na consulta, coleção do alvo, até 50 candidatos, cursor `depoisDe`).
  - Contexto, avisos de duplicidade, correções, auditor, listagem e trava da Global sem leitura de coleção inteira. A aprovação (3B) continua lendo a coleção dentro da transação (garantia mantida).
  - API: `memoria.buscar`, `memoria.reindexar`; `memoria.listar`, `memoria.auditar` e `correcoes.pendentes` paginados. Eventos `memoria.contexto_montado`, `memoria.busca_realizada` e `memoria.reindexada` só com números e ids.
  - 25 índices compostos declarados em `INDICES_NECESSARIOS` (**não publicados**; `firestore.indexes.json` não mudou; precisam de autorização).
  - Testes: `npm test` (127 = 110 + 17 em `test/memoria-busca.test.js`), `test:emulador` (18) e regras (26).
- **LABZ AI — Fase 3D (os 8 agentes no Memory Engine)**, na mesma branch (autorizada pelo Igor em 30/10/2026; 3E **não** autorizada). Decisões do Igor sobre a 3C: manter os 25 índices (sem a alternativa de 16); isenção de indexação só auditada; nada publicado. Commit local `ad07ac0`.
  - `ATOR_SISTEMA` em `auth/super-admin.js` (só cria rascunho de agente; nunca decide). Porta de memória do agente (`src/agentes/memoria-agente.js`, fora da API) e preparação por etapa/plano do Estrategista (`src/execucao/preparacao.js`; API `execucoes.prepararEtapa` e `execucoes.planejarContextos`). Nenhum agente é executado (Fase 4).
  - Catálogo: `prioridadesMemoria` dos 8 agentes (só ordem) e D4 (Carrosséis lê desempenho, não propõe). Contexto em 10 blocos; só segurança, especialidade e permissões são confiáveis; tarefa, memórias e briefing vão delimitados como dado.
  - Testes: `npm test` (140 = 127 + 13 em `test/agentes-memoria.test.js`), `test:emulador` (19) e regras (26). `firestore.rules`, `firestore.indexes.json`, `firebase.json` e `functions/` não mudaram.
- **LABZ AI — Fase 3E (auditoria final + correções)**, na mesma branch, commit local `bae561e` (autorizada pelo Igor em 30/10/2026; Fase 4 **não** autorizada). Commit da 3D: `ad07ac0`.
  - Subcoleções renomeadas: `labz_memorias`, `labz_desempenho`, `labz_versoes` (nada publicado, sem dados reais; regras não mudam).
  - F1 reativação com checagem de conflito na transação; F2 consulta complementar com termos específicos e `completa`; F3 reserva da proposta na aprovação de correção; F4 reserva do nome `labz_nomes/{slug}`; F5 delimitadores com código do contexto + limpeza ampla; F6 fila/auditoria/execuções/empresas paginadas, cursor preso à empresa; F7 empresa arquivada sem contexto/porta/avanço.
  - Índices propostos: 28 (25 + 3 de operação: `labz_fila` ×2, `labz_eventos` ×1); isenções: 27, todas em `labz_*`. Nada publicado; `firestore.indexes.json` não mudou.
  - Testes: `npm test` (153), `test:emulador` (20), regras (26). Decisão do Igor: 28 índices (25 + 3) e 27 isenções ficam só como proposta documentada.
  - Limitações que continuam (não resolvidas): (1) a aprovação lê o escopo inteiro na transação; (2) a busca usa candidatos limitados e não é exaustiva; (3) a reserva da F3 vale 2 minutos; (4) o simulador não comprova os índices no Firebase real; (5) a defesa contra prompt injection depende também do futuro executor de modelos; (6) os agentes ainda não executam tarefas reais; (7) os 28 índices e as 27 isenções não foram publicados.
- **LABZ AI — Fase 4A (motor de execução, agentes SIMULADOS)**, na mesma branch (autorizada pelo Igor em 30/10/2026; 4B–4D **não** autorizadas). Commit da 3E: `bae561e`.
  - `src/motor/`: `adaptador-simulado.js` (nenhum modelo; tudo marcado `[SIMULADO]`), `planejador.js`, `motor.js` (workflow + roteador + monitor), `qualidade.js` (só estrutural), `aprovacoes.js` (ações; só o Super Admin), `custos.js` (unidade simulada), `ferramentas-simuladas.js` (contrato).
  - Crachá do executor (`execucaoAtual.token`): só um executor roda; quem perde o crachá não grava. Contexto só pela porta de memória (`montarContexto`). Contrato de estados: + REVISION_REQUIRED → READY. Fila com espera (`atrasoMs`).
  - API: `execucoes.planejar`, `.aprovacoes`, `.decidirAprovacao`, `.retomar`, `.diagnostico`. O executor não sai pela API nem é agendado.
  - Índices: nenhum novo. Decisão do Igor: proposta futura = **28 índices compostos e 29 isenções** (27 + `labz_resultados.texto` + `labz_tarefas.etapas`), nada publicado.
  - Testes: `npm test` (170), `test:emulador` (21), regras (26).
- **LABZ AI — Fase 4B (adaptadores de IA, executor automático local e custos; tudo SIMULADO)**, na mesma branch, gravada em commit local "feat(labz-ai): implementa adaptadores simulados e execucao automatica - fase 4B" (autorizada pelo Igor em 30/10/2026; 4C **não** autorizada; as 5 isenções novas seguem pendentes de aprovação). Commit da 4A: `ccfd5bf`.
  - `src/ia/`: contrato comum (`contrato.js`, `ErroProvedor`), adaptadores OpenAI/Anthropic/Google/simulado (cada um no seu formato; conferir na documentação oficial antes de ligar), transporte só simulado ou bloqueado (o real não existe), modelo por agente em `labz_agentes/{id}.configModelo` (padrão simulado; `uso: "real"` recusado), prompt seguro (instruções 1–3 e 8 separadas dos dados 4–7; filtro de credenciais) e a ponte `adaptador-modelos.js` (timeout, cancelamento, JSON conferido).
  - `src/motor/`: `validar-plano.js` (o Estrategista propõe; o backend valida; projeto grande → "divida"; plano recusado não muda o estado, até 3 vezes), revisões internas (até 2 por execução, anteriores guardados em `labz_resultados/{etapa}_revN`), `consumo.js` (limites diários global/agente/empresa/provedor com reserva antes da chamada; custo desconhecido nunca vira zero; preço só cadastrado pelo Super Admin), `monitor-fila.js` e `executor-local.js` (só local; não sai pela API nem é agendado).
  - Correções na base: retomada de interrompidas confere a versão (sem retomada dupla); reserva vencida sem tentativa não volta; `trabalhar` aguenta reserva perdida.
  - API nova: `execucoes.pedido`, `modelos.listar/configurar/remover`, `custos.limites/definirLimites/definirPreco/consumo`.
  - Índices: nenhum novo. Proposta separada de **5 isenções** (`labz_consumo.reservas/agentes/empresas/provedores`, `labz_tarefas.custos`), não publicada.
  - Testes: `npm test` (215), `test:emulador` (22), regras (26); 16 mutações detectadas.
- **LABZ AI — Fase 4C.1 (registro de entregas)**, na mesma branch, gravada em commit local "feat(labz-ai): implementa registro de entregas e versionamento - fase 4C.1" (autorizada pelo Igor em 30/10/2026; 4C.2 em diante **não** autorizadas). Commit da 4B: `f61f6e3`.
  - `src/contratos/entrega.js` (8 tipos; texto real para documento/roteiro/planejamento/relatório/código; imagem/carrossel/pacote só representação simulada), `src/entregas/armazenamento.js` (conteúdo por sha256 dentro da execução, até 200 KB, hash conferido) e `src/entregas/registro.js` (versões imutáveis, aprovação só do Super Admin presa a versão + hash, restaurar = versão nova, sem apagar, porta do agente). O motor registra a entrega na transação do crachá. API `entregas.*`.
  - Proposta de indexação consolidada: **28 índices e 34 isenções** (as 5 da 4B aprovadas pelo Igor). Nova proposta separada (pendente de aprovação, fora do consolidado): 7 isenções da 4C.1. Nada publicado.
  - O banco de testes passou a dar à transação um objeto próprio (`emTransacao`), como o Firestore.
  - Testes: `npm test` (232), `test:emulador` (23), regras (26); 16 mutações (15 detectadas, 1 equivalente).
- **LABZ AI — Fase 4C.2, passo 1 (contratos dos documentos estruturados)**, na mesma branch, gravado em commit local "feat(labz-ai): implementa contratos de documentos estruturados - fase 4C2 passo 1" (autorizado pelo Igor em 31/10/2026; passos seguintes da 4C.2 **não** autorizados). Commit da 4C.1: `3dcbddb`.
  - `src/contratos/documentos.js`: 10 documentos (esquema fechado, regras estruturais, limite em bytes, agentes permitidos, tipo de entrega da 4C.1; documentação de projeto e técnica = mesmo contrato). `src/entregas/representacao.js`: Markdown derivado determinístico, escapado, com o sha256 da origem; da mesma entrega e versão; ainda não gravado.
  - Plano: `documento` na etapa (o Estrategista propõe; o backend confere catálogo e permissão; consolidação = `consolidacao-final`); planos antigos continuam iguais.
  - Proposta de indexação consolidada (aprovada pelo Igor): **28 índices e 41 isenções**. Nada publicado.
  - Testes: `npm test` (242), `test:emulador` (23), regras (26); 14 mutações detectadas.
- **Correção isolada das regras** (só a proteção do Super Admin, sem nada da LABZ AI): branch local `claude/seguranca-super-admin` a partir da `main`, commit local `5d0816e` (autorizado pelo Igor em 30/10/2026); 23/23 testes (antes da correção, 2 falhavam). Auditoria de 30/10: as regras publicadas eram idênticas à `main`. A publicação é manual, pelo Igor, no console do Firebase.
- Pendência registrada na v154 (D3c): o mesmo "Salvo falso" para quem não pode gravar existe em Clientes e Fornecedores e em outros cadastros, que ignoram a recusa do `cloudSet`. Ficou para uma etapa própria.
- Pendências funcionais registradas na análise da v150 (não corrigidas; dependem de uma etapa funcional aprovada pelo Igor):
  - Pedidos: não há como reabrir um pedido salvo para editar (sem "Editar" no menu ⋮); "Prazo de entrega" e a quantidade do transportador não são salvos; ao editar, loja, unidade de negócio e lista de preço não voltam; não há como marcar "cancelado" pela tela; "Clonar venda" copia as marcas de estoque, NFS-e e parcelas (clonar um faturado pode devolver estoque); o "+ Incluir cadastro" da lista vazia aponta para uma janela que não existe; a comissão usa bases diferentes no formulário e nas Comissões; o frete não entra no total.
  - Clientes e Fornecedores: para quem não pode alterar, salvar parece funcionar mas não grava (a tela ignora a recusa do `cloudSet`); "Limpar filtros" não limpa o filtro por data; o filtro "Sem compras no período" provavelmente não enxerga os pedidos nesta página; não há aviso de CPF/CNPJ repetido.
  - Estoque e Inventário: a Saída usa o `confirm()` do navegador; a permissão só é conferida ao salvar; o valor em estoque usa o preço de venda; ao concluir o inventário, se a gravação do histórico falhar depois do ajuste do saldo, repetir a conclusão ajustaria duas vezes.

## 11. Pendências e ideias
- **Plano Blaze**: liga o servidor (e-mails automáticos, Meta e o processamento das aprovações mesmo com o sistema fechado) e permitiria **enviar imagens direto pelo sistema** (Firebase Storage) em vez de usar o Drive.
- **Repositório público**: no GitHub grátis, o Pages exige repositório público. Para tornar privado sem tirar o site do ar, a opção recomendada é migrar para o **Firebase Hosting** (grátis, e ainda permite os cabeçalhos de segurança completos); a outra é o GitHub Pro.
- **Limitações conhecidas**:
  - o portal do cliente só se atualiza quando o CRM está aberto em algum aparelho da equipe;
  - o bloqueio de login pode ser usado de má-fé (alguém erra a senha de outra pessoa de propósito); o Super Admin desbloqueia;
  - as imagens do Drive dependem do compartilhamento do arquivo;
  - uma data gravada como número (e não como texto `AAAA-MM-DD`) faz a tabela do cadastro parar de desenhar (`formatDatePt` chama `.split`). Pelos formulários não acontece; só com importação ou edição direta no banco. Já existia antes da v148;
  - a tecla Esc não fecha os menus da barra superior (já era assim antes da v153);
  - em 188px, o Painel e o Dashboard do CRM ainda passam um pouco da largura da tela (o gráfico e os blocos; já era assim na v150).
