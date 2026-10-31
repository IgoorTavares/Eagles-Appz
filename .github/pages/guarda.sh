#!/usr/bin/env bash
# Guarda do GitHub Pages (NÃO publica nada). Usado por .github/workflows/pages-guarda.yml.
#  1) confere a fonte do Pages (build_type precisa ser "workflow" = GitHub Actions);
#  2) se VOLTAS > 0, vigia e cancela a publicação antiga ("pages build and deployment",
#     que publica o repositório inteiro), conferindo a cada PAUSA segundos.
# Termina com erro (1) se a fonte não for "workflow", se não der para lê-la (ex.: 403),
# se achar uma publicação antiga ou se não conseguir cancelá-la.
# A guarda NÃO é uma barreira garantida: ela só reage depois que a publicação antiga começa.
# As barreiras de verdade são a fonte do Pages em "GitHub Actions" e a aprovação obrigatória
# no ambiente github-pages (Settings -> Environments).
set -u
: "${REPO:?defina REPO=dono/repositorio}"
VOLTAS="${VOLTAS:-0}"
PAUSA="${PAUSA:-10}"
problemas=0
erro_tmp="$(mktemp)"

if tipo="$(gh api "repos/$REPO/pages" --jq .build_type 2>"$erro_tmp")" && [ -n "$tipo" ]; then
  if [ "$tipo" = "workflow" ]; then
    echo "OK: fonte do Pages = GitHub Actions (build_type=workflow). Só o workflow Site seguro publica."
  else
    echo "::error::A fonte do Pages está em '$tipo' (Deploy from a branch): o GitHub publica o repositório inteiro a cada mudança na main. Troque em Settings -> Pages -> Source para 'GitHub Actions'."
    problemas=1
  fi
else
  echo "::error::Não consegui ler a configuração do Pages ($(tr -d '\n' < "$erro_tmp" | head -c 200)). Confira à mão: Settings -> Pages -> Source = 'GitHub Actions'."
  problemas=1
fi

i=0
while [ "$i" -lt "$VOLTAS" ]; do
  i=$((i + 1))
  if ids="$(gh api "repos/$REPO/actions/runs?per_page=30" --jq '.workflow_runs[] | select(.path == "dynamic/pages/pages-build-deployment" and (.status == "queued" or .status == "in_progress" or .status == "waiting" or .status == "requested" or .status == "pending")) | .id' 2>"$erro_tmp")"; then
    for id in $ids; do
      problemas=1
      if gh api -X POST "repos/$REPO/actions/runs/$id/cancel" >/dev/null 2>"$erro_tmp"; then
        echo "::error::Publicação antiga (execução $id) encontrada e CANCELADA. Confira se o site não foi substituído."
      else
        echo "::error::Publicação antiga (execução $id) encontrada e NÃO consegui cancelar ($(tr -d '\n' < "$erro_tmp" | head -c 200)). Cancele à mão em Actions agora."
      fi
    done
  else
    echo "::warning::Não consegui listar as execuções nesta volta ($(tr -d '\n' < "$erro_tmp" | head -c 120)); tento de novo."
  fi
  [ "$i" -lt "$VOLTAS" ] && sleep "$PAUSA"
done
rm -f "$erro_tmp"
exit "$problemas"
