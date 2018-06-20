import { Chart } from './chart';
import { Player } from './player';
import {
  makeMessage,
  ChartMessage,
  GenericMessage,
  LoginMessage,
  ChatMessage,
  RoomMessage
} from './messages';

import {
  color,
  colorize,
  opColor,
  ownerColor,
  playerColor,
  removeMultiColor,
  systemPrepend,
  selectionModeDescriptions,
  selectionModes,
  stringToColour,
  unauthorizedChat
} from './utils';

export interface SerializedRoom {
  name: string;
  desc: string;
  players: string[];
  pass: boolean;
  state: number;
}
export class Room {
  name: string;
  desc: string;
  pass: string;
  freerate: boolean;
  playing: boolean;
  chart: Chart | null;
  free: boolean;
  state: number;
  selectionMode: number;
  owner: Player;
  ops: string[];
  players: Player[];
  constructor(_name: string, _desc: string, _pass: string, _owner: Player) {
    this.name = _name;
    this.desc = _desc;
    this.pass = _pass;
    this.players = [];
    this.owner = _owner;
    this.ops = [];
    this.free = false; // free===Anyone can pick
    this.selectionMode = 0; // By metadata(0), filehash(1) or chartkey(2)
    this.state = 0; // Selecting(0), Playing(1)
    this.chart = null;
    this.freerate = false;
    this.playing = false;
  }

  serializeChart(chart: Chart | null = this.chart) {
    if (!chart) return {};

    const selectionMode: (ch: Chart) => any = selectionModes[this.selectionMode];
    if (!selectionMode) {
      this.sendChat(`${systemPrepend}Invalid selection mode`);
      return {};
    }

    const selectedChart = selectionMode(chart);

    if (!this.freerate) {
      selectedChart.rate = chart.rate;
    }
    return selectedChart;
  }

  startChart(player: Player, message: ChartMessage) {
    let chart: Chart = new Chart(message, player);

    // Use the selectionMode criteria
    const newChart = this.serializeChart(chart);
    const oldChart = this.serializeChart(this.chart);

    if (
      !this.chart ||
      player.user !== this.chart.pickedBy ||
      JSON.stringify(newChart) !== JSON.stringify(oldChart)
    ) {
      this.selectChart(player, message);
      return;
    }

    this.chart = chart;
    this.state = 1;

    this.send(makeMessage('startchart', { chart: newChart }));
    this.sendChat(`${systemPrepend}Starting ${colorize(this.chart.title)}`);

    this.playing = true;
  }

  selectChart(player: Player, message: ChartMessage) {
    this.chart = new Chart(message, player);

    this.send(makeMessage('selectchart', { chart: this.serializeChart() }));
    this.sendChat(
      `${systemPrepend}${player.user} selected ` +
        colorize(
          `${message.title} (${message.difficulty}: ${message.meter})${
            message.rate ? ` ${parseFloat((message.rate / 1000).toFixed(2))}` : ''
          }`,
          stringToColour(message.title)
        )
    );
  }

  refreshUserList() {
    this.send(
      makeMessage('userlist', {
        players: this.players.map(x => ({ name: x.user, status: x.state + 1 }))
      })
    );
  }

  enter(player: Player) {
    player.room = this;

    this.players.push(player);

    player.send(makeMessage('enterroom', { entered: true }));
    this.sendChat(`${systemPrepend}${player.user} joined`);

    player.state = 0;

    if (this.chart) player.send(makeMessage('selectchart', { chart: this.serializeChart() }));
  }

  serialize(): SerializedRoom {
    return {
      name: this.name,
      desc: this.desc,
      players: this.players.map(p => p.serialize()),
      pass: !!this.pass,
      state: this.state
    };
  }

  updateStatus() {
    // const oldState = this.state;
    this.state = 0;

    this.players.some(pl => {
      if (pl.state !== 0) {
        this.state = 1;
        return true;
      }
      return false;
    });

    this.refreshUserList();

    if (this.state === 0 && this.playing) {
      this.playing = false;
      this.chart = null;
    }
  }

  send(message: GenericMessage) {
    this.players.forEach(pl => {
      pl.send(message);
    });
  }

  sendChat(chatMessage: string) {
    this.players.forEach(pl => {
      pl.sendChat(1, chatMessage, this.name);
    });
  }

