import Chart from './chart';
import { Player, PLAYING, READY } from './player';

import { ChartMessage, GenericMessage, makeMessage } from './messages';

import {
  colorize,
  selectionModeDescriptions,
  selectionModes,
  stringToColour,
  systemPrepend,
  unauthorizedChat
} from './utils';

export interface SerializedRoom {
  name: string;
  desc: string;
  players: string[];
  pass: boolean;
  state: number;
}

export const SELECTING = 0;
export const INGAME = 1;

export class Room {
  name: string;

  desc: string;

  pass: string;

  freerate: boolean;

  forcestart: boolean;

  playing: boolean;

  chart: Chart | null;

  free: boolean;

  state: number;

  selectionMode: number;

  owner: Player;

  ops: string[];

  players: Player[];

  timerInterval: any;

  countdown: boolean;

  countdownStarted: boolean;

  timerLimit: number;

  constructor(_name: string, _desc: string, _pass: string, _owner: Player) {
    this.name = _name;
    this.desc = _desc;
    this.pass = _pass;
    this.players = [];
    this.forcestart = false;
    this.owner = _owner;
    this.ops = [];
    this.free = false; // Free decides if only the owner can select charts
    this.countdown = false; // No countdown before song start
    this.countdownStarted = false;
    this.selectionMode = 0; // By metadata(0), filehash(1) or chartkey(2)
    this.state = SELECTING;
    this.chart = null;
    this.freerate = false; // Free rate decides if only the owner can select the chart rate
    this.playing = false;
    this.timerInterval = 0;
    this.timerLimit = 0;
  }

  enableForce(player: Player) {
    if (!player.room) {
      // TODO
      return;
    }

    if (
      player.room.owner.user === player.user ||
      player.room.ops.some(operatorInList => operatorInList === player.user)
    ) {
      if (this.forcestart === true) {
        this.forcestart = false;
        this.sendChat(`${systemPrepend} force start disabled.`);
      } else {
        this.forcestart = true;
        this.sendChat(`${systemPrepend} force start enabled for this song.`);
      }
    } else {
      unauthorizedChat(player, true);
    }
  }

  playersWhoNeedToReady(playerWhoSelected: Player): Array<Player> {
    const nonReadyPlayers = this.players.filter(
      (player: Player) => player.readystate !== true && player.user !== playerWhoSelected.user
    );
    return nonReadyPlayers;
  }

  static playerListToString(players: Array<Player>) {
    if (players.length === 1) {
      return players[0].user;
    }
    if (players.length === 2) {
      return `${players[0].user} and ${players[1].user}`;
    }
    if (players.length > 1) {
      const usernames = players.map(p => p.user);
      return [usernames.slice(0, -1).join(', '), usernames.slice(-1)[0]].join(
        usernames.length < 2 ? '' : ' and '
      );
    }

    return '';
  }

  allReady(playerWhoSelected: Player) {
    const nonReadyPlayers: Array<Player> = this.playersWhoNeedToReady(playerWhoSelected);
    if (this.forcestart || nonReadyPlayers.length === 0) {
      return null;
    }
    if (nonReadyPlayers.length === 1) {
      return `${systemPrepend} ${nonReadyPlayers[0].user} is not ready.`;
    }
    return `${systemPrepend} ${Room.playerListToString(nonReadyPlayers)} are not ready.`;
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
    if (this.countdown === true) {
      const err = this.allReady(player);
      if (err) {
        this.sendChat(err);
        return;
      }
      this.players.forEach((p: Player) => {
        p.readystate = false;
      }); // Set everyone back to not ready.
      this.forcestart = false; // Set force back to false
      Promise.resolve(this.startTimer(this.timerLimit)).then(() => {
        const chart: Chart = new Chart(message, player);

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
        this.state = INGAME;

        this.send(makeMessage('startchart', { chart: newChart }));
        this.sendChat(`${systemPrepend}Starting ${colorize(this.chart.title)}`);

        this.playing = true;
      });
    } else {
      const chart: Chart = new Chart(message, player);

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
      const err = this.allReady(player);
      if (err) {
        this.sendChat(err);
        return;
      }
      this.players.forEach((p: Player) => {
        p.readystate = false;
      }); // Set everyone back to not ready.
      this.forcestart = false; // Set force back to false

      this.chart = chart;
      this.state = INGAME;

      this.send(makeMessage('startchart', { chart: newChart }));
      this.sendChat(`${systemPrepend}Starting ${colorize(this.chart.title)}`);

      this.playing = true;
    }
  }

  onGameplayUpdate() {
    this.send(
      makeMessage('leaderboard', {
        scores: this.players
          .filter(p => p.state === PLAYING)
          .map(p => {
            p.gameplayState.user = p.user;
            return p.gameplayState;
          })
      })
    );
  }

  selectChart(player: Player, message: ChartMessage) {
    this.chart = new Chart(message, player);

    this.send(makeMessage('selectchart', { chart: this.serializeChart() }));
    this.sendChat(
      `${systemPrepend}${player.user} selected ${colorize(
        `${message.title} (${message.difficulty}: ${message.meter})${
          message.rate ? ` ${parseFloat((message.rate / 1000).toFixed(2))}` : ''
        }`,
        stringToColour(message.title)
      )}`
    );
  }

