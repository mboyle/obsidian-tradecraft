import { describe, expect, it } from "vitest";
import { ReferenceCache } from "../src/backlinks/ReferenceCache";

describe("ReferenceCache", () => {
  it("keys entries by source, target, mtime, and fingerprint", () => {
    const cache = new ReferenceCache();
    cache.set("A.md", "T.md", 1, "normal", []);
    expect(cache.get("A.md", "T.md", 1, "normal")).toEqual([]);
    expect(cache.get("A.md", "T.md", 2, "normal")).toBeUndefined();
    expect(cache.get("A.md", "T.md", 1, "expanded")).toBeUndefined();
    expect(cache.hits).toBe(1);
    expect(cache.misses).toBe(2);
  });

  it("invalidates by source and target", () => {
    const cache = new ReferenceCache();
    cache.set("A.md", "T.md", 1, "x", []);
    cache.set("B.md", "T.md", 1, "x", []);
    cache.invalidateSource("A.md");
    expect(cache.get("A.md", "T.md", 1, "x")).toBeUndefined();
    expect(cache.get("B.md", "T.md", 1, "x")).toEqual([]);
    cache.invalidateTarget("T.md");
    expect(cache.get("B.md", "T.md", 1, "x")).toBeUndefined();
  });
});
