# GUIA COMPLETO — Do zero ao APK no seu celular

Este guia assume que você **nunca usou Git ou GitHub**. Todos os comandos são para copiar e colar.
No fim, você vai ter:

1. O jogo rodando no seu computador
2. O projeto no GitHub
3. Um **APK instalável** gerado pelo GitHub, sem instalar Android Studio

---

## Parte 0 — O que instalar (só uma vez)

Abra o terminal (Windows: **PowerShell**; macOS/Linux: **Terminal**) e confira se já tem Node:

```bash
node --version
npm --version
```

Se aparecer `v22.x.x` e `10.x.x` (ou números maiores), pule para a Parte 1.

Se não aparecer nada, instale o **Node.js LTS**: <https://nodejs.org> → botão verde **LTS** → instale
com as opções padrão. Feche e reabra o terminal depois.

Git também é necessário (para a Parte 2):

```bash
git --version
```

Se não tiver, instale em <https://git-scm.com/downloads>.

> **Nunca use o PowerShell como administrador** para isso, e nunca cole comandos que você não entendeu.

---

## Parte 1 — Rodar o jogo no seu computador

Na pasta do projeto (onde está o `package.json`):

```bash
npm install
npm run dev
```

Vai aparecer algo assim:

```
  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.0.15:5173/
```

Abra o **Local** no navegador. O jogo carrega na tela de título.
Clique em **NEW GAME** → escolha um slot → comece.

**Testar no celular agora mesmo** (mesma rede Wi-Fi do computador):

1. No celular, abra o Chrome
2. Digite o endereço **Network** que apareceu no terminal (ex.: `http://192.168.0.15:5173`)
3. Os controles de toque aparecem sozinhos
4. Menu do Chrome → **Adicionar à tela inicial**

Isso já é o jogo completo, offline depois do primeiro carregamento.

Para parar o servidor: `Ctrl + C` no terminal.

---

## Parte 2 — Colocar no GitHub

### 2.1 Criar o repositório

1. Vá em <https://github.com> e crie sua conta (se ainda não tem)
2. Clique no **+** no canto superior direito → **New repository**
3. Preencha:
   - **Repository name:** `yshmara` (ou o nome que quiser — só evite espaços)
   - **Visibility:** `Public` (necessário para usar Actions de graça) ou `Private`
   - **NÃO** marque "Add a README file", "Add .gitignore" nem "Choose a license"
4. Clique em **Create repository**

A próxima página mostra comandos. **Ignore-os** e use os de baixo, que já estão certos para este projeto.

### 2.2 Enviar o projeto

Na pasta do projeto, rode **um comando por vez**:

```bash
git init
```

```bash
git add .
```

```bash
git commit -m "Y'SMARA — The Hollow Hymn"
```

```bash
git branch -M main
```

Agora conecte ao seu repositório. **Troque `SEU-USUARIO` e `yshmara`** pelos seus:

```bash
git remote add origin https://github.com/SEU-USUARIO/yshmara.git
```

```bash
git push -u origin main
```

Na primeira vez, o GitHub pede login. Ele abre o navegador — autorize, e volte ao terminal.

> Se pedir **senha** no terminal, senha comum **não funciona mais**. Use um
> **Personal Access Token**: GitHub → foto de perfil → *Settings* → *Developer settings* →
> *Personal access tokens* → *Tokens (classic)* → *Generate new token (classic)* → marque `repo` →
> gere e **cole o token no lugar da senha**.

Atualize a página do repositório: os arquivos devem estar lá.

### 2.3 O `.gitignore` já está pronto

`node_modules/` e `dist/` **não** vão para o GitHub — é isso que você quer. Eles são reconstruídos
com `npm install` e `npm run build`. Sem isso, o repositório teria centenas de milhares de arquivos.

---

## Parte 3 — Baixar o APK (já está pronto) ou gerar o seu

