interface Window {
  createEl<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K];
  createDiv(): HTMLDivElement;
  createSpan(): HTMLSpanElement;
  createFragment(): DocumentFragment;
}
