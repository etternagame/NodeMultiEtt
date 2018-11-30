import { createLogger, format, transports } from 'winston';

import Chart from './chart';
import { NOTREADY, Player, PLAYING, READY } from './player';

import { ChartMessage, GenericMessage, makeMessage, PRIVATE_MESSAGE } from './messages';

import {
  colorize,
  playerColor,
  selectionModeDescriptions,
  selectionModes,
  stringToColour,
  systemPrepend,
  unauthorizedChat
} from './utils';

const logger = createLogger({
  format: format.simple(),
  transports: [new transports.Console()]
});

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

  checkPlayersReady(playerWhoSelected: Player): Array<Player> {
    const nonReadyPlayers = this.players.filter(
      (player: Player) => player.readystate !== true && player.user !== playerWhoSelected.user
    );
    return nonReadyPlayers;
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
    if (!this.forcestart) {
      const nonReadyPlayers: Array<Player> = this.checkPlayersReady(player);

      if (nonReadyPlayers.length === 1) {
        this.sendChat(`${systemPrepend} ${nonReadyPlayers[0].user} is not ready.`);
        return;
      } else if (nonReadyPlayers.length === 2) {
        this.sendChat(
          `${systemPrepend} ${nonReadyPlayers[0].user} and ${
            nonReadyPlayers[1].user
          } are not ready.`
        );
      } else if (nonReadyPlayers.length > 1) {
        this.sendChat(
          `${systemPrepend} ${nonReadyPlayers.map(p => p.user).join(', ')} are not ready.`
        );
        return;
      }
    }

    this.players.forEach((p: Player) => {
      p.readystate = false;
    }); // Set everyone back to not ready.

    this.forcestart = false; // Set force back to false

    if (this.countdown === true) {
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
        players: this.players.map(x => ({ name: x.user, status: x.state + 1 }))
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

  canStart() {
    let err: string | null = null;
    const nonReady: Player[] = [];

    this.players.forEach(pl => {
      if (pl.state !== READY) {
        nonReady.push(pl);
      }
    });

    if (nonReady.length > 0) {
      err = 'Players ';
      nonReady.forEach(pl => {
        err = `${err} ${pl.user}, `;
      });
      err = `${err.substring(0, err.length - 2)} are busy`;
    }

    return err;
  }

  remove(player: Player) {
    this.players = this.players.filter(x => x.user !== player.user);
  }

  static freeMode(player: Player) {
    if (player.room) {
      if (
        player.room.owner.user === player.user ||
        player.room.ops.some(operatorInList => operatorInList === player.user)
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
      // TODO
    }
  }

  static freeRate(player: Player) {
    if (!player.room) {
      // TODO
      return;
    }
    if (
      player.room.owner.user === player.user ||
      player.room.ops.some(operatorInList => operatorInList === player.user)
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
      // TODO
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
    if (!player.room) {
      // TODO
      return;
    }

    if (!Number.isNaN(parseInt(params[0], 10))) {
      const rolledNumber = Math.floor(Math.random() * parseInt(params[0], 10));

      player.room.sendChat(`${systemPrepend}${player.user} rolled ${rolledNumber}`);
    } else {
      player.room.sendChat(
        `${systemPrepend}${player.user} rolled ${Math.floor(Math.random() * 10)}`
      );
    }
  }

  static op(player: Player, command: string, params: string[]) {
    if (!player.room) {
      // TODO
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

  static playerShrugs(player: Player) {
    if (!player.room) {
      logger.error(`Trying to send shrug for roomless player ${player.user}`);
      return;
    }
    player.room.sendChat(`${colorize(player.user, playerColor)}: ¯\\_(ツ)_/¯`);
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

  static stopTimer(player: Player) {
    if (!player.room) {
      logger.error(`Trying to stop timer for roomless player ${player.user}`);
      return;
    }

    player.room.countdownStarted = false;

    player.room.sendChat(`${systemPrepend}Song start cancelled!`);
    clearInterval(player.room.timerInterval);
  }

  static help(player: Player) {
    if (!player.room) {
      logger.error(`Trying to get help for a roomless player ${player.user}`);
      return;
    }

    const helpMessage = `
      Commands:\n
        /free - Enable free mode allows anyone to choose a chart (Privileged)\n
        /freerate - Enable free rate allowing people to play any rate the want (Privileged)\n
        /op - Give a player operator privileges, gives them access to privileged commands (Privileged)\n 
        /countdown - Enable a countdown before starting the chart (Privileged)\n
        /stop - Stop the current countdown (Privileged)\n
        /shrug - Our favorite little emoji\n
        /roll - Roll a random number, you can specify a limit i.e. roll 1442\n
        /help - This command right here!
    `;

    player.sendChat(PRIVATE_MESSAGE, helpMessage);
  }

  static enableCountdown(player: Player, command: string, params: string[]) {
    if (!player.room) {
      logger.error(`Trying to enable countdown for roomless player ${player.user}`);
      return;
    }
    if (player.room.countdown === true) {
      player.room.countdown = false;
      player.room.sendChat(`${systemPrepend}Countdown disabled, songs will start instantly`);
      return;
    }

    if (!params[0]) {
      player.room.sendChat(`${systemPrepend}Please set a countdown timer between 2 and 15`);
    } else {
      player.room.countdown = !player.room.countdown;
      player.room.timerLimit = parseInt(params[0], 10);
    }
  }
}
