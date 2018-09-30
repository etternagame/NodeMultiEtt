import * as wsD from 'ws';
import * as bcrypt from 'bcrypt';
import * as mongodbD from 'mongodb';
import { Player } from './player';

import { Room, SerializedRoom } from './room';

import { colorize, opColor, ownerColor, playerColor, systemPrepend } from './utils';

import {
  makeMessage,
  GenericMessage,
  RoomMessage,
  ChartMessage,
  ChatMessage,
  LoginMessage
} from './messages';

const express = require('express');
const discord = require('discord.js');
const request = require('request');

// Bcrypt default salt rounds
const saltRounds = 10;

let SocketServer: any = null;

try {
  SocketServer = require('uws').Server;
} catch (e) {
  console.log('Require uws failed, trying ws');
  SocketServer = require('ws').Server;
}

type ETTMessage = (player: Player, message: GenericMessage) => void;

export interface EWebSocket extends wsD {
  msgId: number;
  tmpaux(data: any, cb?: (err: Error) => void): void;
  _socket: any;
  pingsToAnswer: number;
  player: Player;
}

export interface EWebSocketServer extends wsD.Server {
  clients: Set<EWebSocket>;
}

export interface ETTHandlers {
  onStartChart: ETTMessage;
  onStartingChart: ETTMessage;
  onMissingChart: ETTMessage;
  onHasChart: ETTMessage;
  onSelectChart: ETTMessage;
  onGameOver: ETTMessage;
  onPing: ETTMessage;
  onChat: ETTMessage;
  onEnterOptions: ETTMessage;
  onLeaveOptions: ETTMessage;
  onLogin: ETTMessage;
  onLogout: ETTMessage;
  onLeaveRoom: ETTMessage;
  onEnterRoom: ETTMessage;
  onCreateRoom: ETTMessage;
  onScore: ETTMessage;
  onLeaveEval: ETTMessage;
  onEnterEval: ETTMessage;
}

export interface ETTParams {
  handlers: ETTHandlers | any;
  port: number | null;
  logPackets: boolean | null;
  mongoDBURL: string | null;
  mongoDBName: string | null;
  serverName: string | null;
  pingInterval: number | null;
  pingCountToDisconnect: number | null;
  discord:
    | {
        guildId: string;
        channelId: string;
        botToken: string;
      }
    | any;
}

export class ETTServer {
  playerList: Player[];
  discordChannel: any;
  discordChannelId: string;
  discordGuildId: string;
  discordBotToken: string;
  discordClient: any;
  useDiscord: boolean;
  wss: EWebSocketServer;
  globalCommands: {
    [key: string]: (player: Player, command: string, params: string[]) => void;
  };
  roomCommands: {
    [key: string]: (player: Player, command: string, params: string[]) => void;
  };
  currentRooms: Room[];
  serverName: string;
  accountList: { user: string; pass: string }[];
  mongoDBURL: string;
  pingInterval: number;
  logPackets: boolean;
  pingCountToDisconnect: number;
  messageHandlers: {
    [key: string]: ETTMessage;
  };
  dbConnectionFailed: boolean = false;
  db: mongodbD.Db | null = null;
  mongoDBName: string;
  connectionFailed: boolean = false;
  server: object;
  port: number; //{ [key: string]: any }
  constructor(params: ETTParams) {
    // Options
    if (!params.discord) params.discord = {};
    if (!params.handlers) params.handlers = {};
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
      login: params.handlers.onLogin || this.onLogin,
      leaveroom: params.handlers.onLeaveRoom || this.onLeaveRoom,
      createroom: params.handlers.onCreateRoom || this.onCreateRoom,
      enterroom: params.handlers.onEnterRoom || this.onEnterRoom,
      ping: params.handlers.onPing || this.onPing,
      chat: params.handlers.onChat || this.onChat,
      selectchart: params.handlers.onSelectChart || this.onSelectChart,
      startchart: params.handlers.onStartChart || this.onStartChart,
      gameover: params.handlers.onGameOver || this.onGameOver,
      haschart: params.handlers.onHasChart || this.onHasChart,
      missingchart: params.handlers.onMissingChart || this.onMissingChart,
      startingchart: params.handlers.onStartingChart || this.onStartingChart,
      leaveoptions: params.handlers.onLeaveOptions || this.onLeaveOptions,
      enteroptions: params.handlers.onEnterOptions || this.onEnterOptions,
      logout: params.handlers.onLogout || this.onLogout,
      entereval: params.handlers.onEnterEval || this.onEnterEval,
      leaveeval: params.handlers.onLeaveEval || this.onLeaveEval,
      score: params.handlers.onScore || this.onScore
    };

