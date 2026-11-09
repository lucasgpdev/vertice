/** Utilitário mínimo para criar elementos DOM tipados (sem framework). */
type Attrs = Record<string, unknown> & {
  class?: string;
  style?: string | Partial<CSSStyleDeclaration>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (e: HTMLElementEventMap[K]) => void }>;
};
type Child = Node | string | number | null | undefined | false;

export const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'style') {
      if (typeof v === 'string') el.setAttribute('style', v);
      else Object.assign(el.style, v);
    } else if (k === 'on') {
      for (const [ev, fn] of Object.entries(v as Record<string, EventListener>)) el.addEventListener(ev, fn);
    } else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
};

export const svg = (markup: string): SVGElement => {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild as SVGElement;
};

/** Cor estável derivada do texto (avatar por iniciais). */
export const colorFor = (s: string): string => {
  let hsh = 0;
  for (const c of s) hsh = (hsh * 31 + c.charCodeAt(0)) >>> 0;
  const hues = [38, 196, 152, 268, 12, 330, 88, 220];
  return `hsl(${hues[hsh % hues.length]} 85% 62%)`;
};

export const avatar = (nick: string): HTMLElement =>
  h('div', { class: 'avatar', style: { background: colorFor(nick) } }, nick.slice(0, 2).toUpperCase());

export const pingClass = (p: number): string => (p <= 0 ? '' : p < 80 ? 'good' : p < 150 ? 'mid' : 'bad');

let toastHost: HTMLElement | null = null;
export const toast = (msg: string, kind: 'info' | 'err' = 'info', ms = 3200): void => {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts' });
    document.getElementById('ui')!.append(toastHost);
  }
  if (!toastHost.isConnected) document.getElementById('ui')!.append(toastHost);
  const t = h('div', { class: `toast ${kind === 'err' ? 'err' : ''}` }, msg);
  toastHost.append(t);
  setTimeout(() => t.remove(), ms);
};

export const BRAND_MARK = `<svg class="brand-mark" viewBox="0 0 48 48" aria-hidden="true">
  <path d="M6 9h10l8 20 8-20h10L28 41h-8z" fill="#ffb020"/>
  <path d="M24 29l-3-7.5h6z" fill="#07090c"/>
  <path d="M2 9h3M43 9h3" stroke="#4fd8ff" stroke-width="2"/>
</svg>`;
