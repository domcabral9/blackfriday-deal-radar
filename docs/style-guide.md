# Guia de estilo de escrita

Este repositório segue o mesmo guia do [`morpheus-beta`](https://github.com/domcabral9/morpheus-beta/blob/main/docs/style-guide.md).
Resumo das regras aplicadas aqui:

1. **Nunca usar travessão ("—")** em nenhum texto versionado. Usar ponto, vírgula, dois-pontos ou parênteses.
2. **Evitar contrastes negativos redundantes**: só negar uma alternativa quando o leitor poderia
   supor essa alternativa de verdade.
3. **Nenhuma assinatura de ferramenta de IA** em commits, PRs, comentários ou docs.
4. **Nunca nomear um empregador real.**

## Enforcement

`scripts/check-style.mjs` roda em dois pontos:

- hook `PostToolUse` em `.claude/settings.json`, a cada edição de `.md`;
- CI em `.github/workflows/style-check.yml`, em todo PR para `main`.

Travessão e assinatura de IA bloqueiam. Contraste negativo só lista candidatos para revisão manual.
