import fs from "node:fs";
import { PassThrough } from "node:stream";
import { request } from "undici";
import { clearPlaybackError, getSongStatus, getSongStreamRecord, markPlaybackError, markSongVerified } from "../repositories/library-repo.js";
import { scraperService } from "./scraper-service.js";
import {
  cacheDownloadFromStream,
  createCachedReadStream,
  getCacheStatus,
  getCacheValidity,
  hasSharedCache,
  readSharedCache,
  resolveCachedAudioFile,
  validateCachedAudioFile
} from "./cache-service.js";
import type { PlaybackResolveResult, ResolvedStream } from "../types.js";

const ACCEPTED_CONTENT_TYPES = ["audio/mpeg", "audio/mp3", "audio/aac", "audio/ogg", "audio/wav", "application/octet-stream"];

function normalizeContentType(value: string | undefined | null) {
  return (value ?? "").split(";")[0].trim().toLowerCase();
}

function isAcceptableStatus(statusCode: number) {
  return statusCode === 200 || statusCode === 206;
}

function isAcceptableContentType(contentType: string) {
  return ACCEPTED_CONTENT_TYPES.includes(contentType);
}

function parseRangeHeader(rangeHeader: string | undefined, size: number) {
  if (!rangeHeader) return null;
  const match = rangeHeader.match(/bytes=(\d+)-(\d+)?/);
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return { start, end };
}

export async function resolveSongStream(songId: string): Promise<PlaybackResolveResult> {
  const song = getSongStreamRecord(songId);
  if (!song) {
    throw new Error("Song not found");
  }

  const cachedFile = resolveCachedAudioFile(songId);
  if (cachedFile) {
    if (!validateCachedAudioFile(cachedFile)) {
      console.warn(`[cache] invalid local file removed for ${songId}`);
    } else {
      const stat = await fs.promises.stat(cachedFile);
      console.info(`[stream] cache hit local ${songId}`);
      return {
        source: "local-cache",
        contentType: cachedFile.endsWith(".mp3") ? "audio/mpeg" : "application/octet-stream",
        contentLength: stat.size,
        path: cachedFile,
        streamFactory: async (rangeHeader?: string) => buildLocalStream(cachedFile, stat.size, rangeHeader)
      };
    }
  }

  if (await hasSharedCache(songId)) {
    const shared = await readSharedCache(songId);
    if (shared) {
      console.info(`[stream] cache hit shared ${songId}`);
      return {
        source: "shared-cache",
        contentType: shared.contentType,
        contentLength: shared.contentLength,
        streamFactory: async () => ({
          statusCode: 200,
          headers: {
            "content-type": shared.contentType,
            "accept-ranges": "bytes",
            ...(shared.contentLength ? { "content-length": String(shared.contentLength) } : {})
          },
          body: shared.body
        })
      };
    }
  }

  console.info(`[stream] cache miss ${songId}`);
  return resolveUpstreamStream(songId, false);
}

function buildLocalStream(filePath: string, size: number, rangeHeader?: string): ResolvedStream {
  const range = parseRangeHeader(rangeHeader, size);
  const headers: Record<string, string> = {
    "content-type": filePath.endsWith(".mp3") ? "audio/mpeg" : "application/octet-stream",
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=86400"
  };
  if (!range) {
    headers["content-length"] = String(size);
    return { statusCode: 200, headers, body: createCachedReadStream(filePath) };
  }
  const chunkSize = range.end - range.start + 1;
  headers["content-length"] = String(chunkSize);
  headers["content-range"] = `bytes ${range.start}-${range.end}/${size}`;
  return { statusCode: 206, headers, body: createCachedReadStream(filePath, range) };
}

async function resolveUpstreamStream(songId: string, didRefresh: boolean): Promise<PlaybackResolveResult> {
  const song = getSongStreamRecord(songId);
  if (!song?.upstreamUrl) {
    if (!didRefresh) {
      await refreshAndRetry(song);
      return resolveUpstreamStream(songId, true);
    }
    throw new Error("No upstream URL available");
  }

  return {
    source: "upstream",
    contentType: "audio/mpeg",
    contentLength: null,
    streamFactory: async (rangeHeader?: string) => {
      const latest = getSongStreamRecord(songId);
      if (!latest?.upstreamUrl) {
        throw new Error("No upstream URL available");
      }

      const upstream = await request(latest.upstreamUrl, {
        method: "GET",
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
          accept: "audio/*,*/*;q=0.8",
          ...(rangeHeader ? { range: rangeHeader } : {})
        }
      });

      const contentType = normalizeContentType(upstream.headers["content-type"] as string | undefined);
      if (!isAcceptableStatus(upstream.statusCode) || !isAcceptableContentType(contentType)) {
        upstream.body.destroy();
        console.warn(`[stream] upstream rejected ${songId} status=${upstream.statusCode} type=${contentType}`);
        if (!didRefresh) {
          await refreshAndRetry(latest);
          return (await resolveUpstreamStream(songId, true)).streamFactory(rangeHeader);
        }
        throw new Error(`Invalid upstream stream response: ${upstream.statusCode} ${contentType}`);
      }

      markSongVerified(songId);
      clearPlaybackError(songId);

      const headers: Record<string, string> = {
        "content-type": contentType,
        "accept-ranges": "bytes"
      };
      const contentLength = upstream.headers["content-length"];
      if (contentLength) headers["content-length"] = String(contentLength);
      const contentRange = upstream.headers["content-range"];
      if (contentRange) headers["content-range"] = String(contentRange);

      const upstreamBody = upstream.body as NodeJS.ReadableStream;
      const clientStream = new PassThrough();
      upstreamBody.pipe(clientStream);

      if (!rangeHeader && upstream.statusCode === 200) {
        const cacheStream = new PassThrough();
        upstreamBody.pipe(cacheStream);
        void cacheDownloadFromStream(songId, cacheStream, contentType).catch(() => {});
      }

      return {
        statusCode: upstream.statusCode,
        headers,
        body: clientStream
      };
    }
  };
}

async function refreshAndRetry(song: ReturnType<typeof getSongStreamRecord>) {
  if (!song) throw new Error("Song not found");
  markPlaybackError(song.id);
  console.info(`[refresh] JIT start ${song.albumSourceUrl}`);
  await scraperService.refreshAlbum(song.albumSourceUrl);
  console.info(`[refresh] JIT success ${song.albumSourceUrl}`);
}

export function getPlaybackHealth() {
  return {
    cache: getCacheStatus()
  };
}

export function getSongPlaybackStatus(songId: string) {
  return getSongStatus(songId, getCacheValidity(songId));
}
