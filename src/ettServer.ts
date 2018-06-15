declare var require: any;
const express = require('express');
const bcrypt = require('bcrypt');
const discord = require('discord.js');
const path = require('path');
const MongoClient = require('mongodb').MongoClient;
const request = require('request');

const saltRounds = 10;

let SocketServer: any = null;

interface ChartMessage {
  title: string;
  subtitle: string;
  artist: string;
  filehash: string;
  chartkey: string;
  rate: number;
  difficulty: number;
  meter: number;
}

interface GenericMessage {
  [key: string]: any;
}

interface ChatMessage {
  msg: string;
  msgtype: number;
  tab: string;
  [key: string]: string | number;
}
interface RoomMessage {
  name: string;
  desc: string;
  pass: string;
}
interface LoginMessage {
  name: string;
  pass: string;
  //Maybe
  desc: string;
}

type Websocket = {
  terminate: () => any;
  on: (event: string, f: any) => any;
  player: Player;
  pingsToAnswer: number;
  _socket: any;
  readyState: number;
  send: (msg: string) => any;
  msgId: number;
  tmpaux: (msg: string) => any;
};
interface WebSocketServer {
  clients: { forEach: (f: (c: Websocket) => any) => any };
  on: any;
}
type MongoDBClient = any;

try {
  SocketServer = require('uws').Server;
} catch (e) {
  console.log('Require uws failed, trying ws');
  SocketServer = require('ws').Server;
}

function makeMessage(type: string, payload: object | null = null) {
  return payload ? { type, payload } : { type };
}

const selectionModeDescriptions: { [index: number]: string } = {
  0: 'By chartkey',
  1: 'By title, subtitle, artist, difficulty meter and filehash',
  2: 'By title, subtitle, artist and filehash'
};

const selectionModes: { [index: number]: (ch: Chart) => object } = {
  0: (ch: Chart) => ({ chartkey: ch.chartkey }),
  1: (ch: Chart) => ({
    title: ch.title,
    subtitle: ch.subtitle,
    artist: ch.artist,
    difficulty: ch.difficulty,
    meter: ch.meter,
    filehash: ch.filehash
  }),
  2: (ch: Chart) => ({
    title: ch.title,
    subtitle: ch.subtitle,
    artist: ch.artist,
    filehash: ch.filehash
  })
};

function removeMultiColor(s: string) {
  return s.replace(/(\|c[0-9A-Fa-f]{7}(\s*))*(\|c[0-9A-Fa-f]{7})/g, '$2$3');
}

function color(c: string) {
  return `|c0${c}`;
}

const systemPrepend = `${color('BBBBFF')}System:${color('FFFFFF')} `;
const ownerColor = 'BBFFBB';
const playerColor = 'AAFFFF';
const opColor = 'FFBBBB';

const stringToColour = function(str: string) {
  let hash = 0;

  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  let colour = '';
  for (let i = 0; i < 3; i++) {
    let value = (hash >> (i * 8)) & 0xff;
    colour += ('00' + value.toString(16)).substr(-2);
  }

  return colour;
};

function colorize(string: string, colour = stringToColour(string)) {
  return color(colour) + string + color('FFFFFF');
}
interface SerializedRoom {
  name: string;
  desc: string;
  players: string[];
  pass: boolean;
  state: number;
}
class Chart {
  title: string;
  subtitle: string;
  artist: string;
  filehash: string;
  pickedBy: string;
  meter: number;
  difficulty: number;
  rate: number;
  chartkey: string;
  constructor(message: ChartMessage, player: Player) {
    this.title = message.title;
    this.subtitle = message.subtitle;
    this.artist = message.artist;
    this.filehash = message.filehash;
    this.chartkey = message.chartkey;
    this.rate = message.rate;
    this.difficulty = message.difficulty;
    this.meter = message.meter;
    this.pickedBy = player.user;
  }
}

class Room {
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
}

