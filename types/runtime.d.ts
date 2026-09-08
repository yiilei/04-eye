interface ImportMetaEnv {
  readonly VITE_PUBLIC_DISTRIBUTION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

type D1Database = import("drizzle-orm/d1").AnyD1Database;

declare module "cloudflare:workers" {
  export const env: { DB?: D1Database };
}
