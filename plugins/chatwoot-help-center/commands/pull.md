---
description: Baixa artigos da Help Center do Chatwoot para Markdown local
argument-hint: "[portal] [locale] [--dir caminho]"
---

Baixe os artigos da Help Center do Chatwoot para arquivos Markdown usando a tool `pull_articles`.

Argumentos: $ARGUMENTS

- Portal: primeiro argumento posicional, senão `CHATWOOT_DEFAULT_PORTAL`. Se nenhum, rode `list_portals` e pergunte.
- Locale: segundo argumento posicional; se omitido, baixe todos os locales do portal.
- Diretório: `--dir` se informado; senão `help-center/` no diretório de trabalho atual. Converta para caminho absoluto.

Ao final, resuma: quantos arquivos foram escritos (agrupados por locale/categoria) e liste os arquivos em
`skipped_local_changes`, explicando que têm edições locais não enviadas (sugira `/chatwoot-help-center:diff`).
