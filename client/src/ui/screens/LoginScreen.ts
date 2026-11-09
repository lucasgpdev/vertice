import { NICKNAME_MAX, NICKNAME_MIN, NicknameSchema } from '@vertice/shared';
import { BRAND_MARK, h, svg } from '../dom.js';

/** Entrada como convidado (Fase 1: só nickname; contas com senha na Fase 7). */
export const LoginScreen = (opts: { initial: string; inviteCode: string | null; onSubmit: (nick: string) => Promise<string | null> }): HTMLElement => {
  const input = h('input', {
    class: 'input',
    maxlength: String(NICKNAME_MAX),
    placeholder: 'Seu nickname',
    value: opts.initial,
    autocomplete: 'off',
    spellcheck: 'false',
    'data-testid': 'nickname',
  });
  const err = h('div', { class: 'error' });
  const btn = h('button', { class: 'btn primary', type: 'submit', 'data-testid': 'login' }, opts.inviteCode ? 'Entrar na sala' : 'Entrar');
  const form = h(
    'form',
    {
      on: {
        submit: async (e) => {
          e.preventDefault();
          const parsed = NicknameSchema.safeParse(input.value);
          if (!parsed.success) {
            err.textContent = `Use ${NICKNAME_MIN}–${NICKNAME_MAX} caracteres: letras, números, _ ou -.`;
            return;
          }
          btn.disabled = true;
          err.textContent = '';
          const e2 = await opts.onSubmit(parsed.data);
          if (e2) {
            err.textContent = e2;
            btn.disabled = false;
          }
        },
      },
    },
    h('div', { class: 'field' }, h('label', {}, 'Nickname de convidado'), input),
    err,
    h('div', { class: 'row' }, btn),
  );
  setTimeout(() => input.focus(), 50);
  const brand = h('div', { class: 'brand' }, svg(BRAND_MARK), h('div', {}, h('div', { class: 'brand-name' }, 'VÉRTI', h('b', {}, 'CE')), h('div', { class: 'brand-sub' }, 'Tático · Competitivo · Navegador')));
  return h(
    'div',
    { class: 'screen' },
    h(
      'div',
      { class: 'login' },
      h('div', { style: { marginBottom: '28px' } }, brand),
      h(
        'div',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, opts.inviteCode ? `Convite para a sala ${opts.inviteCode}` : 'Identificação')),
        h('div', { class: 'panel-body' }, form, h('div', { class: 'hint', style: { marginTop: '14px' } }, 'Contas com senha, nível e ranking chegam em fases futuras.')),
      ),
    ),
  );
};
