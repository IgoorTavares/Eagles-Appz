# Eagles Labz — ERP + CRM (white label)

Documento de passagem para o Claude Code. Versão atual: **v143** (cache `eagles-cache-v143` no `sw.js`), feita sobre a v141 do GitHub.
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
- `testes-regras/`: 21 testes das regras, rodando no simulador do Firebase. `.github/workflows/regras.yml` roda esses testes no GitHub a cada envio.
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

## 11. Pendências e ideias
- **Plano Blaze**: liga o servidor (e-mails automáticos, Meta e o processamento das aprovações mesmo com o sistema fechado) e permitiria **enviar imagens direto pelo sistema** (Firebase Storage) em vez de usar o Drive.
- **Repositório público**: no GitHub grátis, o Pages exige repositório público. Para tornar privado sem tirar o site do ar, a opção recomendada é migrar para o **Firebase Hosting** (grátis, e ainda permite os cabeçalhos de segurança completos); a outra é o GitHub Pro.
- **Limitações conhecidas**:
  - o portal do cliente só se atualiza quando o CRM está aberto em algum aparelho da equipe;
  - o bloqueio de login pode ser usado de má-fé (alguém erra a senha de outra pessoa de propósito); o Super Admin desbloqueia;
  - as imagens do Drive dependem do compartilhamento do arquivo.
