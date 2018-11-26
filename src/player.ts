import { EWebSocket } from './ettServer';

import { Room, SerializedRoom } from './room';

import { makeMessage, GenericMessage, PRIVATE_MESSAGE } from './messages';

import { color, removeMultiColor } from './utils';

export class Player {
  user: string;
  pass: string;
  ws: EWebSocket;
  state: number;
  room: Room | null;
  constructor(_user: string, _pass: string, _ws: EWebSocket) {
    this.user = _user;
    this.pass = _pass;
    this.ws = _ws;
    this.state = 0; // 0 = ready, 1 = playing, 2 = evalScreen, 3 = options, 4 = notReady(unkown reason)
    this.room = null;
  }

  sendPM(msg: string) {
    this.sendChat(PRIVATE_MESSAGE, msg);
  }

  leaveRoom() {
    this.state = 0;

    if (!this.room) {
      return null;
    }

    if (this.user === this.room.owner.user) {
      this.room.changeOwner();
    }

    this.room.remove(this);
    const room = this.room;
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
    message['id'] = this.ws.msgId;
    this.ws.msgId = this.ws.msgId + 1;

    this.ws.send(JSON.stringify(message));
  }

  serialize() {
    return this.user;
  }
}
