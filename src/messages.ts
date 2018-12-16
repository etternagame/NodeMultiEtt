import { Player } from './player';

export function makeMessage(type: string, payload: object | null = null): ETTPOutgoingMsg {
  return payload ? { type, payload } : { type };
}

export interface BaseMsg {};

export const LOBBY_MESSAGE = 0;
export const ROOM_MESSAGE = 1;
export const PRIVATE_MESSAGE = 2;

export interface ChartMsg extends BaseMsg {
  title: string;
  subtitle: string;
  artist: string;
  filehash: string;
  chartkey: string;
  rate: number;
  difficulty: number;
  meter: number;
}

export interface ChatMsg extends BaseMsg {
  msg: string;
  msgtype: number;
  tab: string;
  [key: string]: string | number;
}

export interface RoomMsg extends BaseMsg {
  name: string;
  desc: string;
  pass: string;
}

export interface EnterRoomMsg extends BaseMsg {
  name: string;
  pass: string | null;
  desc: string | null;
}

export interface LoginMsg extends BaseMsg {
  user: string;
  pass: string;
}

export interface StartingChartMsg extends BaseMsg {}

export interface MissingChartMsg extends BaseMsg {}

export interface HasChartMsg extends BaseMsg {}
export interface GameOverMsg extends BaseMsg {}
export interface PingMsg extends BaseMsg {}
export interface LeaveOptionsMsg extends BaseMsg {}
export interface EnterOptiongMsg extends BaseMsg {}
export interface LogoutMsg extends BaseMsg {}
export interface LeaveRoomMsg extends BaseMsg {}
export type CreateRoomMsg = RoomMsg;
export interface ScoreMsg extends BaseMsg {}
export interface LeaveEvalMsg extends BaseMsg {}
export interface GameplayUpdateMsg extends BaseMsg {
  wife: number;
  jdgstr: string;
}
export interface EnterEvalMsg extends BaseMsg {}

export interface HelloMsg extends BaseMsg {
  version: string;
  client: string;
  packs: string[] | null;
}

export type ETTPMsgHandler = (player: Player, message: BaseMsg) => void;

export interface ETTPMsgHandlers {
  [key: string]: ETTPMsgHandler;
}

export interface ETTPOutgoingMsg {
  type: string;
  id?: number;
  payload?: { [key: string]: any };
}
export interface ETTPIncomingMsg {
  type: keyof ETTPMsgHandlers;
  payload:
    | RoomMsg
    | StartingChartMsg
    | MissingChartMsg
    | HasChartMsg
    | GameOverMsg
    | PingMsg
    | LeaveOptionsMsg
    | EnterOptiongMsg
    | LogoutMsg
    | LeaveRoomMsg
    | CreateRoomMsg
    | ScoreMsg
    | LeaveEvalMsg
    | GameplayUpdateMsg
    | EnterEvalMsg
    | ChartMsg
    | LoginMsg
    | ChatMsg
    | EnterRoomMsg;
}
