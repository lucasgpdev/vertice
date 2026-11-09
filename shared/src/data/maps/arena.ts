import type { MapBox, MapDef, SurfaceMaterial } from './types.js';

/**
 * "Pátio 7" — arena da Fase 1 (original).
 * 36 x 36 m, plataforma central elevada com escadas, dois corredores laterais
 * cobertos por muretas, quatro coberturas em L e caixas. Três rotas entre os
 * lados norte e sul: corredor oeste, centro (plataforma) e corredor leste.
 */
const B = (
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  mat: SurfaceMaterial,
): MapBox => ({
  min: { x: Math.min(x0, x1), y: Math.min(y0, y1), z: Math.min(z0, z1) },
  max: { x: Math.max(x0, x1), y: Math.max(y0, y1), z: Math.max(z0, z1) },
  mat,
});

const boxes: MapBox[] = [];

// Piso
boxes.push(B(-20, -1, -20, 20, 0, 20, 'floor'));

// Paredes externas (altura 7)
boxes.push(B(-19, 0, -19, 19, 7, -18, 'concreteDark'));
boxes.push(B(-19, 0, 18, 19, 7, 19, 'concreteDark'));
boxes.push(B(-19, 0, -18, -18, 7, 18, 'concreteDark'));
boxes.push(B(18, 0, -18, 19, 7, 18, 'concreteDark'));

// Plataforma central 6x6, altura 1,6
boxes.push(B(-3, 0, -3, 3, 1.6, 3, 'concrete'));
// Escadas leste e oeste (degraus de 0,4 m)
for (const side of [1, -1]) {
  for (let i = 0; i < 3; i++) {
    const h = 1.2 - i * 0.4;
    const xa = side * (3 + i * 0.6);
    const xb = side * (3 + (i + 1) * 0.6);
    boxes.push(B(xa, 0, -1.4, xb, h, 1.4, 'metal'));
  }
}
// Muretas na plataforma (cobertura alta para quem sobe)
boxes.push(B(-2.6, 1.6, -3, 2.6, 2.6, -2.6, 'trim'));
boxes.push(B(-2.6, 1.6, 2.6, 2.6, 2.6, 3, 'trim'));

// Corredores laterais: mureta longa com aberturas, x = ±13..±13.6
for (const side of [1, -1]) {
  const x0 = side * 13;
  const x1 = side * 13.6;
  boxes.push(B(x0, 0, -12, x1, 3.2, -4, 'concrete'));
  boxes.push(B(x0, 0, -1.5, x1, 3.2, 1.5, 'concrete'));
  boxes.push(B(x0, 0, 4, x1, 3.2, 12, 'concrete'));
  // Teto do corredor (passagem coberta entre z -6..6)
  boxes.push(B(side * 13, 3.2, -6, side * 18, 3.6, 6, 'metal'));
  // Caixas dentro do corredor
  boxes.push(B(side * 15.2, 0, -9.5, side * 16.4, 1.2, -8.3, 'crate'));
  boxes.push(B(side * 15.6, 0, 8.6, side * 16.8, 1.2, 9.8, 'crate'));
}

// Coberturas em L nos quatro quadrantes
for (const sx of [1, -1]) {
  for (const sz of [1, -1]) {
    boxes.push(B(sx * 6, 0, sz * 9, sx * 10.5, 2.4, sz * 9.6, 'concrete'));
    boxes.push(B(sx * 6, 0, sz * 9.6, sx * 6.6, 2.4, sz * 13, 'concrete'));
  }
}

// Pilares
for (const [x, z] of [[-7, 0], [7, 0], [0, -11], [0, 11]] as const) {
  boxes.push(B(x - 0.6, 0, z - 0.6, x + 0.6, 7, z + 0.6, 'trim'));
}

// Caixas avulsas e pilhas
const crates: [number, number, number][] = [
  [-10, 0, -3], [10, 0, 3], [-4.5, 0, -7.5], [4.5, 0, 7.5],
  [-15, 0, -15], [15, 0, 15], [9, 0, -15], [-9, 0, 15],
];
for (const [x, y, z] of crates) boxes.push(B(x - 0.6, y, z - 0.6, x + 0.6, y + 1.2, z + 0.6, 'crate'));
// Pilhas de duas caixas
boxes.push(B(-10.6, 1.2, -3.6, -9.4, 2.4, -2.4, 'crate'));
boxes.push(B(9.4, 1.2, 2.4, 10.6, 2.4, 3.6, 'crate'));
// Caixa baixa para subir na pilha
boxes.push(B(-11.8, 0, -3.5, -10.6, 0.4, -2.5, 'metal'));
boxes.push(B(10.6, 0, 2.5, 11.8, 0.4, 3.5, 'metal'));

export const ARENA: MapDef = {
  id: 'arena-patio7',
  name: 'Pátio 7',
  boxes,
  spawns: [
    [-16, -16], [16, 16], [-16, 16], [16, -16], [0, -16], [0, 16], [-16, 0], [16, 0], [-8, -6], [8, 6],
  ].map(([x, z]) => ({ x: x!, y: 0, z: z!, yaw: Math.atan2(x!, z!) })), // olha para o centro

  lights: [
    { kind: 'point', x: 0, y: 4.5, z: 0, color: '#ffb347', intensity: 18, distance: 14 },
    { kind: 'point', x: -15.5, y: 2.8, z: 0, color: '#4fd8ff', intensity: 10, distance: 10 },
    { kind: 'point', x: 15.5, y: 2.8, z: 0, color: '#4fd8ff', intensity: 10, distance: 10 },
    { kind: 'point', x: 0, y: 5, z: -14, color: '#ff8a3d', intensity: 10, distance: 12 },
    { kind: 'point', x: 0, y: 5, z: 14, color: '#ff8a3d', intensity: 10, distance: 12 },
  ],
  strips: [
    // Faixas luminosas no topo das paredes externas e sob o teto dos corredores
    { min: { x: -18, y: 6.4, z: -18.02 }, max: { x: 18, y: 6.55, z: -17.95 }, color: '#ff9d2e', intensity: 3 },
    { min: { x: -18, y: 6.4, z: 17.95 }, max: { x: 18, y: 6.55, z: 18.02 }, color: '#ff9d2e', intensity: 3 },
    { min: { x: -18.02, y: 6.4, z: -18 }, max: { x: -17.95, y: 6.55, z: 18 }, color: '#4fd8ff', intensity: 3 },
    { min: { x: 17.95, y: 6.4, z: -18 }, max: { x: 18.02, y: 6.55, z: 18 }, color: '#4fd8ff', intensity: 3 },
    { min: { x: -17.8, y: 3.12, z: -5.8 }, max: { x: -13.2, y: 3.18, z: -5.6 }, color: '#4fd8ff', intensity: 4 },
    { min: { x: 13.2, y: 3.12, z: 5.6 }, max: { x: 17.8, y: 3.18, z: 5.8 }, color: '#4fd8ff', intensity: 4 },
    { min: { x: -2.6, y: 2.6, z: -2.62 }, max: { x: 2.6, y: 2.66, z: -2.58 }, color: '#ffb347', intensity: 4 },
    { min: { x: -2.6, y: 2.6, z: 2.58 }, max: { x: 2.6, y: 2.66, z: 2.62 }, color: '#ffb347', intensity: 4 },
  ],
  sun: { dir: [-0.45, -1, -0.3], color: '#ffe2c4', intensity: 2.2 },
  ambient: { sky: '#9fb4d6', ground: '#3a3228', intensity: 0.9 },
  fog: { color: '#1b1f27', near: 30, far: 90 },
  perfBudget: { maxDrawCalls: 120 },
};
