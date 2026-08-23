// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import type { ReferenceSnapshot } from "../src/types";
import { DEFAULT_SETTINGS } from "../src/settings/Settings";
import { BacklinksRenderer, type RendererHost } from "../src/render/BacklinksRenderer";

describe("BacklinksRenderer", () => {
  it("retargets reused mobile DOM and ignores the previous note's late result", async () => {
    const previous = makeTFile("Notes/Previous.md");
    const current = makeTFile("Notes/Current.md");
    const pending = new Map<string, (snapshot: ReferenceSnapshot) => void>();
    const getSnapshot = vi.fn((file: TFile) => new Promise<ReferenceSnapshot>((resolve) => {
      pending.set(file.path, resolve);
    }));
    const rootEl = document.body.appendChild(document.createElement("div"));
    const settings = structuredClone(DEFAULT_SETTINGS);
    const host = {
      app: {},
      service: {
        getSnapshot,
        subscribe: vi.fn(() => vi.fn()),
        notifyTarget: vi.fn(),
      },
      navigator: {},
      getSettings: () => settings,
      persistSettings: vi.fn(async () => undefined),
      registerRenderer: vi.fn(),
      unregisterRenderer: vi.fn(),
    } as unknown as RendererHost;
    const renderer = new BacklinksRenderer(rootEl, previous, host);

    renderer.load();
    renderer.retarget(current);

    expect(rootEl.dataset.dossierTarget).toBe(current.path);
    expect(rootEl.classList.contains("is-empty")).toBe(true);
    pending.get(current.path)?.(snapshot(current, 2));
    await Promise.resolve();
    await Promise.resolve();
    expect(rootEl.querySelector(".dossier-backlinks-count")?.textContent).toBe("(2)");

    pending.get(previous.path)?.(snapshot(previous, 9));
    await Promise.resolve();
    await Promise.resolve();
    expect(rootEl.dataset.dossierTarget).toBe(current.path);
    expect(rootEl.querySelector(".dossier-backlinks-count")?.textContent).toBe("(2)");

    renderer.unload();
    rootEl.remove();
  });
});

function snapshot(targetFile: TFile, totalOccurrences: number): ReferenceSnapshot {
  return { targetFile, groups: [], totalOccurrences };
}

function makeTFile(path: string): TFile {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return Object.assign(Object.create(TFile.prototype) as TFile, {
    path,
    name,
    basename: dot < 0 ? name : name.slice(0, dot),
    extension: dot < 0 ? "" : name.slice(dot + 1),
  });
}
