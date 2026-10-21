# Potyro: guia de redação para agentes

> **Escreva como um bilhete na geladeira: curto, claro e com carinho.**

Este documento diz a qualquer agente de IA como escrever os textos do Potyro: o app Potyro, a landing page e **todos os apps que o Potyro gera**. Vale para botões, títulos, mensagens, e-mails, exemplos, textos alternativos, tudo que alguém vai ler ou ouvir.

Leia junto com o [DESIGN.md](DESIGN.md). Se algo aqui conflitar com a seção 11 do DESIGN.md (acessibilidade), vale a acessibilidade.

---

## 1. A voz

O Potyro fala como **aquele amigo que faz as coisas em casa e faz bem feito**. Ele explica rapidinho, se anima com o que você criou e nunca usa palavra difícil para parecer importante.

| A voz é | A voz não é |
|---|---|
| **Simples:** palavras de todo dia | Técnica, cheia de jargão |
| **Curta:** só o que precisa | Prolixa, cheia de introdução |
| **Clara:** dá para entender na primeira lida | Vaga, cheia de rodeio |
| **Animada e amigável:** se alegra junto | Fria, corporativa, de manual |
| **Caseira:** feita à mão, com cuidado | Polida demais, com cara de propaganda |

Um teste rápido: **você falaria isso em voz alta para um amigo?** Se não falaria, reescreva.

---

## 2. As regras de forma

### 2.1 Tamanho

| Peça | Limite |
|---|---|
| Botão | 1 a 3 palavras |
| Título | até 6 palavras |
| Frase | até 15 palavras |
| Mensagem (erro, aviso, tela vazia) | até 2 frases |
| Descrição de app | 1 frase |
| Tooltip | 1 frase curta |

Passou do limite? Corte antes de pensar em encolher a fonte.

### 2.2 Como cortar

1. **A informação mais importante vem primeiro.** "Seu app tá no ar" antes de "Agora é só compartilhar".
2. **Uma ideia por frase.** Duas ideias viram duas frases.
3. **Tire o que não muda nada:** "por favor", "simplesmente", "basta", "atualmente", "no momento", "com sucesso", "de forma rápida".
4. **Corte a introdução.** "Para criar seu app, descreva o que você quer" vira "Descreva seu app".
5. **Não repita o que a tela já mostra.** Se o botão diz "Publicar", a mensagem não precisa explicar o que é publicar.

### 2.3 Palavras

Use a palavra que a pessoa usaria. Na dúvida, a mais curta.

| Em vez de | Use |
|---|---|
| efetuar login, autenticar | entrar |
| efetuar logout | sair |
| excluir, remover | apagar |
| inserir, incluir | colocar, adicionar |
| visualizar | ver |
| selecionar | escolher |
| solicitar | pedir |
| realizar | fazer |
| sincronizar, persistir | salvar |
| configurações | ajustes |
| usuário | você (ou o nome da pessoa) |
| prompt | ideia, descrição |
| deploy, publicar em produção | publicar, colocar no ar |
| template | modelo |
| dashboard | painel |
| feedback | opinião |
| upload / download | enviar / baixar |
| erro inesperado | algo não funcionou |
| funcionalidade | o que o app faz |
| clique aqui | (diga para onde o link leva) |

**Nunca use:** "solução", "potencializar", "alavancar", "jornada", "experiência incrível", "revolucionário", "inteligência artificial de ponta", "simples assim", "no seu tempo". São palavras de propaganda e não dizem nada.

### 2.4 Pessoa e gênero

- Fale com **você**. Nunca "o usuário".
- Quando o Potyro fala de si, usa **a gente**: "A gente salvou tudo". Nada de "nós" formal ou de "o sistema".
- **Não marque o gênero de quem lê.** "Bem-vindo" vira "Que bom te ver por aqui". "Você está conectado" vira "Você entrou". "Obrigado" (que é de quem fala) pode.
- Em exemplos com pessoas, use nomes variados e reais do Brasil.

### 2.5 Tempo verbal e jeito de falar

- **Voz ativa:** "A gente salvou suas mudanças", não "Suas mudanças foram salvas".
- **Botão no infinitivo:** "Criar app", "Publicar", "Copiar link".
- **Instrução no imperativo:** "Descreva seu app", "Escolha uma cor".
- **Coloquial pode:** "pra", "tá", "bora", "rapidinho", "prontinho". Use com moderação, no máximo uma vez por tela, e nunca em erro, dinheiro ou exclusão.
- **Não pode:** abreviação de internet ("vc", "q", "blz"), gíria regional ou de meme, ironia, sarcasmo, piada que depende de contexto.

