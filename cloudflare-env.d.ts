interface CloudflareEnv {
  ASSETS: Fetcher;
  FIRMS_CACHE: KVNamespace;
  /** NASA FIRMS API map key. Configured as a Cloudflare Worker secret. */
  FIRMS_MAP_KEY: string;
  /** OpenAQ v3 API key for the air-quality route. Worker secret; optional. */
  OPENAQ_API_KEY?: string;
  /** Optional ingest alert channels. Worker secrets. */
  DISCORD_WEBHOOK_URL?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}
