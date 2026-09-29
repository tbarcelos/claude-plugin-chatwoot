---
description: Envia artigos Markdown locais para a Help Center do Chatwoot
argument-hint: "[arquivo.md ... | --all] [--dir caminho]"
---

Envie artigos locais para o Chatwoot com `push_article`.

Argumentos: $ARGUMENTS

1. Se arquivos foram passados, use-os (caminhos absolutos).
2. Se `--all` ou nenhum argumento: rode `diff_articles` no diretório (padrão `help-center/`) e selecione os
   arquivos em `local_modified` e `new_local`. Mostre a lista ao usuário e **peça confirmação** antes de enviar.
3. Envie um por vez. Para cada `conflict` retornado, pare aquele arquivo, mostre a diferença entre a versão remota
   (`get_article`) e a local, e pergunte como resolver. Nunca use `force: true` sem confirmação explícita.
4. Se algum arquivo muda `status` para `published`, destaque isso na confirmação.

Resuma ao final: criados, atualizados, inalterados, com erro.
