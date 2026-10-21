# Potyro: guia de design para agentes

> **Tudo em grafite. A cor entra num traço só.**

Este documento diz a qualquer agente de IA como desenhar para o Potyro: o app Potyro, a landing page e os apps que o Potyro gera a partir de um prompt. Os valores exatos estão em [`potyro-tokens.css`](potyro-tokens.css). O logo está em [`potyro-logo.svg`](potyro-logo.svg).

---

## 0. Como usar este documento

1. Leia as seções 1 a 3 e a seção 11 (acessibilidade) antes de qualquer tarefa. Elas valem para tudo.
2. Depois leia a seção da superfície em que você está trabalhando: **8** para apps gerados, **9** para a landing e **10** para o app Potyro.
3. Use sempre os tokens de `potyro-tokens.css`. Nunca escreva uma cor, fonte, raio ou espaçamento "na mão". Para uma cor fora das 12 horas, gere com [`potyro-color.js`](potyro-color.js) (seção 3.1).
4. **Todo texto** (botões, mensagens, nomes, exemplos) segue o [REDACAO.md](REDACAO.md).
5. Antes de entregar, rode o checklist da seção 13.

**Precedência:** o pedido explícito do usuário vem primeiro, depois este documento, depois o seu gosto. Num app gerado, o prompt só muda o que a seção 8.2 permite. Acessibilidade (seção 11) fica acima de tudo isso: quando o prompt pedir algo que quebra uma regra de acessibilidade, siga a regra e diga o motivo em uma linha.

---

## 1. A ideia

O logo explica o sistema inteiro:

- **As letras são grafite.** Têm traço grosso, espessura constante, pontas redondas e círculos perfeitos.
- **O "y" é uma pessoa de braços pra cima**, com uma bolinha de cabeça. É quem *cria* o app.
- **O espaço negativo do "y" é uma caneta tinteiro**, passando a ideia de autoria.
- **Só um traço do "y" tem cor**, e essa cor muda (rosa, magenta, vermelho, laranja, amarelo, sálvia, azul).

O sistema do Potyro funciona do mesmo jeito: uma base neutra, calma e redonda, e **um traço de cor por app**. E a cor de cada traço sai de uma regra só, o relógio de traços (seção 3.1). A alegria está no gesto (o bonequinho comemorando, o texto que fala como gente, a cor em blocos na landing). A estrutura continua simples.

---

## 2. Princípios

**1. Um traço de cor.** Cada tela usa um acento só, o traço daquele app. Todo o resto é grafite, cinza e branco. Duas cores de acento na mesma tela é erro. A única exceção são **dados com categoria** (etiquetas, grupos, séries de gráfico), que seguem a seção 3.1, "Cores de categoria".

**2. Redondo e de traço grosso.** Bordas de 2px, pontas redondas, cantos arredondados, círculos. Nada de linhas finas de 1px em controles e nada de cantos vivos.

**3. Direto ao ponto.** Uma ação principal por tela. Frases curtas. Se dá pra tirar um elemento sem perder nada, tire.

**4. Claro no meio, animado nas bordas.** A animação fica nos momentos de borda: tela vazia, sucesso, 404, onboarding. Em erro, pagamento, exclusão e dados do usuário, o texto é calmo e sem piada (REDACAO.md, seção 3).

---

## 3. Fundamentos

### 3.1 Cor

#### Neutros (vêm do logo)

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `--bg` | `#ffffff` | `#1c1b1c` | Fundo da página |
| `--surface` | `#f3f3f4` | `#2a2829` | Cards preenchidos, blocos, chips |
| `--surface-2` | `#e6e5e7` | `#414042` | Hover de surface, trilhos de toggle/progresso |
| `--ink` | `#231f20` | `#f3f3f4` | Texto principal |
| `--ink-soft` | `#414042` | `#e6e5e7` | Grafite do logo: títulos grandes, ícones, botão secundário |
| `--muted` | `#6d6b6e` | `#a8a6aa` | Texto secundário, metadados |
| `--line` | `#e6e5e7` | `#3a3839` | Divisores decorativos |
| `--line-strong` | `#8c8a8e` | `#858387` | Borda de inputs, checkbox, botão secundário |

`--muted` passa 4.5:1 sobre `--bg` e `--surface`. **Não use `--muted` sobre `--surface-2`.** Ali o texto é `--ink`.

#### O relógio de traços

**Toda cor do Potyro é só um ângulo. A luz e a intensidade são do sistema.**

O matiz (de 0° a 360°, no espaço de cor OKLCH) é um relógio de 12 horas, de 30° em 30°. O rosa Potyro fica no meio-dia. Quem escolhe a cor de um app escolhe só a hora (ou um ângulo qualquer), e o algoritmo gera o resto. Como a luminosidade é calculada, e não escolhida, toda cor gerada passa no contraste, sem tabela de exceções.

Cada cor tem três níveis, com nomes de caneta (como a caneta-tinteiro no espaço negativo do "y"):

| Token | Nível | O que é | Onde usar |
|---|---|---|---|
| `--traco` | **Traço** | A versão mais viva do matiz | Blocos, ilustração, o "y", barras de gráfico, bloco do card de app. **Texto em cima só com 24px ou mais, em grafite.** |
| `--tinta` | **Tinta** | A versão que passa contraste como texto (≥ 5:1 no fundo, ≥ 4.6:1 em `--surface`) | Links, ícones ativos, números em destaque, anel de foco (`--focus`) |
| `--aguada` | **Aguada** | A cor lavada, quase branca no claro e quase grafite no escuro | Chip selecionado, linha selecionada, banner leve. **Texto em cima é `--ink`.** |
| `--accent` + `--on-accent` | Botão | Traço com texto escuro, se o contraste deixar. Senão, tinta com texto branco (no escuro: sempre texto `#1c1b1c`) | Botão primário, toggle ligado, item ativo da tab bar |