class Player {
  user: string;
  pass: string;
  ws: Websocket;
  state: number;
  room: Room | null;
  constructor(_user: string, _pass: string, _ws: Websocket) {
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
        msg: removeMultiColor(`${color('FFFFFF')} ${msgStr} ${color('FFFFFF')} `)
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

class Server {
  playerList: Player[];
  discordChannel: any;
  discordChannelId: string;
  discordGuildId: string;
  discordBotToken: string;
  discordClient: any;
  useDiscord: boolean;
  wss: WebSocketServer;
  globalCommands: {
    [key: string]: (player: Player, command: string, params: string[]) => any;
  };
  roomCommands: {
    [key: string]: (player: Player, command: string, params: string[]) => any;
  };
  currentRooms: Room[];
  serverName: string;
  accountList: { user: string; pass: string }[];
  mongoDBURL: string;
  pingInterval: number;
  logPackets: boolean;
  pingCountToDisconnect: number;
  messageHandlers: { [key: string]: (player: Player, message: GenericMessage) => any };
  dbConnectionFailed: boolean = false;
  db: MongoDBClient;
  mongoDBName: string;
  connectionFailed: boolean = false;
  server: object;
  port: number;
  constructor(params: { [key: string]: any }) {
    // Options
    this.port = params.port || 8765;
    this.logPackets = params.logPackets || false;
    this.mongoDBURL = params.mongoDBURL || '';
    this.mongoDBName = params.mongoDBName || 'ettmulti';
    this.serverName = params.serverName || 'nodeMultiEtt';
    this.pingInterval = params.pingInterval || 15000;
    this.pingCountToDisconnect = params.pingCountToDisconnect || 2;
    this.globalCommands = this.makeGlobalCommands();
    this.roomCommands = this.makeRoomCommands();

    this.messageHandlers = {
      login: params.onLogin || this.onLogin,
      leaveroom: params.onLeaveRoom || this.onLeaveRoom,
      createroom: params.onCreateRoom || this.onCreateRoom,
      enterroom: params.onEnterRoom || this.onEnterRoom,
      ping: params.onPing || this.onPing,
      chat: params.onChat || this.onChat,
      selectchart: params.onSelectChart || this.onSelectChart,
      startchart: params.onStartChart || this.onStartChart,
      gameover: params.onGameOver || this.onGameOver,
      haschart: params.onHasChart || this.onHasChart,
      missingchart: params.onMissingChart || this.onMissingChart,
      startingchart: params.onStartingChart || this.onStartingChart,
      leaveoptions: params.onLeaveOptions || this.onLeaveOptions,
      enteroptions: params.onEnterOptions || this.onEnterOptions,
      logout: params.onLogout || this.onLogout,
      entereval: params.onEnterEval || this.onEnterEval,
      leaveeval: params.onLeaveEval || this.onLeaveEval,
      score: params.onScore || this.onScore
    };

    // server
    this.server = express().listen(this.port, () => console.log(`Listening on ${this.port}`));
    this.wss = new SocketServer({ server: this.server });

    // init member variables
    this.accountList = [];
    this.currentRooms = [];
    this.playerList = [];

    // Setup Discord Bot
    this.discordChannelId = params.channelId || '429399431725580288';
    this.discordGuildId = params.guildId || '339597420239519755';
    this.discordBotToken = params.botToken;
    this.useDiscord = !!(this.discordChannelId && this.discordGuildId && this.discordBotToken);

    if (this.useDiscord) {
      this.discordClient = new discord.Client();
      this.discordClient.login(this.discordBotToken);

      const serv = this;

      this.discordClient.on('ready', () => {
        console.log(`Discord logged in as ${this.discordClient.user.tag}!`);
        serv.discordChannel = serv.discordClient.guilds
          .get(serv.discordGuildId)
          .channels.get(serv.discordChannelId);
      });

      this.discordClient.on('message', (msg: GenericMessage) => {
        if (msg.channel.id !== serv.discordChannelId || msg.author.bot) {
          return;
        }

        serv.wss.clients.forEach((client: Websocket) => {
          client.player.sendChat(
            0,
            `${colorize('Discord')} (${colorize(msg.author.username, playerColor)}): ${
              msg.cleanContent
            }`
          );
        });
      });
    }
  }

  makeGlobalCommands() {
    return {
      pm: (player: Player, command: string, params: string[]) => {
        this.pm(player, params[0], params.slice(1).join(' '));
      }
    };
  }

  makeRoomCommands() {
    return {
      free: (player: Player, command: string, params: string[]) => {
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
            player.room.sendChat(`${systemPrepend}You are not room owner or operator.`);
          }
        } else {
          //TODO
        }
      },
      freerate: (player: Player, command: string, params: string[]) => {
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
          player.room.sendChat(`${systemPrepend}You are not room owner or operator.`);
        }
      },
      selectionMode: (player: Player, command: string, params: string[]) => {
        if (!player.room) {
          //TODO
          return;
        }
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
      },
      op: (player: Player, command: string, params: string[]) => {
        if (!player.room) {
          //TODO
          return;
        }
        if (player.room.owner.user == player.user) {
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
          player.room.sendChat(`${systemPrepend}You are not the room owner.`);
          return;
        }
      }
    };
  }

  addRoom(message: RoomMessage, creator: Player) {
    const room = new Room(message.name, message.desc, message.pass, creator);

    this.currentRooms.push(room);
    room.players.push(creator);

    creator.room = room;

    this.sendAll(makeMessage('newroom', { room: room.serialize() }));
    this.updateRoomState(room);

    return room;
  }

  addPlayer(_user: string, _pass: string, _ws: Websocket) {
    const player = new Player(_user, _pass, _ws);
    this.playerList.push(player);

    return player;
  }

  removePlayer(player: Player) {
    this.leaveRoom(player);
    this.playerList = this.playerList.filter(x => x.user !== player.user);

    player.user = '';
    player.pass = '';
    player.room = null;
  }

  createAccount(player: Player) {
    if (this.db) {
      this.db
        .collection('accounts')
        .insert({ user: player.user, pass: player.pass }, (err: any, records: any) => {
          console.log(`Created account for user ${records.ops[0].user}`);
        });
      return;
    }

    // Don't try to reconnect more than once
    if (this.connectionFailed) return;

    // Reconnect
    MongoClient.connect(this.mongoDBURL, (err: string, client: MongoDBClient) => {
      if (err || !client) {
        this.connectionFailed = true;
        console.log(`mongodb reconnection failed to ${this.mongoDBURL} error: ${err}`);
        return;
      }

      console.log('Reconnected to mongodb');

      // Add new user
      this.db = client.db(this.mongoDBName);

      this.db
        .collection('accounts')
        .insert({ user: player.user, pass: player.pass }, (err: string, records: any) => {
          console.log(`Created account for user ${records.ops[0].user}`);
        });
    });
  }

  leaveRoom(player: Player) {
    const room = player.leaveRoom();

    if (room) {
      if (room.players.length <= 0) {
        // Delete room if empty
        this.currentRooms = this.currentRooms.filter(x => x.name !== room.name);

        // this.resendAllRooms(this.wss);
        this.sendAll(makeMessage('deleteroom', { room: room.serialize() }));
      } else {
        // send notice to players in room that someone left
        room.sendChat(`${systemPrepend}${player.user} left`);
        this.updateRoomState(room);
      }
      player.sendChat(0, `${systemPrepend}Left room ${room.name}`);
    }
  }

  resendAllRooms() {
    const rooms: SerializedRoom[] = this.currentRooms.map(r => r.serialize());
    this.wss.clients.forEach((client: Websocket) => {
      client.player.sendRoomList(rooms);
    });
  }

  sendAll(message: GenericMessage) {
    this.wss.clients.forEach((client: Websocket) => {
      client.player.send(message);
    });
  }

  chatToAll(type: number, message: string, _tab: string = '') {
    this.wss.clients.forEach((client: Websocket) => {
      client.player.sendChat(type, message, _tab);
    });
  }

  loadAccounts() {
    MongoClient.connect(this.mongoDBURL, (err: string, client: MongoDBClient) => {
      if (err || !client) {
        this.dbConnectionFailed = true;
        console.log(`mongodb connection failed to ${this.mongoDBURL} error: ${err}`);
        return;
      }

      console.log('Connected to mongodb');

      this.db = client.db(this.mongoDBName);
      const collection = this.db.collection('accounts');

      collection.find().forEach((account: { user: string; pass: string }) => {
        this.accountList.push(account);
      });
    });
  }

  start() {
    this.db = null;
    this.dbConnectionFailed = false;
    this.loadAccounts();

    this.wss.on('connection', (ws: Websocket) => {
      ws.tmpaux = ws.send;

      // If I don't check readystate sometimes it crashes
      if (this.logPackets) {
        ws.send = (str: string) => {
          if (ws.readyState === 1) {
            ws.tmpaux(str);
            console.log(`out: ${str}`);
          } else {
            console.log(`Connection closed so msg not sent: ${str}`);
          }
        };
      } else {
        ws.send = (str: string) => {
          if (ws.readyState === 1) {
            ws.tmpaux(str);
          } else {
            console.log(`Connection closed so msg not sent: ${str}`);
          }
        };
      }

      console.log(`Client connected (${ws._socket.remoteAddress})`);
      ws.player = this.addPlayer('', '', ws);

      // Send server version and name
      ws.player.send(makeMessage('hello', { version: 1, name: this.serverName }));

      /* Ignore first interval (This way the first ping check will be in PINGINTERVAL * 2,
      / this is because we don't know when the connection starts in the interval
      / (Could be anywhere below PINGINTERVAL))
      */
      ws.pingsToAnswer = 0;
      ws.msgId = 0;

      ws.player.sendRoomList(this.currentRooms.map(r => r.serialize()));

      ws.on('close', () => {
        console.log(`Client disconnected (${ws._socket.remoteAddress})`);
        this.removePlayer(ws.player);
      });

      ws.on('message', (strMessage: string) => {
        if (this.logPackets) {
          console.log(`in: ${strMessage}`);
        }

        let message = JSON.parse(strMessage);
        const handler = this.messageHandlers[message.type];

        if (handler) {
          handler.call(this, ws.player, message.payload);
        }
      });
    });
    if (this.pingInterval > 0) this.startPinging();
  }

  startPinging() {
    setInterval(() => {
      this.wss.clients.forEach((ws: Websocket) => {
        if (ws.pingsToAnswer >= this.pingCountToDisconnect) {
          console.log(
            `Terminating connection(${ws._socket.remoteAddress}) because ping was not answered`
          );

          return ws.terminate();
        }

        if (this.logPackets) {
          ws.player.send(makeMessage('ping'));
        }

        ws.pingsToAnswer = ws.pingsToAnswer + 1;
      });
    }, this.pingInterval);
  }

  onLogout(player: Player) {
    //TODO
  }

  onSelectChart(player: Player, message: ChartMessage) {
    if (!player.room) {
      player.sendChat(0, `${systemPrepend}You're not in a room`);
      return;
    }
    if (!player.room.canSelect(player)) {
      player.sendChat(
        1,
        `${systemPrepend}You don't have the rights to select a chart!`,
        player.room.name
      );
      return;
    }
    player.room.selectChart(player, message);
  }

  onStartChart(player: Player, message: ChartMessage) {
    if (!player.room) {
      player.sendChat(0, `${systemPrepend}You're not in a room`);
      return;
    }
    if (!player.room || !player.room.canSelect(player)) {
      player.sendChat(
        1,
        `${systemPrepend}You don't have the rights to start a chart!`,
        player.room.name
      );

      return;
    }

    let err = player.room.canStart();

    if (!err) {
      player.room.startChart(player, message);
      this.sendAll(makeMessage('updateroom', { room: player.room.serialize() }));
    } else {
      player.room.sendChat(`${systemPrepend}Cant start (${err})`);
    }
  }

  onLogin(player: Player, message: GenericMessage) {
    if (!message.user || !message.pass) {
      player.send(
        makeMessage('login', { logged: false, msg: 'Missing/Empty username or password' })
      );
      return;
    }

    if (message.user.length < 4 || message.pass.length < 4) {
      player.send(
        makeMessage('login', {
          logged: false,
          msg: 'Username or password must have more than 3 characters'
        })
      );
      return;
    }

    if (player.user) {
      this.removePlayer(player);
    }

    if (this.playerList.find(x => x.user === message.user)) {
      player.send(
        makeMessage('login', { logged: false, msg: `${message.user} is already logged in` })
      );

      return;
    }

    if (!this.mongoDBURL) {
      const serv = this;

      request.post(
        {
          url: 'https://api.etternaonline.com/v1/login',
          form: { username: message.user, password: message.pass }
        },
        (error: any, response: { statusCode: number }, body: string) => {
          if (response && response.statusCode == 200) {
            if (JSON.parse(body).success === 'Valid') {
              player.user = message.user;
              player.pass = message.pass;

              player.sendChat(0, `Welcome to ${colorize(serv.serverName)}`);
              player.send(makeMessage('login', { logged: true, msg: '' }));

              return;
            }
          }

          player.send(
            makeMessage('login', {
              logged: false,
              msg: 'Wrong username or password'
            })
          );
        }
      );
    } else {
      const foundUser = this.accountList.find(x => x.user === message.user);

      if (foundUser) {
        bcrypt.compare(message.pass, foundUser.pass).then((res: boolean) => {
          if (res === true) {
            player.user = message.user;
            player.pass = message.pass;
            player.sendChat(0, `Welcome to ${colorize(this.serverName)}`);
            player.send(makeMessage('login', { logged: true, msg: '' }));
          } else {
            player.send(
              makeMessage('login', {
                logged: false,
                msg: 'username already taken or wrong password'
              })
            );
          }
        });
      } else {
        // New account
        player.user = message.user;
        bcrypt.hash(message.pass, saltRounds, (err: string, hash: string) => {
          player.pass = hash;
          this.createAccount(player);
          player.sendChat(0, `Welcome to ${colorize(this.serverName)}`);
          player.send(makeMessage('login', { logged: true, msg: '' }));
        });
      }
    }
  }

  onLeaveRoom(player: Player, message: RoomMessage) {
    if (!player.user) {
      return;
    }
    this.leaveRoom(player);
  }

  onHasChart(player: Player, message: ChartMessage) {}

  onStartingChart(player: Player, message: ChartMessage) {
    player.state = 1;
    this.updateRoomState(player.room);
  }

  onEnterOptions(player: Player, message: GenericMessage) {
    player.state = 3;
    this.updateRoomState(player.room);
  }

  onLeaveOptions(player: Player, message: GenericMessage) {
    player.state = 0;
    this.updateRoomState(player.room);
  }
  onEnterEval(player: Player, message: GenericMessage) {
    player.state = 2;
    this.updateRoomState(player.room);
  }

  onLeaveEval(player: Player, message: GenericMessage) {
    player.state = 0;
    this.updateRoomState(player.room);
  }

  updateRoomState(room: Room | null) {
    if (!room) return;
    let oldState = room.state;
    room.updateStatus();
    if (oldState !== room.state) {
      this.sendAll(makeMessage('updateroom', { room: room.serialize() }));
    }
  }

  onGameOver(player: Player, message: GenericMessage) {
    player.state = 0;
    this.updateRoomState(player.room);
  }

  onScore(player: Player, message: GenericMessage) {
    if (!player.user || !player.room) {
      return;
    }

    player.room.send(makeMessage('score', { name: player.user, score: message }));
  }
  onMissingChart(player: Player, message: GenericMessage) {
    if (!player.user || !player.room) return;
    if (player.room) player.room.sendChat(`${systemPrepend}${player.user} doesnt have the chart`);
  }

  onCreateRoom(player: Player, message: RoomMessage) {
    if (!player.user) {
      return;
    }

    this.leaveRoom(player);
    const existingRoom = this.currentRooms.find(x => x.name === message.name);

    if (!existingRoom) {
      player.room = this.addRoom(message, player);
      player.send(makeMessage('createroom', { created: true }));
      player.sendChat(1, `${systemPrepend} Created room "${message.name}"`, message.name);
    } else {
      player.send(makeMessage('createroom', { created: false }));
      player.sendChat(0, `${systemPrepend}Room name already in use`);
    }
  }

  enterRoom(player: Player, room: Room) {
    room.enter(player);
    this.sendAll(makeMessage('updateroom', { room: room.serialize() }));
  }

  onEnterRoom(player: Player, message: LoginMessage) {
    if (!player.user) {
      return;
    }

    this.leaveRoom(player);
    const room = this.currentRooms.find(x => x.name === message.name);

    if (room)
      if (!room.pass || room.pass === message.pass) {
        this.enterRoom(player, room);
      } else {
        player.send(makeMessage('enterroom', { entered: false }));
        player.sendChat(0, `${systemPrepend}Incorrect password`);
      }
    else {
      player.room = this.addRoom(message, player);
      player.send(makeMessage('enterroom', { entered: true }));
    }
  }

  onPing(player: Player, message: GenericMessage) {
    if (player.ws.pingsToAnswer > 0) {
      player.ws.pingsToAnswer = player.ws.pingsToAnswer - 1;
    }
  }

  onCommand(player: Player, message: GenericMessage, commandName: string, params: string[]) {
    if (player.room) {
      let command = this.roomCommands[commandName];
      if (command) {
        command(player, commandName, params);
        return true;
      }
    }

    let command = this.globalCommands[commandName];

    if (command) {
      command(player, commandName, params);
      return true;
    }
    return false;
  }

  onChat(player: Player, message: ChatMessage) {
    if (!player.user) {
      return;
    }

    if (message.msg.startsWith('/')) {
      let params = message.msg.split(' ');
      let command = params[0].substring(1);

      params = params.slice(1);

      if (this.onCommand(player, message, command, params)) {
        return;
      }
    }

    switch (message.msgtype) {
      case 0: // lobby (everyone)
        this.wss.clients.forEach((client: Websocket) => {
          client.player.sendChat(0, `${colorize(player.user, playerColor)}: ${message.msg}`);
        });

        if (this.useDiscord) {
          this.discordChannel.send(`${player.user}: ${message.msg}`);
        }

        break;
      case 1: // room (people in room)
        if (!player.room || player.room.name !== message.tab) {
          player.sendChat(1, `${systemPrepend}You're not in the room ${message.tab}`, message.tab);
          return;
        }
        let r = player.room;
        player.room.players.forEach((pl: Player) => {
          pl.sendChat(
            1,
            `${colorize(
              player.user,
              player.user === r.owner.user
                ? ownerColor
                : r.ops.find((x: string) => x === player.user) ? opColor : playerColor
            )}: ${message.msg}`,
            message.tab
          );
        });

        break;
      case 2: // pm (tabname=user to send to)
        this.pm(player, message.tab, message.msg);
        break;
    }
  }

  pm(player: Player, receptorName: string, msg: string) {
    const playerToSendTo = this.playerList.find(x => x.user === receptorName);
    if (!playerToSendTo) {
      player.sendChat(0, `${systemPrepend}Could not find user ${receptorName}`);
    } else {
      playerToSendTo.sendChat(2, `${player.user}: ${msg}`, player.user);
      player.sendChat(2, `${player.user}: ${msg}`, receptorName);
    }
  }
}

declare var module: any;
module.exports = {
  Server,
  Room,
  Player
};
