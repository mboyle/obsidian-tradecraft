import moment from "moment";

export { moment };

export class Component {
  private readonly children = new Set<Component>();

  registerEvent(): void {}
  registerDomEvent(element: EventTarget, type: string, callback: EventListenerOrEventListenerObject, options?: AddEventListenerOptions): void {
    element.addEventListener(type, callback, options);
  }
  register(): void {}
  addChild<T extends Component>(child: T): T {
    this.children.add(child);
    child.load();
    return child;
  }
  removeChild<T extends Component>(child: T): T {
    this.children.delete(child);
    child.unload();
    return child;
  }
  load(): void { this.onload(); }
  unload(): void {
    for (const child of this.children) child.unload();
    this.children.clear();
    this.onunload();
  }
  onload(): void {}
  onunload(): void {}
}

export const Platform = {
  isDesktopApp: true,
  isMobileApp: false,
};

export class Keymap {
  static isModEvent(event: MouseEvent | KeyboardEvent): boolean {
    return event.metaKey || event.ctrlKey;
  }
}

export function setIcon(element: HTMLElement, icon: string): void {
  element.dataset.icon = icon;
}

export class ItemView extends Component {
  app: any;
  leaf: any;
  containerEl: HTMLElement;
  contentEl: HTMLElement;
  navigation = false;
  icon = "";

  constructor(leaf: any) {
    super();
    this.leaf = leaf;
    this.app = leaf.app;
    this.containerEl = leaf.containerEl ?? document.createElement("div");
    this.contentEl = leaf.contentEl ?? this.containerEl.appendChild(document.createElement("div"));
  }

  addAction(icon: string, title: string, callback: (event: MouseEvent) => void): HTMLElement {
    const button = this.containerEl.ownerDocument.createElement("button");
    button.dataset.icon = icon;
    button.title = title;
    button.addEventListener("click", callback);
    this.containerEl.prepend(button);
    return button;
  }

  getState(): Record<string, unknown> { return {}; }
  async setState(): Promise<void> {}
}

export class MarkdownRenderer {
  static async render(_app: unknown, markdown: string, element: HTMLElement): Promise<void> {
    const paragraph = element.ownerDocument.createElement("p");
    paragraph.textContent = markdown;
    element.appendChild(paragraph);
  }
}

export class Notice {
  static messages: string[] = [];

  constructor(message: string) {
    Notice.messages.push(message);
  }
}

export class TFile {
  path: string;
  basename: string;
  extension: string;

  constructor(path: string) {
    this.path = path;
    const name = path.slice(path.lastIndexOf("/") + 1);
    const dot = name.lastIndexOf(".");
    this.basename = dot < 0 ? name : name.slice(0, dot);
    this.extension = dot < 0 ? "" : name.slice(dot + 1);
  }
}

export class MarkdownView {
  contentEl: HTMLElement;

  constructor(public containerEl: HTMLElement, public file: TFile | null) {
    this.contentEl = containerEl;
  }

  getMode(): "preview" | "source" {
    return this.contentEl.querySelector(".markdown-reading-view") ? "preview" : "source";
  }
}

export function getLinkpath(link: string): string {
  return link.split("#", 1)[0] ?? link;
}
