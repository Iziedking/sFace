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

/**
 * The screen a node belongs to, for telling a repaint from a navigation.
 *
 * Every screen's outermost element carries `screen` plus its own name, so the
 * class list is the identity. Comparing it is not elegant and it is honest:
 * nothing else in the tree is stable across a rebuild, and the alternative is
 * threading a screen name through forty call sites.
 */
function screenKey(node: Node | undefined): string {
  return node instanceof HTMLElement ? node.className : '';
}

/**
 * Is this the same screen being painted again, or a different one arriving?
 *
 * Pure, and exported, because it is the whole rule and the DOM work around it
 * is not testable here: there is no browser in the test environment on purpose.
 * An empty previous key means nothing was mounted, which is an arrival however
 * it is dressed up.
 */
export function isRepaint(was: string, next: string): boolean {
  return was !== '' && was === next;
}

/**
 * What the person is typing, so a repaint does not take it off them.
 *
 * Only fields that ask to be kept, by carrying `data-keep`. Everything else is
 * left alone: a repaint that restored focus to something the player was not
 * using would be its own bug.
 */
interface Typing {
  key: string;
  value: string;
  start: number | null;
  end: number | null;
}

function capture(root: HTMLElement): Typing | null {
  if (typeof document === 'undefined') return null;

  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement)) return null;
  if (!root.contains(active)) return null;

  const key = active.getAttribute('data-keep');
  if (!key) return null;

  return {
    key,
    // The raw text, not the value the screen was rebuilt from. They differ
    // exactly while somebody is midway through typing a number, which is the
    // only moment any of this matters.
    value: active.value,
    start: active.selectionStart,
    end: active.selectionEnd,
  };
}

function restore(root: HTMLElement, typing: Typing): void {
  const next = root.querySelector(`[data-keep="${typing.key}"]`);
  if (!(next instanceof HTMLInputElement)) return;

  next.value = typing.value;
  next.focus();

  if (typing.start === null || typing.end === null) return;
  try {
    next.setSelectionRange(typing.start, typing.end);
  } catch {
    // Some input types refuse a selection range. Focus alone is most of it.
  }
}

/**
 * Put a screen on the page.
 *
 * ## Repainting is not navigating
 *
 * This used to replace the children and scroll to the top, every time, on the
 * reasoning that a new screen starts at its own heading. That is right when you
 * have gone somewhere and wrong when you have not: a screen that repaints
 * itself after every tap, which is most of the forms in the app, threw the page
 * back to the top and rebuilt every element under the thumb that pressed it.
 * Reported as everything flashing, and as the custom amount fields being
 * impossible to type into, because the input being typed into was destroyed
 * between one keystroke and the next.
 *
 * So a repaint of the same screen keeps its scroll position and hands back
 * whatever was being typed, and only a genuine change of screen goes to the
 * top. See the campaign ending for why that half still matters: the first thing
 * a player sees after clearing the game should not be the middle of it.
 */
export function mount(root: HTMLElement, ...nodes: Node[]): void {
  const was = screenKey(root.firstElementChild ?? undefined);
  const next = screenKey(nodes[0]);
  const repaint = isRepaint(was, next);

  const scrolled = root.scrollTop;
  const page = typeof window !== 'undefined' ? window.scrollY : 0;
  const typing = repaint ? capture(root) : null;

  root.replaceChildren(...nodes);

  if (repaint) {
    // Both, because a tall screen can scroll the page as well as the layer,
    // depending on the layout it ends up with.
    root.scrollTop = scrolled;
    if (typeof window !== 'undefined' && page > 0) window.scrollTo(0, page);
    if (typing) restore(root, typing);
    return;
  }

  root.scrollTop = 0;
  if (typeof window !== 'undefined') window.scrollTo(0, 0);
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
  options: { disabled?: boolean } = {},
): HTMLButtonElement {
  const node = el('button', {
    class: BUTTON_CLASS[variant],
    type: 'button',
    text: label,
    disabled: options.disabled === true,
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
