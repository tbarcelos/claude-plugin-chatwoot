// Thin client for the Chatwoot Help Center (portals / categories / articles) Application API.
// Portals are addressed by slug; categories and articles by numeric id.

export type ArticleStatus = "draft" | "published" | "archived";

export interface Category {
  id: number;
  name: string;
  slug: string;
  locale: string;
  description?: string | null;
  position?: number | null;
  icon?: string | null;
  parent_category?: { id: number; slug: string; name: string } | null;
  meta?: { articles_count?: number };
}

export interface Article {
  id: number;
  slug: string;
  title: string;
  content: string | null;
  description: string | null;
  status: ArticleStatus;
  position: number | null;
  updated_at: number;
  meta?: { title?: string; description?: string; tags?: string[] } | null;
  category?: { id: number | null; name?: string | null; slug?: string | null; locale?: string | null };
  views?: number;
  author?: { id: number; name?: string; email?: string };
}

export interface Portal {
  id: number;
  name: string;
  slug: string;
  custom_domain?: string | null;
  archived?: boolean;
  config?: { allowed_locales?: Array<{ code: string } | string>; default_locale?: string };
  [key: string]: unknown;
}

export interface ArticleInput {
  title?: string;
  slug?: string;
  content?: string;
  description?: string;
  category_id?: number | null;
  author_id?: number;
  status?: ArticleStatus;
  locale?: string;
  position?: number;
  associated_article_id?: number;
  meta?: { title?: string; description?: string; tags?: string[] };
}

export interface CategoryInput {
  name?: string;
  slug?: string;
  description?: string;
  locale?: string;
  position?: number;
  icon?: string;
  parent_category_id?: number | null;
  associated_category_id?: number | null;
  related_category_ids?: number[];
}

export interface PortalInput {
  name?: string;
  slug?: string;
  color?: string;
  custom_domain?: string;
  header_text?: string;
  homepage_link?: string;
  page_title?: string;
  archived?: boolean;
  config?: { default_locale?: string; allowed_locales?: string[] };
}

export class ChatwootError extends Error {
  constructor(
    public status: number,
    public body: string,
    method: string,
    path: string,
  ) {
    super(`Chatwoot ${method} ${path} falhou (${status}): ${body.slice(0, 500)}`);
  }
}

type Query = Record<string, string | number | undefined | null>;

export class ChatwootClient {
  private readonly baseUrl: string;
  private profileId?: number;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly accountId: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  static fromEnv(): ChatwootClient {
    const missing = ["CHATWOOT_BASE_URL", "CHATWOOT_API_TOKEN", "CHATWOOT_ACCOUNT_ID"].filter((k) => !process.env[k]);
    if (missing.length) {
      throw new Error(
        `Variáveis de ambiente ausentes: ${missing.join(", ")}. Configure-as antes de iniciar o Claude Code.`,
      );
    }
    return new ChatwootClient(
      process.env.CHATWOOT_BASE_URL!,
      process.env.CHATWOOT_API_TOKEN!,
      process.env.CHATWOOT_ACCOUNT_ID!,
    );
  }

  private async request<T>(method: string, path: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, {
      method,
      headers: {
        api_access_token: this.token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    if (!res.ok) throw new ChatwootError(res.status, text, method, path);
    return (text ? JSON.parse(text) : {}) as T;
  }

  private acct(path: string): string {
    return `/api/v1/accounts/${encodeURIComponent(this.accountId)}${path}`;
  }

  private portalPath(portal: string, rest = ""): string {
    return this.acct(`/portals/${encodeURIComponent(portal)}${rest}`);
  }

  /** Id of the user that owns the API token — used as default article author. */
  async currentUserId(): Promise<number> {
    if (this.profileId === undefined) {
      const profile = await this.request<{ id: number }>("GET", "/api/v1/profile");
      this.profileId = profile.id;
    }
    return this.profileId;
  }

  // ---- portals ----
  async listPortals(): Promise<Portal[]> {
    const res = await this.request<{ payload: Portal[] }>("GET", this.acct("/portals"));
    return res.payload;
  }

  async getPortal(portal: string): Promise<Portal> {
    return this.request<Portal>("GET", this.portalPath(portal));
  }

  async createPortal(input: PortalInput): Promise<Portal> {
    return this.request<Portal>("POST", this.acct("/portals"), { body: { portal: input } });
  }

  async updatePortal(portal: string, input: PortalInput): Promise<Portal> {
    return this.request<Portal>("PATCH", this.portalPath(portal), { body: { portal: input } });
  }

  // ---- categories ----
  async listCategories(portal: string, locale?: string): Promise<Category[]> {
    const res = await this.request<{ payload: Category[] }>("GET", this.portalPath(portal, "/categories"), {
      query: { locale },
    });
    return res.payload;
  }

  async createCategory(portal: string, input: CategoryInput): Promise<Category> {
    const res = await this.request<{ payload: Category }>("POST", this.portalPath(portal, "/categories"), {
      body: { category: input },
    });
    return res.payload ?? (res as unknown as Category);
  }

  async updateCategory(portal: string, id: number, input: CategoryInput): Promise<Category> {
    const res = await this.request<{ payload: Category }>("PATCH", this.portalPath(portal, `/categories/${id}`), {
      body: { category: input },
    });
    return res.payload ?? (res as unknown as Category);
  }

  async deleteCategory(portal: string, id: number): Promise<void> {
    await this.request("DELETE", this.portalPath(portal, `/categories/${id}`));
  }

  // ---- articles ----
  async listArticles(
    portal: string,
    filters: { locale?: string; category_slug?: string; status?: ArticleStatus; query?: string; author_id?: number; page?: number },
  ): Promise<{ payload: Article[]; meta: Record<string, number> }> {
    return this.request("GET", this.portalPath(portal, "/articles"), { query: filters });
  }

  /** Walks every page of the article index for the given filters. */
  async listAllArticles(
    portal: string,
    filters: { locale?: string; category_slug?: string; status?: ArticleStatus },
  ): Promise<Article[]> {
    const all: Article[] = [];
    for (let page = 1; page < 1000; page++) {
      const res = await this.listArticles(portal, { ...filters, page });
      if (!res.payload.length) break;
      all.push(...res.payload);
      const total = res.meta?.articles_count;
      if (typeof total === "number" && all.length >= total) break;
    }
    return all;
  }

  async getArticle(portal: string, id: number): Promise<Article> {
    const res = await this.request<{ payload: Article }>("GET", this.portalPath(portal, `/articles/${id}`));
    return res.payload ?? (res as unknown as Article);
  }

  async createArticle(portal: string, input: ArticleInput): Promise<Article> {
    const body = { ...input, author_id: input.author_id ?? (await this.currentUserId()) };
    const res = await this.request<{ payload: Article }>("POST", this.portalPath(portal, "/articles"), {
      body: { article: body },
    });
    return res.payload ?? (res as unknown as Article);
  }

  async updateArticle(portal: string, id: number, input: ArticleInput): Promise<Article> {
    const res = await this.request<{ payload: Article }>("PATCH", this.portalPath(portal, `/articles/${id}`), {
      body: { article: input },
    });
    return res.payload ?? (res as unknown as Article);
  }

  async deleteArticle(portal: string, id: number): Promise<void> {
    await this.request("DELETE", this.portalPath(portal, `/articles/${id}`));
  }
}
