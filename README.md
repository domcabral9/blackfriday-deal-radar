# Black Friday Deal Radar

Radar pessoal de ofertas: escuta canais de promoção no Telegram, cruza cada post com uma lista de
produtos-alvo e manda um alerta formatado para um bot privado assim que algo relevante aparece.

> **Status**: em construção. Infraestrutura, listener e motor de matching prontos e testados
> (28 casos). Falta conectar a conta do Telegram e o bot de alertas.

Documentação: [arquitetura](docs/architecture.md) · [desenvolvimento e operação](docs/DEVELOPMENT.md)

## Como funciona

```mermaid
flowchart LR
    A[Canais de ofertas<br/>Telegram] -->|MTProto| B[tg-listener<br/>Python + Telethon]
    B -->|HTTP POST| C[n8n<br/>webhook]
    C --> D{Bate com<br/>um produto-alvo?}
    D -->|sim, sem duplicata| E[Bot privado<br/>alerta em HTML]
    D -->|não| F[descarta]
```

## Stack

| Camada | Tecnologia |
|---|---|
| Coleta | Python 3.12 + [Telethon](https://github.com/LonamiWebs/Telethon) (MTProto, conta pessoal) |
| Orquestração e regras | n8n Community Edition, instância dedicada |
| Notificação | Telegram Bot API |
| Infraestrutura | Docker Compose numa VM Ubuntu 22.04 (VirtualBox) |

Tudo open source, rodando em hardware próprio.
