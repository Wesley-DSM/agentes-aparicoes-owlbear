# Agentes & Aparições | Ficha para Owlbear Rodeo

Protótipo experimental 0.46.0. A ficha fica nos metadados do token e abre pelo menu de contexto **Ficha A&A**. As barras são vetores nativos anexados ao token.

## Uso

1. Requer Node.js.
2. Na pasta do projeto, execute `npm install`.
3. Execute `npm run dev` e mantenha o terminal aberto.
4. No Owlbear Rodeo, adicione a extensão com `http://localhost:5173/manifest.json`.
5. Para verificar as regras de DT e críticos, execute `npm test`.
6. Selecione uma imagem na camada Personagens (`CHARACTER`) e abra o menu de contexto do item. No desktop, clique com o botão direito; em dispositivos touch, use o menu de contexto disponível no Owlbear. Escolha **Ficha A&A**.
7. Os dados de identificação, Ferimentos, Estresses, defesas e perícias são salvos automaticamente no token. A interface lembra localmente quais seções foram recolhidas para cada token.
8. Clique no nome de uma perícia para fazer a rolagem pública.

## Temas da interface

A opção **Owlbear** acompanha a paleta ativa do Owlbear Rodeo, incluindo as alterações entre os modos claro e escuro. **Personalizado** usa o estilo escuro de A&A e permite ajustar cores, transparência e arredondamento. As preferências são guardadas apenas no navegador/dispositivo local e não alteram o tema visto pelos demais participantes.

## Iniciativa e CHAT

A iniciativa aceita valores decimais e mantém o turno ativo alinhado aos tokens que ainda existem na cena. Registros associados a tokens removidos da cena são limpos automaticamente.

A aba **CHAT** mostra até 20 mensagens e eventos públicos recentes: mensagens dos participantes, rolagens de perícias, rolagens manuais e usos compartilhados de poderes e rituais. Os botões I–V rolam de um a cinco d10. Cada dado rolado pode ser rerrolado após confirmação; os resultados anteriores ficam tachados e somente o resultado mais recente entra no cálculo. A DT fica à direita dos dados; o resultado aparece junto ao nome do personagem e do jogador. A DT aceita valores de 0 a 9999 e calcula os críticos conforme as regras de A&A 0.8. Os usos de poderes e rituais exibem seus traços, rolagens inline e descrição no CHAT. Os participantes podem reagir a cada evento com emojis e alternar suas reações. O mestre pode limpar o CHAT, com confirmação. O registro é compartilhado por meio dos metadados da sala, cujo limite de tamanho exige manter a lista compacta.

O seletor de abas indica mensagens não lidas, e o ícone da extensão recebe um ponto branco enquanto houver mensagens novas. O contador considera eventos novos do CHAT e marca o histórico como lido quando a aba é aberta com o painel visível.

Na iniciativa, clique no valor de iniciativa para editá-lo. O mestre pode ativar o status detalhado pelo botão de olho e configurar quais recursos, defesas e perícias passivas aparecem. As opções de ficha permitem apagar o token, limpar apenas os dados da ficha e importar uma ficha em JSON ou HTML e exportar uma ficha HTML editável para o navegador. Se o limite de Inconsciente de Ferimentos ou Estresses for zero, a respectiva barra não é exibida.

## Cabeçalho da ficha

Cada token guarda Nome, Classe, Organização, Ocupação e Evolução. Classe e Organização usam listas de opções; os demais campos são editáveis. A ficha antiga recebe valores iniciais vazios para Classe, Organização e Ocupação, e Evolução começa em 1%.

## Referências de perícia nas descrições

Nas descrições de poderes e rituais, `[[Percepção]]` exibe o valor atual da perícia e `[[Percepção Passiva]]` exibe seu valor passivo (4 + valor da perícia). Para realizar uma rolagem inline, use `[[@Percepção]]`. As rolagens inline oferecem campo de DT e rerrolagens compartilhadas no CHAT.

## Perícias e rolagens públicas

