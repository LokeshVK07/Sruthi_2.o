import { beforeAll, describe, expect, it } from "vitest";
import { initDb } from "./db.js";
import { ensureDefaultUser, listLibrary } from "./repositories/library-repo.js";

describe("library repo", () => {
  beforeAll(() => {
    initDb();
    ensureDefaultUser();
  });

  it("returns a library array", () => {
    const items = listLibrary("local-user", 10);
    expect(Array.isArray(items)).toBe(true);
  });
});
