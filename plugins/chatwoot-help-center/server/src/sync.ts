// Two-way sync between Help Center articles and local Markdown files with YAML frontmatter.
//
// Layout: <dir>/<portal>/<locale>/<category-slug | _sem-categoria>/<article-slug>.md
//
// Each synced file carries `synced_hash`, the hash of the article as it was at the last
// pull/push. Comparing it against the hash of the local file and of the remote article
// tells us who changed since then, without trusting `updated_at` alone.

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import YAML from "yaml";
import type { Article, ArticleStatus, ChatwootClient, Portal } from "./client.js";

const NO_CATEGORY = "_sem-categoria";

export interface Frontmatter {
  id?: number;
  portal: string;
  locale: string;
  category?: string | null;
  title: string;
  slug?: string;
  description?: string | null;
  status?: ArticleStatus;
  tags?: string[];
  updated_at?: number;
  synced_hash?: string;
}

interface Comparable {
  title: string;
  slug?: string;
  description?: string | null;
  status?: ArticleStatus;
  category?: string | null;
  content: string;
}

export function hashArticle(a: Comparable): string {
  const canonical = JSON.stringify([
    a.title.trim(),
    a.slug ?? "",
    (a.description ?? "").trim(),
    a.status ?? "draft",
    a.category ?? "",
    a.content.trimEnd(),
  ]);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

function remoteComparable(a: Article): Comparable {
  return {
    title: a.title,
    slug: a.slug,
    description: a.description,
    status: a.status,
    category: a.category?.slug ?? null,
    content: a.content ?? "",
  };
}

export function assertAbsolute(p: string): void {
  if (!isAbsolute(p)) throw new Error(`Caminho precisa ser absoluto: ${p}`);
}

function safeSegment(s: string): string {
  return s.replace(/[^\p{L}\p{N}_.-]+/gu, "-").replace(/^-+|-+$/g, "") || "sem-nome";
}

export function articlePath(dir: string, portal: string, locale: string, a: Article): string {
  const category = a.category?.slug ? safeSegment(a.category.slug) : NO_CATEGORY;
  return join(dir, safeSegment(portal), safeSegment(locale), category, `${safeSegment(a.slug)}.md`);
}

export function serialize(fm: Frontmatter, content: string): string {
  const clean = Object.fromEntries(Object.entries(fm).filter(([, v]) => v !== undefined));
  return `---\n${YAML.stringify(clean).trimEnd()}\n---\n\n${content.trimEnd()}\n`;
}

export function parse(raw: string): { fm: Frontmatter; content: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error("Arquivo sem frontmatter YAML (bloco --- no topo).");
  const fm = YAML.parse(m[1]) as Frontmatter;
  if (!fm?.title) throw new Error("Frontmatter precisa de `title`.");
  if (!fm.portal || !fm.locale) throw new Error("Frontmatter precisa de `portal` e `locale`.");
  return { fm, content: m[2].replace(/^\r?\n/, "") };
}

function toFrontmatter(portal: string, locale: string, a: Article): Frontmatter {
  return {
    id: a.id,
    portal,
    locale,
    category: a.category?.slug ?? null,
    title: a.title,
    slug: a.slug,
    description: a.description ?? null,
    status: a.status,
    tags: a.meta?.tags?.length ? a.meta.tags : undefined,
    updated_at: a.updated_at,
    synced_hash: hashArticle(remoteComparable(a)),
  };
}

async function writeArticle(dir: string, portal: string, locale: string, a: Article): Promise<string> {
  const path = articlePath(dir, portal, locale, a);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serialize(toFrontmatter(portal, locale, a), a.content ?? ""), "utf8");
  return path;
}

async function walkMarkdown(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walkMarkdown(p)));
    else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

export function portalLocales(p: Portal): string[] {
  const allowed = p.config?.allowed_locales ?? [];
  const codes = allowed.map((l) => (typeof l === "string" ? l : l.code)).filter(Boolean);
  if (codes.length) return codes;
  return p.config?.default_locale ? [p.config.default_locale] : [];
}