  changeOwner() {
    if (this.ops.length > 0) {
      let operatorPlayers = this.players.filter(p =>
        this.ops.find(opUsername => opUsername === p.user)
      );

      this.owner = operatorPlayers[Math.floor(Math.random() * operatorPlayers.length)];
    }

    const auxUserList = this.players.filter(pl => pl.user !== this.owner.user);

    if (auxUserList.length > 0) {
      this.owner = auxUserList[Math.floor(Math.random() * auxUserList.length)];
    }
  }

  canSelect(player: Player) {
    return (
      this.free ||
      player === this.owner ||
      this.ops.some(operatorInList => operatorInList == player.user)
    );
  }

  canStart() {
    let err: string | null = null;
    let nonReady: Player[] = [];

    this.players.forEach(pl => {
      if (pl.state !== 0) {
        nonReady.push(pl);
      }
    });

    if (nonReady.length > 0) {
      err = 'Players ';
      nonReady.forEach(pl => {
        err = err + pl.user + ', ';
      });
      err = `${err.substring(0, err.length - 2)} are busy`;
    }

    return err;
  }

  remove(player: Player) {
    this.players = this.players.filter(x => x.user !== player.user);
  }

  static freeMode(player: Player, command: string, params: string[]) {
    if (player.room) {
      if (
        player.room.owner.user === player.user ||
        player.room.ops.some(operatorInList => operatorInList == player.user)
      ) {
        player.room.free = !player.room.free;
        player.room.sendChat(
          `${systemPrepend}The room is now ${
            player.room.free ? '' : 'not '
          }in free song picking mode`
        );
      } else {
        unauthorizedChat(player, true);
      }
    } else {
      //TODO
    }
  }

  static freeRate(player: Player, command: string, params: string[]) {
    if (!player.room) {
      //TODO
      return;
    }
    if (
      player.room.owner.user == player.user ||
      player.room.ops.some(operatorInList => operatorInList == player.user)
    ) {
      player.room.freerate = !player.room.freerate;

      player.room.sendChat(
        `${systemPrepend}The room is now ${player.room.freerate ? '' : 'not'} rate free mode`
      );
    } else {
      unauthorizedChat(player, true);
    }
  }

  static selectionMode(player: Player, command: string, params: string[]) {
    if (!player.room) {
      //TODO
      return;
    }

    if (player.room.owner.user === player.user) {
      const selectionMode = params[0] ? selectionModes[+params[0]] : null;

      if (!selectionMode) {
        player.sendChat(
          1,
          `${systemPrepend}Invalid selection mode. Valid ones are:\n
              ${JSON.stringify(selectionModeDescriptions, null, 4).replace(/[{}]/g, '')}`,
          player.room.name
        );
      }

      player.room.selectionMode = +params[0];

      player.room.sendChat(
        `${systemPrepend}The room is now in "${
          selectionModeDescriptions[+params[0]]
        }" selection mode`
      );
    } else {
      unauthorizedChat(player);
    }
  }

  static roll(player: Player, command: string, params: string[]) {
    if (params[0]) {
      let rolledNumber = Math.floor(Math.random() * (params[0] - 0) + 0);

      player.room.sendChat(`${systemPrepend}${player.user} rolled ${rolledNumber}`);
    } else {
      player.room.sendChat(
        `${systemPrepend}${player.user} rolled ${Math.floor(Math.random() * 10)}`
      );
    }
  }

  static op(player: Player, command: string, params: string[]) {
    if (!player.room) {
      //TODO
      return;
    }
    if (player.room.owner.user === player.user) {
      if (!player.room.players.find(x => x.user === params[0])) {
        player.room.sendChat(`${systemPrepend}${params[0]} is not in the room!`);
        return;
      }

      if (!player.room.ops.find(x => x === params[0])) {
        player.room.ops.push(params[0]);
        player.room.sendChat(`${systemPrepend}${params[0]} is now a room operator`);
      } else {
        player.room.ops = player.room.ops.filter(x => x !== params[0]);
        player.room.sendChat(`${systemPrepend}${params[0]} is no longer a room operator`);
      }
    } else {
      unauthorizedChat(player);
    }
  }
}