| Hora | Nome | Matiz | Traço | Tinta (claro) | Aguada (claro) | Botão (claro) | Tinta (escuro) | Aguada (escuro) |
|---|---|---|---|---|---|---|---|---|
| 12h | rosa (Potyro) | 0° | `#e44f89` | `#ca2b70` | `#ffeaef` | tinta + branco | `#f87da7` | `#44212d` |
| 1h | vermelho | 30° | `#e54e3c` | `#d02e1e` | `#ffebe7` | tinta + branco | `#f88574` | `#46221d` |
| 2h | laranja | 60° | `#f69536` | `#a05e1c` | `#ffecde` | traço + grafite | `#f1902f` | `#42270e` |
| 3h | amarelo | 90° | `#e2b93c` | `#846b1c` | `#f8f0d8` | traço + grafite | `#cca630` | `#382c07` |
| 4h | lima | 120° | `#b0cd3d` | `#64751b` | `#edf4dc` | traço + grafite | `#9fb931` | `#2a320f` |
| 5h | verde | 150° | `#49de78` | `#1f7e3f` | `#e2f7e5` | traço + grafite | `#37ca68` | `#17351f` |
| 6h | menta | 180° | `#44d8c1` | `#1f7b6d` | `#daf8f1` | traço + grafite | `#37c3ae` | `#00372f` |
| 7h | ciano | 210° | `#44d3e9` | `#1f7885` | `#d9f7fc` | traço + grafite | `#37bed3` | `#00353c` |
| 8h | azul | 240° | `#37adf3` | `#1e74a6` | `#e2f3ff` | traço + grafite | `#4db5f7` | `#0f3146` |
| 9h | anil | 270° | `#5d7bf1` | `#4761e4` | `#eaf0ff` | tinta + branco | `#8da7f7` | `#232c49` |
| 10h | roxo | 300° | `#9964e5` | `#884dd5` | `#f2edff` | tinta + branco | `#b995f7` | `#322745` |
| 11h | magenta | 330° | `#dc6ad4` | `#b23bac` | `#fde9fb` | traço + grafite | `#ee75e6` | `#3d233b` |

O traço é o mesmo nos dois temas. Tudo isso já está pré-calculado em `potyro-tokens.css`: basta `<html data-traco="laranja">`.

**Cores fora das 12 horas.** Um app pode usar qualquer ângulo. Gere com o [`potyro-color.js`](potyro-color.js):

- No navegador: `PotyroColor.apply(document.documentElement, 135)`. Aceita um ângulo, um nome de hora ou um hex, do qual ele extrai só o matiz.
- No terminal: `node potyro-color.js 135`.

Nunca ajuste à mão a luminosidade ou a intensidade de uma cor gerada.

**O algoritmo**, para quem precisar reimplementar (os parâmetros ficam no topo de `potyro-color.js` e só mudam lá):

| Nível | Luminosidade (L) | Intensidade (C) |
|---|---|---|
| Traço | A luminosidade em que o matiz é mais vivo, presa entre 0.62 e 0.80 | 88% do máximo que cabe na tela, até 0.19 |
| Tinta, claro | A mais alta que dá ≥ 5:1 em `#ffffff` e ≥ 4.6:1 em `#f3f3f4` | 90% do máximo, até 0.20 |
| Tinta, escuro | A mais baixa, a partir de 0.74, que dá ≥ 5:1 em `#1c1b1c` e ≥ 4.6:1 em `#2a2829` | 90% do máximo, até 0.20 |
| Aguada | 0.955 no claro, 0.30 no escuro | até 0.032 no claro, até 0.055 no escuro |
| Botão | Traço com texto escuro se o contraste for ≥ 4.5:1. Senão, tinta com texto branco. | |

**Quanto de cor:** em telas de produto (app Potyro e apps gerados), o acento ocupa **no máximo 10% da área**. Na landing ele pode ocupar até metade (ver seção 9).

**12h é do Potyro.** Os apps gerados usam as outras 11 horas. Só use o rosa num app gerado se o usuário pedir.

#### Status

Status são horas fixas do relógio, no nível tinta:

| Token | Hora | Claro | Escuro |
|---|---|---|---|
| `--danger` | 1h vermelho | `#d02e1e` | `#f88574` |
| `--warning` | 3h amarelo | `#846b1c` | `#cca630` |
| `--warning-fill` | 3h amarelo, traço | `#e2b93c` (texto `--on-warning-fill`, grafite nos dois temas) | `#e2b93c` |
| `--success` | 5h verde | `#1f7e3f` | `#37ca68` |

Status **sempre** leva ícone + palavra, nunca só cor. Num app vermelho, laranja ou verde, o status tem a mesma cor do acento, e só o ícone e a palavra diferenciam os dois. Status não é acento e não conta para a regra de um traço.

#### Cores de categoria

Quando os **dados do app** têm categorias (etiquetas de tarefa, colunas de um quadro, séries de um gráfico, membros de um bolão), as categorias usam outras horas do relógio. Elas identificam dados e não são acento: não pintam botões, links ou navegação.

| Token | É o nível | Uso |
|---|---|---|
| `--cat-X` | tinta | Ponto, ícone e linha de gráfico |
| `--cat-X-fill` | traço | Barras, fatias, blocos. Sempre com rótulo em texto. |
| `--cat-X-soft` | aguada | Fundo do chip de categoria. Texto sobre ele: `--ink`. |

