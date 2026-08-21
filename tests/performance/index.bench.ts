import { bench, describe } from "vitest";
import { BacklinkIndex } from "../../src/backlinks/BacklinkIndex";

for (const size of [1_000, 10_000, 50_000]) {
  describe(`${size.toLocaleString()} notes`, () => {
    const resolvedLinks = makeLinks(size);
    bench("initial reverse index", () => {
      const index = new BacklinkIndex({ resolvedLinks });
      index.build();
      if (index.getSourcesForTarget("Target.md").length === 0) throw new Error("benchmark fixture is invalid");
    });
  });
}

describe("pathological target", () => {
  const resolvedLinks = Object.fromEntries(
    Array.from({ length: 1_000 }, (_, index) => [`Source-${index}.md`, { "Target.md": 1 }]),
  );
  const index = new BacklinkIndex({ resolvedLinks });
  index.build();
  bench("retrieve 1,000 source paths", () => {
    const sources = index.getSourcesForTarget("Target.md");
    if (sources.length !== 1_000) throw new Error("unexpected source count");
  });
});

function makeLinks(size: number): Record<string, Record<string, number>> {
  return Object.fromEntries(Array.from({ length: size }, (_, index) => [
    `Notes/Note-${index}.md`,
    index % 20 === 0 ? { "Target.md": 1, [`Topic-${index % 100}.md`]: 1 } : { [`Topic-${index % 100}.md`]: 1 },
  ]));
}
