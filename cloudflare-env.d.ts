interface CloudflareEnv {
  ASSETS: Fetcher;
  DATA_SOURCE: string;
  FIRMS_CACHE: KVNamespace;
  /** NASA FIRMS API map key. Configured as a Cloudflare Worker secret. */
  FIRMS_MAP_KEY: string;
}
