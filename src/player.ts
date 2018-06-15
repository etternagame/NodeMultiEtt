/// <reference path="references.ts" />
namespace Player {
  export class Player {
    user: string;
    pass: string;
    ws: ETTServer.Websocket;
    state: number;
    room: Room.Room | null;
    constructor(_user: string, _pass: string, _ws: ETTServer.Websocket) {
      this.user = _user;
      this.pass = _pass;
      this.ws = _ws;
      this.state = 0; // 0 = ready, 1 = playing, 2 = evalScreen, 3 = options, 4 = notReady(unkown reason)
      this.room = null;
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

      this.send(Messages.makeMessage('userlist', { players: [] }));

      return room;
    }

    sendRoomList(_rooms: Room.SerializedRoom[]) {
      this.send(Messages.makeMessage('roomlist', { rooms: _rooms }));
    }

    sendChat(type: number, msgStr: string, _tab: string = '') {
      this.send(
        Messages.makeMessage('chat', {
          msgtype: type,
          tab: _tab,
          msg: Utils.removeMultiColor(
            `${Utils.color('FFFFFF')} ${msgStr} ${Utils.color('FFFFFF')} `
          )
        })
      );
    }

    send(message: Messages.GenericMessage) {
      message['id'] = this.ws.msgId;
      this.ws.msgId = this.ws.msgId + 1;

      this.ws.send(JSON.stringify(message));
    }

    serialize() {
      return this.user;
    }
  }
}