A ficha contém as 22 perícias de A&A 0.8 agrupadas em Resistências, Equipamentos e Especialidades. Os treinamentos I–V ficam salvos nos metadados da ficha do token.

Ao clicar no nome da perícia, a extensão rola de 1 a 5 dados de dez faces conforme o treinamento, organiza os resultados em ordem decrescente e destaca todos os resultados 10. A rolagem é exibida em uma pequena janela separada da ficha. O resultado original é enviado por `OBR.broadcast` aos demais participantes conectados com a extensão ativa; todos veem exatamente os mesmos dados. Uma nova rolagem substitui a janela anterior.

## Ferimentos e Estresses

Cada recurso tem três valores: **Normais**, **Crônicos** e **Inconsciente**. O número exibido na barra é a soma de Normais + Crônicos. O valor de Inconsciente determina o limite visual da barra; quando o total atual alcança ou ultrapassa esse limite, a barra fica cheia. O número mostrado dentro da barra apresenta apenas o total atual.

Dados antigos são migrados automaticamente: o antigo valor atual passa para Normais, Crônicos começa em zero e o antigo máximo passa para Inconsciente.

## Barras

- Usa curvas e textos nativos da cena, sem imagens externas.
- Cada recurso tem trilho vetorial e preenchimento proporcional aos valores atuais.
- Itens anexados aos tokens são reconstruídos pelo serviço de fundo a partir dos metadados da ficha.

## Modo de desenvolvimento

Para testar em grupo com `localhost`, cada participante precisa ter a extensão instalada e o servidor local acessível no próprio navegador. Para uso normal por várias pessoas, hospede a extensão em um endereço HTTPS público e atualize o URL da extensão.

## Compatibilidade com dispositivos móveis

A interface ajusta a altura da ficha e da janela de rolagem ao espaço visível, usa alvos de toque maiores e evita o zoom automático de campos no Safari para iOS. Como a interface é aberta dentro do Owlbear, teste os fluxos de edição, o teclado virtual, a janela de rolagem e a confirmação de reset em iOS e Android antes de considerar a extensão pronta para uso amplo.

## Hospedagem pública

Os arquivos HTML e os recursos internos usam caminhos relativos para funcionar sob uma subpasta, como no GitHub Pages de um repositório. O Owlbear espera que os campos `background_url`, `action.icon` e `action.popover` do manifesto apontem para URLs absolutas, então a compilação pode preencher essas URLs com `EXTENSION_BASE_URL`.

1. Copie `.env.example` para `.env` e substitua `EXTENSION_BASE_URL` pela URL pública completa, incluindo `/nome-do-repositorio/` no GitHub Pages.
2. Execute `npm run build`.
3. Publique o conteúdo de `dist/`, não a pasta do código-fonte.
4. No Owlbear, adicione a URL pública de `manifest.json`.

A pasta `dist/` é ignorada pelo Git e deve ser gerada novamente em cada publicação.

## Referência e licença

A geometria das barras foi adaptada de **Bubbles for Owlbear Rodeo**, por Seamus Finlayson e Owlbear Rodeo, disponível em https://github.com/SeamusFinlayson/Bubbles-for-Owlbear-Rodeo e licenciada sob GNU GPL v3. Consulte `LICENSE` e `THIRD_PARTY_NOTICES.md`.

## Comandos

```bash
npm install
npm run dev
```

Para verificar a compilação de produção:

```bash
npm run build
```


Mensagens e descrições de poderes ou rituais aceitam imagens no formato `[[https://endereco-da-imagem]]`, rolagens inline como `[[1d10]]` ou `[[2d10]]` e testes de perícia como `[[Percepção]]`. Também é possível escrever o nome da perícia com um pequeno erro de digitação; o sistema tenta identificar a correspondência mais próxima. Os resultados das rolagens aparecem antes da descrição, com controles para definir DT e rerrolar dados, e os resultados também são repetidos em quadradinhos menores no ponto em que a expressão aparece no texto. Na ficha, antes do uso, as expressões são exibidas como etiquetas compactas. Para rolar uma perícia, é necessário ter um token selecionado no CHAT ou estar usando a ficha daquele token.

