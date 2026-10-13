# Como ligar o servidor do Eagles Labz (Rodada 5)

Este guia liga, no seu Firebase (projeto **labz-18246**), as funções que rodam sozinhas:

| Função | O que faz |
|---|---|
| `rotinaDiaria` | Todo dia às 7h (Brasília): confere as assinaturas (fim do teste, atraso, bloqueio), manda os lembretes de pagamento por e-mail para os clientes das empresas e o resumo do dia para os Diretores |
| `aoResponderAprovacao` | Quando um cliente aprova ou pede alteração no link, manda e-mail para a equipe |
| `boasVindas` | E-mail de boas-vindas para cada pessoa nova da equipe |
| `criarAssinatura` | Cria a cobrança mensal no **Asaas** (boleto, PIX ou cartão) ou no **Mercado Pago** (cartão recorrente) |
| `webhookAsaas` / `webhookMercadoPago` | Recebem o aviso de "pagou" / "atrasou" e liberam ou bloqueiam o acesso sozinhos |
| `cadastroPublico` | Cadastro sozinho pela página `vendas.html` (empresa + titular, em período de teste) |

> Faça tudo primeiro no **ambiente de testes** (sandbox) do Asaas. Só troque para produção depois de testar um pagamento de ponta a ponta.

---

## 1. Ativar o plano Blaze (5 min)
1. Console do Firebase → projeto **labz-18246** → engrenagem → **Uso e faturamento** → **Modificar plano** → **Blaze**.
2. Cadastre um cartão. O Blaze tem uma **cota grátis mensal**: com poucas empresas, o custo costuma ser zero ou centavos.
3. **Coloque um alerta de gasto:** Google Cloud Console → Faturamento → **Orçamentos e alertas** → crie um orçamento de, por exemplo, R$ 50 com aviso em 50%, 90% e 100%.

## 2. E-mail: Resend (10 min + espera da verificação)
Escolhi o **Resend**: simples, confiável e com 3.000 e-mails por mês grátis (100 por dia).
1. Crie a conta em <https://resend.com>.
2. **Domains → Add domain** → `eagleslabz.com.br`. O Resend mostra 3 ou 4 registros (DNS) para colocar onde o domínio está registrado (Registro.br, Hostinger, Cloudflare...). A verificação leva de minutos a algumas horas.
3. **API Keys → Create API key** (permissão "Sending access"). Copie a chave (começa com `re_`).
4. O remetente padrão é `Eagles Labz <nao-responda@eagleslabz.com.br>`. Para trocar, veja o passo 5.

## 3. Asaas (boleto, PIX e cartão)
1. Crie a conta de **testes** em <https://sandbox.asaas.com> (e depois a de produção em <https://www.asaas.com>).
2. **Integrações → Chave de API** → gere e copie a chave (começa com `$aact_`).
3. Invente um **token do webhook** (uma senha longa qualquer, ex.: `eagles-asaas-7f3k9...`). Guarde.
4. Depois do deploy (passo 6): **Integrações → Webhooks → Adicionar**:
   - URL: `https://southamerica-east1-labz-18246.cloudfunctions.net/webhookAsaas`
   - Token de autenticação: o token que você inventou
   - Eventos: **Cobranças** (todos os de pagamento) e **Assinaturas**
   - Versão da API: v3 · Ativo: sim

## 4. Mercado Pago (cartão recorrente)
1. <https://www.mercadopago.com.br/developers> → **Suas integrações → Criar aplicação** (produto: Assinaturas).
2. **Credenciais de teste** → copie o **Access Token** (`TEST-...`). Em produção, use o de produção (`APP_USR-...`).
3. Depois do deploy: **Webhooks → Configurar notificações**:
   - URL: `https://southamerica-east1-labz-18246.cloudfunctions.net/webhookMercadoPago`
   - Eventos: **Planos e assinaturas** (subscription_preapproval e subscription_authorized_payment)
   - Copie a **assinatura secreta** que o Mercado Pago mostra.
> Observação: no Mercado Pago a assinatura recorrente é **só no cartão**. Boleto e PIX ficam com o Asaas.

## 5. Instalar a ferramenta e colocar as chaves (no seu computador)
Precisa do **Node.js 20** instalado (<https://nodejs.org>). No terminal, dentro da pasta do projeto (onde está o `firebase.json`):

```bash
npm install -g firebase-tools
firebase login
cd functions && npm install && cd ..

# chaves secretas (o terminal pede para colar cada uma)
firebase functions:secrets:set RESEND_API_KEY
firebase functions:secrets:set ASAAS_API_KEY
firebase functions:secrets:set ASAAS_WEBHOOK_TOKEN
firebase functions:secrets:set MP_ACCESS_TOKEN
firebase functions:secrets:set MP_WEBHOOK_SECRET
```
Se ainda não for usar o Mercado Pago, coloque `nada` em `MP_ACCESS_TOKEN` e `MP_WEBHOOK_SECRET` — e deixe só o Asaas marcado em **Empresas → Planos e cobrança**.

Crie o arquivo **`functions/.env`** com:
```
APP_URL=https://eagleslabz.com.br
EMAIL_FROM=Eagles Labz <nao-responda@eagleslabz.com.br>
ASAAS_SANDBOX=sim
```
(`ASAAS_SANDBOX=nao` quando for para produção.)

## 6. Publicar
```bash
firebase deploy --only functions,firestore:rules
```
Na primeira vez, o Firebase pode pedir para ativar algumas APIs (Cloud Functions, Cloud Build, Artifact Registry, Cloud Scheduler, Secret Manager): aceite. O deploy leva alguns minutos.

## 7. Configurar no sistema
1. Entre como **super administrador** → **Empresas → Planos e cobrança**: preços, usuários por plano, dias de teste, tolerância e quais meios de pagamento oferecer. Os endereços dos webhooks aparecem ali para copiar.
2. Em cada empresa antiga, decida: deixar como está (sem assinatura pelo sistema), marcar **Cortesia** (nunca bloqueia) ou pedir que o Diretor assine em **Configurações → Assinatura**.
3. Diretores ligam os e-mails em **Configurações → E-mails automáticos**.

## 8. Testar de ponta a ponta (sandbox)
- [ ] Abra `vendas.html`, crie uma conta de teste → deve entrar no questionário.
- [ ] Na conta nova, **Configurações → Assinatura → Pagar (Asaas)** → pague o boleto de teste pelo painel do sandbox (Cobranças → "Confirmar recebimento").
- [ ] Em até 1 minuto a assinatura deve aparecer **Em dia** e chegar o e-mail "Pagamento confirmado".
- [ ] Mande um link de aprovação de conteúdo e responda → deve chegar o e-mail para a equipe.
- [ ] No dia seguinte às 7h, confira o e-mail de resumo (ou rode a rotina na hora: Google Cloud Console → Cloud Scheduler → `rotinaDiaria` → **Forçar execução**).
- [ ] Logs de cada função: Console do Firebase → Functions → Registros.

## 9. Ir para produção
1. Troque `ASAAS_API_KEY` pela chave de produção (`firebase functions:secrets:set ASAAS_API_KEY`) e `ASAAS_SANDBOX=nao` no `functions/.env`.
2. Mercado Pago: troque o `MP_ACCESS_TOKEN` pelo de produção e configure o webhook de produção.
3. `firebase deploy --only functions`.
4. Cadastre os webhooks também na conta de produção do Asaas.

## Testes automáticos das regras
`cd functions && npm test` roda os testes das regras de cobrança, e-mails e verificação dos avisos de pagamento (não precisa de internet nem de Firebase).
