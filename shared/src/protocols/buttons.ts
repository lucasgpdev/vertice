/** Bitmask dos botões enviados em cada InputCmd. */
export const Buttons = {
  Forward: 1 << 0,
  Back: 1 << 1,
  Left: 1 << 2,
  Right: 1 << 3,
  Jump: 1 << 4,
  Crouch: 1 << 5,
  Sprint: 1 << 6,
  Fire: 1 << 7,
  Reload: 1 << 8,
  Aim: 1 << 9,
} as const;

export const BUTTONS_MASK = (1 << 10) - 1;