`X` é o nome da hora (`vermelho`, `laranja`, `amarelo`, `lima`, `verde`, `menta`, `ciano`, `azul`, `anil`, `roxo`, `magenta`).

Regras:

- **Anda 5 horas.** A primeira categoria é a hora do app, e cada nova categoria anda 5 horas no relógio, pulando o 12h. Um app verde (5h) fica com verde, roxo, amarelo, azul, vermelho. `PotyroColor.categorias("verde", 5)` devolve essa lista. Andar 5 horas mantém categorias seguidas sempre a 150° de distância.
- **No máximo cinco categorias coloridas.** A partir da sexta, as horas começam a ficar vizinhas. Use cinza (`--surface-2` com texto `--ink`) e agrupe em "Outros" quando for gráfico.
- A mesma categoria tem sempre a mesma cor em todas as telas do app.
- **Cor nunca sozinha:** toda categoria tem nome visível (texto no chip, rótulo direto na barra ou legenda colada ao gráfico).
- Sem categorias nos dados, sem cores de categoria. Não use isso para decorar.

### 3.2 Tipografia

| Papel | Fonte | Pesos | Onde |
|---|---|---|---|
| Display | **Quicksand** (`--font-display`) | 600, 700 | Títulos, nome do app, números grandes. É a fonte da tagline do logo: terminais redondos como o wordmark. |
| Corpo / UI | **Figtree** (`--font-body`) | 400, 500, 600, 700 | Todo o resto: texto, botões, inputs, rótulos |
| Mono | **DM Mono** (`--font-mono`) | 400, 500 | Código, IDs, prompts mostrados como dado |

| Token | Tamanho | Altura de linha | Fonte / peso |
|---|---|---|---|
| `--text-hero` | 64px | 1.0 | Quicksand 700. Só na landing. No celular, 44px. |
| `--text-display` | 40px | 1.1 | Quicksand 700 |
| `--text-h1` | 32px | 1.15 | Quicksand 700 |
| `--text-h2` | 24px | 1.25 | Quicksand 700 |
| `--text-h3` | 20px | 1.3 | Figtree 600 |
| `--text-body` | 16px | 1.5 | Figtree 400 |
| `--text-small` | 14px | 1.45 | Figtree 400/500 |
| `--text-micro` | 12px | 1.4 | Figtree 600, só rótulos |

Regras:

- Quicksand **só a partir de 20px** e **só nos pesos 600/700**. Abaixo disso ela fica frágil. Use Figtree.
- Títulos com `text-wrap: balance` e letter-spacing `-0.01em`.
- **Caixa de frase** em tudo ("Criar app", não "Criar App"). CAIXA ALTA só em `--text-micro`, com letter-spacing `0.06em`.
- Linhas de texto corrido com no máximo ~65 caracteres.
- Números em tabela ou lista usam `font-variant-numeric: tabular-nums`.

### 3.3 Forma

O logo é feito de traço grosso com ponta redonda. Tudo deriva disso.

| Token | Valor | Uso |
|---|---|---|
| `--stroke` | 2px | Toda borda de controle, todo ícone, anel de foco |
| `--radius-sm` | 8px | Tooltip, imagem pequena, chip quadrado |
| `--radius-md` | 12px | Input, menu, dropdown |
| `--radius-lg` | 20px | Card, sheet, modal |
| `--radius-pill` | 999px | Botão, chip, toggle, badge, busca |

- **Botões são sempre pílula.** É a ponta redonda do traço.
- Avatares, indicadores e pontos são **círculos perfeitos**, como o "o" e a cabeça do bonequinho.
- **Sem sombras**, a não ser `--shadow-float` em elementos que flutuam (menu, toast, sheet, popover). Para separar um card do fundo, use preenchimento (`--surface`) **ou** borda (`--stroke` em `--line`), nunca as duas coisas e nunca sombra.
- Sem gradientes. Sem cards com faixa colorida na lateral. Sem vidro/blur.

### 3.4 Espaço e layout

Escala de base 4: `--space-1` 4 · `--space-2` 8 · `--space-3` 12 · `--space-4` 16 · `--space-5` 24 · `--space-6` 32 · `--space-7` 48 · `--space-8` 64 · `--space-9` 96.

- Use `gap` em flex/grid, não margem em cada elemento.
- Margem lateral mínima de **16px** no celular e de **24px** a partir de 768px.
- Largura máxima de conteúdo: **1120px** na landing, **720px** em apps gerados de conteúdo (lista, formulário, leitura) e **1120px** em apps de painel.
- **Mobile primeiro.** Apps do Potyro são compartilhados por link e a maioria abre no celular. Desenhe para 375px e depois expanda.
- Área de toque mínima de **44×44px**.

### 3.5 Ícones

- **Lucide**, `stroke-width: 2`, `stroke-linecap: round`, `stroke-linejoin: round`. É o mesmo traço do logo.
- Tamanhos: 16px (inline com `--text-small`), 20px (padrão), 24px (tab bar, ações principais).
- Cor: `--ink-soft` por padrão, `--tinta` quando ativo.
- **Sem emoji na interface.** O único personagem é o bonequinho do logo (seção 4.2).

### 3.6 Movimento

| Token | Valor | Uso |
|---|---|---|
| `--dur-fast` | 120ms | Hover, press |
| `--dur-base` | 200ms | Abrir menu, trocar de aba |
| `--dur-slow` | 320ms | Sheet, modal, transição de tela |
| `--ease-out` | `cubic-bezier(.22,1,.36,1)` | Padrão |
| `--ease-boing` | `cubic-bezier(.34,1.56,.64,1)` | Entrada de coisas **pequenas**: chip, toast, check, o bonequinho |

