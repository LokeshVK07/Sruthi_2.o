import path from "node:path";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  APP_BASE_URL: z.string().default("http://localhost:4000"),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  PYTHON_BIN: z.string().default("python3"),
  DATABASE_PATH: z.string().default("apps/server/data/melodify.db"),
  CACHE_DIR: z.string().default("apps/server/cache/audio"),
  TEMP_CACHE_DIR: z.string().default("apps/server/cache/temp"),
  ARTWORK_CACHE_DIR: z.string().default("apps/server/cache/artwork"),
  SHARED_CACHE_ENABLED: z.coerce.boolean().default(false),
  SHARED_CACHE_BUCKET: z.string().optional(),
  SHARED_CACHE_REGION: z.string().optional(),
  SHARED_CACHE_ENDPOINT: z.string().optional(),
  SHARED_CACHE_ACCESS_KEY_ID: z.string().optional(),
  SHARED_CACHE_SECRET_ACCESS_KEY: z.string().optional(),
  SHARED_CACHE_PREFIX: z.string().default("audio"),
  MASSTAMILAN_BASE_URL: z.string().default("https://www.masstamilan.dev"),
  MASSTAMILAN_LIST_PATH: z.string().default("/tamil-songs"),
  MASSTAMILAN_MAX_PAGES: z.coerce.number().default(481),
  MASSTAMILAN_STORAGE_STATE: z.string().default("apps/server/.playwright/masstamilan-storage.json"),
  MASSTAMILAN_HEADLESS: z.coerce.boolean().default(true),
  MASSTAMILAN_REQUEST_TIMEOUT_MS: z.coerce.number().default(30_000),
  MASSTAMILAN_CONCURRENCY: z.coerce.number().default(2),
  MASSTAMILAN_RETRY_COUNT: z.coerce.number().default(3),
  MASSTAMILAN_RETRY_BASE_MS: z.coerce.number().default(1500),
  MAX_CACHE_SIZE_MB: z.coerce.number().default(4096),
  MIN_CACHE_FILE_BYTES: z.coerce.number().default(65536),
  STREAM_PREFETCH_LIMIT: z.coerce.number().default(4),
  WARMUP_BATCH_SIZE: z.coerce.number().default(12),
  SESSION_SECRET: z.string().default("change-me")
});

const parsed = envSchema.parse(process.env);
const rootDir = process.cwd();

export const appConfig = {
  ...parsed,
  rootDir,
  databasePath: path.resolve(rootDir, parsed.DATABASE_PATH),
  cacheDir: path.resolve(rootDir, parsed.CACHE_DIR),
  tempCacheDir: path.resolve(rootDir, parsed.TEMP_CACHE_DIR),
  artworkCacheDir: path.resolve(rootDir, parsed.ARTWORK_CACHE_DIR),
  storageStatePath: path.resolve(rootDir, parsed.MASSTAMILAN_STORAGE_STATE),
  maxCacheSizeBytes: parsed.MAX_CACHE_SIZE_MB * 1024 * 1024
};
