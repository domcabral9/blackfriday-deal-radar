# Arquitetura

## Fluxo de ponta a ponta

```mermaid
flowchart TD
    subgraph Telegram
        C1[Ofertas Rodrigo Moreira]
        C2[VRL Melhores Promoções]
    end

    C1 & C2 -->|MTProto, conta pessoal| L["tg-listener<br/>(listener/radar/listen.py)"]
    L -->|cópia bruta| J[(messages.jsonl)]
    L -->|POST + X-Radar-Token| W[Webhook]

    subgraph n8n dedicado
        W --> CAT[Catálogo de produtos]
        CAT --> A["Analisar oferta<br/>produto, preço, cupom, link"]
        A --> IF{status = alerta?}
        IF -->|sim| D["Deduplicar<br/>produto + preço, janela de 12h"]
        D --> F[Formatar alerta]
        F --> T[Enviar no Telegram]
    end

    T -->|Bot API| B[Bot privado]

    style J fill:#1a2942,stroke:#4a7ab8,color:#e8eef7
    style B fill:#1a2942,stroke:#4a7ab8,color:#e8eef7
```

## Por que um listener separado

O nó Telegram do n8n usa a Bot API, e um bot só lê canais em que é administrador. Ler canais de
terceiros com a própria conta exige o protocolo MTProto, que é o que os apps oficiais usam. O
Telethon implementa esse protocolo em Python.

O listener foi mantido propositalmente simples: escuta só os canais cadastrados, transforma cada
post em JSON (texto, links escondidos em texto, botões, trechos formatados como código) e entrega
ao n8n. Decidir se a oferta interessa é tarefa do workflow, onde a regra fica visível e editável.

`catch_up=True` faz o Telethon pedir ao Telegram as mensagens publicadas enquanto o listener estava
fora. Numa reinicialização curta da VM, os alertas chegam atrasados em vez de se perderem. Em
quedas longas, o Telegram pode limitar a recuperação, e a fonte de verdade passa a ser o
histórico do canal (`radar.backfill`).

## Por que uma instância n8n dedicada

A VM já hospedava uma instância n8n de outro projeto. Um workflow novo dentro dela funcionaria,
mas misturaria credenciais pessoais (sessão do Telegram, token do bot) com as do outro projeto e
acoplaria os dois ciclos de restart e upgrade. A stack `deal-radar` tem projeto Compose, rede,
volumes e banco próprios, e reaproveita a mesma imagem do n8n por uma tag local fixa. Com isso, o
custo em disco é zero e um upgrade do outro projeto não muda esta stack.

## Motor de matching

Cada produto do catálogo é uma regex do modelo mais restrições:

| Regra | Exemplo | Para quê |
|---|---|---|
| `excludeAfter` | S26 seguido de `ultra`, `plus`, `+`, `fe` | descarta variantes indesejadas |
| `requireAll` | `galaxy\|samsung`, `256gb` | exige termos combinados |
| `size` | `55` | TVs no tamanho certo |
| `minPrice` | 900 | abaixo disso é acessório (capa, película) |
| `maxPrice` | 5000 | teto de orçamento, parcelado conta pelo total |

O texto é normalizado antes (minúsculo, sem acento, sem pontuação exceto `+`) e os valores em reais
são removidos antes de procurar o tamanho, para que centavos como `,55` não virem "55 polegadas".

O preço efetivo é o menor valor plausível do post, à vista ou total parcelado. Valores ao lado de
"cupom", "OFF", "desconto" ou "cashback" são ignorados, assim como o preço antigo em "de R$ X por
R$ Y". Cada análise devolve um status (`alerta`, `acessorio`, `acima_do_teto`, `sem_produto`), que
aparece no histórico de execuções do n8n e explica por que um post não gerou alerta.

## Deduplicação

Os dois canais costumam repostar a mesma oferta, cada um com seu link de afiliado. A chave de dedup
é produto + preço arredondado, que se mantém entre canais, com janela de 12 horas. Sem preço
identificado, a chave cai para o link.