async function resolveLocales(client: ChatwootClient, portal: string, locale?: string): Promise<string[]> {
  if (locale) return [locale];
  const locales = portalLocales(await client.getPortal(portal));
  if (!locales.length) throw new Error(`Portal ${portal} não tem locales configurados; informe \`locale\`.`);
  return locales;
}

// ---------------------------------------------------------------------------

export interface PullResult {
  written: string[];
  skipped_local_changes: string[];
}

export async function pull(
  client: ChatwootClient,
  opts: { dir: string; portal: string; locale?: string; status?: ArticleStatus; overwrite_local_changes?: boolean },
): Promise<PullResult> {
  assertAbsolute(opts.dir);
  const result: PullResult = { written: [], skipped_local_changes: [] };
  const localById = await indexLocal(opts.dir);

  for (const locale of await resolveLocales(client, opts.portal, opts.locale)) {
    const articles = await client.listAllArticles(opts.portal, { locale, status: opts.status });
    for (const summary of articles) {
      // The index payload may omit fields in some versions; always fetch the full article.
      const a = await client.getArticle(opts.portal, summary.id);
      const existing = localById.get(key(opts.portal, a.id));
      if (existing && existing.locallyModified && !opts.overwrite_local_changes) {
        result.skipped_local_changes.push(existing.path);
        continue;
      }
      const path = await writeArticle(opts.dir, opts.portal, locale, a);
      // Category or slug changed remotely: drop the stale copy at the old location.
      if (existing && existing.path !== path) await unlink(existing.path).catch(() => {});
      result.written.push(relative(opts.dir, path));
    }
  }
  return result;
}

interface LocalEntry {
  path: string;
  fm: Frontmatter;
  content: string;
  locallyModified: boolean;
}

const key = (portal: string, id: number) => `${portal}#${id}`;

async function indexLocal(dir: string): Promise<Map<string, LocalEntry>> {
  const map = new Map<string, LocalEntry>();
  for (const path of await walkMarkdown(dir)) {
    try {
      const { fm, content } = parse(await readFile(path, "utf8"));
      if (!fm.id) continue;
      const locallyModified = !!fm.synced_hash && hashArticle({ ...fm, content }) !== fm.synced_hash;
      map.set(key(fm.portal, fm.id), { path, fm, content, locallyModified });
    } catch {
      // Not a synced article file; ignore.
    }
  }
  return map;
}

// ---------------------------------------------------------------------------

export interface PushResult {
  action: "created" | "updated" | "unchanged";
  id: number;
  path: string;
  status: ArticleStatus;
}

export async function push(
  client: ChatwootClient,
  opts: { file: string; force?: boolean; author_id?: number },
): Promise<PushResult> {
  assertAbsolute(opts.file);
  const parsed = parse(await readFile(opts.file, "utf8"));
  const fm = parsed.fm;
  // The file always ends with a newline; don't leak it into the article body.
  const content = parsed.content.trimEnd();

  let categoryId: number | null = null;
  if (fm.category) {
    const cats = await client.listCategories(fm.portal, fm.locale);
    const cat = cats.find((c) => c.slug === fm.category && (!c.locale || c.locale === fm.locale));
    if (!cat) {
      throw new Error(
        `Categoria "${fm.category}" não existe no portal ${fm.portal} (${fm.locale}). ` +
          `Crie-a com create_category ou ajuste o frontmatter.`,
      );
    }
    categoryId = cat.id;
  }

  const input = {
    title: fm.title,
    slug: fm.slug,
    description: fm.description ?? undefined,
    content,
    status: fm.status ?? "draft",
    locale: fm.locale,
    category_id: categoryId,
    meta: fm.tags ? { tags: fm.tags } : undefined,
  };

  let saved: Article;
  let action: PushResult["action"];
  if (!fm.id) {
    saved = await client.createArticle(fm.portal, { ...input, author_id: opts.author_id });
    action = "created";
  } else {
    const remote = await client.getArticle(fm.portal, fm.id);
    const remoteHash = hashArticle(remoteComparable(remote));
    const localHash = hashArticle({ ...fm, content });
    if (remoteHash === localHash) {
      saved = remote;
      action = "unchanged";
    } else {
      if (fm.synced_hash && remoteHash !== fm.synced_hash && !opts.force) {
        throw new Error(
          `Conflito: o artigo ${fm.id} foi alterado no Chatwoot desde o último sync. ` +
            `Rode diff_articles para ver o que mudou, faça pull, ou repita com force=true para sobrescrever.`,
        );
      }
      saved = await client.updateArticle(fm.portal, fm.id, input);
      action = "updated";
    }
  }

  // Rewrite the file with fresh sync metadata; keep it at the same path so edits stay put.
  await writeFile(opts.file, serialize(toFrontmatter(fm.portal, fm.locale, saved), saved.content ?? content), "utf8");
  return { action, id: saved.id, path: opts.file, status: saved.status };
}