### 2.6 Pontuação e formato

- **Caixa de frase** em tudo: "Criar app", não "Criar App".
- **Ponto final** em frases completas. Botões, títulos, labels e itens curtos de lista ficam sem ponto.
- **Exclamação:** no máximo uma por tela, só para comemorar ("Pronto! Seu app tá no ar."). Nunca duas seguidas e nunca em erro.
- **Sem reticências.** Quando algo está carregando, diga o que está acontecendo: "Montando seu app".
- **Sem emoji.** Quem comemora é o bonequinho do logo (DESIGN.md, seção 4.2).
- **Sem CAIXA ALTA para gritar.** Para destacar, escreva melhor ou use o negrito do componente.
- **Números em algarismo:** "3 itens", "1 app".
- **Datas e horas do jeito que se fala:** "hoje", "ontem", "3 de março", "14h30". Evite "03/03" quando houver dúvida.
- **Dinheiro:** "R$ 12,50".

---

## 3. O volume da animação

A voz é sempre a mesma. O que muda é o **volume**: quanto entusiasmo cabe em cada momento.

| Momento | Volume | Como soa |
|---|---|---|
| Comemoração (app publicado, primeiro app) | **Alto** | "Pronto! Seu app tá no ar." |
| Boas-vindas, tela vazia, onboarding | **Médio** | "Nada por aqui ainda. Bora criar o primeiro?" |
| Uso normal (botões, títulos, listas) | **Baixo** | "Adicionar item" |
| Carregando | **Baixo** | "Montando seu app. Leva uns 20 segundos." |
| Erro | **Zero** | Calmo e útil, sem piada |
| Dinheiro, dados pessoais, apagar | **Zero** | Sério, gentil e muito claro |

Na dúvida, abaixe o volume. Entusiasmo demais cansa, e clareza nunca cansa.

---

## 4. Fórmulas por tipo de texto

### Botão
**Verbo + coisa.** Diz exatamente o que vai acontecer.
- "Criar app", "Publicar", "Copiar link", "Adicionar item"
- Evite "OK", "Confirmar", "Enviar" soltos e "Sim/Não".

### Título de tela
**O nome da coisa ou o que a pessoa faz ali.** Até 6 palavras.
- "Seus apps", "Nova lista", "Quem vai no churrasco"

### Label e placeholder
- Label diz **o que vai no campo**: "Nome do app".
- Placeholder dá **um exemplo real**: "Ex.: Bolão da firma". Placeholder nunca substitui o label.

### Tela vazia
**O que tem aqui + um convite.**
- "Nada por aqui ainda. Bora criar o primeiro?"
- "Nenhum gasto este mês. Que tal anotar o primeiro?"

### Carregando
**O que está acontecendo + quanto demora**, se você souber.
- "Montando seu app. Leva uns 20 segundos."
- "Salvando"

### Sucesso
**O que deu certo + o próximo passo**, se houver.
- "Pronto! Seu app tá no ar."
- "Link copiado. Agora é só mandar."

### Erro
**O que aconteceu + o que fazer.** Sem culpa, sem desculpa, sem piada.
- "Sem internet agora. A gente guarda suas mudanças e salva quando ela voltar."
- "Esse e-mail parece incompleto. Confere se tem o @."
- "Não deu pra publicar. Tenta de novo em alguns segundos."

Nunca culpe a pessoa ("Você digitou errado"). Nunca mostre código de erro sozinho. Se precisar mostrar um código, ele vai depois da explicação.

### Confirmação (apagar, sair sem salvar)
**Pergunta com o verbo + a consequência. Botões repetem o verbo.**
- "Apagar 'Bolão da firma'? Quem tem o link perde o acesso." → **Apagar** / **Cancelar**
- "Sair sem salvar? Você perde o que mudou." → **Sair** / **Continuar editando**

### Aviso
**O que pode acontecer + o que fazer.**
- "Esse app é público. Qualquer pessoa com o link vê os dados."

### Toast e notificação
**Uma frase curta, a coisa mais importante primeiro.**
- "Item apagado." + **Desfazer**
- "A Ana entrou no seu bolão."

### Tooltip
**Uma frase que responde "o que é isso?"**
- "Só quem tem o link consegue ver."

### Descrição de app
**Uma frase que diz o que o app faz, para quem.**
- "Lista de compras da casa, dividida por mercado."

---

## 5. Textos dos apps gerados

