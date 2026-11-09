import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@vertice/shared';
import { BRAND_MARK, avatar, h, svg } from '../dom.js';

interface MenuOpts {
  nickname: string;
  connected: boolean;
  onCreate: () => Promise<string | null>;
  onJoin: (code: string) => Promise<string | null>;
  onSettings: () => void;
  onLogout: () => void;
}

/** Ilustração vetorial original do menu (silhueta da arena + operador). */
const HERO = `<svg class="hero-art" viewBox="0 0 900 600" aria-hidden="true">
  <defs>
    <linearGradient id="hg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb020" stop-opacity=".22"/><stop offset="1" stop-color="#ffb020" stop-opacity="0"/></linearGradient>
    <linearGradient id="hc" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4fd8ff" stop-opacity="0"/><stop offset=".5" stop-color="#4fd8ff" stop-opacity=".7"/><stop offset="1" stop-color="#4fd8ff" stop-opacity="0"/></linearGradient>
  </defs>
  <g fill="none" stroke="#2a3342" stroke-width="1.5">
    <path d="M60 470 L450 300 L840 470 L450 590 Z"/>
    <path d="M300 420 L450 355 L600 420 L450 480 Z" stroke="#3a4658"/>
    <path d="M300 420 v-40 L450 315 v40 M600 420 v-40 L450 315" stroke="#3a4658"/>
    <path d="M130 445 v-90 l120 -52 v90 M770 445 v-90 l-120 -52 v90"/>
  </g>
  <path d="M60 470 L450 300 L840 470 L450 590 Z" fill="url(#hg)"/>
  <path d="M120 300 H780" stroke="url(#hc)" stroke-width="2"/>
  <g transform="translate(520 120)">
    <path d="M60 0c22 0 36 16 36 34 0 6-2 12-4 16h-64c-2-4-4-10-4-16 0-18 14-34 36-34z" fill="#3b414b"/>
    <rect x="30" y="36" width="60" height="10" fill="#0a0c10"/>
    <rect x="36" y="40" width="48" height="3" fill="#ffb020"/>
    <path d="M18 64h84l14 120H4z" fill="#2b2f36"/>
    <path d="M28 70h64l6 70H22z" fill="#3b414b"/>
    <rect x="22" y="80" width="76" height="4" fill="#ffb020"/>
    <path d="M4 184h112l-8 150h-36l-12-110-12 110H12z" fill="#23272d"/>
    <path d="M102 92l70 40-6 12-74-30z" fill="#2b2f36"/>
    <path d="M160 126h46v10h-46z" fill="#1b1e24"/>
  </g>
</svg>`;

export const MenuScreen = (o: MenuOpts): HTMLElement => {
  const err = h('div', { class: 'error' });
  const item = (idx: string, label: string, onClick: (() => void) | null, primary = false, testid?: string) =>
    h(
      'button',
      { class: `menu-item ${primary ? 'primary' : ''}`, disabled: !onClick, on: onClick ? { click: onClick } : {}, ...(testid ? { 'data-testid': testid } : {}) },
      h('span', { class: 'idx' }, idx),
      label,
      onClick ? '' : h('span', { class: 'soon' }, 'em breve'),
    );

  const root = h('div', { class: 'screen' });
  const openJoin = (): void => {
    const input = h('input', { class: 'input code', maxlength: String(ROOM_CODE_LENGTH), placeholder: '••••••', autocomplete: 'off', spellcheck: 'false', 'data-testid': 'join-code' });
    const jerr = h('div', { class: 'error' });
    const go = h('button', { class: 'btn primary', type: 'submit', 'data-testid': 'join-submit' }, 'Entrar');
    input.addEventListener('input', () => {
      input.value = [...input.value.toUpperCase()].filter((c) => ROOM_CODE_ALPHABET.includes(c)).join('');
    });
    const back: HTMLDivElement = h(
      'div',
      { class: 'modal-back', on: { click: (e) => e.target === back && back.remove() } },
      h(
        'div',
        { class: 'modal panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, 'Entrar em sala'), h('button', { class: 'btn sm ghost', on: { click: () => back.remove() } }, 'Fechar')),
        h(
          'form',
          {
            class: 'panel-body',
            on: {
              submit: async (e) => {
                e.preventDefault();
                if (input.value.length !== ROOM_CODE_LENGTH) {
                  jerr.textContent = `O código tem ${ROOM_CODE_LENGTH} caracteres.`;
                  return;
                }
                go.disabled = true;
                const r = await o.onJoin(input.value);
                if (r) {
                  jerr.textContent = r;
                  go.disabled = false;
                } else back.remove();
              },
            },
          },
          h('div', { class: 'field' }, h('label', {}, 'Código da sala'), input),
          jerr,
          h('div', { class: 'row' }, h('span', { class: 'hint grow' }, 'Peça o código ou o link ao anfitrião.'), go),
        ),
      ),
    );
    root.append(back);
    setTimeout(() => input.focus(), 30);
  };

  const list = h(
    'nav',
    { class: 'menu-list' },
    item('01', 'Jogar', null),
    item('02', 'Criar sala', async () => {
      const e = await o.onCreate();
      if (e) err.textContent = e;
    }, true, 'create-room'),
    item('03', 'Entrar em sala', openJoin, false, 'open-join'),
    item('04', 'Arsenal', null),
    item('05', 'Inventário', null),
    item('06', 'Personagens', null),
    item('07', 'Perfil', null),
    item('08', 'Ranking', null),
    item('09', 'Histórico', null),
    item('10', 'Configurações', o.onSettings),
  );

  root.append(
    svg(HERO),
    h(
      'div',
      { class: 'menu' },
      h(
        'div',
        { class: 'menu-left' },
        h('div', { class: 'brand' }, svg(BRAND_MARK), h('div', {}, h('div', { class: 'brand-name' }, 'VÉRTI', h('b', {}, 'CE')), h('div', { class: 'brand-sub' }, 'Fase 1 · Multiplayer'))),
        list,
        err,
      ),
      h(
        'div',
        { class: 'menu-right' },
        h(
          'div',
          { class: 'panel player-chip' },
          avatar(o.nickname),
          h('div', {}, h('div', { style: { fontSize: '17px', letterSpacing: '0.06em' } }, o.nickname), h('div', { class: 'hint' }, 'Convidado · Nível 1')),
          h('span', { class: `conn-dot ${o.connected ? '' : 'off'}`, title: o.connected ? 'Conectado' : 'Sem conexão' }),
          h('button', { class: 'btn sm ghost', on: { click: o.onLogout } }, 'Trocar'),
        ),
        h('div', { class: 'hint' }, '"Jogar" (partidas públicas) chega com matchmaking. Por enquanto: crie uma sala e mande o link.'),
      ),
    ),
  );
  return root;
};
