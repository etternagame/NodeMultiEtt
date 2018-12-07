import { EWebSocket } from './ettServer';

import { Room, SerializedRoom } from './room';

import { makeMessage, GenericMessage, PRIVATE_MESSAGE } from './messages';

import { color, removeMultiColor, systemPrepend } from './utils';

export const READY = 0;
export const PLAYING = 1;
export const EVAL = 2;
export const OPTIONS = 3;
export const NOTREADY = 4;

export class Player {
  user: string;

  pass: string;

  ws: EWebSocket;

  state: number;

  readystate: boolean;

  gameplayState: {
    wife: number;
    user: string;
    jdgstr: string;
  };

  room: Room | null;

  constructor(_user: string, _pass: string, _ws: EWebSocket) {
    this.user = _user;
    this.pass = _pass;
    this.ws = _ws;
    this.state = READY;
    this.readystate = false;
    this.room = null;
    this.gameplayState = { wife: 0, user: _user, jdgstr: '' };
  }

  sendPM(msg: string) {
    this.sendChat(PRIVATE_MESSAGE, msg);
  }

  leaveRoom() {
    this.state = READY;

    if (!this.room) {
      return null;
    }

    if (this.user === this.room.owner.user) {
      this.room.changeOwner();
    }

    this.room.remove(this);
    const { room } = this;
    this.room = null;

    this.send(makeMessage('userlist', { players: [] }));

    return room;
  }

  sendRoomList(_rooms: SerializedRoom[]) {
    this.send(makeMessage('roomlist', { rooms: _rooms }));
  }

  sendChat(type: number, msgStr: string, _tab: string = '') {
    this.send(
      makeMessage('chat', {
        msgtype: type,
        tab: _tab,
        msg: removeMultiColor(`${color('FFFFFF')} ${msgStr}`)
      })
    );
  }

  send(message: GenericMessage) {
    message.id = this.ws.msgId;
    this.ws.msgId = this.ws.msgId + 1;

    this.ws.send(JSON.stringify(message));
  }

  serialize() {
    return this.user;
  }

  toggleReady() {
    if (this.readystate === true) {
      this.readystate = false;
      if (this.room !== null) {
        this.room.sendChat(`${systemPrepend} ${this.user} is not ready.`);
      }
    } else {
      this.readystate = true;
      if (this.room !== null) {
        this.room.sendChat(`${systemPrepend} ${this.user} is ready.`);
      }
    }
  }
}

export { Player as default };
