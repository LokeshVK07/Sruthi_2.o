import { initDb } from "../db.js";
import { scraperService } from "../services/scraper-service.js";

initDb();

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.split("=");
    return [key, value ?? "true"];
  })
);

const page = args.get("--page");
const limit = args.get("--limit");

const result = await scraperService.scrape({
  page: page ? Number(page) : undefined,
  limit: limit ? Number(limit) : undefined,
  incremental: args.has("--incremental"),
  fullScan: args.has("--full-scan")
});

console.log(
  `Scrape complete: albums=${result.albumsParsed} songs=${result.songsUpserted} discovered=${result.discoveredAlbumUrls.length} stoppedEarly=${result.stoppedEarly}`
);
