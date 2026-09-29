---
description: Compara o acervo Markdown local com a Help Center do Chatwoot
argument-hint: "[portal] [locale] [--dir caminho]"
---

Rode `diff_articles` para comparar o acervo local com o Chatwoot.

Argumentos: $ARGUMENTS (mesmas regras de portal/locale/diretório de `/chatwoot-help-center:pull`; padrão `help-center/`, caminho absoluto).

Apresente o resultado como tabela agrupada por estado, nesta ordem, omitindo estados vazios:
`conflict`, `local_modified`, `new_local`, `remote_modified`, `remote_only`, `deleted_remote`.

Depois sugira o próximo passo: push para `local_modified`/`new_local`, pull para `remote_modified`/`remote_only`,
e revisão manual para `conflict` e `deleted_remote`. Não execute nada além do diff.
