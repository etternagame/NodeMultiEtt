import * as wsD from "uws";
import * as bcrypt from 'bcrypt';
import * as mongodbD from 'mongodb';
import * as express from 'express';
import * as discord from 'discord.js';
import * as request from 'request';
import { createLogger, format, transports } from 'winston';

import { Player, OPTIONS, READY, PLAYING, EVAL } from './player';

import { Room, SerializedRoom } from './room';

import { colorize, opColor, ownerColor, playerColor, systemPrepend } from './utils';

import {
  ROOM_MESSAGE,
  LOBBY_MESSAGE,
  PRIVATE_MESSAGE,
  makeMessage,
  RoomMsg,
  ETTPMsgHandlers,
  ScoreMsg,
  GameplayUpdateMsg,
  ChartMsg,
  LoginMsg,
  HelloMsg,
  ChatMsg,
  ETTPOutgoingMsg,
  EnterRoomMsg,
  ETTPIncomingMsg
} from './messages';
import { Int32 } from 'bson';

// Bcrypt default salt rounds
const saltRounds = 10;

const logger = createLogger({
  format: format.simple(),
  transports: [new transports.Console()]
});

let SocketServer: any = null;

// TODO make these use import
try {
  // eslint-disable-next-line global-require
  SocketServer = require('uws').Server;
} catch (e) {
  logger.warn(`Require uws failed, trying ws (${JSON.stringify(e)}`);
  // eslint-disable-next-line global-require
  SocketServer = require('ws').Server;
}

export interface EWebSocket extends wsD {
  msgId: number;
  tmpaux(data: any, cb?: (err?: Error) => void): void;
  _socket: any;
  pingsToAnswer: number;
  player: Player;
}

export interface EWebSocketServer extends wsD.Server {
  clients: EWebSocket[];
}

