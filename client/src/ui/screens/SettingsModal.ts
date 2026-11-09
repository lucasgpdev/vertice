import { ACTION_LABELS, keyLabel, settings } from '../../config/settings.js';
import type { Action, Quality } from '../../config/settings.js';
import { h } from '../dom.js';

type Tab = 'video' | 'controls' | 'audio' | 'hud';

/** Configurações: gráficos, controles (teclas remapeáveis), áudio e HUD. */
export const openSettings = (host: HTMLElement, antialiasAtStart: boolean): void => {
  let tab: Tab = 'video';
  const body = h('div', { class: 'panel-body' });
  const tabs = h('div', { class: 'tabs' });
  const back: HTMLDivElement = h('div', { class: 'modal-back', on: { click: (e) => e.target === back && close() } });
  const close = (): void => {
    back.remove();
    document.removeEventListener('keydown', esc, true);
  };
  const esc = (e: KeyboardEvent): void => {
    if (e.code === 'Escape' && !listening) {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', esc, true);
  let listening: Action | null = null;

  const row = (label: string, sub: string | null, ctrl: HTMLElement) =>
    h('div', { class: 'setting' }, h('div', { class: 'lbl' }, label, sub ? h('small', {}, sub) : ''), ctrl);
  const range = (min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt = (v: number) => v.toFixed(2)) => {
    const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step) });
    input.value = String(get());
    const out = h('output', {}, fmt(get()));
    input.addEventListener('input', () => {
      set(Number(input.value));
      out.textContent = fmt(Number(input.value));
    });
    return h('div', { class: 'range' }, input, out);
  };
  const toggle = (get: () => boolean, set: (v: boolean) => void) => {
    const t = h('button', { class: `toggle ${get() ? 'on' : ''}`, 'aria-pressed': String(get()) });
    t.addEventListener('click', () => {
      set(!get());
      t.classList.toggle('on', get());
    });
    return t;
  };
  const seg = <T extends string>(opts: [T, string][], get: () => T, set: (v: T) => void) => {
    const wrap = h('div', { class: 'seg' });
    const draw = () => {
      wrap.innerHTML = '';
      for (const [v, l] of opts) wrap.append(h('button', { class: get() === v ? 'active' : '', on: { click: () => (set(v), draw(), render()) } }, l));
    };
    draw();
    return wrap;
  };
  const soon = (label: string) => row(label, null, h('span', { class: 'soon', style: { justifySelf: 'end' } }, 'em breve'));

  const render = (): void => {
    const s = settings.value;
    tabs.innerHTML = '';
    for (const [id, label] of [['video', 'Gráficos'], ['controls', 'Controles'], ['audio', 'Áudio'], ['hud', 'Interface']] as [Tab, string][]) {
      tabs.append(h('button', { class: `tab ${tab === id ? 'active' : ''}`, on: { click: () => ((tab = id), render()) } }, label));
    }
    body.innerHTML = '';
    if (tab === 'video') {
      body.append(
        row('Qualidade', 'Média é a meta de 60 FPS em PC intermediário', seg<Quality>([['low', 'Baixa'], ['medium', 'Média'], ['high', 'Alta'], ['custom', 'Pers.']], () => s.quality, (q) => settings.setQuality(q))),
        row('Sombras', null, seg<'off' | 'low' | 'high'>([['off', 'Desl.'], ['low', 'Baixa'], ['high', 'Alta']], () => s.graphics.shadows, (v) => settings.update((x) => ((x.graphics.shadows = v), (x.quality = 'custom'))))),
        row('Escala de renderização', null, range(0.5, 1, 0.05, () => s.graphics.renderScale, (v) => settings.update((x) => ((x.graphics.renderScale = v), (x.quality = 'custom'))), (v) => `${Math.round(v * 100)}%`)),
        row('Antialiasing', antialiasAtStart !== s.graphics.antialias ? 'Aplicado ao recarregar a página' : null, toggle(() => s.graphics.antialias, (v) => settings.update((x) => ((x.graphics.antialias = v), (x.quality = 'custom'))))),
        row('Campo de visão (horizontal)', null, range(75, 110, 1, () => s.fov, (v) => settings.update((x) => (x.fov = v)), (v) => `${v}°`)),
        row('Painel de depuração', 'FPS, ping, draw calls e memória (F3)', toggle(() => s.showDebug, (v) => settings.update((x) => (x.showDebug = v)))),
      );
    } else if (tab === 'controls') {
      body.append(
        row('Sensibilidade do mouse', null, range(0.1, 4, 0.05, () => s.sensitivity, (v) => settings.update((x) => (x.sensitivity = v)))),
        row('Inverter eixo Y', null, toggle(() => s.invertY, (v) => settings.update((x) => (x.invertY = v)))),
      );
      for (const a of Object.keys(ACTION_LABELS) as Action[]) {
        const b = h('button', { class: `keybind ${listening === a ? 'listening' : ''}` }, listening === a ? 'Pressione…' : keyLabel(s.keys[a]));
        b.addEventListener('click', () => {
          listening = a;
          render();
          const onKey = (e: KeyboardEvent): void => {
            e.preventDefault();
            e.stopPropagation();
            document.removeEventListener('keydown', onKey, true);
            if (e.code !== 'Escape') settings.update((x) => (x.keys[a] = e.code));
            listening = null;
            render();
          };
          document.addEventListener('keydown', onKey, true);
        });
        body.append(row(ACTION_LABELS[a], null, b));
      }
      body.append(
        row('Atirar / Mirar', 'Botão esquerdo / direito do mouse', h('span', { class: 'hint', style: { justifySelf: 'end' } }, 'fixo')),
        soon('Trocar arma (1–4), Interagir (F), Equipamento (G), Loja (B), Chat (Enter/Y/U)'),
        h('div', { class: 'row', style: { marginTop: '12px' } }, h('span', { class: 'hint grow' }, 'Dica: C agacha sem o risco do Ctrl+W fechar a aba.'), h('button', { class: 'btn sm', on: { click: () => (settings.reset(), render()) } }, 'Restaurar padrões')),
      );
    } else if (tab === 'audio') {
      const pct = (v: number) => `${Math.round(v * 100)}%`;
      body.append(
        row('Volume geral', null, range(0, 1, 0.01, () => s.volume.master, (v) => settings.update((x) => (x.volume.master = v)), pct)),
        row('Efeitos', 'Disparos, recarga, impactos', range(0, 1, 0.01, () => s.volume.effects, (v) => settings.update((x) => (x.volume.effects = v)), pct)),
        row('Interface', 'Marcador de acerto, cliques', range(0, 1, 0.01, () => s.volume.ui, (v) => settings.update((x) => (x.volume.ui = v)), pct)),
        soon('Música'),
        soon('Voz'),
      );
    } else {
      const c = s.crosshair;
      const color = h('input', { type: 'color', value: c.color, style: { justifySelf: 'end', width: '60px', height: '32px', background: 'none', border: '0' } });
      color.addEventListener('input', () => settings.update((x) => (x.crosshair.color = color.value)));
      body.append(
        row('Exibir nomes dos jogadores', 'Nunca aparecem através de paredes', toggle(() => s.showNames, (v) => settings.update((x) => (x.showNames = v)))),
        row('Cor da mira', null, color),
        row('Tamanho da mira', null, range(2, 20, 1, () => c.size, (v) => settings.update((x) => (x.crosshair.size = v)), (v) => `${v}px`)),
        row('Espaço central', null, range(0, 14, 1, () => c.gap, (v) => settings.update((x) => (x.crosshair.gap = v)), (v) => `${v}px`)),
        row('Espessura', null, range(1, 5, 1, () => c.thickness, (v) => settings.update((x) => (x.crosshair.thickness = v)), (v) => `${v}px`)),
        row('Ponto central', null, toggle(() => c.dot, (v) => settings.update((x) => (x.crosshair.dot = v)))),
      );
    }
  };
  render();
  back.append(
    h(
      'div',
      { class: 'modal wide panel' },
      h('div', { class: 'panel-head' }, h('h3', {}, 'Configurações'), h('button', { class: 'btn sm ghost', on: { click: close } }, 'Fechar')),
      tabs,
      body,
    ),
  );
  host.append(back);
};