- Press de botão: `transform: scale(0.97)`.
- O "boing" é o tempero. Use em **um** momento por tela, não em tudo.
- Respeite `prefers-reduced-motion`: troque movimento por fade ou por nada.

---

## 4. Marca

### 4.1 Logo

- **Nunca redesenhe, re-tipografe ou aproxime o logo.** Use o SVG original.
- Versões: wordmark grafite em fundo claro, wordmark branco em fundo grafite (`#414042`) e o símbolo (o "y") em círculo ou quadrado arredondado para ícone e favicon.
- O traço colorido do "y" segue o traço do contexto: rosa no Potyro e o traço do app em "Feito com Potyro".
- **As variações atuais do logo usam cores anteriores ao relógio.** Até o logo ganhar as 12 horas, o selo de um app usa a variação do logo com a hora mais próxima. Se nenhuma estiver a menos de uma hora de distância, use o símbolo com o traço grafite. Não pinte o logo por conta própria.
- Respiro mínimo em volta do logo: a altura do "o".
- Tamanho mínimo: wordmark com 80px de largura e símbolo com 20px.
- Não aplique o logo sobre um bloco de traço colorido, não gire, não aplique sombra nem contorno.
- Tagline: **author your own apps**, minúsculas. Use a versão em contorno do SVG, não redigite.

### 4.2 O bonequinho

O "y" do logo é uma pessoa de braços pra cima. Ele é o mascote e aparece em **momentos de borda**:

- **Sucesso** (app publicado, primeiro app criado): ele entra com `--ease-boing`.
- **Tela vazia:** ele aparece pequeno ao lado do texto.
- **Carregamento longo** (gerando o app): o traço colorido se desenha (animação de `stroke-dashoffset`).
- **404**.

Regras: use a forma do logo, não desenhe variações com rosto, roupa ou outras poses. No máximo um por tela. Nunca em erro, pagamento ou exclusão.

---

## 5. Voz e texto

A voz e as regras de escrita estão no **[REDACAO.md](REDACAO.md)**. O resumo:

- **Simples, curto e claro.** Palavras de todo dia, uma ideia por frase, a informação mais importante primeiro.
- **Animado e amigável, com cara de feito em casa.** Como um bilhete na geladeira, não como um manual.
- **O volume da animação muda com o momento:** alto para comemorar e zero em erro, dinheiro e exclusão.
- Botões com verbo ("Criar app"), fala com "você", sem marcar gênero de quem lê, no máximo uma exclamação por tela e sem emoji.

---

## 6. Componentes

Todos usam os tokens. Estados obrigatórios: padrão, hover, press, foco (`:focus-visible` com anel `--stroke` em `--focus` e offset de 2px), desabilitado (opacidade 0.4, sem hover) e carregando, quando houver.

**Botão**
- Pílula. Altura de 48px (grande), 40px (padrão) ou 32px (compacto). Padding horizontal de `--space-5`. Figtree 600.
- **Primário:** fundo `--accent`, texto `--on-accent`. **Um por tela.**
- **Secundário:** fundo transparente, borda `--stroke` em `--line-strong`, texto `--ink`.
- **Fantasma:** só texto `--ink-soft`; no hover, fundo `--surface`.
- **Perigo:** fundo `--danger`, texto branco (claro) ou `#1c1b1c` (escuro). Só em confirmação de exclusão.
- Ícone à esquerda, 20px, gap de `--space-2`.

**Input / textarea**
- Fundo `--bg`, borda `--stroke` em `--line-strong` (3:1, o contorno precisa ser visível) e raio `--radius-md`. Altura de 48px.
- No foco, a borda vira `--tinta`. Com erro, a borda vira `--danger` e aparece uma mensagem abaixo em `--text-small` com ícone.
- Label sempre visível acima (Figtree 500, `--text-small`). Placeholder é exemplo, não label.

**Caixa de prompt** (o componente central do Potyro)
- Textarea grande com raio `--radius-lg`, fundo `--bg`, borda `--stroke` em `--line-strong`, `--text-body` e altura mínima de 3 linhas. No foco, a borda vira `--tinta`.
- Botão primário redondo (44px, só ícone de seta) no canto inferior direito, dentro da caixa.
- Abaixo, de 3 a 4 chips de exemplo clicáveis com prompts reais e curtos.
- O placeholder sempre traz um exemplo concreto.

**Card**
- Raio `--radius-lg` e padding `--space-5`. Fundo `--surface` **ou** borda `--stroke` `--line`.
- Card clicável: no hover, fundo `--surface-2`; no press, `scale(0.98)`.

**Card de app** (galeria, "meus apps")
- Topo com um bloco de `--traco` do app (altura de 96px, cantos de cima `--radius-lg`) e o símbolo/inicial do app em Quicksand 700 grafite.
- Abaixo: nome (Quicksand 700, 20px), uma linha de descrição (`--muted`) e metadado (quem fez e quando).

**Chip / tag**
- Pílula com altura de 32px e Figtree 500 `--text-small`.
- Padrão: fundo `--surface`, texto `--ink`. Selecionado: fundo `--aguada`, texto `--ink`, com um ponto de 8px em `--tinta` à esquerda (a "cabeça").

**Etiqueta de categoria**
- Pílula com altura de 24px, fundo `--cat-X-soft`, ponto de 8px em `--cat-X` e texto `--ink` em Figtree 500 `--text-small`.
- Em listas e quadros, fica alinhada sempre no mesmo lugar de cada item.

