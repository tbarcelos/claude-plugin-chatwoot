# Chatwoot Help Center — plugin para Claude Code

Gerencia a Help Center (base de conhecimento) de uma instância Chatwoot pelo Claude Code: portais, categorias e
artigos, com sincronização bidirecional entre artigos e arquivos Markdown versionáveis.

## O que vem no plugin

| Peça | Conteúdo |
|---|---|
| MCP server (`server/`) | 15 tools: `list_portals`, `create_portal`, `update_portal`, `list_categories`, `create_category`, `update_category`, `delete_category`, `list_articles`, `get_article`, `create_article`, `update_article`, `delete_article`, `pull_articles`, `push_article`, `diff_articles` |
| Skill `chatwoot-help-center` | Modelo de dados, fluxo de sync, boas práticas de redação, regras para operações destrutivas |
| Comandos | `/chatwoot-help-center:pull`, `:diff`, `:push`, `:new` |

## Configuração

Crie um token de acesso em **Chatwoot → Configurações do perfil → Token de acesso** (o usuário precisa ser
administrador da conta para gerenciar a Help Center) e exporte no shell que inicia o Claude Code:

```bash
export CHATWOOT_BASE_URL="https://chat.suaempresa.com"   # sem /api
export CHATWOOT_API_TOKEN="..."                           # token do perfil
export CHATWOOT_ACCOUNT_ID="1"                            # número na URL /app/accounts/<id>/
export CHATWOOT_DEFAULT_PORTAL="ajuda"                    # opcional: slug do portal padrão
```

Artigos criados sem `author_id` usam o dono do token como autor.

## Instalação

Requer Node 18+ instalado. No Claude Code:

```
/plugin marketplace add tbarcelos/claude-plugin-chatwoot
/plugin install chatwoot-help-center@emotize-tools
```

Ou pelo terminal:

```bash
claude plugin marketplace add tbarcelos/claude-plugin-chatwoot
claude plugin install chatwoot-help-center@emotize-tools
```

Abra uma sessão nova para o MCP server subir. Para atualizar depois:
`claude plugin marketplace update emotize-tools`.

No app desktop, prefira colocar as variáveis no bloco `env` do `~/.claude/settings.json`
em vez de `export` no shell — o app nem sempre herda o ambiente do terminal.

## Sync com Markdown

```
help-center/
└── ajuda/                 # portal
    └── pt_BR/             # locale
        ├── primeiros-passos/
        │   └── como-entrar.md
        └── _sem-categoria/
            └── faq.md
```

Cada arquivo tem frontmatter com `id`, `portal`, `locale`, `category` (slug), `title`, `slug`, `description`,
`status`, `tags`, e dois campos gerenciados (`updated_at`, `synced_hash`). O `synced_hash` registra o estado no
último sync, o que permite ao `diff_articles` distinguir edição local, edição remota e conflito. O `push_article`
recusa sobrescrever uma edição remota a menos que receba `force: true`.

Arquivo sem `id` = artigo novo; o push cria e grava o id de volta no frontmatter.

## Desenvolvimento

```bash
cd plugins/chatwoot-help-center/server
npm install
npm run typecheck
npm run build        # gera dist/index.js (bundle único, versionado para o plugin rodar sem npm install)
```

Sempre rode `npm run build` e comite `dist/` após mudar `src/`.

Endpoints usados (API de aplicação, header `api_access_token`):
`/api/v1/accounts/:account_id/portals[/:portal_slug[/categories|/articles][/:id]]` e `/api/v1/profile`.
