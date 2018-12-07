export function makeMessage(type: string, payload: object | null = null) {
  return payload ? { type, payload } : { type };
}

export const LOBBY_MESSAGE = 0;
export const ROOM_MESSAGE = 1;
export const PRIVATE_MESSAGE = 2;

export interface ChartMessage {
  title: string;
  subtitle: string;
  artist: string;
  filehash: string;
  chartkey: string;
  rate: number;
  difficulty: number;
  meter: number;
}

export interface GenericMessage {
  [key: string]: any;
}

export interface ChatMessage {
  msg: string;
  msgtype: number;
  tab: string;
  [key: string]: string | number;
}

export interface RoomMessage {
  name: string;
  desc: string;
  pass: string;
}

export interface LoginMessage {
  user: string;
  pass: string;
  // Maybe
  desc: string;
}
