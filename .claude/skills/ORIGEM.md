# Origem das skills do Claude Code

Estas pastas são **instruções para o Claude Code** (o assistente que programa o sistema).
Elas não fazem parte do site: nenhuma página carrega estes arquivos e o GitHub Pages não publica a pasta `.claude`.

Os arquivos `SKILL.md` e as licenças foram copiados **sem nenhuma alteração** dos repositórios oficiais abaixo,
em 17/10/2026, sobre a base v141 do Eagles Labz.

## frontend-design (Anthropic)
- Repositório: https://github.com/anthropics/skills
- Caminho de origem: `skills/frontend-design/` (`SKILL.md` e `LICENSE.txt`)
- Commit: `dbd4588f9e1033efb41dad4bef2f7947c8993d44` (09/10/2026)
- Licença: Apache 2.0 (`frontend-design/LICENSE.txt`)

## gsap-core, gsap-timeline, gsap-scrolltrigger, gsap-performance, gsap-utils (GreenSock)
- Repositório: https://github.com/greensock/gsap-skills
- Caminho de origem: `skills/<nome>/SKILL.md`
- Commit: `aed9cfd3277740755f6bfc1155c7aa645403b760` (21/04/2026)
- Licença: MIT, Copyright (c) 2026 GreenSock. O arquivo `LICENSE` fica só na raiz do repositório de origem;
  uma cópia idêntica foi colocada em cada pasta, como `LICENSE.txt`.
- Ficaram de fora, por não servirem a um projeto em HTML, CSS e JavaScript puro: `gsap-react`, `gsap-frameworks` e `gsap-plugins`.

## Observação
- No exemplo de rolagem horizontal da `gsap-scrolltrigger/SKILL.md`, o original escreve `Max.max` onde o certo é `Math.max`.
  O arquivo foi mantido idêntico ao original; ao usar esse exemplo, corrija para `Math.max`.

## Como atualizar
Baixe de novo os repositórios, compare com estas pastas, leia as mudanças antes de copiar e atualize os commits acima.
