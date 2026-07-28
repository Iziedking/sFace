/**
 * Six lines of DOM helper, so the screens read as structure rather than as a
 * wall of createElement calls.
 *
 * Text is always set through textContent, never innerHTML. Some of what these
 * screens render comes off the network: a ticker name from the market API, a
 * challenger's address from a deeplink. None of it is trusted, and textContent
 * means none of it can be markup.
 */

type Attrs = Record<string, string | number | boolean | undefined>;
type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else node.setAttribute(key, String(value));
  }

  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }

  return node;
}

export function clear(root: HTMLElement): void {
  root.replaceChildren();
}

export function mount(root: HTMLElement, ...nodes: Node[]): void {
  root.replaceChildren(...nodes);
}

export type ButtonVariant = 'primary' | 'ghost' | 'quiet' | 'x';

const BUTTON_CLASS: Record<ButtonVariant, string> = {
  primary: 'button',
  ghost: 'button button--ghost',
  quiet: 'button button--quiet',
  // Ink on cream, so connecting an account reads as X's own colour without
  // borrowing their mark.
  x: 'button button--x',
};

export function button(
  label: string,
  onClick: () => void,
  variant: ButtonVariant = 'primary',
): HTMLButtonElement {
  const node = el('button', {
    class: BUTTON_CLASS[variant],
    type: 'button',
    text: label,
  });
  node.addEventListener('click', onClick);
  return node;
}

export function stat(label: string, value: string): HTMLElement {
  return el(
    'div',
    { class: 'stat' },
    el('span', { class: 'stat__label', text: label }),
    el('span', { class: 'stat__value', text: value }),
  );
}

export function row(label: string, value: string): HTMLElement {
  return el(
    'div',
    { class: 'breakdown__row' },
    el('span', { text: label }),
    el('span', { text: value }),
  );
}
