#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ChatwootClient } from "./client.js";
import { diff, pull, push } from "./sync.js";

const server = new McpServer({ name: "chatwoot-help-center", version: "0.1.0" });

// Created lazily so the server still starts (and reports a clear error per call) when env is missing.
let client: ChatwootClient | undefined;
const api = () => (client ??= ChatwootClient.fromEnv());

const defaultPortal = process.env.CHATWOOT_DEFAULT_PORTAL;

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });

function tool<S extends z.ZodRawShape>(
  name: string,
  description: string,
  inputSchema: S,
  handler: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean } = {},
) {
  server.registerTool(name, { description, inputSchema, annotations }, (async (args: z.infer<z.ZodObject<S>>) => {
    try {
      return ok(await handler(args));
    } catch (e) {
      return { isError: true, content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }] };
    }
  }) as never);
}

function portalOf(p?: string): string {
  const slug = p ?? defaultPortal;
  if (!slug) throw new Error("Informe `portal` (slug) ou defina CHATWOOT_DEFAULT_PORTAL.");
  return slug;
}

const portal = z.string().optional().describe("Slug do portal. Padrão: CHATWOOT_DEFAULT_PORTAL.");
const locale = z.string().optional().describe("Código do locale, ex.: pt_BR, en.");
const status = z.enum(["draft", "published", "archived"]);
const absPath = (what: string) => z.string().describe(`${what} — caminho ABSOLUTO no sistema de arquivos.`);

// ---------------------------------------------------------------- portals

tool("list_portals", "Lista os portais da Help Center da conta, com locales configurados.", {}, async () =>
  (await api().listPortals()).map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    custom_domain: p.custom_domain,
    archived: p.archived,
    config: p.config,
  })),
  { readOnlyHint: true },
);

const portalFields = {
  name: z.string().optional(),
  slug: z.string().optional(),
  color: z.string().optional().describe("Cor hex, ex.: #14254A"),
  custom_domain: z.string().optional(),
  header_text: z.string().optional(),
  homepage_link: z.string().optional(),
  page_title: z.string().optional(),
  default_locale: z.string().optional(),
  allowed_locales: z.array(z.string()).optional(),
};

type PortalFields = { default_locale?: string; allowed_locales?: string[] } & Record<string, unknown>;
const portalBody = ({ default_locale, allowed_locales, ...rest }: PortalFields) => ({
  ...rest,
  ...(default_locale || allowed_locales ? { config: { default_locale, allowed_locales } } : {}),
});

tool("create_portal", "Cria um novo portal da Help Center.", { ...portalFields, name: z.string(), slug: z.string() }, async (a) =>
  api().createPortal(portalBody(a)),
);

tool(
  "update_portal",
  "Atualiza um portal existente (nome, cor, domínio, locales, arquivamento).",
  { portal, ...portalFields, archived: z.boolean().optional() },
  async ({ portal: p, ...rest }) => api().updatePortal(portalOf(p), portalBody(rest)),
);

// ---------------------------------------------------------------- categories

tool(
  "list_categories",
  "Lista categorias de um portal, opcionalmente filtradas por locale. Inclui contagem de artigos.",
  { portal, locale },
  async ({ portal: p, locale: l }) => api().listCategories(portalOf(p), l),
  { readOnlyHint: true },
);

const categoryFields = {
  name: z.string().optional(),
  slug: z.string().optional(),
  description: z.string().optional(),
  locale,
  position: z.number().int().optional(),
  icon: z.string().optional().describe("Emoji/ícone exibido no portal"),
  parent_category_id: z.number().int().nullable().optional(),
  associated_category_id: z.number().int().nullable().optional().describe("Mesma categoria em outro locale"),
  related_category_ids: z.array(z.number().int()).optional(),
};

tool(
  "create_category",
  "Cria uma categoria em um portal. `locale` é obrigatório.",
  { portal, ...categoryFields, name: z.string(), locale: z.string() },
  async ({ portal: p, ...input }) => api().createCategory(portalOf(p), input),
);

tool(
  "update_category",
  "Atualiza uma categoria pelo id.",
  { portal, id: z.number().int(), ...categoryFields },
  async ({ portal: p, id, ...input }) => api().updateCategory(portalOf(p), id, input),
);

tool(
  "delete_category",
  "Exclui uma categoria pelo id. Irreversível — confirme com o usuário antes.",
  { portal, id: z.number().int() },
  async ({ portal: p, id }) => {
    await api().deleteCategory(portalOf(p), id);
    return { deleted: id };
  },
  { destructiveHint: true },
);

// ---------------------------------------------------------------- articles

