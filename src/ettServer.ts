/// <reference path="references.ts" />
declare function require(name: string): any;
declare var module: any;
const express = require('express');
const bcrypt = require('bcrypt');
const discord = require('discord.js');
const path = require('path');
const MongoClient = require('mongodb').MongoClient;
const request = require('request');
namespace ETTServer {
  const saltRounds = 10;

  let SocketServer: any = null;

  export interface Websocket {
    terminate: () => any;
    on: (event: string, f: any) => any;
    player: Player.Player;
    pingsToAnswer: number;
    _socket: any;
    readyState: number;
    send: (msg: string) => any;
    msgId: number;
    tmpaux: (msg: string) => any;
  }
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

  export class Server {
    playerList: Player.Player[];
    discordChannel: any;
    discordChannelId: string;
    discordGuildId: string;
    discordBotToken: string;
    discordClient: any;
    useDiscord: boolean;
    wss: WebSocketServer;
    globalCommands: {
      [key: string]: (player: Player.Player, command: string, params: string[]) => any;
    };
    roomCommands: {
      [key: string]: (player: Player.Player, command: string, params: string[]) => any;
    };
    currentRooms: Room.Room[];
    serverName: string;
    accountList: { user: string; pass: string }[];
    mongoDBURL: string;
    pingInterval: number;
    logPackets: boolean;
    pingCountToDisconnect: number;
    messageHandlers: {
      [key: string]: (player: Player.Player, message: Messages.GenericMessage) => any;
    };
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

