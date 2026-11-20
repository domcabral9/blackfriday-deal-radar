# Desenvolvimento e operação

Referência prática: como o ambiente está montado, como colocar no ar do zero, como mudar regras e o
que já deu errado. A visão de arquitetura está em [`architecture.md`](./architecture.md).

## Estrutura do repositório

```
├── listener/               # serviço Python que lê os canais (Telethon)
│   └── radar/
│       ├── listen.py       # serviço contínuo: canal -> webhook do n8n
│       ├── extract.py      # mensagem do Telegram -> payload JSON
│       ├── login.py        # login interativo único, lista IDs dos canais
│       └── backfill.py     # baixa histórico para massa de teste
├── n8n/
│   ├── code/               # código dos Code nodes (fonte de verdade)
│   ├── tests/              # harness local + fixtures
│   ├── build-workflow.mjs  # gera o JSON do workflow a partir de code/
│   └── workflows/          # JSON gerado (com placeholders)
├── deploy/
│   ├── docker-compose.yml  # stack "deal-radar": n8n dedicado + listener
│   ├── deploy-workflow.sh  # testa, gera, importa e publica o workflow
│   └── .env.example
└── docs/
```

## Ambiente

| Item | Valor |
|---|---|
| Host | VM Ubuntu 22.04 no VirtualBox, acessível por `ssh n8n-poc` |
| Diretório da stack | `~/deal-radar` |
| Projeto Compose | `deal-radar` (rede, volumes e banco próprios) |
| Editor do n8n | `http://localhost:5680` via túnel SSH |
| Volumes | `deal-radar_n8n_data`, `deal-radar_sessions`, `deal-radar_data` |

A VM também roda outra instância n8n, de um projeto independente, na porta 5678. As duas não
compartilham container, volume, rede nem credencial. Todo comando deste projeto usa o nome
`deal-radar-n8n` ou roda dentro de `~/deal-radar/deploy`.

Para abrir o editor:

```bash
ssh -N -L 5680:127.0.0.1:5680 n8n-poc
# depois, no navegador: http://localhost:5680
```

## Colocando no ar do zero

1. **Credenciais da API do Telegram**: em https://my.telegram.org > *API development tools*, criar
   um app (nome e plataforma são indiferentes) e anotar `api_id` e `api_hash`.
2. **`.env` na VM** (`~/deal-radar/deploy/.env`, permissão 600), a partir de `.env.example`. As
   chaves do n8n saem de `openssl rand -hex 32`.
3. **Imagem do n8n**: a stack usa uma tag local fixa, criada a partir da imagem já presente:
   `docker tag n8nio/n8n:<versao> deal-radar/n8n:<versao>`.
4. **Subir o n8n** e criar a conta de dono no editor:
   `docker compose up -d n8n`.
5. **Login da conta do Telegram** (interativo, uma vez só):
   ```bash
   cd ~/deal-radar/deploy
   docker compose run --rm listener python -m radar.login
   ```
   Pede telefone (`+55...`), o código que chega no app do Telegram e a senha de duas etapas, se
   houver. No final, lista os canais com o ID numérico. Os IDs vão em `TG_CHANNELS`, separados por
   vírgula.
6. **Bot de alertas**: ver seção abaixo.
7. **Workflow**: `bash deploy/deploy-workflow.sh` (rodado do Windows, Git Bash).
8. **Listener**: `docker compose up -d listener`.

### Bot de alertas

1. No Telegram, abrir **@BotFather**, enviar `/newbot`, escolher um nome e um username terminado
   em `bot`. Guardar o token (formato `123456:ABC...`).
2. Abrir a conversa com o bot novo e enviar `/start`. Bots só podem escrever para quem falou com
   eles primeiro.
3. Descobrir o `chat_id`: `curl -s https://api.telegram.org/bot<TOKEN>/getUpdates` e ler
   `result[0].message.chat.id`.
4. No editor do n8n, *Credentials* > *Create credential* > *Telegram API*, colar o token. O nome é livre: o deploy encontra a credencial pelo tipo.
5. Colocar `TELEGRAM_CHAT_ID=<id>` no `.env` da VM e rodar o deploy do workflow.

## Como mudar regras

### Cadastrar ou ajustar um produto

Editar [`n8n/code/catalog.js`](../n8n/code/catalog.js), acrescentar um caso em
[`n8n/tests/fixtures.json`](../n8n/tests/fixtures.json) e rodar:

```bash
node n8n/tests/run.mjs            # casos de teste
node n8n/tests/run.mjs --preview  # como cada alerta vai aparecer no bot
bash deploy/deploy-workflow.sh    # publica
```

O texto é comparado já normalizado: minúsculo, sem acento, só letras, números e `+`. Por isso
`"Galaxy S26+ 256GB"` vira `galaxy s26+ 256gb`, e as regex do catálogo são escritas nesse formato.

### Cadastrar um canal

Rodar `radar.login` de novo para ver o ID, acrescentar em `TG_CHANNELS` no `.env` e recriar o
listener com `docker compose up -d listener`.

### Validar contra posts reais

```bash
docker compose run --rm listener python -m radar.backfill 300
docker compose run --rm --entrypoint cat listener /data/backfill.jsonl > ~/backfill.jsonl
# no Windows: scp n8n-poc:backfill.jsonl . && node n8n/tests/run.mjs backfill.jsonl
```

O modo corpus imprime tudo que bateu com algum produto, com o status (alerta, acessório, acima do
teto) e um resumo. É o jeito de medir falso positivo antes de publicar uma regra nova.

## Segurança

- O arquivo de sessão do Telethon (volume `deal-radar_sessions`) dá acesso completo à conta do
  Telegram. Ele nunca sai da VM e está fora do git (`*.session` no `.gitignore`).
- Para revogar o acesso: Telegram > *Configurações* > *Dispositivos*, encerrar a sessão do listener.
- O webhook exige o header `X-Radar-Token`. Sem ele, o n8n responde 403.
- O editor e o webhook escutam só em `127.0.0.1` da VM. O listener fala com o n8n pela rede interna
  do Compose.

## Problemas conhecidos

### `.env` sem quebra de linha no final emenda a próxima variável

Ao acrescentar linhas com `>>` num `.env` criado no Windows sem newline final, a primeira variável
nova grudou no fim do `TG_API_HASH`. Sintoma: login falhando com hash inválido. Conferir com
`awk -F= '{print $1, length($2)}' .env`, que deve mostrar 32 caracteres no hash.

### Importar desativa o workflow, e publicar só vale após restart

`n8n import:workflow` sempre desativa. `n8n publish:workflow` reativa no banco, mas a instância em
execução só percebe depois de `docker restart deal-radar-n8n`. O `deploy-workflow.sh` já faz as três
coisas em sequência.

### Deduplicação não funciona em execução manual

O dedup guarda as ofertas vistas no *static data* do workflow, que o n8n só persiste em execuções de
produção. Testando pelo botão *Execute workflow*, toda oferta parece nova.
