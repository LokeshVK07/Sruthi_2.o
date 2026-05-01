import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { request } from "undici";
import { appConfig } from "../config.js";
import { getSongById } from "../repositories/library-repo.js";

export async function resolveArtwork(songId: string) {
  const song = getSongById(songId);
  if (!song?.artworkUrl) return null;
  const extension = path.extname(new URL(song.artworkUrl).pathname) || ".jpg";
  const filePath = path.join(appConfig.artworkCacheDir, `${crypto.createHash("md5").update(song.artworkUrl).digest("hex")}${extension}`);
  if (fs.existsSync(filePath)) return filePath;
  const res = await request(song.artworkUrl, { method: "GET", headers: { "user-agent": "Mozilla/5.0 Melodify/1.0" } });
  if (res.statusCode >= 400) return null;
  const buffer = Buffer.from(await res.body.arrayBuffer());
  await fs.promises.writeFile(filePath, buffer);
  return filePath;
}