tool(
  "list_articles",
  "Lista/busca artigos (paginado). `query` faz busca full-text em título, descrição e conteúdo. " +
    "Retorna resumo sem o conteúdo; use get_article para o corpo completo.",
  {
    portal,
    locale,
    category_slug: z.string().optional(),
    status: status.optional(),
    query: z.string().optional(),
    author_id: z.number().int().optional(),
    page: z.number().int().min(1).optional(),
  },
  async ({ portal: p, ...filters }) => {
    const res = await api().listArticles(portalOf(p), filters);
    return {
      meta: res.meta,
      articles: res.payload.map((a) => ({
        id: a.id,
        title: a.title,
        slug: a.slug,
        status: a.status,
        description: a.description,
        category: a.category?.slug,
        views: a.views,
        updated_at: new Date(a.updated_at * 1000).toISOString(),
      })),
    };
  },
  { readOnlyHint: true },
);

tool(
  "get_article",
  "Retorna um artigo completo (conteúdo Markdown, metadados, categoria, autor).",
  { portal, id: z.number().int() },
  async ({ portal: p, id }) => api().getArticle(portalOf(p), id),
  { readOnlyHint: true },
);

const articleFields = {
  title: z.string().optional(),
  slug: z.string().optional().describe("Apenas letras, números, - e _. Gerado a partir do título se omitido."),
  content: z.string().optional().describe("Corpo em Markdown. Obrigatório para publicar."),
  description: z.string().optional().describe("Resumo curto exibido na listagem e usado na busca."),
  category_id: z.number().int().nullable().optional(),
  status: status.optional(),
  locale,
  position: z.number().int().optional(),
  author_id: z.number().int().optional().describe("Padrão: dono do token da API."),
  associated_article_id: z.number().int().optional().describe("Mesmo artigo em outro locale (tradução)."),
  meta: z
    .object({ title: z.string().optional(), description: z.string().optional(), tags: z.array(z.string()).optional() })
    .optional()
    .describe("SEO: título, descrição e tags."),
};

tool(
  "create_article",
  "Cria um artigo. Nasce como rascunho (draft), a menos que `status` seja informado.",
  { portal, ...articleFields, title: z.string(), locale: z.string() },
  async ({ portal: p, ...input }) => api().createArticle(portalOf(p), input),
);

tool(
  "update_article",
  "Atualiza campos de um artigo. Para publicar/arquivar, envie apenas `status`.",
  { portal, id: z.number().int(), ...articleFields },
  async ({ portal: p, id, ...input }) => api().updateArticle(portalOf(p), id, input),
);

tool(
  "delete_article",
  "Exclui um artigo pelo id. Irreversível — prefira arquivar (status=archived) e confirme com o usuário antes.",
  { portal, id: z.number().int() },
  async ({ portal: p, id }) => {
    await api().deleteArticle(portalOf(p), id);
    return { deleted: id };
  },
  { destructiveHint: true },
);

// ---------------------------------------------------------------- markdown sync

tool(
  "pull_articles",
  "Baixa artigos do portal para arquivos Markdown com frontmatter em " +
    "<dir>/<portal>/<locale>/<categoria>/<slug>.md. Arquivos com edições locais não enviadas são preservados " +
    "(listados em skipped_local_changes) a menos que overwrite_local_changes=true.",
  {
    dir: absPath("Diretório raiz do acervo local"),
    portal,
    locale: locale.describe("Locale a baixar. Padrão: todos os locales do portal."),
    status: status.optional(),
    overwrite_local_changes: z.boolean().optional(),
  },
  async ({ portal: p, ...rest }) => pull(api(), { ...rest, portal: portalOf(p) }),
  { idempotentHint: true },
);

tool(
  "push_article",
  "Envia um arquivo Markdown para o Chatwoot: cria o artigo se o frontmatter não tem `id`, senão atualiza. " +
    "Recusa se o artigo mudou no Chatwoot desde o último sync, a menos que force=true. " +
    "Reescreve o frontmatter do arquivo com id/updated_at/synced_hash novos.",
  {
    file: absPath("Arquivo .md do artigo"),
    force: z.boolean().optional().describe("Sobrescreve alterações remotas. Só use com confirmação do usuário."),
    author_id: z.number().int().optional(),
  },
  async (args) => push(api(), args),
);

tool(
  "diff_articles",
  "Compara o acervo local com o portal e classifica cada artigo: local_modified, remote_modified, conflict, " +
    "new_local (sem id), remote_only (não baixado), deleted_remote. Omite os que estão in_sync.",
  { dir: absPath("Diretório raiz do acervo local"), portal, locale },
  async ({ portal: p, ...rest }) => diff(api(), { ...rest, portal: portalOf(p) }),
  { readOnlyHint: true },
);

await server.connect(new StdioServerTransport());