## Correções da versão 0.40.0

- Removida a camada de imagem monocromática que podia ficar por cima do token e ocultar nome, barras e defesas.
- O botão de iniciativa agora tem formato quadrado.
- Adicionado espaçamento entre os painéis Iniciativa Detalhada e Aparência Individual.


## Correções da versão 0.41.0

- Removida das configurações a opção de colorir tokens ao atingir Inconsciente.
- Aproximados os botões de iniciativa e remoção, restaurando o espaçamento padrão dos cartões.
- Ajustado o espaçamento entre os painéis de Iniciativa Detalhada e Aparência Individual.
- Adicionados controles de aumento e redução de Ferimentos e Estresses para o mestre na iniciativa detalhada.
- Perícias configuráveis agora aparecem na mesma linha das defesas, com opção de exibir o valor treinado ou o valor passivo.
- Adicionada seleção de perícias por popup e pré-visualização dinâmica de um turno.


## Correções da versão 0.42.0

- Perícias passivas passam a ser exibidas no formato “Percepção Passiva 5”.
- A iniciativa detalhada usa sempre barras de Ferimentos e Estresses, mantendo o espaço quando um limite é zero.
- As opções são editadas diretamente na pré-visualização: defesas tachadas ficam ocultas na iniciativa real, e o botão + permite adicionar perícias.
- Perícias na pré-visualização podem ser editadas ou removidas pelo popup.
- O campo de iniciativa não exibe mais as setas numéricas do navegador.
- Restaurado o espaçamento padrão entre Iniciativa Detalhada e Aparência Individual.


## Ajustes da versão 0.43.0

- Barras de Ferimentos e Estresses agora exibem nome, valor e controles dentro da própria barra.
- Nome à esquerda e controles à direita; setas de ajuste sem fundo.
- Perícias da iniciativa detalhada quebram para linhas adicionais quando não cabem na largura disponível.


## Ajustes da versão 0.44.0

- Barras da iniciativa detalhada ligeiramente mais finas e setas de ajuste centralizadas verticalmente.
- Fundos de EVA, PRO e CON na iniciativa seguem as cores de personalização definidas nas configurações.
- Popup de perícias permite escolher uma cor personalizada por perícia.
- Botão de Iniciativa Detalhada disponível também para jogadores; os controles de alteração continuam restritos ao mestre.
- Para jogadores, a área detalhada de tokens com a opção “Esconder” ativada exibe apenas o preenchimento das barras, sem rótulos ou valores, defesas ou perícias.


## Ficha HTML independente (versão 0.45.0)

- Em **Opções da ficha → Exportar ficha para navegador**, a extensão gera um único arquivo HTML com estrutura, estilos, editor e dados do personagem incorporados. Ele pode ser aberto diretamente no Chrome, Edge, Firefox ou outro navegador moderno, sem instalar programas ou manter conexão com o Owlbear.
- A interface reaproveita a folha de estilos da extensão para manter o tema visual semelhante ao Owlbear. Nome, classe, organização, ocupação, evolução, Ferimentos, Estresses, defesas, treinamento das perícias, inventário, poderes, rituais, parâmetros, traumas e história podem ser editados. É possível adicionar e remover itens.
- Na ficha independente, **Salvar** baixa um novo arquivo HTML com as alterações embutidas. O navegador não sobrescreve silenciosamente o original. Importe o HTML atualizado em **Opções da ficha → Importar ficha** para aplicar os dados ao token.
- O arquivo HTML salvo é lido como texto durante a importação; a extensão extrai e valida os dados embutidos sem executar o JavaScript do arquivo importado. Arquivos JSON exportados por versões anteriores continuam aceitos.
- A versão independente não executa operações que dependem da sala do Owlbear, como rolar perícias, usar poderes/rituais no CHAT ou adicionar o personagem à iniciativa. Essas ações continuam disponíveis dentro da extensão.
