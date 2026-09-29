---
name: chatwoot-help-center
description: Use ao trabalhar com a Help Center / base de conhecimento do Chatwoot — listar, buscar, escrever, revisar, publicar, arquivar ou traduzir artigos; organizar categorias e portais; ou sincronizar artigos com arquivos Markdown locais (pull, push, diff). Também quando o usuário mencionar "central de ajuda", "artigo de ajuda", "FAQ do Chatwoot" ou "knowledge base".
---

# Chatwoot Help Center

As tools `mcp__plugin_chatwoot-help-center_chatwoot-help-center__*` falam com a API da Help Center do Chatwoot
configurada por variáveis de ambiente. Se uma tool responder "Variáveis de ambiente ausentes", explique ao usuário
como configurar (ver README do plugin) — não peça o token no chat.

## Modelo de dados

- **Portal** → identificado por **slug** (não por id). Tem `allowed_locales` (ex.: `pt_BR`, `en`).
- **Categoria** → pertence a um portal e a **um locale**. Identificada por id; referenciada por slug nos arquivos.
- **Artigo** → pertence a um portal, um locale e opcionalmente uma categoria. `status`: `draft` | `published` | `archived`.
  Conteúdo em Markdown. Publicar exige `content` não vazio. Traduções são ligadas por `associated_article_id`.

Se `CHATWOOT_DEFAULT_PORTAL` estiver definido, o parâmetro `portal` pode ser omitido.

## Escolha do caminho

| Pedido | Caminho |
|---|---|
| Consultar, buscar, conferir um artigo | `list_articles` (com `query`) → `get_article` |
| Ajuste pontual (status, título, um parágrafo) | `update_article` direto |
| Escrever/revisar vários artigos, ou trabalho que o usuário quer versionar | Sync Markdown: `pull_articles` → editar arquivos → `diff_articles` → `push_article` |
| Estrutura (categorias, portais) | `list_categories` / `create_category` / `update_category` / `update_portal` |

## Fluxo de sync Markdown

Arquivos ficam em `<dir>/<portal>/<locale>/<categoria>/<slug>.md` (artigos sem categoria em `_sem-categoria/`):

```markdown
---
id: 12              # ausente = artigo novo (push cria)
portal: ajuda
locale: pt_BR
category: primeiros-passos   # slug da categoria (precisa existir no mesmo locale)
title: Como redefinir sua senha
slug: como-redefinir-sua-senha
description: Passo a passo para recuperar o acesso.
status: draft
tags: [conta, senha]
updated_at: 1727190000       # gerenciado pelo plugin
synced_hash: 3f9c...         # gerenciado pelo plugin — não editar
---

Corpo em Markdown…
```

Regras:
1. Sempre passe caminhos **absolutos** (`dir`, `file`).
2. Antes de qualquer push em lote, rode `diff_articles` e mostre o resumo ao usuário.
3. `push_article` recusa quando o artigo mudou no Chatwoot desde o último sync (**conflict**). Nesse caso mostre
   as duas versões (`get_article` vs arquivo local), proponha um merge e só use `force: true` com confirmação explícita.
4. `pull_articles` não sobrescreve arquivos com edições locais não enviadas; eles voltam em `skipped_local_changes`.
5. Para criar artigo novo via arquivo, escreva o `.md` sem `id` e rode `push_article` — o frontmatter recebe o id.
6. Nunca edite `synced_hash`/`updated_at` à mão.

## Boas práticas de conteúdo

- **Título** como a pergunta ou tarefa do usuário ("Como exportar relatórios"), não como nome de feature.
- **Descrição** de uma frase — aparece na listagem e pesa na busca.
- Comece pela resposta; passos numerados para procedimentos; um assunto por artigo.
- Use `##`/`###` para seções; evite `#` no corpo (o título já é o H1 do portal).
- Links entre artigos: use a URL pública do portal.
- Respeite a língua do locale; em `pt_BR`, acentuação correta é obrigatória.
- Crie como `draft`, mostre ao usuário, e só publique quando ele aprovar.

## Operações destrutivas

`delete_article` e `delete_category` são irreversíveis. Prefira arquivar (`status: archived`). Só exclua com
confirmação explícita do usuário para aquele item específico.
