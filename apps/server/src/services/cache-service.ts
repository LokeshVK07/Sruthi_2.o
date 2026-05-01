import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { appConfig } from "../config.js";
import { inferAudioExtension } from "../utils.js";

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

ensureDir(appConfig.cacheDir);
ensureDir(appConfig.tempCacheDir);
ensureDir(appConfig.artworkCacheDir);

const inflightDownloads = new Map<string, Promise<string>>();

let s3Client: S3Client | null = null;
if (appConfig.SHARED_CACHE_ENABLED && appConfig.SHARED_CACHE_BUCKET) {
  s3Client = new S3Client({
    region: appConfig.SHARED_CACHE_REGION,
    endpoint: appConfig.SHARED_CACHE_ENDPOINT || undefined,
    credentials:
      appConfig.SHARED_CACHE_ACCESS_KEY_ID && appConfig.SHARED_CACHE_SECRET_ACCESS_KEY
        ? {
            accessKeyId: appConfig.SHARED_CACHE_ACCESS_KEY_ID,
            secretAccessKey: appConfig.SHARED_CACHE_SECRET_ACCESS_KEY
          }
        : undefined,
    forcePathStyle: Boolean(appConfig.SHARED_CACHE_ENDPOINT)
  });
}

export function getLocalCacheFilePath(songId: string, contentType = "audio/mpeg") {
  ensureDir(appConfig.cacheDir);
  return path.join(appConfig.cacheDir, `${songId}${inferAudioExtension(contentType)}`);
}

export function resolveCachedAudioFile(songId: string) {
  ensureDir(appConfig.cacheDir);
  const matches = fs.readdirSync(appConfig.cacheDir).filter((file) => file.startsWith(songId));
  if (matches.length === 0) return null;
  return path.join(appConfig.cacheDir, matches[0]);
}

export function validateCachedAudioFile(filePath: string) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size < appConfig.MIN_CACHE_FILE_BYTES) {
      fs.unlinkSync(filePath);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function hasSharedCache(songId: string) {
  if (!s3Client || !appConfig.SHARED_CACHE_BUCKET) return false;
  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: appConfig.SHARED_CACHE_BUCKET,
        Key: `${appConfig.SHARED_CACHE_PREFIX}/${songId}.mp3`
      })
    );
    return true;
  } catch {
    return false;
  }
}

export async function readSharedCache(songId: string) {
  if (!s3Client || !appConfig.SHARED_CACHE_BUCKET) return null;
  try {
    const res = await s3Client.send(
      new GetObjectCommand({
        Bucket: appConfig.SHARED_CACHE_BUCKET,
        Key: `${appConfig.SHARED_CACHE_PREFIX}/${songId}.mp3`
      })
    );
    if (!res.Body) return null;
    return {
      body: res.Body as NodeJS.ReadableStream,
      contentType: res.ContentType ?? "audio/mpeg",
      contentLength: res.ContentLength ?? null
    };
  } catch {
    return null;
  }
}

export async function uploadSharedCache(songId: string, filePath: string, contentType: string) {
  if (!s3Client || !appConfig.SHARED_CACHE_BUCKET) return;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: appConfig.SHARED_CACHE_BUCKET,
      Key: `${appConfig.SHARED_CACHE_PREFIX}/${songId}.mp3`,
      Body: createReadStream(filePath),
      ContentType: contentType
    })
  );
}

export async function cacheDownloadFromStream(songId: string, stream: NodeJS.ReadableStream, contentType: string) {
  if (inflightDownloads.has(songId)) {
    return inflightDownloads.get(songId)!;
  }
  const task = (async () => {
    const tempFilePath = path.join(appConfig.tempCacheDir, `${songId}.${Date.now()}.part`);
    const finalPath = getLocalCacheFilePath(songId, contentType);
    await pipeline(stream, createWriteStream(tempFilePath));
    if (!validateCompletedTempFile(tempFilePath)) {
      await fs.promises.rm(tempFilePath, { force: true });
      throw new Error(`Invalid downloaded cache file for ${songId}`);
    }
    await fs.promises.rename(tempFilePath, finalPath);
    void uploadSharedCache(songId, finalPath, contentType).catch(() => {});
    await trimCacheIfNeeded();
    console.info(`[cache] download success ${songId}`);
    return finalPath;
  })()
    .catch(async (error) => {
      console.error(`[cache] download failure ${songId}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    })
    .finally(() => inflightDownloads.delete(songId));
  inflightDownloads.set(songId, task);
  return task;
}

function validateCompletedTempFile(filePath: string) {
  try {
    const stat = fs.statSync(filePath);
    return stat.size >= appConfig.MIN_CACHE_FILE_BYTES;
  } catch {
    return false;
  }
}

export function createCachedReadStream(filePath: string, range?: { start: number; end?: number }) {
  return createReadStream(filePath, range ? { start: range.start, end: range.end } : undefined);
}

export async function trimCacheIfNeeded() {
  const files = listCacheFiles();
  let totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes <= appConfig.maxCacheSizeBytes) return { trimmedFiles: 0 };
  files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  let trimmedFiles = 0;
  for (const file of files) {
    fs.unlinkSync(file.filePath);
    trimmedFiles += 1;
    totalBytes -= file.size;
    if (totalBytes <= appConfig.maxCacheSizeBytes) break;
  }
  console.info(`[cache] trimmed ${trimmedFiles} files`);
  return { trimmedFiles };
}

function listCacheFiles() {
  ensureDir(appConfig.cacheDir);
  return fs.readdirSync(appConfig.cacheDir).flatMap((file) => {
    const filePath = path.join(appConfig.cacheDir, file);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return [];
    return [{ filePath, size: stat.size, mtimeMs: stat.mtimeMs }];
  });
}

export function getCacheStatus() {
  const files = listCacheFiles();
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  return {
    fileCount: files.length,
    totalBytes,
    totalMegabytes: Number((totalBytes / 1024 / 1024).toFixed(2)),
    limitMegabytes: Number((appConfig.maxCacheSizeBytes / 1024 / 1024).toFixed(2)),
    inflightDownloads: inflightDownloads.size
  };
}

export function getCacheValidity(songId: string): "missing" | "valid" | "invalid" {
  const filePath = resolveCachedAudioFile(songId);
  if (!filePath) return "missing";
  return validateCachedAudioFile(filePath) ? "valid" : "invalid";
}

export async function streamToBuffer(stream: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function bufferToStream(buffer: Buffer) {
  return Readable.from(buffer);
}
