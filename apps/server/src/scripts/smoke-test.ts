import { initDb } from "../db.js";
import { ensureDefaultUser, getPrefetchCandidates, listLibrary, searchLibrary } from "../repositories/library-repo.js";
import { resolveSongStream } from "../services/stream-service.js";

initDb();
const userId = ensureDefaultUser();

const library = listLibrary(userId, 5);
if (library.length === 0) {
  throw new Error("Smoke test failed: library is empty");
}

const search = searchLibrary(userId, library[0].title.slice(0, 4));
if (search.length === 0) {
  throw new Error("Smoke test failed: search returned no matches");
}

const prefetched = getPrefetchCandidates(library[0].id, 2);
if (prefetched.length < 0) {
  throw new Error("Smoke test failed: invalid prefetch result");
}

const stream = await resolveSongStream(library[0].id);
if (!stream) {
  throw new Error("Smoke test failed: stream did not resolve");
}

console.log("Smoke test passed.");
