import { describe, expect, it } from "vitest";
import { BacklinkIndex } from "../src/backlinks/BacklinkIndex";

describe("BacklinkIndex", () => {
  it("builds reverse and forward relationships", () => {
    const metadata = {
      resolvedLinks: {
        "A.md": { "Target.md": 2, "Other.md": 1 },
        "B.md": { "Target.md": 1 },
      },
    };
    const index = new BacklinkIndex(metadata);
    index.build();
    expect(index.getSourcesForTarget("Target.md").sort()).toEqual(["A.md", "B.md"]);
    expect(index.getTargetsForSource("A.md").sort()).toEqual(["Other.md", "Target.md"]);
    expect(index.edgeCount).toBe(3);
  });

  it("incrementally updates a source without rebuilding", () => {
    const metadata: { resolvedLinks: Record<string, Record<string, number>> } = {
      resolvedLinks: { "A.md": { "Target.md": 1 } },
    };
    const index = new BacklinkIndex(metadata);
    index.build();
    metadata.resolvedLinks["A.md"] = { "New.md": 1 };
    expect([...index.updateSource("A.md")].sort()).toEqual(["New.md", "Target.md"]);
    expect(index.getSourcesForTarget("Target.md")).toEqual([]);
    expect(index.getSourcesForTarget("New.md")).toEqual(["A.md"]);
  });

  it("handles source and target renames and deletion", () => {
    const metadata = { resolvedLinks: { "Folder/A.md": { "Target.md": 1 } } };
    const index = new BacklinkIndex(metadata);
    index.build();
    index.renameFile("Folder/A.md", "Archive/A.md");
    index.renameFile("Target.md", "People/Target.md");
    expect(index.getSourcesForTarget("People/Target.md")).toEqual(["Archive/A.md"]);
    expect(index.removeSource("Archive/A.md")).toEqual(new Set(["People/Target.md"]));
    expect(index.edgeCount).toBe(0);
  });

  it("removes a deleted target from every source", () => {
    const metadata = { resolvedLinks: { "A.md": { "Target.md": 1 }, "B.md": { "Target.md": 1 } } };
    const index = new BacklinkIndex(metadata);
    index.build();
    expect(index.removeTarget("Target.md")).toEqual(new Set(["A.md", "B.md"]));
    expect(index.getTargetsForSource("A.md")).toEqual([]);
    expect(index.edgeCount).toBe(0);
  });
});
