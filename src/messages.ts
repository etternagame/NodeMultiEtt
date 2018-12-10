import { Player } from './player';

export function makeMessage(type: string, payload: object | null = null): ETTPOutgoingMsg {
  return payload ? { type, payload } : { type };
}

export const LOBBY_MESSAGE = 0;
export const ROOM_MESSAGE = 1;
export const PRIVATE_MESSAGE = 2;

export interface ChartMsg {
  title: string;
  subtitle: string;
  artist: string;
  filehash: string;
  chartkey: string;
  rate: number;
  difficulty: number;
  meter: number;
}

export interface ChatMsg {
  msg: string;
  msgtype: number;
  tab: string;
  [key: string]: string | number;
}

export interface RoomMsg {
  name: string;
  desc: string;
  pass: string;
}

export interface EnterRoomMsg {
  name: string;
  pass: string | null;
  desc: string | null;
}

export interface LoginMsg {
  user: string;
  pass: string;
}

export interface StartingChartMsg {}

export interface MissingChartMsg {}

export interface HasChartMsg {}
export interface GameOverMsg {}
export interface PingMsg {}
export interface LeaveOptionsMsg {}
export interface EnterOptiongMsg {}
export interface LogoutMsg {}
export interface LeaveRoomMsg {}
export type CreateRoomMsg = RoomMsg;
export interface ScoreMsg {}
export interface LeaveEvalMsg {}
export interface GameplayUpdateMsg {
  wife: number;
  jdgstr: string;
}
export interface EnterEvalMsg {}

export interface HelloMsg {
  version: string;
  client: string;
  packs: string[] | null;
}

export type ETTPMsgHandler<MsgType> = (player: Player, message: MsgType) => void;
export interface ETTPMsgHandlers {
  startchart: ETTPMsgHandler<ChartMsg>;
  hello: ETTPMsgHandler<HelloMsg>;
  startingchart: ETTPMsgHandler<StartingChartMsg>;
  missingchart: ETTPMsgHandler<MissingChartMsg>;
  haschart: ETTPMsgHandler<HasChartMsg>;
  selectchart: ETTPMsgHandler<ChartMsg>;
  gameover: ETTPMsgHandler<GameOverMsg>;
  ping: ETTPMsgHandler<PingMsg>;
  chat: ETTPMsgHandler<ChatMsg>;
  enteroptions: ETTPMsgHandler<EnterOptiongMsg>;
  leaveoptions: ETTPMsgHandler<LeaveOptionsMsg>;
  login: ETTPMsgHandler<LoginMsg>;
  logout: ETTPMsgHandler<LogoutMsg>;
  leaveroom: ETTPMsgHandler<LeaveRoomMsg>;
  enterroom: ETTPMsgHandler<EnterRoomMsg>;
  createroom: ETTPMsgHandler<CreateRoomMsg>;
  score: ETTPMsgHandler<ScoreMsg>;
  leaveeval: ETTPMsgHandler<LeaveEvalMsg>;
  entereval: ETTPMsgHandler<EnterEvalMsg>;
  gameplayupdate: ETTPMsgHandler<GameplayUpdateMsg>;
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
