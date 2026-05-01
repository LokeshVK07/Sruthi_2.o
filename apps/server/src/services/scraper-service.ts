import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appConfig } from "../config.js";
import type { ScrapedAlbum } from "../types.js";
import { createScrapeRun, finishScrapeRun, getKnownAlbumUrls, upsertAlbumGraph } from "../repositories/library-repo.js";

const execFileAsync = promisify(execFile);

type ScrapeOptions = {
  page?: number;
  limit?: number;
  incremental?: boolean;
  fullScan?: boolean;
};

type ScrapeResult = {
  discoveredAlbumUrls: string[];
  albumsParsed: number;
  songsUpserted: number;
  stoppedEarly: boolean;
  scrapeRunId: string;
};

export class ScraperService {
  private refreshLocks = new Map<string, Promise<void>>();
  private pythonScriptPath = this.resolvePythonScriptPath();

  async scrape(options: ScrapeOptions = {}): Promise<ScrapeResult> {
    const startPage = options.page ?? 1;
    const limit = options.limit ?? appConfig.MASSTAMILAN_MAX_PAGES;
    const incremental = options.incremental ?? true;
    const fullScan = options.fullScan ?? false;
    const scrapeRunId = createScrapeRun({
      mode: fullScan ? "full-scan" : incremental ? "incremental" : "manual",
      pageFrom: startPage,
      pageTo: startPage + limit - 1
    });

    let albumsParsed = 0;
    let songsUpserted = 0;
    let stoppedEarly = false;
    const discoveredAlbumUrls: string[] = [];

    try {
      for (let pageNumber = startPage; pageNumber < startPage + limit; pageNumber += 1) {
        const listingUrl = `${appConfig.MASSTAMILAN_BASE_URL}${appConfig.MASSTAMILAN_LIST_PATH}?page=${pageNumber}`;
        let albumUrls: string[] = [];
        try {
          albumUrls = await this.discoverListing(listingUrl);
        } catch (error) {
          console.error(`[scrape] listing page failed ${listingUrl}: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }

        const known = getKnownAlbumUrls(albumUrls);
        console.info(`[scrape] listing ${pageNumber}: discovered=${albumUrls.length} known=${known.size}`);

        if (incremental && !fullScan && albumUrls.length > 0 && known.size === albumUrls.length) {
          console.info(`[scrape] stopping early at listing ${pageNumber} because the full page is already known`);
          stoppedEarly = true;
          break;
        }

        for (const albumUrl of albumUrls) {
          discoveredAlbumUrls.push(albumUrl);
          if (incremental && !fullScan && known.has(albumUrl)) continue;
          try {
            const album = await this.parseAlbum(albumUrl);
            const result = upsertAlbumGraph(album);
            albumsParsed += 1;
            songsUpserted += result.songsUpserted;
            console.info(`[scrape] album parsed: ${album.title} (${result.songsUpserted} songs)`);
          } catch (error) {
            console.error(`[scrape] album failed ${albumUrl}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      finishScrapeRun(scrapeRunId, {
        status: "success",
        albumsFound: albumsParsed,
        songsFound: songsUpserted
      });
      return { discoveredAlbumUrls, albumsParsed, songsUpserted, stoppedEarly, scrapeRunId };
    } catch (error) {
      finishScrapeRun(scrapeRunId, {
        status: "failed",
        albumsFound: albumsParsed,
        songsFound: songsUpserted,
        errorMessage: error instanceof Error ? error.message : "Unknown scrape error"
      });
      throw error;
    }
  }

  async refreshAlbum(albumSourceUrl: string) {
    if (this.refreshLocks.has(albumSourceUrl)) {
      return this.refreshLocks.get(albumSourceUrl)!;
    }
    const task = this.refreshAlbumInternal(albumSourceUrl).finally(() => this.refreshLocks.delete(albumSourceUrl));
    this.refreshLocks.set(albumSourceUrl, task);
    return task;
  }

  async discoverListing(listingUrl: string) {
    const payload = await this.runPython<{ urls: string[] }>(["discover-listing", "--url", listingUrl]);
    return payload.urls;
  }

  async parseAlbum(albumUrl: string) {
    return this.runPython<ScrapedAlbum>(["parse-album", "--url", albumUrl]);
  }

  private async refreshAlbumInternal(albumSourceUrl: string) {
    console.info(`[refresh] start ${albumSourceUrl}`);
    const album = await this.parseAlbum(albumSourceUrl);
    upsertAlbumGraph(album);
    console.info(`[refresh] success ${albumSourceUrl}`);
  }

  private async runPython<T>(args: string[]) {
    const { stdout, stderr } = await execFileAsync(appConfig.PYTHON_BIN, [this.pythonScriptPath, ...args], {
      cwd: appConfig.rootDir,
      maxBuffer: 10 * 1024 * 1024
    });
    if (stderr?.trim()) {
      console.warn(stderr.trim());
    }
    return JSON.parse(stdout) as T;
  }

  private resolvePythonScriptPath() {
    const candidates = [
      path.resolve(appConfig.rootDir, "apps/server/src/python/http_scraper.py"),
      path.resolve(appConfig.rootDir, "src/python/http_scraper.py")
    ];
    const match = candidates.find((candidate) => fs.existsSync(candidate));
    if (!match) {
      throw new Error("Python scraper script not found");
    }
    return match;
  }
}

export const scraperService = new ScraperService();
