import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CachedMetadata } from "obsidian";

vi.mock("obsidian", () => ({
  getLinkpath: (link: string) => link.split("#", 1)[0] ?? link,
}));

describe("ReferenceResolver", () => {
  beforeEach(() => vi.resetModules());

  it("resolves aliases, subpaths, Markdown links, and duplicate basenames through metadata", async () => {
    const { ReferenceResolver } = await import("../src/backlinks/ReferenceResolver");
    const destinations: Record<string, string> = {
      "Target": "Folder/Target.md",
      "../Target.md": "Other/Target.md",
    };
    const resolver = new ReferenceResolver({
      getFirstLinkpathDest: (linkpath: string) => ({ path: destinations[linkpath] }) as never,
    });
    const cache = {
      links: [
        link("Target#Section", "[[Target#Section|visible]]", 0),
        link("../Target.md", "[other](../Target.md)", 30),
      ],
    } as CachedMetadata;
    const matches = resolver.resolve("Folder/Source.md", "Folder/Target.md", cache, false);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ original: "[[Target#Section|visible]]", startOffset: 0 });
  });

  it("includes embeds only when enabled", async () => {
    const { ReferenceResolver } = await import("../src/backlinks/ReferenceResolver");
    const resolver = new ReferenceResolver({
      getFirstLinkpathDest: () => ({ path: "Target.md" }) as never,
    });
    const cache = { links: [link("Target", "[[Target]]", 0)], embeds: [link("Target", "![[Target]]", 20)] } as CachedMetadata;
    expect(resolver.resolve("Source.md", "Target.md", cache, false)).toHaveLength(1);
    expect(resolver.resolve("Source.md", "Target.md", cache, true)).toHaveLength(2);
  });
});

function link(linkText: string, original: string, offset: number) {
  return {
    link: linkText,
    original,
    position: {
      start: { line: 0, col: offset, offset },
      end: { line: 0, col: offset + original.length, offset: offset + original.length },
    },
  };
}
