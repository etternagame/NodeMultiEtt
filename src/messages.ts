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
  pack: string;
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
export type CreateRoomMsg = RoomMsg;

export interface EnterRoomMsg extends BaseMsg {
  name: string;
  pass: string | null;
  desc: string | null;
}

export interface LoginMsg extends BaseMsg {
  user: string;
  pass: string;
}

export interface GameplayUpdateMsg extends BaseMsg {
  wife: number;
  jdgstr: string;
}

export interface HelloMsg extends BaseMsg {
  version: string;
  client: string;
  packs: string[] | null;
}

export interface StartingChartMsg extends BaseMsg {}
export interface NotStartingChartMsg extends BaseMsg {}
export interface MissingChartMsg extends BaseMsg {}
export interface HasChartMsg extends BaseMsg {}
export interface GameOverMsg extends BaseMsg {}
export interface PingMsg extends BaseMsg {}
export interface CloseOptionsMsg extends BaseMsg {}
export interface OpenOptiongMsg extends BaseMsg {}
export interface LogoutMsg extends BaseMsg {}
export interface LeaveRoomMsg extends BaseMsg {}
export interface ScoreMsg extends BaseMsg {}
export interface CloseEvalMsg extends BaseMsg {}
export interface OpenEvalMsg extends BaseMsg {}

export type ETTPMsgHandler<MsgType> = (player: Player, message: MsgType) => void;
export interface ETTPMsgHandlers {
  startchart: ETTPMsgHandler<ChartMsg>;
  notstartingchart: ETTPMsgHandler<NotStartingChartMsg>;
  hello: ETTPMsgHandler<HelloMsg>;
  startingchart: ETTPMsgHandler<StartingChartMsg>;
  missingchart: ETTPMsgHandler<MissingChartMsg>;
  haschart: ETTPMsgHandler<HasChartMsg>;
  selectchart: ETTPMsgHandler<ChartMsg>;
  gameover: ETTPMsgHandler<GameOverMsg>;
  ping: ETTPMsgHandler<PingMsg>;
  chat: ETTPMsgHandler<ChatMsg>;
  openoptions: ETTPMsgHandler<OpenOptiongMsg>;
  closeoptions: ETTPMsgHandler<CloseOptionsMsg>;
  login: ETTPMsgHandler<LoginMsg>;
  logout: ETTPMsgHandler<LogoutMsg>;
  leaveroom: ETTPMsgHandler<LeaveRoomMsg>;
  enterroom: ETTPMsgHandler<EnterRoomMsg>;
  createroom: ETTPMsgHandler<CreateRoomMsg>;
  score: ETTPMsgHandler<ScoreMsg>;
  closeeval: ETTPMsgHandler<CloseEvalMsg>;
  openeval: ETTPMsgHandler<OpenEvalMsg>;
  gameplayupdate: ETTPMsgHandler<GameplayUpdateMsg>;
}
export const ETTPMsgGuards = {
  hello: function(msg: any): msg is HelloMsg {
    return msg != null;
  },
  startingchart: function(msg: any): msg is StartingChartMsg {
    return true;
  },
  notstartingchart: function(msg: any): msg is NotStartingChartMsg {
    return true;
  },
  missingchart: function(msg: any): msg is MissingChartMsg {
    return true;
  },
  haschart: function(msg: any): msg is HasChartMsg {
    return true;
  },
  gameover: function(msg: any): msg is GameOverMsg {
    return true;
  },
  ping: function(msg: any): msg is PingMsg {
    return true;
  },
  openoptions: function(msg: any): msg is OpenOptiongMsg {
    return true;
  },
  closeoptions: function(msg: any): msg is CloseOptionsMsg {
    return true;
  },
  logout: function(msg: any): msg is LogoutMsg {
    return true;
  },
  leaveroom: function(msg: any): msg is LeaveRoomMsg {
    return true;
  },
  openeval: function(msg: any): msg is CloseEvalMsg {
    return true;
  },
  closeeval: function(msg: any): msg is OpenEvalMsg {
    return true;
  },
  score: function(msg: any): msg is ScoreMsg {
    return true;
  },
  startchart: function(msg: any): msg is ChartMsg {
    return msg != null && typeof msg.title == 'string';
  },
  selectchart: function(msg: any): msg is ChartMsg {
    return msg != null && typeof msg.title == 'string';
  },
  chat: function(msg: any): msg is ChatMsg {
    return (
      msg != null &&
      typeof msg.msgtype == 'number' &&
      typeof msg.msg == 'string'
    );
  },
  login: function(msg: any): msg is LoginMsg {
    return (
      msg != null &&
      typeof msg.user == 'string' &&
      typeof msg.pass == 'string'
    );
  },
  enterroom: function(msg: any): msg is EnterRoomMsg {
    return msg != null && typeof msg.name == 'string';
  },
  createroom: function(msg: any): msg is CreateRoomMsg {
    return msg != null && typeof msg.name == 'string';
  },
  gameplayupdate: function(msg: any): msg is GameplayUpdateMsg {
    return msg != null;
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
    | CloseOptionsMsg
    | OpenOptiongMsg
    | LogoutMsg
    | LeaveRoomMsg
    | CreateRoomMsg
    | ScoreMsg
    | CloseEvalMsg
    | GameplayUpdateMsg
    | OpenEvalMsg
    | ChartMsg
    | LoginMsg
    | ChatMsg
    | EnterRoomMsg;
}
