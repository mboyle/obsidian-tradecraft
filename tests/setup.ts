if (typeof window !== "undefined") {
  const testWindow = window as Window;
  testWindow.createEl ??= (<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] =>
    document.createElement(tag));
  testWindow.createDiv ??= (() => document.createElement("div"));
  testWindow.createSpan ??= (() => document.createElement("span"));
  testWindow.createFragment ??= (() => document.createDocumentFragment());
  if (!("win" in Node.prototype)) {
    Object.defineProperty(Node.prototype, "win", {
      configurable: true,
      get(this: Node): Window {
        return this.ownerDocument?.defaultView ?? window;
      },
    });
  }
}