**Gráfico**
- Barras e fatias em `--cat-X-fill`, com raio `--radius-sm` só na ponta da barra. Linhas em `--cat-X` com `--stroke` e ponta redonda.
- Grade em `--line`, sem eixo pesado. Rótulos e valores em `--muted` `--text-small`, com `tabular-nums`.
- Valores escritos direto nas barras ou nos pontos finais. Legenda separada só quando não couber.
- Com uma série só, use a cor do app (`--tinta` para linhas, `--traco` para barras).

**Toggle**
- Pílula de 44×28px. Desligado: trilho `--surface-2` com borda `--stroke` `--line-strong`, bolinha branca. Ligado: trilho `--accent`, bolinha `--on-accent`. A bolinha usa `--ease-boing`.

**Lista**
- Itens com 56px de altura mínima, divisor `--line` e padding horizontal `--space-4`.
- Ação secundária à direita, em ícone de 20px `--muted`.

**Navegação**
- Apps gerados no celular: **tab bar inferior** com até 4 itens, ícone de 24px e rótulo `--text-micro`. O ativo fica com ícone e rótulo em `--tinta` e um ponto de 4px acima.
- No desktop: barra superior de 64px, com nome do app à esquerda (Quicksand 700) e ações à direita.

**Sheet / modal**
- No celular, use sheet que sobe de baixo (raio `--radius-lg` em cima e alça de 36×4px). No desktop, use modal centralizado com 480px de largura máxima.
- `--shadow-float` e fundo atrás com `rgba(35,31,32,.4)`.

**Toast**
- Pílula grafite (`--ink-soft` com texto `--bg`; no escuro, `--surface-2` com texto `--ink`). Embaixo, no centro. Some em 4 segundos se for só informativo; com ação, segue a seção 11.6. Entra com `--ease-boing`.

**Tela vazia**
- Bonequinho de 48px, uma frase de título (Quicksand 700, 20px), uma frase de apoio (`--muted`) e um botão primário. Nada mais.

**Selo "Feito com Potyro"**
- Em todo app gerado: rodapé ou canto inferior, pílula `--surface` com símbolo de 16px (traço na cor do app) e "Feito com Potyro" em `--text-micro`. Leva à landing. Discreto, sempre presente e nunca removido por prompt.

---

## 7. Imagem e ilustração

- Prefira **forma e cor** a fotos: blocos de `--traco`, círculos e pílulas grossas.
- Se o app pedir fotos (receitas, imóveis, produtos), use proporção 4:3 ou 1:1, raio `--radius-md` e nenhum filtro.
- Nada de ilustração 3D, gradiente de malha, pessoas de banco de imagem ou arte gerada genérica.

---

## 8. Apps gerados pelo Potyro

Esta é a superfície mais importante: o agente cria um app novo a partir de um prompt, e ele precisa parecer Potyro sem parecer igual aos outros.

### 8.1 O que nunca muda

Fontes, neutros, escala de tipo, espaçamento, raios, `--stroke`, ícones Lucide, componentes da seção 6, regras de contraste, o selo "Feito com Potyro" e a voz do REDACAO.md (adaptada ao assunto do app).

### 8.2 O que o prompt pode mudar

| Parâmetro | Opções | Como decidir |
|---|---|---|
| **Traço** | uma das 11 horas (vermelho a magenta) ou qualquer ângulo | Ver 8.3 |
| **Nome** | Texto curto | O que o usuário escreveu. Se não escreveu, crie um nome de 1 a 3 palavras, concreto e sem trocadilho forçado. |
| **Tema** | claro, escuro, sistema | Padrão: sistema. |
| **Densidade** | confortável (padrão), compacta | Compacta só para tabelas e painéis com muitos dados: itens de lista com 44px e padding de card `--space-4`. |
| **Padrão de layout** | lista, formulário, quadro, painel, galeria, página única | O que a tarefa do app pede. Ver 8.4. Galeria com imagens de alturas variadas usa **mosaico** (colunas de largura igual, alturas livres, gap `--space-2`, imagem com `--radius-md` e título abaixo, sem card em volta). Quadro (colunas de status, como num kanban) usa uma etiqueta de categoria por coluna. |
| **Volume da animação** | alto, médio ou baixo (REDACAO.md, seção 3) | Um app de bolão pode ir no alto. Um app de remédios fica sempre no baixo. |

Se o prompt pedir algo fora disso (outra fonte, gradiente, cor neon, cor pastel), **aproxime para o mais perto do sistema** e diga em uma linha o que foi adaptado. Exemplo: pediu "verde-neon", recebeu verde (5h) na intensidade do sistema.

### 8.3 Escolhendo o traço

1. **O prompt cita uma cor?** Use o matiz dela. Se for um nome comum, use a hora: vermelho 1h, laranja 2h, amarelo/dourado 3h, verde-limão 4h, verde 5h, menta/turquesa 6h, ciano/azul-claro 7h, azul 8h, azul-escuro/anil 9h, roxo/lilás 10h, magenta/pink 11h. Se for um hex ou uma cor de marca, passe para `PotyroColor.cor("#hex")`, que fica só com o matiz. Marrom vira laranja e bege vira amarelo, porque o sistema não faz cores escuras ou acinzentadas.
2. **Não cita?** Escolha pelo assunto:
   - dinheiro, trabalho, organização: **azul** (8h)
   - saúde, bem-estar, água, viagem: **menta** (6h) ou **ciano** (7h)
   - comida, receita, energia: **laranja** (2h)
   - escola, crianças, ideias, lembretes: **amarelo** (3h)
   - natureza, plantas, casa, hábitos: **verde** (5h) ou **lima** (4h)
   - festa, música, jogos, social: **magenta** (11h) ou **roxo** (10h)
   - esporte, times, bolão, competição: **vermelho** (1h)
   - leitura, estudo, foco, noite: **anil** (9h)