// ---------------------------------------------------------------------------

export type DiffState = "in_sync" | "local_modified" | "remote_modified" | "conflict" | "new_local" | "remote_only" | "deleted_remote";

export interface DiffEntry {
  state: DiffState;
  id?: number;
  title: string;
  path?: string;
  locale: string;
}

export async function diff(
  client: ChatwootClient,
  opts: { dir: string; portal: string; locale?: string },
): Promise<{ summary: Record<DiffState, number>; entries: DiffEntry[] }> {
  assertAbsolute(opts.dir);
  const entries: DiffEntry[] = [];
  const locales = await resolveLocales(client, opts.portal, opts.locale);

  const local: LocalEntry[] = [];
  for (const path of await walkMarkdown(opts.dir)) {
    try {
      const { fm, content } = parse(await readFile(path, "utf8"));
      if (fm.portal !== opts.portal || !locales.includes(fm.locale)) continue;
      const locallyModified = !fm.synced_hash || hashArticle({ ...fm, content }) !== fm.synced_hash;
      local.push({ path, fm, content, locallyModified });
    } catch {
      // ignore non-article markdown
    }
  }

  const seen = new Set<number>();
  for (const locale of locales) {
    const remoteList = await client.listAllArticles(opts.portal, { locale });
    const remoteIds = new Set(remoteList.map((a) => a.id));

    for (const l of local.filter((x) => x.fm.locale === locale)) {
      const rel = relative(opts.dir, l.path);
      if (!l.fm.id) {
        entries.push({ state: "new_local", title: l.fm.title, path: rel, locale });
        continue;
      }
      seen.add(l.fm.id);
      if (!remoteIds.has(l.fm.id)) {
        entries.push({ state: "deleted_remote", id: l.fm.id, title: l.fm.title, path: rel, locale });
        continue;
      }
      const remote = await client.getArticle(opts.portal, l.fm.id);
      const remoteModified = hashArticle(remoteComparable(remote)) !== l.fm.synced_hash;
      const state: DiffState =
        l.locallyModified && remoteModified
          ? hashArticle(remoteComparable(remote)) === hashArticle({ ...l.fm, content: l.content })
            ? "in_sync"
            : "conflict"
          : l.locallyModified
            ? "local_modified"
            : remoteModified
              ? "remote_modified"
              : "in_sync";
      entries.push({ state, id: l.fm.id, title: l.fm.title, path: rel, locale });
    }

    for (const a of remoteList) {
      if (!seen.has(a.id)) entries.push({ state: "remote_only", id: a.id, title: a.title, locale });
    }
  }

  const summary = Object.fromEntries(
    (["in_sync", "local_modified", "remote_modified", "conflict", "new_local", "remote_only", "deleted_remote"] as DiffState[]).map(
      (s) => [s, entries.filter((e) => e.state === s).length],
    ),
  ) as Record<DiffState, number>;
  return { summary, entries: entries.filter((e) => e.state !== "in_sync") };
}