> **Atalho:** o APK já foi construído e está publicado em
> **[Releases](https://github.com/gzuismoura-ops/The-Game/releases/latest)**.
> Baixe `yshmara-hollow-hymn.apk`, mande pro celular e instale. Pule para a Parte 3.3.
>
> Se você mudou o jogo e quer um APK novo, siga a Parte 3.1 em diante.

O projeto já inclui o workflow `.github/workflows/build-apk.yml`. Ele roda na nuvem do GitHub,
que tem o Android SDK pronto.

### 3.1 Rodar o build

1. No seu repositório, clique na aba **Actions**
2. Se aparecer um aviso pedindo para habilitar workflows, clique em **I understand my workflows, go ahead and enable them**
3. Na lista à esquerda, clique em **Build Android APK**
4. Clique no botão **Run workflow** (à direita) → **Run workflow**
5. Espere de **4 a 8 minutos**. A bolinha fica amarela (rodando), depois verde (✓)

### 3.2 Baixar o APK

1. Clique no item que acabou de rodar (o mais recente da lista)
2. Role até o fim da página, seção **Artifacts**
3. Clique em **yshmara-apk** — baixa um `.zip`
4. Descompacte. Dentro está `yshmara-hollow-hymn.apk`

### 3.3 Instalar no celular

1. Copie o `.apk` para o celular (cabo USB, Google Drive, Telegram, e-mail — o que preferir)
2. Toque no arquivo no celular
3. O Android vai avisar que é de "fonte desconhecida". Toque em **Configurações** → permita
   **Instalar apps desconhecidos** para o app que você usou (Arquivos/Chrome)
4. Volte e toque em **Instalar**
5. Abra **Y'SMARA** na gaveta de apps

O jogo abre em tela cheia, travado em paisagem, e **funciona sem internet**.

### 3.4 Fazer um "release" com o APK anexado

Se quiser um link público permanente (mais fácil de mandar para alguém):

```bash
git tag v1.0.1
```

```bash
git push origin v1.0.1
```

O workflow roda de novo e, ao terminar, anexa o APK automaticamente em
**Releases** (aba na direita da página do repositório). O link do release pode ser aberto no
celular e instalado direto.

---

## Parte 4 — Problemas comuns

| Sintoma | Causa | Solução |
|---|---|---|
| `npm: command not found` | Node não instalado / terminal antigo | Reinstale o Node LTS e reabra o terminal |
| `npm install` falha com `EACCES` | Permissão de pasta | Não use `sudo`. Rode dentro da pasta do projeto, não em `/` |
| Tela preta no navegador | WebGL desabilitado | Chrome → `chrome://gpu` → veja se WebGL2 está ativo. Atualize o Chrome |
| `git push` pede senha e falha | Senha comum não é aceita | Use Personal Access Token (Parte 2.2) |
| Actions: **"Workflow does not have permission"** | Permissões do repo | *Settings* → *Actions* → *General* → **Workflow permissions** → marque **Read and write** |
| APK não instala | Conflito de assinatura | Desinstale qualquer versão anterior do app e instale de novo |
| Jogo lento no celular | Preset alto demais | No jogo: **Pause → Settings → Graphics → Quality → Low ou Medium** |

---

## Parte 5 — Mexer no jogo

Tudo é editável. Os arquivos mais interessantes:

| Quero mudar... | Arquivo |
|---|---|
| Velocidade, dano, alcance do canto | `src/world/world.js` → `GAME_CONSTANTS` |
| Cores de cada região | `src/world/world.js` → `REGIONS[].palette` |
| Textos, diálogos, objetivos | `src/narrative/quest.js` |
| Aparência dos menus | `src/ui/style.css` |
| Criaturas e comportamento | `src/entities/enemies.js` |
| Iluminação/atmosfera por área | `src/main.js` → `regionLook()` |
| Conquistas | `src/systems/save.js` → `ACHIEVEMENTS` |
| Ícone do app | `tools/gen-icons.mjs` (rode `npm run icons`) |

Depois de mudar qualquer coisa:

```bash
npm test
```

Se as 63 verificações passarem, o jogo continua funcionando. Se algo quebrar, o teste te diz **qual
arquivo e qual linha**.

Só mantenha a regra de ouro: **não adicione assets por download.** O jogo inteiro funciona sem
nenhum arquivo de imagem ou áudio externo, e é isso que o mantém leve, offline e sem problemas de
licença.

---

## Resumo em 8 linhas

```bash
npm install
npm run dev                          # jogar agora
git init && git add . && git commit -m "Y'SMARA"
git remote add origin https://github.com/SEU-USUARIO/yshmara.git
git push -u origin main              # enviar
# GitHub → Actions → Build Android APK → Run workflow
# Actions → o run mais recente → Artifacts → yshmara-apk
# descompactar, mandar pro celular, instalar
```