3. **Empatou ou não sabe?** Escolha qualquer hora, menos a última usada por esse usuário.

Defina com `<html data-traco="laranja">` (ou com `PotyroColor.apply` para um ângulo). A cor aparece só onde a seção 3.1 manda: botão primário, item ativo, link, foco, seleção, o bloco do card de app e o traço do "y" no selo.

### 8.4 Estrutura de tela

- **Topo:** nome do app em Quicksand 700 (`--text-h2` no celular, `--text-h1` no desktop) e, opcionalmente, uma linha de descrição em `--muted`.
- **Corpo:** o conteúdo da tarefa. A primeira tela **já mostra o app funcionando**, com exemplos marcados como exemplo quando não houver dados reais. Nunca entregue uma tela vazia esperando input.
- **Ação principal:** um botão primário, fixo embaixo no celular (pílula 48px, largura total menos 16px de cada lado) quando a ação for recorrente ("Adicionar item").
- **Rodapé:** selo "Feito com Potyro".

### 8.5 Compartilhamento

Todo app gerado tem:

- `<title>`: o nome do app.
- **Imagem de compartilhamento** (1200×630): fundo `--bg`, bloco de `--traco` ocupando o terço direito, nome do app em Quicksand 700 (96px, `--ink`) à esquerda e selo "Feito com Potyro" embaixo à esquerda.
- **Favicon:** círculo `--traco` com a inicial do app em Quicksand 700, grafite `#231f20`.

---

## 9. Landing page

A landing é onde o Potyro pode ser **ousado**. O produto é calmo, e a vitrine pode ser barulhenta.

- **Blocos de cor:** aqui as horas do relógio aparecem juntas, em `--traco`, como **blocos grandes e chapados** com raio `--radius-lg` ou pílulas gigantes, que podem vazar pela borda da tela. Esse é o lugar onde a regra de um traço é quebrada, e só aqui.
- **Tipografia grande:** `--text-hero` em Quicksand 700, grafite. Texto nunca vai em cima de bloco colorido, a não ser grafite `#231f20` com 24px ou mais.
- **CTA:** sempre rosa Potyro (`--accent` padrão). Um texto só em toda a página ("Criar meu app"), repetido no topo e no fim.
- **Estrutura:**
  1. **Hero:** título curto, subtítulo de uma frase e a **caixa de prompt de verdade**, funcionando. O produto é a demonstração.
  2. **Galeria:** apps reais feitos com o Potyro, em cards de app, cada um no seu traço. É aqui que os blocos coloridos aparecem naturalmente.
  3. **Como funciona:** três passos (descreva, ajuste, compartilhe). É uma sequência real, então numerar faz sentido.
  4. **Fechamento:** wordmark grande, a tagline e o CTA.
- O bonequinho pode aparecer grande (até 240px) uma vez, no hero ou no fechamento.
- Uma ideia de interação: o próprio relógio. Doze traços em círculo, e o "y" do hero troca de cor conforme a hora passa (com `prefers-reduced-motion`, fica parado no rosa).
- Sem depoimento inventado, número inventado ou logo de cliente que não existe.

Exemplos de texto para o hero (escolha um ou siga o tom):

- **Descreva. Pronto, é um app.**
- **Seu app, do seu jeito, em um prompt.**
- **Pare de procurar o app certo. Faça o seu.**

---

## 10. App Potyro (a plataforma)

É onde a pessoa cria, ajusta e compartilha. Precisa sumir para o app dela aparecer.

- **Só rosa Potyro** como acento na interface da plataforma.
- O **preview** do app que está sendo criado aparece numa moldura de celular (raio de 32px, borda `--stroke` `--line`) e roda no traço do app. É o único lugar da plataforma onde aparece outro traço.
- Layout no desktop: caixa de prompt e histórico de ajustes à esquerda (400px) e preview à direita. No celular, use abas "Conversa" e "App".
- Ajustes rápidos acima do preview: cor, tema e nome. O seletor de cor **é um relógio**: 11 bolinhas de 24px em círculo, nas posições das horas, com o 12h vazio porque é do Potyro. A escolhida ganha anel `--stroke` `--ink`. No centro, um campo "ângulo" para quem quiser uma cor fora das horas. Cada bolinha tem nome acessível ("Laranja, 2 horas").
- O botão primário da plataforma é **"Publicar"** antes de publicar e **"Copiar link"** depois.

---

## 11. Acessibilidade

**A meta é WCAG 2.2 nível AA em tudo:** no app Potyro, na landing e em **todo app gerado**. No Brasil, a Lei Brasileira de Inclusão (Lei 13.146/2015) também exige sites acessíveis. Acessibilidade não é ajuste final nem opção do prompt: um app que não passa nesta seção não está pronto.

Quando uma regra daqui conflitar com qualquer outra coisa (pedido do usuário, estética, este próprio documento), vale esta seção. Explique a adaptação em uma linha.

### 11.1 Cor e contraste

| O quê | Mínimo | Como o sistema garante |
|---|---|---|
| Texto normal | 4.5:1 | `--ink`, `--muted`, `--tinta` e `--on-accent` já passam nos fundos que a seção 3.1 indica |
| Texto grande (24px+, ou 19px+ em negrito) | 3:1 | Grafite sobre qualquer `--traco` |
| Bordas de controle, ícones com significado, anel de foco | 3:1 | `--line-strong`, `--tinta`, `--focus` |
| Estado de componente (toggle, checkbox, aba ativa) | 3:1 contra o vizinho | Trilho do toggle com borda, aba ativa com ponto e rótulo em `--tinta` |

