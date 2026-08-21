import {
  Component,
  getLinkpath,
  HoverPopover,
  MarkdownRenderer,
  type App,
  type HoverParent,
  type TFile,
} from "obsidian";
import type { BacklinkService } from "../backlinks/BacklinkService";
import type { ContextPassage, DossierSettings, ReferenceSnapshot, SourceBacklinkGroup } from "../types";
import type { ReferenceNavigator } from "./ReferenceNavigator";

export interface RendererHost {
  app: App;
  service: BacklinkService;
  navigator: ReferenceNavigator;
  getSettings(): DossierSettings;
  persistSettings(): Promise<void>;
  registerRenderer(renderer: BacklinksRenderer): void;
  unregisterRenderer(renderer: BacklinksRenderer): void;
}

export class BacklinksRenderer extends Component implements HoverParent {
  hoverPopover: HoverPopover | null = null;
  private unsubscribe?: () => void;
  private subscribedPath?: string;
  private generation = 0;
  private showAll = false;
  private forceExpanded = false;
  private readonly expandedPassages = new Set<string>();
  private renderCycle?: Component;

  constructor(
    readonly rootEl: HTMLElement,
    readonly targetFile: TFile,
    private readonly host: RendererHost,
    private readonly onLayoutChange?: () => void,
  ) {
    super();
    rootEl.classList.add("dossier-backlinks", "is-empty");
    rootEl.dataset.dossierTarget = targetFile.path;
  }

  onload(): void {
    this.host.registerRenderer(this);
    this.ensureSubscription();
    void this.refresh();
  }

  onunload(): void {
    this.generation += 1;
    this.unsubscribe?.();
    this.host.unregisterRenderer(this);
    this.rootEl.replaceChildren();
    this.rootEl.classList.add("is-empty");
    this.onLayoutChange?.();
  }

  async refresh(): Promise<void> {
    this.ensureSubscription();
    const generation = ++this.generation;
    const started = performance.now();
    try {
      const collapsed = this.host.getSettings().collapsedTargets.includes(this.targetFile.path);
      const snapshot = await this.host.service.getSnapshot(this.targetFile, this.showAll, !collapsed);
      if (generation !== this.generation) return;
      await this.draw(snapshot, generation);
      if (this.host.getSettings().debug) {
        console.debug(`[Dossier] Rendered ${this.targetFile.path} in ${(performance.now() - started).toFixed(1)}ms`);
      }
    } catch (error) {
      if (generation === this.generation) {
        this.rootEl.replaceChildren();
        this.rootEl.classList.add("is-empty");
        this.onLayoutChange?.();
        console.error(`[Dossier] Failed to render references for ${this.targetFile.path}`, error);
      }
    }
  }

  private ensureSubscription(): void {
    if (this.subscribedPath === this.targetFile.path) return;
    this.unsubscribe?.();
    this.subscribedPath = this.targetFile.path;
    this.rootEl.dataset.dossierTarget = this.targetFile.path;
    this.unsubscribe = this.host.service.subscribe(this.targetFile.path, () => this.refresh());
  }

  expandAll(): void {
    this.showAll = true;
    this.forceExpanded = true;
    const settings = this.host.getSettings();
    settings.collapsedTargets = settings.collapsedTargets.filter((path) => path !== this.targetFile.path);
    void this.host.persistSettings().then(() => this.host.service.notifyTarget(this.targetFile.path));
  }

  collapse(): void {
    const settings = this.host.getSettings();
    if (!settings.collapsedTargets.includes(this.targetFile.path)) settings.collapsedTargets.push(this.targetFile.path);
    void this.host.persistSettings().then(() => this.host.service.notifyTarget(this.targetFile.path));
  }

  private async draw(snapshot: ReferenceSnapshot, generation: number): Promise<void> {
    if (this.renderCycle) this.removeChild(this.renderCycle);
    const renderCycle = this.addChild(new Component());
    this.renderCycle = renderCycle;
    const settings = this.host.getSettings();
    const collapsed = settings.collapsedTargets.includes(this.targetFile.path);
    if (snapshot.totalOccurrences === 0 && !settings.showEmpty) {
      this.rootEl.replaceChildren();
      this.rootEl.classList.add("is-empty");
      this.onLayoutChange?.();
      return;
    }

    const fragment = document.createDocumentFragment();
    if (settings.showHeading) fragment.append(this.createHeader(snapshot.totalOccurrences, collapsed));
    if (!collapsed) {
      const body = document.createElement("div");
      body.className = "dossier-backlinks-body";
      if (settings.groupBySource) {
        for (const group of snapshot.groups) {
          body.append(await this.createGroup(group, generation, renderCycle));
          if (generation !== this.generation) return;
        }
      } else {
        for (const group of snapshot.groups) {
          for (const passage of group.passages) {
            body.append(await this.createGroup({ ...group, passages: [passage] }, generation, renderCycle));
            if (generation !== this.generation) return;
          }
        }
      }
      const visibleOccurrences = snapshot.groups.reduce((sum, group) => sum + group.occurrences.length, 0);
      const remaining = Math.max(0, snapshot.totalOccurrences - visibleOccurrences);
      if (remaining > 0) body.append(this.createShowMoreButton(remaining));
      fragment.append(body);
    }
    if (generation === this.generation) {
      this.rootEl.classList.remove("is-empty");
      this.rootEl.replaceChildren(fragment);
      this.onLayoutChange?.();
    }
  }