        this.discordClient.on('message', (msg: Messages.GenericMessage) => {
          if (msg.channel.id !== serv.discordChannelId || msg.author.bot) {
            return;
          }

          serv.wss.clients.forEach((client: Websocket) => {
            client.player.sendChat(
              0,
              `${Utils.colorize('Discord')} (${Utils.colorize(
                msg.author.username,
                Utils.playerColor
              )}): ${msg.cleanContent}`
            );
          });
        });
      }
    }

    makeGlobalCommands() {
      return {
        pm: (player: Player.Player, command: string, params: string[]) => {
          this.pm(player, params[0], params.slice(1).join(' '));
        }
      };
    }

    makeRoomCommands() {
      return {
        free: (player: Player.Player, command: string, params: string[]) => {
          if (player.room) {
            if (
              player.room.owner.user === player.user ||
              player.room.ops.some(operatorInList => operatorInList == player.user)
            ) {
              player.room.free = !player.room.free;
              player.room.sendChat(
                `${Utils.systemPrepend}The room is now ${
                  player.room.free ? '' : 'not '
                }in free song picking mode`
              );
            } else {
              player.room.sendChat(`${Utils.systemPrepend}You are not room owner or operator.`);
            }
          } else {
            //TODO
          }
        },
        freerate: (player: Player.Player, command: string, params: string[]) => {
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
              `${Utils.systemPrepend}The room is now ${
                player.room.freerate ? '' : 'not'
              } rate free mode`
            );
          } else {
            player.room.sendChat(`${Utils.systemPrepend}You are not room owner or operator.`);
          }
        },
        selectionMode: (player: Player.Player, command: string, params: string[]) => {
          if (!player.room) {
            //TODO
            return;
          }
          const selectionMode = params[0] ? Utils.selectionModes[+params[0]] : null;

          if (!selectionMode) {
            player.sendChat(
              1,
              `${Utils.systemPrepend}Invalid selection mode. Valid ones are:\n
              ${JSON.stringify(Utils.selectionModeDescriptions, null, 4).replace(/[{}]/g, '')}`,
              player.room.name
            );
          }

          player.room.selectionMode = +params[0];

          player.room.sendChat(
            `${Utils.systemPrepend}The room is now in "${
              Utils.selectionModeDescriptions[+params[0]]
            }" selection mode`
          );
        },
        op: (player: Player.Player, command: string, params: string[]) => {
          if (!player.room) {
            //TODO
            return;
          }
          if (player.room.owner.user == player.user) {
            if (!player.room.players.find(x => x.user === params[0])) {
              player.room.sendChat(`${Utils.systemPrepend}${params[0]} is not in the room!`);
              return;
            }

            if (!player.room.ops.find(x => x === params[0])) {
              player.room.ops.push(params[0]);
              player.room.sendChat(`${Utils.systemPrepend}${params[0]} is now a room operator`);
            } else {
              player.room.ops = player.room.ops.filter(x => x !== params[0]);
              player.room.sendChat(
                `${Utils.systemPrepend}${params[0]} is no longer a room operator`
              );
            }
          } else {
            player.room.sendChat(`${Utils.systemPrepend}You are not the room owner.`);
            return;
          }
        }
      };
    }

    addRoom(message: Messages.RoomMessage, creator: Player.Player) {
      const room = new Room.Room(message.name, message.desc, message.pass, creator);

      this.currentRooms.push(room);
      room.players.push(creator);

      creator.room = room;

      this.sendAll(Messages.makeMessage('newroom', { room: room.serialize() }));
      this.updateRoomState(room);

      return room;
    }

    addPlayer(_user: string, _pass: string, _ws: Websocket) {
      const player = new Player.Player(_user, _pass, _ws);
      this.playerList.push(player);

      return player;
    }

    removePlayer(player: Player.Player) {
      this.leaveRoom(player);
      this.playerList = this.playerList.filter(x => x.user !== player.user);

      player.user = '';
      player.pass = '';
      player.room = null;
    }

    createAccount(player: Player.Player) {
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

    leaveRoom(player: Player.Player) {
      const room = player.leaveRoom();

      if (room) {
        if (room.players.length <= 0) {
          // Delete room if empty
          this.currentRooms = this.currentRooms.filter(x => x.name !== room.name);

          // this.resendAllRooms(this.wss);
          this.sendAll(Messages.makeMessage('deleteroom', { room: room.serialize() }));
        } else {
          // send notice to players in room that someone left
          room.sendChat(`${Utils.systemPrepend}${player.user} left`);
          this.updateRoomState(room);
        }
        player.sendChat(0, `${Utils.systemPrepend}Left room ${room.name}`);
      }
    }

    resendAllRooms() {
      const rooms: Room.SerializedRoom[] = this.currentRooms.map(r => r.serialize());
      this.wss.clients.forEach((client: Websocket) => {
        client.player.sendRoomList(rooms);
      });
    }

    sendAll(message: Messages.GenericMessage) {
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
        ws.player.send(Messages.makeMessage('hello', { version: 1, name: this.serverName }));

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
            ws.player.send(Messages.makeMessage('ping'));
          }

          ws.pingsToAnswer = ws.pingsToAnswer + 1;
        });
      }, this.pingInterval);
    }

    onLogout(player: Player.Player) {
      //TODO
    }

    onSelectChart(player: Player.Player, message: Messages.ChartMessage) {
      if (!player.room) {
        player.sendChat(0, `${Utils.systemPrepend}You're not in a room`);
        return;
      }
      if (!player.room.canSelect(player)) {
        player.sendChat(
          1,
          `${Utils.systemPrepend}You don't have the rights to select a chart!`,
          player.room.name
        );
        return;
      }
      player.room.selectChart(player, message);
    }

    onStartChart(player: Player.Player, message: Messages.ChartMessage) {
      if (!player.room) {
        player.sendChat(0, `${Utils.systemPrepend}You're not in a room`);
        return;
      }
      if (!player.room || !player.room.canSelect(player)) {
        player.sendChat(
          1,
          `${Utils.systemPrepend}You don't have the rights to start a chart!`,
          player.room.name
        );

        return;
      }

      let err = player.room.canStart();

      if (!err) {
        player.room.startChart(player, message);
        this.sendAll(Messages.makeMessage('updateroom', { room: player.room.serialize() }));
      } else {
        player.room.sendChat(`${Utils.systemPrepend}Cant start (${err})`);
      }
    }

    onLogin(player: Player.Player, message: Messages.GenericMessage) {
      if (!message.user || !message.pass) {
        player.send(
          Messages.makeMessage('login', {
            logged: false,
            msg: 'Missing/Empty username or password'
          })
        );
        return;
      }

      if (message.user.length < 4 || message.pass.length < 4) {
        player.send(
          Messages.makeMessage('login', {
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
          Messages.makeMessage('login', {
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

                player.sendChat(0, `Welcome to ${Utils.colorize(serv.serverName)}`);
                player.send(Messages.makeMessage('login', { logged: true, msg: '' }));

                return;
              }
            }

            player.send(
              Messages.makeMessage('login', {
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
              player.sendChat(0, `Welcome to ${Utils.colorize(this.serverName)}`);
              player.send(Messages.makeMessage('login', { logged: true, msg: '' }));
            } else {
              player.send(
                Messages.makeMessage('login', {
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
            player.sendChat(0, `Welcome to ${Utils.colorize(this.serverName)}`);
            player.send(Messages.makeMessage('login', { logged: true, msg: '' }));
          });
        }
      }
    }

    onLeaveRoom(player: Player.Player, message: Messages.RoomMessage) {
      if (!player.user) {
        return;
      }
      this.leaveRoom(player);
    }

    onHasChart(player: Player.Player, message: Messages.ChartMessage) {}

    onStartingChart(player: Player.Player, message: Messages.ChartMessage) {
      player.state = 1;
      this.updateRoomState(player.room);
    }

    onEnterOptions(player: Player.Player, message: Messages.GenericMessage) {
      player.state = 3;
      this.updateRoomState(player.room);
    }

    onLeaveOptions(player: Player.Player, message: Messages.GenericMessage) {
      player.state = 0;
      this.updateRoomState(player.room);
    }
    onEnterEval(player: Player.Player, message: Messages.GenericMessage) {
      player.state = 2;
      this.updateRoomState(player.room);
    }

    onLeaveEval(player: Player.Player, message: Messages.GenericMessage) {
      player.state = 0;
      this.updateRoomState(player.room);
    }

    updateRoomState(room: Room.Room | null) {
      if (!room) return;
      let oldState = room.state;
      room.updateStatus();
      if (oldState !== room.state) {
        this.sendAll(Messages.makeMessage('updateroom', { room: room.serialize() }));
      }
    }

    onGameOver(player: Player.Player, message: Messages.GenericMessage) {
      player.state = 0;
      this.updateRoomState(player.room);
    }

    onScore(player: Player.Player, message: Messages.GenericMessage) {
      if (!player.user || !player.room) {
        return;
      }

      player.room.send(Messages.makeMessage('score', { name: player.user, score: message }));
    }
    onMissingChart(player: Player.Player, message: Messages.GenericMessage) {
      if (!player.user || !player.room) return;
      if (player.room)
        player.room.sendChat(`${Utils.systemPrepend}${player.user} doesnt have the chart`);
    }

    onCreateRoom(player: Player.Player, message: Messages.RoomMessage) {
      if (!player.user) {
        return;
      }

      this.leaveRoom(player);
      const existingRoom = this.currentRooms.find(x => x.name === message.name);

      if (!existingRoom) {
        player.room = this.addRoom(message, player);
        player.send(Messages.makeMessage('createroom', { created: true }));
        player.sendChat(1, `${Utils.systemPrepend} Created room "${message.name}"`, message.name);
      } else {
        player.send(Messages.makeMessage('createroom', { created: false }));
        player.sendChat(0, `${Utils.systemPrepend}Room name already in use`);
      }
    }

    enterRoom(player: Player.Player, room: Room.Room) {
      room.enter(player);
      this.sendAll(Messages.makeMessage('updateroom', { room: room.serialize() }));
    }

    onEnterRoom(player: Player.Player, message: Messages.LoginMessage) {
      if (!player.user) {
        return;
      }

      this.leaveRoom(player);
      const room = this.currentRooms.find(x => x.name === message.name);

      if (room)
        if (!room.pass || room.pass === message.pass) {
          this.enterRoom(player, room);
        } else {
          player.send(Messages.makeMessage('enterroom', { entered: false }));
          player.sendChat(0, `${Utils.systemPrepend}Incorrect password`);
        }
      else {
        player.room = this.addRoom(message, player);
        player.send(Messages.makeMessage('enterroom', { entered: true }));
      }
    }

    onPing(player: Player.Player, message: Messages.GenericMessage) {
      if (player.ws.pingsToAnswer > 0) {
        player.ws.pingsToAnswer = player.ws.pingsToAnswer - 1;
      }
    }

    onCommand(
      player: Player.Player,
      message: Messages.GenericMessage,
      commandName: string,
      params: string[]
    ) {
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

    onChat(player: Player.Player, message: Messages.ChatMessage) {
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
            client.player.sendChat(
              0,
              `${Utils.colorize(player.user, Utils.playerColor)}: ${message.msg}`
            );
          });

          if (this.useDiscord) {
            this.discordChannel.send(`${player.user}: ${message.msg}`);
          }

          break;
        case 1: // room (people in room)
          if (!player.room || player.room.name !== message.tab) {
            player.sendChat(
              1,
              `${Utils.systemPrepend}You're not in the room ${message.tab}`,
              message.tab
            );
            return;
          }
          let r = player.room;
          player.room.players.forEach((pl: Player.Player) => {
            pl.sendChat(
              1,
              `${Utils.colorize(
                player.user,
                player.user === r.owner.user
                  ? Utils.ownerColor
                  : r.ops.find((x: string) => x === player.user) ? Utils.opColor : Utils.playerColor
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

    pm(player: Player.Player, receptorName: string, msg: string) {
      const playerToSendTo = this.playerList.find(x => x.user === receptorName);
      if (!playerToSendTo) {
        player.sendChat(0, `${Utils.systemPrepend}Could not find user ${receptorName}`);
      } else {
        playerToSendTo.sendChat(2, `${player.user}: ${msg}`, player.user);
        player.sendChat(2, `${player.user}: ${msg}`, receptorName);
      }
    }
  }
}
module.exports = {
  Server: ETTServer.Server
};
