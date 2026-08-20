# FriendCord — mini Discord privado

Primeira versão funcional de uma comunidade privada para amigos. O projeto usa React/Vite, Node.js/TypeScript, PostgreSQL, Socket.IO e WebRTC.

## O que já funciona

- Cadastro e login com senha protegida por `bcrypt` (12 rounds) e sessão JWT de 7 dias.
- Salas, canais de texto/voz, histórico das últimas 100 mensagens e chat em tempo real.
- Presença online, notificações do navegador e convites com validade/limite de uso.
- Papéis `owner`, `admin` e `member`; criação de canais e convites restrita a owner/admin.
- Chamada mesh P2P com áudio/vídeo, mudo, câmera, volume dos participantes e sinalização por Socket.IO.
- Compartilhamento de tela em 720p/1080p/1440p e 30/60 FPS (a resolução real depende da tela, navegador, CPU e rede).
- Gravação local em WebM via `MediaRecorder`; o arquivo é baixado no computador, nunca enviado ao servidor.
- YouTube pelo IFrame Player API oficial, com vídeo/play/pause/posição sincronizados pela sala.
- Spotify por Embed oficial. O item é sincronizado, mas a reprodução continua sujeita às regras e controles do Spotify.

O projeto **não bloqueia anúncios, não baixa mídia e não retransmite conteúdo**. Spotify Premium e YouTube Premium são os meios oficiais de obter os benefícios oferecidos por cada serviço.

## Estrutura

```text
apps/web              React + Vite
apps/server           Express + Socket.IO + PostgreSQL
apps/server/migrations SQL versionado
packages/shared       tipos compartilhados
docker-compose.yml    PostgreSQL local
render.yaml           modelo de deploy
```

## Requisitos no Windows

1. Instale [Node.js 20 LTS ou superior](https://nodejs.org/).
2. Instale [Docker Desktop](https://www.docker.com/products/docker-desktop/) e deixe-o aberto.
3. Abra o PowerShell na pasta `mini-discord`.

## Rodar localmente — passo a passo

```powershell
Copy-Item .env.example .env
docker compose up -d
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Abra `http://localhost:5173`. O seed opcional cria `admin` / `amigos123`; troque essa senha para qualquer uso real. Para não usar o seed, crie uma conta pela tela inicial.

O frontend roda na porta `5173`, a API na `3001` e o PostgreSQL na `5432`. Pare a aplicação com `Ctrl+C`; pare o banco com `docker compose down`. Para também apagar os dados locais, use `docker compose down -v`.

## Configuração

Copie `.env.example` para `.env`. Variáveis principais:

- `DATABASE_URL`: conexão PostgreSQL.
- `JWT_SECRET`: segredo aleatório com pelo menos 32 caracteres; nunca publique.
- `CLIENT_ORIGIN`: URL exata do frontend, sem barra final.
- `VITE_API_URL`: URL pública da API, sem `/api` no final.
- `VITE_STUN_URL`: servidor STUN autorizado.
- `VITE_TURN_*`: URL, usuário e credencial de um serviço TURN.

Variáveis com prefixo `VITE_` são incorporadas ao build do frontend; elas não devem conter segredos permanentes. Credenciais TURN de produção deveriam ser temporárias, geradas por um backend ou provedor especializado.

## Como testar com amigos na rede local

O acesso a câmera, microfone e compartilhamento de tela exige contexto seguro: `localhost` funciona, mas outro computador acessando por IP normalmente precisa de HTTPS. Para testes reais entre redes diferentes, faça deploy HTTPS e configure TURN.

## Deploy gratuito sugerido (agosto de 2026)

### 1. Banco no Supabase

1. Crie um projeto em [Supabase](https://supabase.com/dashboard).
2. Em **Connect**, copie a connection string PostgreSQL compatível com seu ambiente.
3. Use essa string como `DATABASE_URL` no backend.
4. Rode as migrações apontando temporariamente o `.env` local para essa URL: `npm run db:migrate`.

O plano grátis é adequado para hobby, mas possui cotas e pode pausar por inatividade. Confira sempre a [página oficial de preços](https://supabase.com/pricing).

### 2. Código em um repositório Git

Crie um repositório privado no GitHub/GitLab/Bitbucket, confirme que `.env` não foi adicionado e envie a pasta inteira.

### 3. Backend no Render

1. No Render, escolha **New > Web Service** e conecte o repositório.
2. Root directory: deixe na raiz do monorepo.
3. Build: `npm install && npm run build -w @friendcord/shared && npm run build -w @friendcord/server`.
4. Start: `npm run db:migrate && npm run start -w @friendcord/server`.
5. Health check: `/api/health`.
6. Configure `DATABASE_URL`, `JWT_SECRET` e, depois de criar o frontend, `CLIENT_ORIGIN`.

### 4. Frontend estático no Render

1. Escolha **New > Static Site** no mesmo repositório.
2. Build: `npm install && npm run build -w @friendcord/shared && npm run build -w @friendcord/web`.
3. Publish directory: `apps/web/dist`.
4. Defina `VITE_API_URL=https://SEU-BACKEND.onrender.com` e as variáveis STUN/TURN antes do build.
5. Volte ao backend e configure `CLIENT_ORIGIN=https://SEU-FRONTEND.onrender.com`.

O arquivo `render.yaml` contém a mesma topologia. Serviços web gratuitos do Render entram em repouso após inatividade e podem demorar para acordar; isso desconecta o Socket.IO. O PostgreSQL gratuito do próprio Render expira, então Supabase tende a ser mais cômodo para este hobby.

## STUN, TURN e escala

O STUN ajuda os navegadores a descobrir uma rota direta. Algumas redes corporativas, CGNATs e NATs simétricos bloqueiam essa rota; nesses casos, a chamada só funciona com TURN, que retransmite áudio/vídeo e consome bastante banda. Um TURN gratuito pode limitar tráfego, usuários ou tempo e não deve ser tratado como garantia de disponibilidade.

Esta versão usa topologia **mesh**: cada pessoa envia uma cópia do vídeo a cada participante. É apropriada para grupos pequenos (na prática, teste 2–6 pessoas conforme qualidade/rede). Para grupos maiores, a extensão correta é um SFU como LiveKit, mediasoup ou Janus, não aumentar o servidor Socket.IO.

Para produção, use um TURN sob seu controle (como coturn) ou um provedor com credenciais temporárias. Veja a [explicação oficial do WebRTC](https://webrtc.org/getting-started/turn-server).

## Pontos de extensão

- Refresh tokens, recuperação de senha, rate limiting e auditoria administrativa.
- Edição/exclusão de mensagens e paginação por cursor.
- Credenciais TURN efêmeras e monitoramento ICE.
- SFU para chamadas maiores, gravação consentida no servidor e moderação.
- Compartilhamento de arquivos com storage de objetos e antivírus.
- Sincronização do Spotify via SDK somente nos fluxos e contas autorizados pelo Spotify.

## Segurança e privacidade

- Use HTTPS em produção e um `JWT_SECRET` exclusivo.
- Informe todos os participantes antes de gravar; leis de consentimento variam por local.
- A gravação atual captura localmente uma única `MediaStream` (sua câmera/tela ou um stream remoto selecionado pela implementação). Misturar todos os áudios/vídeos em um único arquivo exige Web Audio/Canvas ou gravação por SFU.
- WebRTC protege o transporte, mas esta primeira versão não implementa verificação de identidade E2EE adicional nem moderação avançada.

## Comandos úteis

```powershell
npm run dev
npm run build
npm run db:migrate
npm run db:seed
docker compose logs -f postgres
```
