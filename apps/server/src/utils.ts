import crypto from "node:crypto";

export function nowIso() {
  return new Date().toISOString();
}

export function deterministicId(...parts: string[]) {
  return crypto.createHash("sha1").update(parts.join("::")).digest("hex");
}

export function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function parseDurationToSeconds(input: string | null | undefined) {
  if (!input) return null;
  const match = input.trim().match(/^(\d+):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function inferAudioExtension(contentType: string) {
  if (contentType.includes("mpeg")) return ".mp3";
  if (contentType.includes("ogg")) return ".ogg";
  if (contentType.includes("aac")) return ".aac";
  if (contentType.includes("wav")) return ".wav";
  return ".bin";
}
