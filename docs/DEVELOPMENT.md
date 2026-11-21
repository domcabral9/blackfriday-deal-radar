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

## Ligar e desligar junto com o Windows

O radar só funciona com a VM ligada, e a VM roda no PC pessoal. Dois scripts em
[`deploy/windows/`](../deploy/windows/) cuidam do ciclo, com log em `%LOCALAPPDATA%\deal-radar\vm.log`:

| Momento | Script | Como é disparado |
|---|---|---|
| Boot do Windows, sem login | autostart oficial do VirtualBox (`autostart-enabled=on`, atraso de 30 s) | serviço instalado por `install-autostart.ps1` (admin, uma vez) |
| Logon | `start-vm.ps1`: liga a VM se ainda estiver parada e espera o SSH | tarefa agendada *DealRadar - Ligar VM* (45 s de atraso) |
| Logoff, desligar ou reiniciar | `stop-vm.ps1`: botão ACPI, com *savestate* se passar de 60 s | script de logoff via `gpedit.msc` |

As tarefas chamam `conhost.exe --headless powershell.exe ... -File <script>`. Com `powershell.exe`
direto, mesmo com `-WindowStyle Hidden`, uma janela pisca na tela a cada execução, o que incomoda no
watchdog de 5 em 5 minutos.

Dentro da VM, nada precisa ser feito: o Docker sobe no boot e os containers têm
`restart: unless-stopped`. Ciclo medido: desligamento limpo em cerca de 13 s, SSH de volta em
cerca de 45 s, listener reconectado logo em seguida.

O desligamento limpo importa porque uma VM morta junto com o Windows já teve o journal do ext4
abortado e o disco remontado como somente leitura.

Para registrar o script de logoff: `gpedit.msc` > *Configuração do Usuário* > *Configurações do
Windows* > *Scripts (Logon/Logoff)* > *Fazer logoff* > aba *Scripts do PowerShell* > *Adicionar*, com
o caminho completo de `stop-vm.ps1`.

## Healthcheck

O workflow *Deal Radar: saúde* avisa pelo mesmo bot:

| Aviso | Quando |
|---|---|
| 🟢 Radar online | listener (re)iniciou e mandou o primeiro batimento |
| 🔴 Listener sem sinal | mais de 15 min sem batimento (o listener manda um a cada 5 min) |
| 🟢 Radar de volta | primeiro batimento depois de uma queda avisada |
| 🟡 Nenhum post há Xh | listener vivo, mas 3 h sem posts entre 9h e 23h |

Os limites ficam no topo de [`n8n/code/health.js`](../n8n/code/health.js). Quando o próprio n8n
ficou fora (VM desligada), a primeira avaliação depois da volta só recalibra, sem acusar queda.

O que o healthcheck não cobre: com a VM ou o n8n fora, não há quem avise. Nesse caso, a ausência
do aviso "Radar online" depois de ligar o PC é o sinal.

## Como mudar regras

### Pelo bot (dia a dia)

| Comando | Exemplo |
|---|---|
| `/produtos` | lista com status e teto |
| `/pausar <id>`, `/ativar <id>` | `/pausar iphone-16e` depois de comprar |
| `/teto <id> <valor>` | `/teto tv-lg-qned 4500` |
| `/add <termos> [-excluir] [teto=N] [min=N]` | `/add galaxy s25 fe -ultra teto=2500` |
| `/remover <id>` | só produtos criados por `/add` |
| `/status` | último post recebido e produtos ativos |

O bot do Telegram é encontrável por qualquer pessoa, então o listener só repassa comandos cujo
remetente é o `TELEGRAM_CHAT_ID`. Os demais são ignorados sem resposta. Os alertas também só vão
para esse chat.

Os comandos recebidos pelo bot chegam pelo listener (MTProto, sessão própria em
`/sessions/bot.session`), porque o gatilho de Telegram do n8n exige uma URL pública HTTPS. As
alterações ficam no *static data* do workflow, por cima da lista de `catalog.js`. O
`deploy-workflow.sh` preserva esse estado ao publicar uma versão nova.

### No código (regras novas ou mudanças estruturais)

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

### VM congelada pelo host trava o disco em somente leitura

Incidente real (20/11, 20:09): o radar parou por uma hora sem nenhum aviso. O kernel da VM
registrou uma gravação em disco expirando depois de 301 s (`sd ... DID_TIME_OUT`, `I/O error`),
seguida de `Aborting journal` e remontagem do `/` como somente leitura. Com o disco travado, n8n e
listener param juntos, e o healthcheck interno não tem como avisar.

Causa raiz: a VM ficou ~216 s sem CPU. O `VBox.log` mostra o VirtualBox em modo NEM
(`HM: HMR3Init: Attempting fall back to NEM: VT-x is not available`), rodando sobre o Hyper-V
porque o Windows está com Isolamento de Núcleo / Integridade de Memória (VBS/HVCI) ativo. Nesse
modo, congelamentos longos são recorrentes: foram 11 entre 80 e 496 s em menos de 3 horas
(`TM: Giving up catch-up attempt at a ... lag`). O Windows não estava em economia de energia.

Diagnóstico rápido:

```bash
ssh n8n-poc 'touch /tmp/x'                       # "Read-only file system" confirma
ssh n8n-poc 'journalctl -k -b | grep -iE "I/O error|Aborting journal"'
```

```powershell
Select-String 'D:\VirtualBox VMs\n8n\Logs\VBox.log' -Pattern 'NEM|catch-up attempt'
```

Recuperação: `VBoxManage controlvm n8n reset`. O journal é refeito no boot; conferir
`pragma integrity_check` nos bancos SQLite dos dois n8n.

Mitigações aplicadas:
- `watchdog-vm.ps1`, tarefa agendada a cada 5 min no Windows: reseta a VM se o disco estiver em
  somente leitura ou se o SSH sumir por 3 verificações.
- O listener espera o n8n responder antes de conectar ao Telegram. Num reboot, o Docker sobe os
  containers pela política de restart e ignora o `depends_on` do Compose; sem a espera, os posts
  recuperados chegavam com o n8n ainda fora.

Aplicado também (21/11): `deploy/vm/disk-timeout.sh` cria a regra udev que sobe o timeout de disco para
1800 s; rodar uma vez com `sudo bash ~/deal-radar/deploy/vm/disk-timeout.sh`. Os congelamentos
continuam, mas o Linux espera a gravação em vez de travar o disco.

Correção definitiva, no host: desligar a Integridade de Memória libera o VT-x para o VirtualBox,
com o custo de abrir mão dessa proteção do Windows. Foi a opção descartada, para manter a proteção.

### VM restaurada de "saved" volta com o relógio parado

No logoff, o VirtualBox pode salvar a VM em vez de deixá-la desligar (21/11: o `stop-vm.ps1` leu o
estado durante o encerramento do serviço do VirtualBox e concluiu que ela já estava parada). Ao
restaurar de manhã, o relógio da VM voltou 11 h atrasado, porque esta VM não tem as Guest Additions
que corrigem a hora depois de uma restauração, e o `systemd-timesyncd` só confere a cada 34 min.

Efeito: idade dos posts e healthcheck calculados com o "agora" errado. Correções:
- `deploy/vm/timesync.sh` (rodar uma vez com sudo) faz o NTP conferir a cada 2 min.
- `stop-vm.ps1` só desiste do desligamento limpo quando o estado diz claramente `poweroff`,
  `saved` ou `aborted`.
