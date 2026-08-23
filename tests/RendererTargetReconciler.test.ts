// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { MarkdownView, TFile, type Workspace } from "obsidian";
import type { BacklinksRenderer } from "../src/render/BacklinksRenderer";
import { reconcileRendererTargets } from "../src/render/RendererTargetReconciler";

describe("renderer target reconciliation", () => {
  it("retargets a renderer when mobile reuses its Markdown DOM for another note", () => {
    const contentEl = document.createElement("div");
    const rootEl = contentEl.appendChild(document.createElement("div"));
    const previous = makeTFile("Notes/Previous.md");
    const current = makeTFile("Notes/Current.md");
    const view = makeMarkdownView(contentEl, current);
    const retarget = vi.fn();
    const renderer = { rootEl, targetFile: previous, retarget } as unknown as BacklinksRenderer;
    const workspace = {
      iterateAllLeaves: (callback: (leaf: { view: MarkdownView }) => void) => callback({ view }),
    } as unknown as Pick<Workspace, "iterateAllLeaves">;

    reconcileRendererTargets([renderer], workspace);

    expect(retarget).toHaveBeenCalledOnce();
    expect(retarget).toHaveBeenCalledWith(current);
  });

  it("does not retarget renderers outside a Markdown view", () => {
    const contentEl = document.createElement("div");
    const current = makeTFile("Notes/Current.md");
    const view = makeMarkdownView(contentEl, current);
    const retarget = vi.fn();
    const renderer = {
      rootEl: document.createElement("div"),
      targetFile: makeTFile("Notes/Previous.md"),
      retarget,
    } as unknown as BacklinksRenderer;
    const workspace = {
      iterateAllLeaves: (callback: (leaf: { view: MarkdownView }) => void) => callback({ view }),
    } as unknown as Pick<Workspace, "iterateAllLeaves">;

    reconcileRendererTargets([renderer], workspace);

    expect(retarget).not.toHaveBeenCalled();
  });

  it("removes a stale duplicate after the current note has already rendered", () => {
    const contentEl = document.createElement("div");
    const sourceView = contentEl.appendChild(document.createElement("div"));
    sourceView.className = "markdown-source-view";
    const staleRoot = sourceView.appendChild(document.createElement("div"));
    const currentRoot = sourceView.appendChild(document.createElement("div"));
    const current = makeTFile("Notes/Current.md");
    const view = makeMarkdownView(contentEl, current);
    const stale = {
      rootEl: staleRoot,
      targetFile: makeTFile("Notes/Previous.md"),
      retarget: vi.fn(),
      unload: vi.fn(),
    } as unknown as BacklinksRenderer;
    const currentRenderer = {
      rootEl: currentRoot,
      targetFile: current,
      retarget: vi.fn(),
      unload: vi.fn(),
    } as unknown as BacklinksRenderer;
    const workspace = {
      iterateAllLeaves: (callback: (leaf: { view: MarkdownView }) => void) => callback({ view }),
    } as unknown as Pick<Workspace, "iterateAllLeaves">;

    reconcileRendererTargets([stale, currentRenderer], workspace);

    expect(stale.unload).toHaveBeenCalledOnce();
    expect(staleRoot.isConnected).toBe(false);
    expect(currentRenderer.retarget).toHaveBeenCalledWith(current);
    expect(currentRoot.parentElement).toBe(sourceView);
  });
});

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

function makeMarkdownView(contentEl: HTMLElement, file: TFile): MarkdownView {
  return Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, {
    contentEl,
    containerEl: contentEl,
    file,
  });
}