  refreshUserList() {
    this.send(
      makeMessage('userlist', {
        players: this.players.map(x => ({ name: x.user, status: x.state + 1, ready: x.readystate }))
      })
    );
  }

  enter(player: Player) {
    player.room = this;

    this.players.push(player);

    player.send(makeMessage('enterroom', { entered: true }));
    this.sendChat(`${systemPrepend}${player.user} joined`);

    player.state = READY;

    if (this.chart) player.send(makeMessage('selectchart', { chart: this.serializeChart() }));

    this.refreshUserList();
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
    this.state = SELECTING;

    this.players.some(pl => {
      if (pl.state !== READY) {
        this.state = INGAME;
        return true;
      }
      return false;
    });

    this.refreshUserList();

    if (this.state === SELECTING && this.playing) {
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
      const operatorPlayers = this.players.filter(p =>
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
      this.ops.some(operatorInList => operatorInList === player.user)
    );
  }

  canStart(playerWhoSelected: Player) {
    let err: string | null = null;
    const busyPlayers = this.players.filter(p => p.state !== READY);

    if (busyPlayers.length > 0) {
      err = 'Players ';
      busyPlayers.forEach(pl => {
        err = `${err} ${pl.user}, `;
      });
      err = `${err.substring(0, err.length - 2)} are busy`;
    }

    err = this.allReady(playerWhoSelected);
    if (err) {
      err = `${err} ${err.length > 1 ? 'are' : 'is'} busy`;
    }

    return err;
  }

  remove(player: Player) {
    this.players = this.players.filter(x => x.user !== player.user);
  }

  toggleFreeMode(player: Player) {
    if (
      this.owner.user === player.user ||
      this.ops.some(operatorInList => operatorInList === player.user)
    ) {
      this.free = !this.free;
      this.sendChat(
        `${systemPrepend}The room is now ${this.free ? '' : 'not '}in free song picking mode`
      );
    } else {
      unauthorizedChat(player, true);
    }
  }

  freeRate(player: Player) {
    if (
      this.owner.user === player.user ||
      this.ops.some(operatorInList => operatorInList === player.user)
    ) {
      this.freerate = !this.freerate;

      this.sendChat(`${systemPrepend}The room is now ${this.freerate ? '' : 'not'} rate free mode`);
    } else {
      unauthorizedChat(player, true);
    }
  }

  selectionModeCommand(player: Player, command: string, params: string[]) {
    if (this.owner.user === player.user) {
      const selectionMode = params[0] ? selectionModes[+params[0]] : null;

      if (!selectionMode) {
        player.sendChat(
          1,
          `${systemPrepend}Invalid selection mode. Valid ones are:\n
              ${JSON.stringify(selectionModeDescriptions, null, 4).replace(/[{}]/g, '')}`,
          this.name
        );
      }

      this.selectionMode = +params[0];

      this.sendChat(
        `${systemPrepend}The room is now in "${
          selectionModeDescriptions[+params[0]]
        }" selection mode`
      );
    } else {
      unauthorizedChat(player);
    }
  }

  roll(player: Player, command: string, params: string[]) {
    if (!Number.isNaN(parseInt(params[0], 10))) {
      const rolledNumber = Math.floor(Math.random() * parseInt(params[0], 10));

      this.sendChat(`${systemPrepend}${player.user} rolled ${rolledNumber}`);
    } else {
      this.sendChat(`${systemPrepend}${player.user} rolled ${Math.floor(Math.random() * 10)}`);
    }
  }

  op(player: Player, command: string, params: string[]) {
    if (this.owner.user === player.user) {
      if (!this.players.find(x => x.user === params[0])) {
        this.sendChat(`${systemPrepend}${params[0]} is not in the room!`);
        return;
      }

      if (!this.ops.find(x => x === params[0])) {
        this.ops.push(params[0]);
        this.sendChat(`${systemPrepend}${params[0]} is now a room operator`);
      } else {
        this.ops = this.ops.filter(x => x !== params[0]);
        this.sendChat(`${systemPrepend}${params[0]} is no longer a room operator`);
      }
    } else {
      unauthorizedChat(player);
    }
  }

  startTimer(limit: number) {
    if (this.countdownStarted === true) {
      return false;
    }

    this.countdownStarted = !this.countdownStarted;

    return new Promise(resolve => {
      let currentTimer: number = limit;

      this.timerInterval = setInterval(() => {
        this.sendChat(`${systemPrepend}Starting in ${currentTimer} seconds`);

        currentTimer -= 1;
        if (currentTimer === 0) {
          this.sendChat(`${systemPrepend}Starting song in ${currentTimer} seconds`);
          clearInterval(this.timerInterval);
          this.countdownStarted = false;
          resolve(true);
        }
      }, 1000);
    });
  }

  stopTimer() {
    this.countdownStarted = false;
    this.sendChat(`${systemPrepend}Song start cancelled!`);
    clearInterval(this.timerInterval);
  }

  enableCountdown(player: Player, command: string, params: string[]) {
    if (this.countdown === true) {
      this.countdown = false;
      this.sendChat(`${systemPrepend}Countdown disabled, songs will start instantly`);
      return;
    }

    if (!params[0]) {
      this.sendChat(`${systemPrepend}Please set a countdown timer between 2 and 15`);
    } else {
      this.countdown = !this.countdown;
      this.timerLimit = parseInt(params[0], 10);
    }
  }
}
