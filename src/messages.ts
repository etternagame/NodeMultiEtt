import { Player } from './player';

export function makeMessage(type: string, payload: object | null = null): ETTPOutgoingMsg {
  return payload ? { type, payload } : { type };
}

export interface BaseMsg {}

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
export const ETTPMsgGuards = {
  startchart: function(msg: any): msg is ChartMsg {
    return msg !== undefined;
  },
  hello: function(msg: any): msg is HelloMsg {
    return true;
  },
  startingchart: function(msg: any): msg is StartingChartMsg {
    return msg !== undefined;
  },
  missingchart: function(msg: any): msg is MissingChartMsg {
    return msg !== undefined;
  },
  haschart: function(msg: any): msg is HasChartMsg {
    return msg !== undefined;
  },
  selectchart: function(msg: any): msg is ChartMsg {
    return msg !== undefined;
  },
  gameover: function(msg: any): msg is GameOverMsg {
    return msg !== undefined;
  },
  ping: function(msg: any): msg is PingMsg {
    return msg !== undefined;
  },
  chat: function(msg: any): msg is ChatMsg {
    return msg !== undefined;
  },
  enteroptions: function(msg: any): msg is EnterOptiongMsg {
    return msg !== undefined;
  },
  leaveoptions: function(msg: any): msg is LeaveOptionsMsg {
    return msg !== undefined;
  },
  login: function(msg: any): msg is LoginMsg {
    return msg !== undefined;
  },
  logout: function(msg: any): msg is LogoutMsg {
    return msg !== undefined;
  },
  leaveroom: function(msg: any): msg is LeaveRoomMsg {
    return msg !== undefined;
  },
  enterroom: function(msg: any): msg is EnterRoomMsg {
    return msg !== undefined;
  },
  createroom: function(msg: any): msg is CreateRoomMsg {
    return msg !== undefined;
  },
  score: function(msg: any): msg is ScoreMsg {
    return msg !== undefined;
  },
  leaveeval: function(msg: any): msg is LeaveEvalMsg {
    return msg !== undefined;
  },
  entereval: function(msg: any): msg is EnterEvalMsg {
    return msg !== undefined;
  },
  gameplayupdate: function(msg: any): msg is GameplayUpdateMsg {
    return msg !== undefined;
  }
};

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
