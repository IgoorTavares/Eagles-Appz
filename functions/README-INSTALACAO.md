# Como ligar o servidor do Eagles Labz

Este guia liga, no seu Firebase (projeto **labz-18246**), as funções que rodam sozinhas:

| Função | O que faz |
|---|---|
| `rotinaDiaria` | Todo dia às 7h (Brasília): manda os lembretes de pagamento por e-mail para os clientes das empresas e o resumo do dia para os Diretores |
| `aoResponderAprovacao` | Quando um cliente aprova ou pede alteração no link, manda e-mail para a equipe |
| `boasVindas` | E-mail de boas-vindas para cada pessoa nova da equipe |
| `meta*` | Instagram e anúncios (veja `README-META.md`) |

> O acesso das empresas é liberado e suspenso por você, em **Empresas** (super administrador). Não há cobrança automática nem cadastro público.

---

## 1. Ativar o plano Blaze
1. Console do Firebase → projeto **labz-18246** → canto inferior esquerdo → **Fazer upgrade** → **Blaze**.
2. Crie a conta de faturamento (cartão de crédito). Se o Google pedir um **pré-pagamento**, ele vira saldo na conta e é devolvido se você encerrar a conta de faturamento.
3. **Alerta de gasto:** <https://console.cloud.google.com/billing> → **Orçamentos e alertas** → orçamento de R$ 50 com aviso por e-mail em 50%, 90% e 100%.

## 2. E-mail: Resend
1. Crie a conta em <https://resend.com> (3.000 e-mails por mês grátis).
2. **Domains → Add domain** → `eagleslabz.com.br`. Coloque os registros (DNS) que o Resend mostrar onde o domínio está registrado. A verificação leva de minutos a algumas horas.
3. **API Keys → Create API key** (permissão "Sending access"). Copie a chave (começa com `re_`).

## 3. Instalar a ferramenta e colocar as chaves (no seu computador)
Precisa do **Node.js 20** (<https://nodejs.org>). No terminal, dentro da pasta do projeto (onde está o `firebase.json`):

```bash
npm install -g firebase-tools
firebase login
cd functions && npm install && cd ..

firebase functions:secrets:set RESEND_API_KEY      # cole a chave do Resend
firebase functions:secrets:set META_APP_SECRET     # se ainda não for usar a Meta, coloque: nada
```

Crie o arquivo **`functions/.env`** com:
```
APP_URL=https://eagleslabz.com.br
EMAIL_FROM=Eagles Labz <nao-responda@eagleslabz.com.br>
META_APP_ID=
META_API_VERSION=v21.0
```

## 4. Publicar
```bash
firebase deploy --only functions,firestore
```
Na primeira vez, aceite ativar as APIs que o Firebase pedir (Cloud Functions, Cloud Build, Artifact Registry, Cloud Scheduler e Secret Manager). Se ele perguntar sobre apagar imagens antigas das funções, responda **sim**.

## 5. Configurar no sistema
Cada Diretor liga os e-mails em **Configurações → E-mails** (resumo do dia, aviso de aprovação e lembretes de pagamento, com os modelos de texto).

## 6. Testar
- [ ] Mande um link de aprovação de conteúdo e responda: deve chegar o e-mail para a equipe.
- [ ] Crie uma pessoa nova na equipe: deve chegar o e-mail de boas-vindas.
- [ ] Para não esperar as 7h: Google Cloud Console → **Cloud Scheduler** → `rotinaDiaria` → **Forçar execução**, e confira o resumo do dia.
- [ ] Registros de cada função: Console do Firebase → Functions → Registros.

## Testes automáticos das regras
`cd functions && npm test` roda os testes das regras dos e-mails e da Meta (não precisa de internet nem de Firebase).
