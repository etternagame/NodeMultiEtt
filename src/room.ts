import Chart from './chart';
import { Player, PLAYING, READY } from './player';

import { ChartMsg, makeMessage, ETTPOutgoingMsg } from './messages';

import {
  colorize,
  selectionModeDescriptions,
  selectionModes,
  stringToColour,
  systemColor,
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

  commonPacksCached: string[] | null;

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
    this.owner = _owner;
    this.players = [_owner];
    _owner.room = this;
    this.forcestart = false;
    this.ops = [];
    this.free = false; // Free decides if only the owner can select charts
    this.countdown = false; // No countdown before song start
    this.countdownStarted = false;
    this.selectionMode = 0; // By filehash+metatadata(2), filehash+metatadata+diff(1) or chartkey(1)
    this.state = SELECTING;
    this.chart = null;
    this.freerate = false; // Free rate decides if only the owner can select the chart rate
    this.playing = false;
    this.timerInterval = 0;
    this.timerLimit = 0;
    this.commonPacksCached = null;
    this.updateStatus();
  }

  isOperator(player: Player) {
    return this.ops.some(operatorInList => operatorInList === player.user);
  }

  isOwner(player: Player) {
    return this.owner.user === player.user;
  }

  isOperatorOrOwner(player: Player) {
    return this.isOwner(player) || this.isOperator(player);
  }

  enableForce(player: Player) {
    if (this.isOperatorOrOwner(player)) {
      if (this.forcestart === true) {
        this.forcestart = false;
        this.sendChat(`${systemPrepend} Force start disabled.`);
      } else {
        this.forcestart = true;
        this.sendChat(`${systemPrepend} Force start enabled for this song.`);
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
      return `${nonReadyPlayers[0].user} is not ready.`;
    }
    return `${Room.playerListToString(nonReadyPlayers)} are not ready.`;
  }

  serializeChart(chart: Chart | null = this.chart) {
    if (!chart) return {};

    const selectionMode: (ch: Chart) => any = selectionModes[this.selectionMode];
    if (!selectionMode) {
      this.sendChat(`${systemPrepend}Invalid selection mode.`);
      return {};
    }

    const selectedChart = selectionMode(chart);

    if (!this.freerate) {
      selectedChart.rate = chart.rate;
    }
    return selectedChart;
  }

  startChart(player: Player, message: ChartMsg) {
    if (this.countdown === true) {
      const err = this.allReady(player);
      if (err) {
        this.sendChat(`${systemPrepend}${err}`);
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
        this.sendChat(`${systemPrepend}Starting ${colorize(this.chart.title, systemColor)}`);

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
        this.sendChat(`${systemPrepend}${err}`);
        return;
      }
      this.players.forEach((p: Player) => {
        p.readystate = false;
      }); // Set everyone back to not ready.
      this.forcestart = false; // Set force back to false

      this.chart = chart;
      this.state = INGAME;

      this.send(makeMessage('startchart', { chart: newChart }));
      this.sendChat(`${systemPrepend}Starting ${colorize(this.chart.title, systemColor)}`);

      this.playing = true;
    }
  }

  commonPacks() {
    if (this.commonPacksCached !== null) return this.commonPacksCached;
    const packArrays = this.players.map(p => p.packs);
    // If called with an empty array reduce errors
    const smallest =
      packArrays.length > 0
        ? packArrays.reduce((prev, curr) => {
            return prev.length > curr.length ? curr : prev;
          })
        : null;
    let result: string[] | null = null;
    if (smallest)
      result = smallest.reduce<string[]>((res, v) => {
        // If the element isnt already in result and is in every pack
        if (
          res.indexOf(v) === -1 &&
          packArrays.every(a => {
            return a.indexOf(v) !== -1;
          })
        )
          res.push(v);
        return res;
      }, []);
    this.commonPacksCached = result || [];
    return this.commonPacksCached;
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

  selectChart(player: Player, message: ChartMsg) {
    this.chart = new Chart(message, player);

    this.send(makeMessage('selectchart', { chart: this.serializeChart() }));
    this.sendChat(
      `${systemPrepend}${player.user} selected ${colorize(
        `${message.title} (${message.difficulty}) ${message.rate ? ` ${
          parseFloat((message.rate / 1000).toFixed(2))}x` : ''} ${
          message.pack ? `[${message.pack}]` : `` } `,
        systemColor
      )}`
    );
  }

  refreshPackList() {
    this.send(
      makeMessage('packlist', {
        commonpacks: this.commonPacks()
      })
    );
  }

  refreshUserList() {
    this.send(
      makeMessage('userlist', {
        players: this.players.map(x => ({
          name: x.user,
          status: x.state + 1,
          ready: x.readystate
        }))
      })
    );
  }

  enter(player: Player) {
    this.commonPacksCached = null;

    player.room = this;

    this.players.push(player);

    player.send(makeMessage('enterroom', { entered: true }));
    this.sendChat(`${systemPrepend}${player.user} joined.`);

    player.state = READY;

    if (this.chart)
      player.send(
        makeMessage('selectchart', {
          chart: this.serializeChart()
        })
      );

    this.refreshUserList();
    this.refreshPackList();
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

  send(message: ETTPOutgoingMsg) {
    this.players.forEach(pl => {
      pl.send(message);
    });
  }

  sendChat(ChatMsg: string) {
    this.players.forEach(pl => {
      pl.sendChat(1, ChatMsg, this.name);
    });
  }

  changeOwner() {
    if (this.ops.length > 0) {
      const operatorPlayers = this.players.filter(p =>
        this.ops.find(opUsername => opUsername === p.user)
      );

      if (operatorPlayers.length > 0) {
        this.owner = operatorPlayers[Math.floor(Math.random() * operatorPlayers.length)];
      }
    }

    const auxUserList = this.players.filter(pl => pl.user !== this.owner.user);

    if (auxUserList.length > 0) {
      this.owner = auxUserList[Math.floor(Math.random() * auxUserList.length)];
    }
  }

  canSelect(player: Player) {
    return this.free || this.isOperatorOrOwner(player);
  }

  canStart(playerWhoSelected: Player) {
    let err: string | null = null;
    const busyPlayers = this.players.filter(p => p.state !== READY);

    if (busyPlayers.length > 0) {
      err = 'Players ';
      busyPlayers.forEach(pl => {
        err = `${err} ${pl.user}, `;
      });
      err = `${err.substring(0, err.length - 2)} ${busyPlayers.length > 1 ? 'are' : 'is'} busy`;
      return err;
    }

    err = this.allReady(playerWhoSelected);

    return err;
  }

  remove(player: Player) {
    this.players = this.players.filter(x => x.user !== player.user);
    this.commonPacksCached = null;
    this.refreshUserList();
    this.refreshPackList();
  }

  toggleFreeMode(player: Player) {
    if (this.isOperatorOrOwner(player)) {
      this.free = !this.free;
      this.sendChat(
        `${systemPrepend}The room is ${this.free ? 'now' : 'no longer'} in free song picking mode.`
      );
    } else {
      unauthorizedChat(player, true);
    }
  }

  freeRate(player: Player) {
    if (this.isOperatorOrOwner(player)) {
      this.freerate = !this.freerate;

      this.sendChat(`${systemPrepend}The room is ${this.freerate ? 'now' : 'no longer'} in rate free mode.`);
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
          `${systemPrepend}Invalid selection mode, ${player.user}. Valid ones are: ${JSON.stringify(
            selectionModeDescriptions, null, 4).replace(/[{}]/g, '')}`,
          this.name
        );
      } else {
        this.selectionMode = +params[0];
        this.sendChat(
          `${systemPrepend}The room is now in "${ selectionModeDescriptions[+params[0]]
          }" selection mode.`
        );
      }
    } else {
      unauthorizedChat(player);
    }
  }

  roll(player: Player, command: string, params: string[]) {
    if (!Number.isNaN(parseInt(params[0], 10))) {
      const rolledNumber = Math.floor(Math.random() * parseInt(params[0], 10));
      this.sendChat(`${systemPrepend}${player.user} rolled ${rolledNumber + 1} (max ${parseInt(params[0],10)}).`);
    } else {
      this.sendChat(`${systemPrepend}${player.user} rolled ${Math.floor(Math.random() * 100) + 1} (max 100).`);
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
        this.sendChat(`${systemPrepend}${params[0]} is now a room operator.`);
      } else {
        this.ops = this.ops.filter(x => x !== params[0]);
        this.sendChat(`${systemPrepend}${params[0]} is no longer a room operator.`);
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
        this.sendChat(`${systemPrepend}Starting in ${currentTimer} seconds.`);

        currentTimer -= 1;
        if (currentTimer === 0) {
          this.sendChat(`${systemPrepend}Starting song.`);
          clearInterval(this.timerInterval);
          this.countdownStarted = false;
          resolve(true);
        }
      }, 1000);
    });
  }

  stopTimer() {
    this.countdownStarted = false;
    this.sendChat(`${systemPrepend}Countdown cancelled!`);
    clearInterval(this.timerInterval);
  }

  enableCountdown(player: Player, command: string, params: string[]) {
    if (this.countdown === true && !params[0]) {
      this.countdown = false;
      this.sendChat(`${systemPrepend}Countdown disabled, songs will start instantly.`);
      return;
    } else if (!params[0] || isNaN(parseInt(params[0])) || parseInt(params[0], 10) < 2 || parseInt(params[0], 10) > 20 ) {
      this.sendChat(`${systemPrepend}Please set a countdown timer between 2 and 20.`);
    } else {
      this.countdown = true;
      this.timerLimit = parseInt(params[0], 10);
      this.sendChat(`${systemPrepend}Countdown of ${params[0]} seconds enabled.`);
    }
  }
}
