# Como ligar a integração com a Meta (Instagram e anúncios)

Pré-requisito: o servidor já instalado (veja `README-INSTALACAO.md`, passos 1, 5 e 6).

O que a integração faz:
- **Publica** imagem, carrossel (2 a 10) e reels no Instagram no horário agendado (o servidor confere a cada 10 minutos).
- **Relatórios** do perfil (seguidores, alcance, visitas, contas engajadas), dos posts e dos **anúncios** (investido, cliques, CTR, CPC e resultados por campanha), atualizados todo dia às 6h.
- As chaves da Meta ficam **só no servidor**; o navegador nunca vê.

---

## 1. Antes de tudo (em cada empresa cliente)
- O Instagram precisa ser **profissional** (Comercial ou Criador de conteúdo).
- Ele precisa estar **ligado a uma Página do Facebook** (no Instagram: Configurações → Central de Contas, ou na Página: Configurações → Contas vinculadas).
- Quem vai conectar precisa ser **administrador** dessa Página (e da conta de anúncios, para os relatórios de anúncios).

## 2. Criar o app da Meta (uma vez, por você)
1. <https://developers.facebook.com/apps> → **Criar app** → tipo **Empresa** (Business) → ligue ao seu **Gerenciador de Negócios** (Business Manager).
2. No painel do app, adicione os produtos:
   - **Login do Facebook para Empresas** (Facebook Login for Business)
   - **API do Instagram** (com login do Facebook)
   - **API de Marketing**
3. **Login do Facebook → Configurações → URIs de redirecionamento do OAuth válidos**:
   `https://southamerica-east1-labz-18246.cloudfunctions.net/metaOAuthCallback`
4. **Configurações → Básico**: copie o **ID do app** e a **Chave secreta do app**. Preencha a URL da Política de Privacidade (`https://eagleslabz.com.br/privacidade.html`), dos Termos (`/termos.html`) e um ícone.

## 3. Colocar no servidor
```bash
firebase functions:secrets:set META_APP_SECRET     # cole a Chave secreta do app
```
No arquivo `functions/.env`, acrescente:
```
META_APP_ID=SEU_ID_DO_APP
META_API_VERSION=v21.0
```
Depois: `firebase deploy --only functions,firestore`

> **Versão da API:** a Meta lança uma versão nova a cada poucos meses e desliga as antigas depois de cerca de 2 anos. Se um dia aparecer erro de versão nos registros, troque `META_API_VERSION` pela versão atual (veja em developers.facebook.com/docs/graph-api/changelog) e publique de novo.

## 4. Testar já, antes da aprovação
Enquanto o app está em **modo de desenvolvimento**, ele funciona para quem tem função no app. Em **Funções do app → Funções**, adicione como administrador ou testador as contas do Facebook que vão testar (a sua e a de algum cliente piloto). Aí:
1. CRM → **Instagram e anúncios** → **Conectar com a Meta** → aceite as permissões.
2. **Publicações → Agendar publicação** para daqui a 15 minutos, com um link de imagem pública (JPG).
3. Confira no Instagram. Se der erro, a mensagem aparece na lista e nos registros (Console do Firebase → Functions → Registros).

## 5. Pedir a aprovação (para qualquer cliente usar)
1. **Verificação da empresa** no Gerenciador de Negócios (Central de Segurança → Verificação). Comece por aqui: leva de dias a semanas.
2. **Análise do app → Permissões e recursos**, peça acesso avançado a:
   `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`, `business_management`, `ads_read`
3. Para cada permissão, a Meta pede **um vídeo de tela** mostrando o uso real: conectar no CRM, agendar um post e ele aparecendo no Instagram, e a aba Relatórios com os números. Explique em português simples para que serve.
4. Depois de aprovado, mude o app para **modo Ao vivo** (Live).

## 6. Limites e cuidados
- O Instagram aceita até **50 publicações por conta a cada 24 horas** pela API.
- A mídia precisa estar em um **link público que abra direto o arquivo** (JPG/PNG para imagem, MP4 para reels). Links do Google Drive e Dropbox são convertidos sozinhos, mas o arquivo precisa estar como "Qualquer pessoa com o link". Arquivos muito grandes ou em formatos diferentes podem ser recusados pela Meta.
- A conexão vale **60 dias**. O sistema avisa por e-mail 7 dias antes; basta tocar em "Reconectar".
- Stories, música e marcação de pessoas não estão disponíveis pela API da Meta para esse tipo de publicação.