O agente que gera um app escreve **todo** o texto dele: nome, títulos, botões, mensagens, exemplos. Esse texto segue este guia, adaptado ao assunto.

- **Use as palavras de quem pediu.** Se o prompt diz "rolê", o app diz "rolê", não "evento".
- **Ajuste o volume ao assunto.** Um app de bolão pode estar no volume alto. Um app de remédios fica no baixo, sempre.
- **Nome do app:** de 1 a 3 palavras, concreto, do jeito que a pessoa chamaria. "Compras da casa", não "ShopManager Pro". Sem trocadilho forçado.
- **Dados de exemplo** são realistas e brasileiros (nomes, lugares, preços em reais), variados e marcados como exemplo.
- **Não prometa o que o app não faz.** Se ele não manda notificação, não escreva "a gente te avisa".
- **Selo:** sempre "Feito com Potyro", sem variação.

---

## 6. Landing page

Aqui a voz pode ir ao volume mais alto, mas continua curta.

- **Título:** até 8 palavras, dizendo o que o Potyro faz. "Descreva. Pronto, é um app."
- **Subtítulo:** 1 frase que explica como. "Conta o que você precisa e o Potyro monta um app pra você compartilhar."
- **Botão:** "Criar meu app", o mesmo em toda a página.
- **Como funciona:** 3 passos, cada um com um verbo e uma frase. "Descreva", "Ajuste", "Compartilhe".
- **Nada inventado:** sem números, depoimentos ou clientes que não existem.

---

## 7. Escrever para todo mundo

Texto acessível é texto bem escrito. Estas regras completam a seção 11 do DESIGN.md.

- **Linguagem simples ajuda todo mundo**, inclusive quem usa leitor de tela, quem está aprendendo português e quem está com pressa.
- **Não dependa de posição ou cor:** "Toque em Publicar", não "Toque no botão rosa à direita".
- **Link diz para onde vai:** "Ver o app", nunca "clique aqui" ou "saiba mais" soltos.
- **Botão só com ícone tem nome falado** (`aria-label`): "Criar app", "Apagar item", "Fechar".
- **Texto alternativo de imagem** descreve o que importa, em uma frase: "Bolo de cenoura com cobertura de chocolate". Não comece com "Imagem de". Imagem decorativa fica com `alt=""`.
- **Siglas** por extenso na primeira vez, ou não use.
- **Instrução não depende só de som, forma ou tempo:** "quando a bolinha ficar verde" não funciona para todo mundo.

---

## 8. Antes e depois

| Antes | Depois |
|---|---|
| Bem-vindo ao Potyro! Aqui você pode criar aplicativos incríveis usando inteligência artificial. | Que bom te ver por aqui. Bora criar um app? |
| Digite aqui seu prompt... | Ex.: lista de compras da casa, dividida por mercado |
| Carregando... | Montando seu app. Leva uns 20 segundos. |
| Parabéns!!! 🎉 Seu aplicativo foi criado com sucesso! | Pronto! Seu app tá no ar. |
| Você ainda não possui itens cadastrados. | Nada por aqui ainda. Que tal o primeiro? |
| Ops! Algo deu errado :( | Não deu pra salvar. Tenta de novo em alguns segundos. |
| Erro 401: usuário não autenticado. | Você saiu da sua conta. Entra de novo pra continuar. |
| Tem certeza? Essa ação é irreversível! | Apagar "Bolão da firma"? Quem tem o link perde o acesso. |
| Suas configurações foram atualizadas com sucesso. | Ajustes salvos. |
| Clique aqui para saber mais sobre nossos planos. | Ver os planos |
| O campo e-mail é obrigatório. | Coloca seu e-mail pra gente te mandar o link. |
| Funcionalidade indisponível no momento. | Isso ainda não funciona. Tá na nossa lista. |

---

## 9. Checklist antes de entregar

- [ ] Você falaria isso em voz alta para um amigo?
- [ ] Cada texto está dentro do limite de tamanho (seção 2.1)?
- [ ] A informação mais importante vem primeiro?
- [ ] Nenhuma palavra da lista de "em vez de" e nenhuma palavra de propaganda?
- [ ] Fala com "você", não marca gênero de quem lê?
- [ ] O volume da animação combina com o momento? Erro, dinheiro e exclusão no zero?
- [ ] No máximo uma exclamação por tela, sem reticências e sem emoji?
- [ ] Botões dizem o que acontece, com verbo?
- [ ] Erros dizem o que aconteceu e o que fazer, sem culpar ninguém?
- [ ] Links, botões de ícone e imagens têm texto que funciona sem ver a tela?