- **Só use as combinações que a seção 3.1 indica.** O algoritmo garante o contraste delas. Qualquer outra combinação precisa ser medida.
- **Nunca use a cor como único sinal.** Status leva ícone e palavra, categorias levam nome, links no meio do texto são sublinhados e campos com erro mostram mensagem escrita.
- **Teste os dois temas.** Uma combinação que passa no claro pode falhar no escuro.
- **Texto sobre imagem** precisa de um fundo sólido atrás (`--bg` ou `--ink-soft`). Não confie em sombra no texto.
- **Desabilitado** (opacidade 0.4) não precisa passar contraste, mas não pode ser a única forma de explicar por que algo não funciona: diga em texto.

### 11.2 Teclado e foco

- **Tudo que funciona com o dedo funciona com o teclado:** Tab e Shift+Tab navegam, Enter e Espaço ativam, Esc fecha. A ordem do Tab segue a ordem de leitura.
- **Foco sempre visível:** anel de 2px em `--focus`, com offset de 2px, em `:focus-visible`. Nunca use `outline: none` sem substituto.
- **Foco nunca escondido:** a barra fixa de baixo e a tab bar não podem cobrir o elemento focado. Use `scroll-padding-bottom` com a altura delas.
- **Primeiro item da página:** um link "Pular para o conteúdo", visível quando recebe foco.
- **Sheet e modal:** o foco entra no primeiro campo (ou no título), fica preso dentro enquanto está aberto, Esc fecha, e ao fechar o foco volta para quem abriu.
- **Sem armadilhas:** nenhum componente pode prender o foco sem saída.

### 11.3 Leitor de tela e semântica

- **Use o elemento HTML certo:** `<button>` para ações, `<a>` para navegação, `<input>` com `<label>`. Uma `<div>` clicável é erro.
- **Estrutura:** `<html lang="pt-BR">`, um `<h1>` por tela (o nome do app ou da tela), títulos em ordem sem pular nível e as regiões `<header>`, `<nav>`, `<main>` e `<footer>`.
- **Toda tela tem `<title>` único**, por exemplo "Lista de compras · Mercado".
- **Botão só com ícone tem nome:** `aria-label="Criar app"` na seta da caixa de prompt e `aria-label="Apagar item"` na lixeira.
- **Imagens:** `alt` descreve o conteúdo ("Bolo de cenoura com cobertura de chocolate"). Imagem decorativa, blocos de cor e o bonequinho usam `alt=""`, exceto na tela de sucesso, onde o texto ao lado já diz o que aconteceu.
- **Estados com ARIA:** o item ativo da tab bar tem `aria-current="page"`, o toggle tem `role="switch"` com `aria-checked`, o chip selecionável tem `aria-pressed` e o grupo de abas usa `role="tablist"`.
- **Mudanças anunciadas:** o toast usa `role="status"`, o erro que bloqueia usa `role="alert"` e "Montando seu app" fica numa região `aria-live="polite"` com o progresso em texto.
- **Gráficos** têm resumo em texto ("Gastos de março: mercado R$ 820, a maior categoria") e, quando houver muitos dados, uma tabela alternativa.

### 11.4 Toque e ponteiro

- **Área de toque mínima de 44×44px**, com 8px entre alvos vizinhos. A WCAG pede 24px, mas o Potyro usa 44.
- **Gesto nunca é o único caminho:** deslizar para apagar também tem um botão. Arrastar no quadro também tem "Mover para…" no menu do item.
- **A ação acontece ao soltar o dedo**, não ao encostar, para dar para desistir arrastando para fora.
- **Nada só no hover:** o que aparece no hover aparece também no foco e tem alternativa no toque.

### 11.5 Texto, zoom e layout

- **Tamanhos em `rem`.** A página precisa funcionar com zoom de 200% e com o texto aumentado pelo sistema.
- **Reflow:** a página funciona em 320px de largura sem rolagem horizontal (só tabelas e gráficos podem rolar dentro do próprio container).
- **Espaçamento de texto:** nada quebra se o usuário aumentar a altura de linha, o espaço entre letras ou o espaço entre palavras. Não use altura fixa em containers com texto.
- **Inputs com fonte de pelo menos 16px**, senão o iOS dá zoom ao focar.
- **Sem texto dentro de imagem**, a não ser o logo.
- **Orientação livre:** funciona em retrato e paisagem.

### 11.6 Movimento e tempo

- **`prefers-reduced-motion`:** o "boing" vira fade, o traço que se desenha vira barra de progresso, e o relógio da landing para. Os tokens já cortam as durações; componentes com JavaScript também precisam checar.
- **Nada pisca mais de 3 vezes por segundo.**
- **Toast some em 4 segundos só quando é informativo.** Toast com ação ("Desfazer") fica até a pessoa fechar ou por pelo menos 10 segundos, e pausa enquanto tem foco ou o cursor em cima. Informação importante nunca aparece só num toast.
- **Sem limite de tempo** para preencher nada. Se existir um, avise antes e deixe estender.
- **Nada toca som sozinho.**

### 11.7 Formulários

- **Label sempre visível**, ligado ao campo. Placeholder não é label.
- **Obrigatório em texto:** "(obrigatório)" no label, não só um asterisco.
- **Erro em texto**, perto do campo, ligado por `aria-describedby`, dizendo como resolver ("Use um e-mail com @, como nome@exemplo.com"). Ao enviar com erro, o foco vai para o primeiro campo com problema.
- **Valide ao sair do campo ou ao enviar**, não a cada tecla.
- **Nunca apague o que a pessoa digitou** por causa de um erro.
- **`autocomplete`** certo em nome, e-mail, telefone e endereço.
- **Não peça a mesma informação duas vezes** no mesmo fluxo.
- **Login sem charada:** sem quebra-cabeça ou teste de memória. Permita colar a senha e usar gerenciador de senhas.