    // server
    this.server = express().listen(this.port, () => console.log(`Listening on ${this.port}`));
    this.wss = new SocketServer({ server: this.server });

    // init member variables
    this.accountList = [];
    this.currentRooms = [];
    this.playerList = [];

    // Setup Discord Bot
    this.discordChannelId = params.discord.channelId || '429399431725580288';
    this.discordGuildId = params.discord.guildId || '339597420239519755';
    this.discordBotToken = params.discord.botToken;
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

        serv.wss.clients.forEach((client: EWebSocket) => {
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
      shrug: (player: Player, command: string, params: string[]) => {
        Room.playerShrugs(player, command, params);
      },
      countdown: (player: Player, command: string, params: string[]) => {
        Room.enableCountdown(player, command, params);
      },
      stop: (player: Player, command: string, params: string[]) => {
        Room.stopTimer(player);
      },
      free: (player: Player, command: string, params: string[]) => {
        Room.freeMode(player, command, params);
      },
      freerate: (player: Player, command: string, params: string[]) => {
        Room.freeRate(player, command, params);
      },
      selectionMode: (player: Player, command: string, params: string[]) => {
        Room.selectionMode(player, command, params);
      },
      roll: (player: Player, command: string, params: string[]) => {
        Room.roll(player, command, params);
      },
      op: (player: Player, command: string, params: string[]) => {
        Room.op(player, command, params);
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

  addPlayer(_user: string, _pass: string, _ws: EWebSocket) {
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
    mongodbD.MongoClient.connect(this.mongoDBURL, (err, client) => {
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
        .insert({ user: player.user, pass: player.pass }, (err, records) => {
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
    this.wss.clients.forEach(client => {
      client.player.sendRoomList(rooms);
    });
  }

  sendAll(message: GenericMessage) {
    this.wss.clients.forEach(client => {
      client.player.send(message);
    });
  }

  chatToAll(type: number, message: string, _tab: string = '') {
    this.wss.clients.forEach(client => {
      client.player.sendChat(type, message, _tab);
    });
  }

  loadAccounts() {
    mongodbD.MongoClient.connect(this.mongoDBURL, (err, client) => {
      if (err || !client) {
        this.dbConnectionFailed = true;
        console.log(`mongodb connection failed to ${this.mongoDBURL} error: ${err}`);
        return;
      }

      console.log('Connected to mongodb');

      this.db = client.db(this.mongoDBName);
      const collection = this.db.collection('accounts');

      collection.find().forEach(
        (account: { user: string; pass: string }) => {
          this.accountList.push(account);
        },
        function(err) {
          // done or error
        }
      );
    });
  }

  start() {
    this.db = null;
    this.dbConnectionFailed = false;
    this.loadAccounts();

    this.wss.on('connection', (ws: EWebSocket) => {
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
      this.wss.clients.forEach(ws => {
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
        makeMessage('login', {
          logged: false,
          msg: 'Missing/Empty username or password'
        })
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
        makeMessage('login', {
          logged: false,
          msg: `${message.user} is already logged in`
        })
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
        bcrypt.hash(message.pass, saltRounds, (err: Error, hash: string) => {
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

    if (!message.name) {
      player.sendChat(0, `${systemPrepend}Cannot use empty room name`);
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
      let command = this.roomCommands[commandName.toLocaleLowerCase()];
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
        this.wss.clients.forEach(client => {
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
