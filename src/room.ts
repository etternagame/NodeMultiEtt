/// <reference path="references.ts" />
namespace Room {
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
    chart: Chart.Chart | null;
    free: boolean;
    state: number;
    selectionMode: number;
    owner: Player.Player;
    ops: string[];
    players: Player.Player[];
    constructor(_name: string, _desc: string, _pass: string, _owner: Player.Player) {
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

    serializeChart(chart: Chart.Chart | null = this.chart) {
      if (!chart) return {};

      const selectionMode: (ch: Chart.Chart) => any = Utils.selectionModes[this.selectionMode];
      if (!selectionMode) {
        this.sendChat(`${Utils.systemPrepend}Invalid selection mode`);
        return {};
      }

      const selectedChart = selectionMode(chart);

      if (!this.freerate) {
        selectedChart.rate = chart.rate;
      }
      return selectedChart;
    }

    startChart(player: Player.Player, message: Messages.ChartMessage) {
      let chart: Chart.Chart = new Chart.Chart(message, player);

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

      this.send(Messages.makeMessage('startchart', { chart: newChart }));
      this.sendChat(`${Utils.systemPrepend}Starting ${Utils.colorize(this.chart.title)}`);

      this.playing = true;
    }

    selectChart(player: Player.Player, message: Messages.ChartMessage) {
      this.chart = new Chart.Chart(message, player);

      this.send(Messages.makeMessage('selectchart', { chart: this.serializeChart() }));
      this.sendChat(
        `${Utils.systemPrepend}${player.user} selected ` +
          Utils.colorize(
            `${message.title} (${message.difficulty}: ${message.meter})${
              message.rate ? ` ${parseFloat((message.rate / 1000).toFixed(2))}` : ''
            }`,
            Utils.stringToColour(message.title)
          )
      );
    }

    refreshUserList() {
      this.send(
        Messages.makeMessage('userlist', {
          players: this.players.map(x => ({ name: x.user, status: x.state + 1 }))
        })
      );
    }

    enter(player: Player.Player) {
      player.room = this;

      this.players.push(player);

      player.send(Messages.makeMessage('enterroom', { entered: true }));
      this.sendChat(`${Utils.systemPrepend}${player.user} joined`);

      player.state = 0;

      if (this.chart)
        player.send(Messages.makeMessage('selectchart', { chart: this.serializeChart() }));
    }

    serialize(): Room.SerializedRoom {
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

    send(message: Messages.GenericMessage) {
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

    canSelect(player: Player.Player) {
      return (
        this.free ||
        player === this.owner ||
        this.ops.some(operatorInList => operatorInList == player.user)
      );
    }

    canStart() {
      let err: string | null = null;
      let nonReady: Player.Player[] = [];

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

    remove(player: Player.Player) {
      this.players = this.players.filter(x => x.user !== player.user);
    }
  }
}