### 11.8 Linguagem

- O tom da seção 5 já ajuda: frases curtas, palavras comuns, um assunto por frase.
- **Link diz para onde vai:** "Ver o app", não "clique aqui".
- **Ajuda sempre no mesmo lugar** em todas as telas do app.
- Sem abreviação sem explicação. Números e datas por extenso quando houver dúvida ("3 de março", não "03/03").

### 11.9 Apps gerados

- **O prompt não desliga acessibilidade.** Se a pessoa pedir "texto cinza clarinho", "sem contorno no foco" ou "só ícones, sem texto", entregue a versão acessível mais perto do pedido e explique em uma linha.
- O agente que gera o app é responsável por: `lang`, `<title>`, títulos, labels, nomes de botões de ícone, `alt` e as alternativas aos gestos. Nada disso fica para o usuário.
- O conteúdo de exemplo também precisa ser acessível (imagens de exemplo com `alt`).

### 11.10 Como testar

Antes de entregar qualquer tela:

1. **Verificação automática** com axe (ou Lighthouse, no item Acessibilidade): zero erros.
2. **Só teclado:** percorra a tela inteira com Tab, use tudo e feche tudo com Esc, sem mouse.
3. **Leitor de tela:** VoiceOver (Mac e iPhone) ou TalkBack (Android). Os títulos, botões e mudanças fazem sentido só ouvindo?
4. **Zoom de 200%** e largura de 320px.
5. **Tema escuro** e **movimento reduzido** ligados.
6. **Escala de cinza:** dá para entender tudo sem cor?

---

## 12. De onde vem cada ideia

| Referência | O que pegamos | O que não pegamos |
|---|---|---|
| [Animalia](https://doc.animaliads.io/) | Personalidade brasileira; marca que brinca sem perder clareza | Variedade de cores por componente |
| [Tangerina (Smiles)](https://tangerina.golsmiles.com.br/) | Organização de tokens; acessibilidade como regra | Densidade de produto de companhia aérea |
| [Montage (Wanted)](https://montage.wanted.co.kr/) | Rigor de escala tipográfica e espaçamento; neutros limpos | Tom corporativo |
| [MongoDB LeafyGreen](https://www.mongodb.design/component/palette/live-example) | Paleta com variantes por papel (texto, fundo, borda) | Paleta grande demais |
| [Zendesk Garden](https://garden.zendesk.com/) | Estados de componente completos e foco visível | Visual neutro de ferramenta interna |
| [Lightning (Salesforce)](https://www.lightningdesignsystem.com) | Nomenclatura de tokens por papel, não por valor | Complexidade e densidade |
| [Vibe (monday.com)](https://vibe.monday.com/) | Produto colorido que continua legível: cores de categoria com nome, ordem fixa e uso só em dados; componentes amigáveis e arredondados | Paleta de dezenas de cores de etiqueta |
| [Gestalt (Pinterest)](https://gestalt.pinterest.systems/) | Uma cor de marca usada com parcimônia sobre base neutra; botões pílula e cantos generosos; conteúdo em primeiro plano com galeria em mosaico; guias de escrita e acessibilidade | Vermelho da marca; dependência de imagem em todo lugar |
| [EMD / Merck](https://emd.design/) | Blocos de cor chapados e grandes, formas que vazam a tela. **Só na landing.** | Muitas cores juntas no produto |

---

## 13. Checklist antes de entregar

**Marca e estilo**
- [ ] Só tokens de `potyro-tokens.css` (ou cores geradas pelo `potyro-color.js`), sem cor, fonte, raio ou espaço solto.
- [ ] Uma cor de acento por tela (exceto landing), ocupando ≤ 10% da área. O 12h rosa só no Potyro.
- [ ] Cores de categoria só em dados com categoria: andando 5 horas, no máximo cinco, sempre com nome visível.
- [ ] Um botão primário por tela.
- [ ] Quicksand só a partir de 20px.
- [ ] Todo texto passou no checklist do [REDACAO.md](REDACAO.md).
- [ ] Bordas de 2px, botões pílula, ícones Lucide com stroke 2.
- [ ] Sem sombra fora de elementos flutuantes. Sem gradiente. Sem faixa lateral em card.
- [ ] Primeira tela mostra o app funcionando (com exemplos marcados, se for o caso).
- [ ] App gerado: `data-traco` definido, selo "Feito com Potyro", `<title>`, favicon e imagem de compartilhamento.
- [ ] Logo original, sem redesenho.

**Acessibilidade (seção 11)**
- [ ] Só combinações de cor da seção 3.1, conferidas no claro **e** no escuro. Texto sobre `--aguada` é `--ink`; sobre `--traco`, só grafite com 24px ou mais.
- [ ] Cor nunca é o único sinal.
- [ ] Tudo funciona só com teclado; foco visível e nunca coberto; modal prende e devolve o foco.
- [ ] HTML semântico, `lang="pt-BR"`, um `<h1>`, `<title>` por tela, nome em todo botão de ícone, `alt` certo.
- [ ] Toque ≥ 44px; todo gesto tem alternativa.
- [ ] Funciona com zoom de 200% e em 320px sem rolagem horizontal.
- [ ] `prefers-reduced-motion` respeitado; nada pisca; toast com ação não some sozinho.
- [ ] Formulários com label visível, erro em texto ligado ao campo e nada apagado em caso de erro.
- [ ] axe sem erros; passada só com teclado e com leitor de tela.
