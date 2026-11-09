import { randomInt } from 'node:crypto';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@vertice/shared';

/** Gera um código de sala exclusivo (criptograficamente aleatório). */
export const generateRoomCode = (taken: (code: string) => boolean): string => {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    if (!taken(code)) return code;
  }
  throw new Error('Não foi possível gerar um código de sala livre');
};