export interface ETTParams {
  handlers: ETTPMsgHandlers | any;
  allowAccountCreation: boolean | null;
  port: number | null;
  logPackets: boolean | null;
  mongoDBURL: string | null;
  ip: string | undefined;
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
    [key: string]: (player: Player, command: string, params: string[], msg: ChatMsg) => void;
  };

  roomCommands: {
    [key: string]: (
      player: Player,
      room: Room,
      command: string,
      params: string[],
      msg: ChatMsg
    ) => void;
  };

  currentRooms: Room[];

  serverName: string;

  accountList: { user: string; pass: string }[];

  mongoDBURL: string;

  pingInterval: number;

  logPackets: boolean;

  pingCountToDisconnect: number;

  globalPermissions: { [key: string]: [string] };

  messageHandlers: ETTPMsgHandlers;

  dbConnectionFailed: boolean = false;

  allowAccountCreation: boolean = false;

  db: mongodbD.Db | null = null;

  mongoDBName: string;

  connectionFailed: boolean = false;

  server: object;

  port: number;

  // { [key: string]: any }
  constructor(params: ETTParams) {
    // Options
    if (!params.discord) params.discord = {};
    if (!params.handlers) params.handlers = {};
    this.port = params.port || 8765;
    this.logPackets = params.logPackets || false;
    this.mongoDBURL = params.mongoDBURL || '';
    this.mongoDBName = params.mongoDBName || 'ettmulti';
    this.serverName = params.serverName || 'nodeMultiEtt';
    this.allowAccountCreation = params.allowAccountCreation || false;
    this.pingInterval = params.pingInterval || 15000;
    this.pingCountToDisconnect = params.pingCountToDisconnect || 2;
    this.globalCommands = this.makeGlobalCommands();
    this.roomCommands = this.makeRoomCommands();
    this.globalPermissions = {};

    this.messageHandlers = {
      hello: params.handlers.hello || this.onHello,
      login: params.handlers.login || this.onLogin,
      leaveroom: params.handlers.leaveroom || this.onLeaveRoom,
      createroom: params.handlers.createroom || this.onCreateRoom,
      enterroom: params.handlers.enterroom || this.onEnterRoom,
      ping: params.handlers.ping || ETTServer.onPing,
      chat: params.handlers.chat || this.onChat,
      selectchart: params.handlers.selectchart || ETTServer.onSelectChart,
      startchart: params.handlers.startchart || this.onStartChart,
      gameover: params.handlers.gameover || this.onGameOver,
      haschart: params.handlers.haschart || ETTServer.onHasChart,
      missingchart: params.handlers.missingchart || ETTServer.onMissingChart,
      startingchart: params.handlers.startingchart || this.onStartingChart,
      leaveoptions: params.handlers.leaveoptions || this.onLeaveOptions,
      enteroptions: params.handlers.enteroptions || this.onEnterOptions,
      logout: params.handlers.logout || this.onLogout,
      entereval: params.handlers.entereval || this.onEnterEval,
      gameplayupdate: params.handlers.gameplayupdate || ETTServer.onGameplayUpdate,
      leaveeval: params.handlers.leaveeval || this.onLeaveEval,
      score: params.handlers.score || ETTServer.onScore
    };

    // server
    const app = express();
    app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'X-Requested-With,Upgrade-Insecure-Requests');
      res.header('Access-Control-Allow-Methods', 'PUT,POST,GET,DELETE,HEAD,OPTIONS');
      next();
    });
    if (!params.ip)
      this.server = app.listen(this.port, () => logger.info(`Listening on ${this.port}`));
    else
      this.server = app.listen(this.port, params.ip, () =>
        logger.info(`Listening on ${this.port}`)
      );
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
        logger.info(`Discord logged in as ${this.discordClient.user.tag}!`);
        serv.discordChannel = serv.discordClient.guilds
          .get(serv.discordGuildId)
          .channels.get(serv.discordChannelId);
      });
      this.discordClient.on('error', console.error);

      this.discordClient.on('message', (msg: discord.Message) => {
        if (msg.channel.id !== serv.discordChannelId || msg.author.bot) {
          return;
        }

        serv.wss.clients.forEach((client: EWebSocket) => {
          client.player.sendChat(
            LOBBY_MESSAGE,
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
      },
      wave: (player: Player, command: string, params: string[], msg: ChatMsg) => {
        this.onChat(player, {
          msg: '( * ^ *) ノシ',
          tab: msg.tab,
          msgtype: msg.msgtype
        });
      },
      shrug: (player: Player, command: string, params: string[], msg: ChatMsg) => {
        this.onChat(player, {
          msg: '¯\\_(ツ)_/¯',
          tab: msg.tab,
          msgtype: msg.msgtype
        });
      },
      help: (player: Player) => {
        const helpMessage = `Commands:\n
        /free - Enable free mode allows anyone to choose a chart (Privileged)\n
        /freerate - Enable free rate allowing people to play any rate the want (Privileged)\n
        /op - Give a player operator privileges, gives them access to privileged commands (Privileged)\n 
        /countdown - Enable a countdown before starting the chart (Privileged)\n
        /stop - Stop the current countdown (Privileged)\n
        /shrug - Our favorite little emoji\n
        /roll - Roll a random number, you can specify a limit i.e. roll 1442\n
        /help - This command right here!`;
        // We send each line separetely because the client chatbox gets fucky with newlines in msgs
        helpMessage.split('\n').forEach(l => player.sendChat(PRIVATE_MESSAGE, l));
      },
      request: (player: Player, command: string, params: string[]) => {
        this.requestChart(player, params);
      }
    };
  }

  makeRoomCommands() {
    return {
      ready: (player: Player) => {
        player.toggleReady();
      },
      commonpacks: (player: Player, room: Room, command: string, params: string[]) => {
        const commonPacks = room.commonPacks();
        if (commonPacks.length > 0) room.sendChat(`Common packs: ${commonPacks.join(',')}`);
        else room.sendChat(`No pack in common between the players in the room :(`);
      },
      countdown: (player: Player, room: Room, command: string, params: string[]) => {
        room.enableCountdown(player, command, params);
      },
      desc: (player: Player, room: Room, command: string, [desc]: string[]) => {
        if (room.isOwner(player)) {
          room.desc = desc;
          this.updateRoom(room);
          room.sendChat('');
          room.sendChat(`${systemPrepend}${player.user} changed the room description to ${desc}`);
        } else {
          player.sendChat(
            ROOM_MESSAGE,
            `${systemPrepend}${
              player.user
            }, you're not the room owner so you cannot change the description`,
            room.name
          );
        }
      },
      title: (player: Player, room: Room, command: string, [title]: string[]) => {
        if (room.isOwner(player)) {
          room.name = title;
          this.updateRoom(room);
          room.sendChat('');
          room.sendChat(`${systemPrepend}${player.user} renamed the room to ${title}`);
        } else {
          player.sendChat(
            ROOM_MESSAGE,
            `${systemPrepend}${
              player.user
            }, you're not the room owner so you cannot change the title`,
            room.name
          );
        }
      },
      pass: (player: Player, room: Room, command: string, [pass]: string[]) => {
        if (room.isOwner(player)) {
          room.pass = pass;
          this.updateRoom(room);
          room.sendChat('');
          room.sendChat(`${systemPrepend}${player.user} changed the room password`);
        } else {
          player.sendChat(
            ROOM_MESSAGE,
            `${systemPrepend}${
              player.user
            }, you're not the room owner so you cannot change the password`,
            room.name
          );
        }
      },
      kick: (player: Player, room: Room, command: string, [user]: string[]) => {
        const playerToKick = this.findUser(user);
        if (playerToKick) {
          const isOp = room.isOperator(player);
          const isOwner = room.isOwner(player);
          const playerToKickIsOp = room.isOwner(playerToKick);
          if (isOwner || (isOp && !playerToKickIsOp)) {
            this.leaveRoom(playerToKick);
            room.sendChat(`${systemPrepend}${playerToKick.user} was kicked`);
            playerToKick.sendChat(ROOM_MESSAGE, `${systemPrepend}You have been kicked`, room.name);
            playerToKick.send(makeMessage('kicked'));
          } else {
            player.sendChat(
              ROOM_MESSAGE,
              `${systemPrepend}${player.user},  you have insufficient rights to kick ${
                playerToKick.user
              }`,
              room.name
            );
          }
        } else {
          player.sendChat(
            ROOM_MESSAGE,
            `${systemPrepend}${
              player.user
            }, you're not the room owner so you cannot change the password`,
            room.name
          );
        }
      },
      force: (player: Player, room: Room) => {
        room.enableForce(player);
      },
      stop: (player: Player, room: Room) => {
        room.stopTimer();
      },
      free: (player: Player, room: Room) => {
        room.toggleFreeMode(player);
      },
      freerate: (player: Player, room: Room) => {
        room.freeRate(player);
      },
      selectionMode: (player: Player, room: Room, command: string, params: string[]) => {
        room.selectionModeCommand(player, command, params);
      },
      roll: (player: Player, room: Room, command: string, params: string[]) => {
        room.roll(player, command, params);
      },
      op: (player: Player, room: Room, command: string, params: string[]) => {
        room.op(player, command, params);
      }
    };
  }

  addRoom(message: RoomMsg, creator: Player) {
    const room = new Room(message.name, message.desc, message.pass, creator);
    this.currentRooms.push(room);

    this.sendAll(makeMessage('newroom', { room: room.serialize() }));

    return room;
  }

  addPlayer(_user: string, _pass: string, _ws: EWebSocket) {
    const player = new Player(_user, _pass, _ws);
    this.playerList.push(player);

    return player;
  }

  removePlayer(player: Player) {
    this.removePlayerInLobbyLists(player);
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
        .insertOne({ user: player.user, pass: player.pass }, (err, records) => {
          if (err) {
            logger.error(
              `Failed mongodb insertion: ${err.name} : ${err.message} (For ${player.user})`
            );
          } else {
            logger.info(`Created account for user ${records.ops[0].user}`);
          }
        });
      return;
    }

    // Don't try to reconnect more than once
    if (this.connectionFailed) return;

    // Reconnect
    mongodbD.MongoClient.connect(
      this.mongoDBURL,
      (err, client) => {
        if (err || !client) {
          this.connectionFailed = true;
          logger.error(`mongodb reconnection failed to ${this.mongoDBURL} error: ${err}`);
          return;
        }

        logger.debug('Reconnected to mongodb');

        // Add new user
        this.db = client.db(this.mongoDBName);

        this.db
          .collection('accounts')
          .insertOne({ user: player.user, pass: player.pass }, (error, records) => {
            if (err) {
              logger.error(
                `Failed mongodb insertion: ${error.name} : ${error.message} (For ${player.user})`
              );
            } else {
              logger.info(`Created account for user ${records.ops[0].user}`);
            }
          });
      }
    );
  }

  leaveRoom(player: Player) {
    const room = player.leaveRoom();

    if (!room) return;
    if (room.players.length <= 0) {
      // Delete room if empty
      this.currentRooms = this.currentRooms.filter(x => x.name !== room.name);
      this.sendAll(makeMessage('deleteroom', { room: room.serialize() }));
    } else {
      // send notice to players in room that someone left
      room.sendChat(`${systemPrepend}${player.user} left`);
      this.updateRoom(room);
    }
    player.sendChat(LOBBY_MESSAGE, `${systemPrepend}Left room ${room.name}`);
  }

  resendAllRooms() {
    const rooms: SerializedRoom[] = this.currentRooms.map(r => r.serialize());
    this.wss.clients.forEach(client => {
      client.player.sendRoomList(rooms);
    });
  }

  sendAll(message: ETTPOutgoingMsg) {
    this.wss.clients.forEach(client => {
      client.player.send(message);
    });
  }

  chatToAll(type: number, message: string, _tab: string = '') {
    this.wss.clients.forEach(client => {
      client.player.sendChat(type, message, _tab);
    });
  }

  findUser(username: string) {
    const lowerUsername = username.toLowerCase();
    return this.playerList.find(x => x.user.toLowerCase() === lowerUsername);
  }

  loadAccounts() {
    mongodbD.MongoClient.connect(
      this.mongoDBURL,
      (err, client) => {
        if (err || !client) {
          this.dbConnectionFailed = true;
          logger.error(`mongodb connection failed to ${this.mongoDBURL} error: ${err}`);
          return;
        }

        logger.info('Connected to mongodb');

        this.db = client.db(this.mongoDBName);
        const collection = this.db.collection('accounts');
        collection.createIndex({ user: 'text' }, { unique: true, name: 'username' });
        // Both the collection and index are created if they dont exist (idempotent operations)

        collection.find().forEach(
          (account: { user: string; pass: string }) => {
            this.accountList.push(account);
          },
          error => {
            logger.error(error);
          }
        );
        this.db
          .collection<{ [key: string]: [string] }>('globalPermissions')
          .find()
          .close()
          .then(perms => {
            this.globalPermissions = perms;
          });
      }
    );
  }

  async userExistsInDB(username: string): Promise<boolean | null> {
    if (this.db) {
      return this.db.collection('accounts').findOne({ user: username });
    }
    return false;
  }

  start() {
    this.db = null;
    this.dbConnectionFailed = false;
    this.loadAccounts();
    this.wss.on('error', console.error);
    this.wss.on('connection', (ws: EWebSocket) => {
      ws.tmpaux = ws.send;

      // If I don't check readystate sometimes it crashes
      if (this.logPackets) {
        ws.send = (str: string) => {
          if (ws.readyState === 1) {
            ws.tmpaux(str);
            logger.debug(`out: ${str}`);
          } else {
            logger.debug(`Connection closed so msg not sent: ${str}`);
          }
        };
      } else {
        ws.send = (str: string) => {
          if (ws.readyState === 1) {
            ws.tmpaux(str);
          } else {
            logger.debug(`Connection closed so msg not
ent: ${str}`);
          }
        };
      }

      // eslint-disable-next-line no-underscore-dangle
      logger.info(`Client connected (${ws._socket.remoteAddress})`);
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
        // eslint-disable-next-line no-underscore-dangle
        logger.info(`Client disconnected (${ws._socket.remoteAddress})`);
        this.removePlayer(ws.player);
      });

      ws.on('message', (strMessage: string) => {
        if (this.logPackets) {
          logger.debug(`in: ${strMessage}`);
        }

        // TODO: Validate json input here before casting?
        const message: ETTPIncomingMsg = JSON.parse(strMessage);
        const msgtype = message.type;
        const handler = this.messageHandlers[msgtype];

        if (handler) {
          handler.call(this, ws.player, message.payload);
        } else {
          logger.error(`Unknown ETTP msg type: ${msgtype}`);
        }
      });
    });
    if (this.pingInterval > 0) this.startPinging();
  }

  startPinging() {
    setInterval(() => {
      this.wss.clients.forEach(ws => {
        if (ws.pingsToAnswer >= this.pingCountToDisconnect) {
          logger.debug(
            // eslint-disable-next-line no-underscore-dangle
            `Terminating connection(${ws._socket.remoteAddress}) because ping was not answered`
          );
          this.removePlayer(ws.player);
          return ws.terminate();
        }

        if (this.logPackets) {
          ws.player.send(makeMessage('ping'));
        }

        ws.pingsToAnswer += 1;
        return true;
      });
    }, this.pingInterval);
  }

  onLogout(player: Player) {
    this.removePlayer(player);
  }

  static onSelectChart(player: Player, message: ChartMsg) {
    if (!player.room) {
      player.sendPM(`${systemPrepend}You're not in a room`);
      return;
    }
    if (!player.room.canSelect(player)) {
      player.sendChat(
        ROOM_MESSAGE,
        `${systemPrepend}You don't have the rights to select a chart!`,
        player.room.name
      );
      return;
    }
    player.room.selectChart(player, message);
  }

  sendLobbyList(player: Player) {
    player.send(
      makeMessage('lobbyuserlist', {
        users: this.playerList.map(p => p.user)
      })
    );
  }

  removePlayerInLobbyLists(player: Player) {
    this.playerList.forEach(p =>
      p.send(makeMessage('lobbyuserlistupdate', { off: [player.user] }))
    );
  }

  addPlayerInLobbyLists(player: Player) {
    this.playerList.forEach(p => p.send(makeMessage('lobbyuserlistupdate', { on: [player.user] })));
  }

  onStartChart(player: Player, message: ChartMsg) {
    if (!player.room) {
      player.sendPM(`${systemPrepend}You're not in a room`);
      return;
    }
    if (!player.room.canSelect(player)) {
      player.sendChat(
        ROOM_MESSAGE,
        `${systemPrepend}You don't have the rights to start a chart!`,
        player.room.name
      );

      return;
    }

    const err = player.room.canStart(player);

    if (!err) {
      player.room.startChart(player, message);
      this.sendAll(makeMessage('updateroom', { room: player.room.serialize() }));
    } else {
      player.room.sendChat(`${systemPrepend}Can't start (${err})`);
    }
  }

  static onGameplayUpdate(player: Player, message: GameplayUpdateMsg) {
    player.gameplayState.wife = message.wife;
    player.gameplayState.jdgstr = message.jdgstr;
    if (player.room) player.room.onGameplayUpdate();
  }

  onHello(player: Player, message: HelloMsg) {
    player.ettpcver = parseInt(message.version) || 0;
    player.client = message.client || '';
    const packs = message.packs;
    if (Array.isArray(packs)) player.packs = packs;
    else player.packs = [];
  }

  onLogin(player: Player, message: LoginMsg) {
    if (!message.user || !message.pass) {
      player.send(
        makeMessage('login', {
          logged: false,
          msg: 'Missing/Empty username or password'
        })
      );
      return;
    }

    const maxLength = 256;
    const minLength = 2;
    const passLength = message.pass.length;
    const userLength = message.user.length;
    if (
      userLength <= minLength ||
      userLength >= maxLength ||
      passLength <= minLength ||
      passLength >= maxLength
    ) {
      player.send(
        makeMessage('login', {
          logged: false,
          msg: `Username and password must have more than ${minLength} characters and less than ${maxLength}`
        })
      );
      return;
    }
    if (
      message.user.includes(' ') ||
      message.user.includes('::') ||
      message.user.includes('\n') ||
      message.user.includes('\t')
    ) {
      player.send(
        makeMessage('login', {
          logged: false,
          msg: `Usernames cannot contain whitespace`
        })
      );
      return;
    }

    if (player.user) {
      this.removePlayer(player);
    }

    if (this.findUser(message.user)) {
      player.send(
        makeMessage('login', {
          logged: false,
          msg: `${message.user} is already logged in`
        })
      );

      return;
    }

    if (!this.mongoDBURL) {
      this.EOLogin(player, message);
    } else {
      const foundUser = this.findUser(message.user);

      if (foundUser) {
        bcrypt.compare(message.pass, foundUser.pass).then((res: boolean) => {
          if (res === true) {
            player.user = message.user;
            player.pass = message.pass;
            player.sendChat(LOBBY_MESSAGE, `Welcome to ${colorize(this.serverName)}`);
            player.send(makeMessage('login', { logged: true, msg: '' }));
            this.sendLobbyList(player);
            this.addPlayerInLobbyLists(player);
          } else {
            player.send(
              makeMessage('login', {
                logged: false,
                msg: 'username already taken or wrong password'
              })
            );
          }
        });
      } else if (this.allowAccountCreation) {
        // New account
        player.user = message.user;
        bcrypt.hash(message.pass, saltRounds, (err: Error, hash: string) => {
          player.pass = hash;
          this.createAccount(player);
          player.sendChat(LOBBY_MESSAGE, `Welcome to ${colorize(this.serverName)}`);
          player.send(makeMessage('login', { logged: true, msg: '' }));
          this.sendLobbyList(player);
          this.addPlayerInLobbyLists(player);
        });
      } else {
        this.EOLogin(player, message);
      }
    }
  }

  EOLogin(player: Player, { user, pass }: LoginMsg) {
    request.post(
      {
        url: 'https://api.etternaonline.com/v1/login',
        form: { username: user, password: pass }
      },
      (error: any, response: { statusCode: number }, body: string) => {
        if (response && response.statusCode === 200) {
          if (JSON.parse(body).success === 'Valid') {
            player.user = user;
            player.pass = pass;

            player.sendChat(LOBBY_MESSAGE, `Welcome to ${colorize(this.serverName)}`);
            player.send(makeMessage('login', { logged: true, msg: '' }));
            this.sendLobbyList(player);
            this.addPlayerInLobbyLists(player);

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
  }

  onLeaveRoom(player: Player) {
    if (!player.user) {
      return;
    }
    this.leaveRoom(player);
  }

  static onHasChart() {}

  onStartingChart(player: Player) {
    player.state = PLAYING;
    this.updateRoomState(player.room);
  }

  onEnterOptions(player: Player) {
    player.state = OPTIONS;
    this.updateRoomState(player.room);
  }

  onLeaveOptions(player: Player) {
    player.state = READY;
    this.updateRoomState(player.room);
  }

  onEnterEval(player: Player) {
    player.state = EVAL;
    this.updateRoomState(player.room);
  }

  onLeaveEval(player: Player) {
    player.state = READY;
    this.updateRoomState(player.room);
  }

  updateRoom(room: Room) {
    this.sendAll(makeMessage('updateroom', { room: room.serialize() }));
  }

  updateRoomState(room: Room | null) {
    if (!room) return;
    const oldState = room.state;
    room.updateStatus();
    if (oldState !== room.state) {
      this.updateRoom(room);
    }
  }

  onGameOver(player: Player) {
    player.state = READY;
    this.updateRoomState(player.room);
  }

  static onScore(player: Player, message: ScoreMsg) {
    if (!player.user || !player.room) {
      return;
    }

    player.room.send(makeMessage('score', { name: player.user, score: message }));
  }

  static onMissingChart(player: Player) {
    if (!player.user || !player.room) return;
    if (player.room) {
      player.room.sendChat(`${systemPrepend}${player.user} doesnt have the chart`);
    }
  }

  onCreateRoom(player: Player, message: RoomMsg) {
    if (!player.user) {
      return;
    }

    if (!message.name) {
      player.sendChat(LOBBY_MESSAGE, `${systemPrepend}Cannot use empty room name`);
      return;
    }

    this.leaveRoom(player);
    const existingRoom = this.currentRooms.find(x => x.name === message.name);

    if (!existingRoom) {
      player.send(makeMessage('createroom', { created: true }));
      player.room = this.addRoom(message, player);
      player.state = READY;
      player.sendChat(
        ROOM_MESSAGE,
        `${systemPrepend} Created room "${message.name}"`,
        message.name
      );
      player.readystate = false;
    } else {
      player.send(makeMessage('createroom', { created: false }));
      player.sendChat(LOBBY_MESSAGE, `${systemPrepend}Room name already in use`);
    }
  }

  enterRoom(player: Player, room: Room) {
    room.enter(player);
    this.sendAll(makeMessage('updateroom', { room: room.serialize() }));
    room.refreshUserList();
  }

  onEnterRoom(player: Player, message: EnterRoomMsg) {
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
        player.sendChat(LOBBY_MESSAGE, `${systemPrepend}Incorrect password`);
      }
    else {
      player.readystate = false;
      if (!message.desc) message.desc = '';
      player.room = this.addRoom(<RoomMsg>message, player);
      player.send(makeMessage('enterroom', { entered: true }));
    }
  }

  static onPing(player: Player) {
    if (player.ws.pingsToAnswer > 0) {
      player.ws.pingsToAnswer -= 1;
    }
  }

  onCommand(player: Player, message: ChatMsg, _commandName: string, params: string[]) {
    const commandName = _commandName.toLocaleLowerCase();
    if (player.room) {
      const command = this.roomCommands[commandName];
      if (command) {
        command(player, player.room, commandName, params, message);
        return true;
      }
    }

    const command = this.globalCommands[commandName];

    if (command) {
      command(player, commandName, params, message);
      return true;
    }
    return false;
  }

  static getUserColor(player: Player, room: Room) {
    if (room.isOwner(player)) {
      return ownerColor;
    }
    if (room.ops.find((x: string) => x === player.user)) {
      return opColor;
    }
    return playerColor;
  }

  onChat(player: Player, message: ChatMsg) {
    if (!player.user) {
      return;
    }

    // We strip newlines so they're not abused
    // For some reason stepmania parses '::' as newlines
    message.msg = message.msg.replace('\n', '').replace('::', '');

    if (message.msg.startsWith('/')) {
      let params = message.msg.split(' ');
      const command = params[0].substring(1);

      params = params.slice(1);

      if (this.onCommand(player, message, command, params)) {
        return;
      }
    }

    switch (message.msgtype) {
      case LOBBY_MESSAGE: // lobby (everyone)
        this.wss.clients.forEach(client => {
          client.player.sendChat(
            LOBBY_MESSAGE,
            `${colorize(player.user, playerColor)}: ${message.msg}`
          );
        });

        if (this.useDiscord) {
          this.discordChannel.send(`${player.user}: ${message.msg}`);
        }
        break;
      case ROOM_MESSAGE: {
        // room (people in room)
        if (!player.room || player.room.name !== message.tab) {
          player.sendChat(
            ROOM_MESSAGE,
            `${systemPrepend}You're not in the room ${message.tab}`,
            message.tab
          );
          return;
        }
        const r = player.room;

        const userColor = ETTServer.getUserColor(player, r);

        player.room.players.forEach((pl: Player) => {
          pl.sendChat(
            ROOM_MESSAGE,
            `${colorize(player.user, userColor)}: ${message.msg}`,
            message.tab
          );
        });

        break;
      }
      case PRIVATE_MESSAGE: // pm (tabname=user to send to)
        this.pm(player, message.tab, message.msg);
        break;
      default:
        logger.error(`Unknown chat msg type: ${message.msgtype}`);
        break;
    }
  }

  userNotFoundOnlineHandler(sender: Player, reciever: string) {
    this.userExistsInDB(reciever).then(exists => {
      if (exists) sender.sendPM(`${systemPrepend}User ${reciever} is offline`);
      else sender.sendPM(`${systemPrepend}User ${reciever} doesn't exist`);
    });
  }

  userHasPemission(player: Player, permission: string) {
    const allowedUsers = this.globalPermissions[permission];
    return allowedUsers && allowedUsers.find(usr => usr === player.user);
  }

  // Handles chart request commands
  requestChart(player: Player, params: string[]) {
    if (!this.userHasPemission(player, 'chartRequesting')) {
      player.sendChat(
        PRIVATE_MESSAGE,
        `${systemPrepend}You are not allowed to send chart requests. Contact a server admin`
      );
      return;
    }
    const recieverName = params[0];
    const chartkey = params[1];
    const rate = params[2] || 1000;
    const requester = params[3] || player.user;

    const playerToSendTo = this.findUser(recieverName);
    if (!playerToSendTo) {
      this.userNotFoundOnlineHandler(player, recieverName);
    } else {
      playerToSendTo.send(makeMessage('chartrequest', { requester, chartkey, rate }));
    }
  }

  // Handles pm commands
  pm(player: Player, receptorName: string, msg: string) {
    const playerToSendTo = this.findUser(receptorName);
    if (!playerToSendTo) {
      player.sendPM(`${systemPrepend}Could not find user ${receptorName}`);
    } else {
      playerToSendTo.sendChat(PRIVATE_MESSAGE, `${player.user}: ${msg}`, player.user);
      player.sendChat(PRIVATE_MESSAGE, `${player.user}: ${msg}`, receptorName);
    }
  }
}
