import { customAlphabet, nanoid } from 'nanoid';
import { CODE_LEN } from '../../shared/types.ts';

// Crockford-ish alphabet — no 0/O, 1/I/L confusion. Uppercase only.
const codeAlphabet = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', CODE_LEN);

export const generateLobbyCode = (): string => codeAlphabet();
export const generatePlayerId = (): string => 'p_' + nanoid(12);
export const generateReconnectToken = (): string => nanoid(32);
export const generateEventId = (): string => 'e_' + nanoid(10);