  private createHeader(count: number, collapsed: boolean): HTMLElement {
    const settings = this.host.getSettings();
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dossier-backlinks-header";
    button.setAttribute("aria-expanded", String(!collapsed));
    const heading = document.createElement("span");
    heading.className = "dossier-backlinks-heading";
    heading.textContent = settings.heading;
    button.append(heading);
    if (settings.showCount) {
      const countEl = document.createElement("span");
      countEl.className = "dossier-backlinks-count";
      countEl.textContent = `(${count})`;
      button.append(countEl);
    }
    button.addEventListener("click", () => {
      const collapsedTargets = settings.collapsedTargets;
      settings.collapsedTargets = collapsed
        ? collapsedTargets.filter((path) => path !== this.targetFile.path)
        : [...new Set([...collapsedTargets, this.targetFile.path])];
      void this.host.persistSettings().then(() => this.host.service.notifyTarget(this.targetFile.path));
    });
    return button;
  }

  private async createGroup(
    group: SourceBacklinkGroup,
    generation: number,
    renderCycle: Component,
  ): Promise<HTMLElement> {
    const groupEl = document.createElement("section");
    groupEl.className = "dossier-backlink-group";
    const sourceButton = document.createElement("button");
    sourceButton.type = "button";
    sourceButton.className = "dossier-backlink-source";
    sourceButton.dataset.href = group.sourceFile.path;
    sourceButton.append(document.createTextNode(group.sourceLabel));
    const firstOccurrence = group.occurrences[0];
    if (firstOccurrence) {
      sourceButton.addEventListener("click", (event) => {
        void this.host.navigator.open(group.sourceFile, firstOccurrence, event);
      });
      sourceButton.addEventListener("mouseover", (event) => {
        this.host.app.workspace.trigger("hover-link", {
          event,
          source: "dossier",
          hoverParent: this,
          targetEl: sourceButton,
          linktext: group.sourceFile.path,
          sourcePath: this.targetFile.path,
        });
      });
    }
    groupEl.append(sourceButton);

    for (const passage of group.passages) {
      if (this.host.getSettings().showSourceHeading && passage.heading) {
        const heading = document.createElement("div");
        heading.className = "dossier-backlink-context-heading";
        heading.textContent = passage.heading;
        groupEl.append(heading);
      }
      groupEl.append(await this.createPassage(group.sourceFile, passage, generation, renderCycle));
    }
    return groupEl;
  }

  private async createPassage(
    sourceFile: TFile,
    passage: ContextPassage,
    generation: number,
    renderCycle: Component,
  ): Promise<HTMLElement> {
    const wrapper = document.createElement("div");
    wrapper.className = "dossier-backlink-passage";
    wrapper.tabIndex = this.host.getSettings().openSourceOnExcerptClick ? 0 : -1;
    const markdownEl = document.createElement("div");
    markdownEl.className = "dossier-backlink-context markdown-rendered";
    wrapper.append(markdownEl);
    const expanded = this.forceExpanded || this.expandedPassages.has(passage.key);
    await MarkdownRenderer.render(
      this.host.app,
      expanded ? passage.fullMarkdown : passage.markdown,
      markdownEl,
      sourceFile.path,
      renderCycle,
    );
    if (generation !== this.generation) return wrapper;

    const targetAnchors = this.highlightTargetLinks(markdownEl, passage);
    wrapper.addEventListener("click", (event) => {
      if (!this.host.getSettings().openSourceOnExcerptClick) return;
      const target = event.target;
      const anchor = target instanceof Element ? target.closest("a") : null;
      if (anchor && !anchor.classList.contains("dossier-backlink-current-link")) return;
      event.preventDefault();
      event.stopPropagation();
      const anchorIndex = anchor ? targetAnchors.indexOf(anchor as HTMLAnchorElement) : -1;
      const occurrence = anchorIndex >= 0 ? passage.occurrences[anchorIndex] : passage.primaryOccurrence;
      void this.host.navigator.open(sourceFile, occurrence ?? passage.primaryOccurrence, event);
    });
    wrapper.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && event.target === wrapper) {
        event.preventDefault();
        void this.host.navigator.open(sourceFile, passage.primaryOccurrence, event);
      }
    });

    if (passage.truncated && !expanded) {
      const expand = document.createElement("button");
      expand.type = "button";
      expand.className = "dossier-backlink-expand";
      expand.textContent = "Show more";
      expand.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.expandedPassages.add(passage.key);
        void this.refresh();
      });
      wrapper.append(expand);
    }
    return wrapper;
  }

  private highlightTargetLinks(container: HTMLElement, passage: ContextPassage): HTMLAnchorElement[] {
    const anchors = Array.from(container.querySelectorAll<HTMLAnchorElement>("a.internal-link"));
    const targetAnchors = anchors.filter((anchor) => {
      const href = anchor.dataset.href ?? anchor.getAttribute("href") ?? "";
      const destination = this.host.app.metadataCache.getFirstLinkpathDest(getLinkpath(href), passage.sourcePath);
      if (destination?.path !== passage.targetPath) return false;
      anchor.classList.add("dossier-backlink-current-link");
      return true;
    });
    return targetAnchors;
  }

  private createShowMoreButton(remaining: number): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dossier-backlinks-more";
    button.textContent = `Show ${remaining} more`;
    button.addEventListener("click", () => {
      this.showAll = true;
      void this.refresh();
    });
    return button;
  }
}
