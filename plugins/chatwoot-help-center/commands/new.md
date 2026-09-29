---
description: Rascunha um novo artigo da Help Center como arquivo Markdown
argument-hint: "<assunto do artigo> [--categoria slug] [--locale pt_BR]"
---

Rascunhe um novo artigo da Help Center sobre: $ARGUMENTS

1. Descubra portal e locale (argumentos, `CHATWOOT_DEFAULT_PORTAL`, ou `list_portals`).
2. Rode `list_categories` e escolha a categoria mais adequada (ou a informada). Se nenhuma servir, sugira criar uma
   e pergunte antes de chamar `create_category`.
3. Use `list_articles` com `query` para checar se já existe artigo sobre o assunto; se existir, mostre e pergunte
   se é para editar o existente em vez de criar.
4. Escreva o arquivo em `help-center/<portal>/<locale>/<categoria>/<slug>.md` (caminho absoluto), **sem `id`**,
   com `status: draft`, seguindo as boas práticas da skill `chatwoot-help-center`.
5. Mostre o rascunho e pergunte se deve enviar com `push_article` (continuará como draft até aprovação para publicar).
