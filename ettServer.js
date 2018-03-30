const express = require('express');

let SocketServer = null;
try {
  SocketServer = require('uws').Server;
} catch (e) {
  console.log('require uws failed, trying ws');
  SocketServer = require('ws').Server;
}
const discord = require('discord.js');
const path = require('path');
const MongoClient = require('mongodb').MongoClient;
var request = require('request');

function makeMessage(type, payload = null) {
  return payload ? { type: type, payload: payload } : { type: type };
}
const selectionModeDescriptions = {
  0: 'By chartkey',
  1: 'By title, subtitle, artist, difficulty meter and filehash',
  2: 'By title, subtitle, artist and filehash'
};
const selectionModes = {
  0: ch => {
    return {
      chartkey: ch.chartkey
    };
  },
  1: ch => {
    return {
      title: ch.title,
      subtitle: ch.subtitle,
      artist: ch.artist,
      difficulty: ch.difficulty,
      meter: ch.meter,
      filehash: ch.filehash
    };
  },
  2: ch => {
    return {
      title: ch.title,
      subtitle: ch.subtitle,
      artist: ch.artist,
      filehash: ch.filehash
    };
  }
};
function color(c) {
  return `|c0${c}`;
}
const systemPrepend = `${color('BBBBFF')}System:${color('FFFFFF')} `;
const ownerColor = 'BBFFBB';
const playerColor = 'AAFFFF';
const opColor = 'FFBBBB';
const stringToColour = function(str) {
  var hash = 0;
  for (var i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  var colour = '';
  for (var i = 0; i < 3; i++) {
    var value = (hash >> (i * 8)) & 0xff;
    colour += ('00' + value.toString(16)).substr(-2);
  }
  return colour;
};
function colorize(string, colour = stringToColour(string)) {
  return color(colour) + string + color('FFFFFF');
}
class Chart {
  constructor(message, player) {
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
  constructor(_name, _desc, _pass) {
    this.name = _name;
    this.desc = _desc;
    this.pass = _pass;
    this.players = [];
    this.owner = null;
    this.ops = [];
    this.free = false; // free===Anyone can pick
    this.selectionMode = 0; // By metadata(0), filehash(1) or chartkey(2)
    this.state = 0; // Selecting(0), Playing(1)
    this.chart = null;
    this.freeRate = false;
    this.playing = false;
  }
  serializeChart(chart = this.chart) {
    if (!chart) return {};
    const selectionMode = selectionModes[this.selectionMode];
    if (!selectionMode) {
      this.sendChat(`${systemPrepend}Invalid selection mode`);
      return {};
    }
    const c = selectionMode(chart);
    if (!this.freeRate) {
      c.rate = chart.rate;
    }
    return c;
  }
  startChart(player, message) {
    let ch = new Chart(message, player);
    // Use the selectionMode criteria
    const newChart = this.serializeChart(ch);
    const oldChart = this.serializeChart(this.chart);
    if (
      !this.chart ||
      player.user !== this.chart.pickedBy ||
      JSON.stringify(newChart) !== JSON.stringify(oldChart)
    ) {
      this.selectChart(player, message);
      return;
    }
    this.chart = ch;
    this.state = 1;
    this.send(makeMessage('startchart', { chart: newChart }));
    this.sendChat(`${systemPrepend}Starting ${colorize(this.chart.title)}`);
    this.playing = true;
  }
  selectChart(player, message) {
    this.chart = new Chart(message, player);
    this.send(makeMessage('selectchart', { chart: this.serializeChart() }));
    this.sendChat(
      `${systemPrepend}${player.user} selected ` +
        colorize(
          `${message.title} (${message.difficulty}: ${message.meter})${
            message.rate ? ` ${parseFloat(message.rate / 1000).toFixed(2)}` : ''
          }`,
          stringToColour(message.title)
        )
    );
  }
  refreshUserList() {
    this.send(
      makeMessage('userlist', {
        players: this.players.map(x => {
          return {
            name: x.user,
            status: x.state + 1
          };
        })
      })
    );
  }
  enter(player) {
    player.room = this;
    this.players.push(player);
    player.send(makeMessage('enterroom', { entered: true }));
    this.sendChat(`${systemPrepend}${player.user} joined`);
    player.state = 0;
    if (this.chart) player.send(makeMessage('selectchart', { chart: this.serializeChart() }));
  }
  serialize() {
    return {
      name: this.name,
      desc: this.desc,
      players: this.players.map(p => p.serialize()),
      pass: !!this.pass,
      state: this.state
    };
  }
  updateStatus() {
    const oldState = this.state;
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
  send(message) {
    this.players.forEach(pl => {
      pl.send(message);
    });
  }
  sendChat(message) {
    this.players.forEach(pl => {
      pl.sendChat(1, message, this.name);
    });
  }
  changeOwner() {
    if (this.ops.length > 0) this.owner = this.ops[Math.floor(Math.random() * this.ops.length)];
    const auxUserList = this.players.filter(pl => pl.user !== this.owner.user);
    if (auxUserList.length > 0)
      this.owner = auxUserList[Math.floor(Math.random() * auxUserList.length)];
  }
  canSelect(player) {
    return this.free || player === this.owner || this.ops.some(x => x.user === player.user);
  }
  canStart() {
    let err = null;
    let nonReady = [];
    this.players.forEach(pl => {
      if (pl.state != 0) nonReady.push(pl);
    });
    if (nonReady.length > 0) {
      err = 'Players ';
      nonReady.forEach(pl => {
        err = err + pl.user + ', ';
      });
      err = err.substring(0, err.length - 2) + ' are busy';
    }
    return err;
  }
  remove(player) {
    this.players = this.players.filter(x => x.user !== player.user);
  }
}
class Player {
  constructor(_user, _pass, _ws) {
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
    if (this.user == this.room.owner.user) this.room.changeOwner();
    this.room.remove(this);
    const room = this.room;
    this.room = null;
    this.send(makeMessage('userlist', { players: [] }));
    return room;
  }
  sendRoomList(_rooms) {
    this.send(makeMessage('roomlist', { rooms: _rooms }));
  }
  sendChat(type, msgStr, _tab = '') {
    this.send(
      makeMessage('chat', { msgtype: type, tab: _tab, msg: msgStr + color('FFFFFF') + ' ' })
    );
  }
  send(message) {
    message.id = this.ws.msgId;
    this.ws.msgId = this.ws.msgId + 1;
    this.ws.send(JSON.stringify(message));
  }
  serialize() {
    return this.user;
  }
}
class Server {
  constructor(params) {
    // Options
    this.port = params.port || 8765;
    this.logPackets = params.logPackets || false;
    this.mongoDBURL = params.mongoDBURL || '';
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
    this.discordChannelId = params.channelId || '429399431725580288';
    this.discordGuildId = params.guildId || '339597420239519755';
    this.discordBotToken = params.botToken;
    this.useDiscord = this.discordChannelId && this.discordGuildId && this.discordBotToken;
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
      this.discordClient.on('message', msg => {
        if (msg.channel.id !== serv.discordChannelId || msg.author.bot) return;
        serv.wss.clients.forEach(client => {
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
      pm: (player, message, command, params) => {
        this.pm(player, params[0], params.slice(1).join(' '));
      }
    };
  }
  makeRoomCommands() {
    return {
      free: (player, message, command, params) => {
        player.room.free = !player.room.free;
        player.room.sendChat(
          `${systemPrepend}The room is now ${
            player.room.free ? '' : 'not '
          }in free song picking mode`
        );
      },
      freerate: (player, message, command, params) => {
        player.room.freerate = !player.room.freerate;
        player.room.sendChat(
          `${systemPrepend}The room is now ${player.room.freerate ? '' : 'not'} rate free mode`
        );
      },
      selectionMode: (player, message, command, params) => {
        const selectionMode = params[0] ? selectionModes[params[0]] : null;
        if (!selectionMode) {
          player.sendChat(
            `${systemPrepend}Invalid selection mode. Valid ones are:\n` +
              JSON.stringify(selectionModeDescriptions, null, 4).replace(/[{}]/g, '')
          );
        }
        player.room.selectionMode = params[0];
        player.room.sendChat(
          `${systemPrepend}The room is now in "${
            selectionModeDescriptions[params[0]]
          }" selection mode`
        );
      },
      op: (player, message, command, params) => {
        if (player.room.owner != player.user) {
          player.sendChat(0, `${systemPrepend}You're not the room owner!`);
          return;
        }
        if (!player.room.players.find(x => x.user === params[0])) {
          player.sendChat(0, `${systemPrepend}${params[0]} is not in the room!`);
          return;
        }
        if (!player.room.ops.find(x => x === params[0])) {
          player.room.ops.push(params[0]);
          player.room.sendChat(`${systemPrepend}${params[0]} is now a room operator`);
        } else {
          player.room.ops = player.room.ops.filter(x => x !== params[0]);
          player.room.sendChat(`${systemPrepend}${params[0]} is no longer a room operator`);
        }
      }
    };
  }
  addRoom(message, creator) {
    const room = new Room(message.name, message.desc, message.pass);
    this.currentRooms.push(room);
    room.players.push(creator);
    room.owner = creator;
    creator.room = room;
    this.sendAll(makeMessage('newroom', { room: room.serialize() }));
    this.updateRoomStatus(room);
    return room;
  }
  addPlayer(_user, _pass, _ws) {
    const player = new Player(_user, _pass, _ws);
    this.playerList.push(player);
    return player;
  }
  removePlayer(player) {
    this.leaveRoom(player);
    this.playerList = this.playerList.filter(x => x.user !== player.user);
    player.user = '';
    player.pass = '';
    player.room = null;
  }
  createAccount(player) {
    if (this.db) {
      this.db
        .collection('accounts')
        .insert({ user: player.user, pass: player.pass }, (err, records) => {
          console.log(`Created account for user ${records.ops[0].user}`);
        });
      return;
    }
    // Dont try to reconnect more than once
    if (this.connectionFailed) return;
    // reconnect
    MongoClient.connect(this.mongoDBURL, (err, client) => {
      if (err || !client) {
        this.connectionFailed = true;
        console.log(`mongodb reconnection failed to ${this.mongoDBURL} error: ${err}`);
        return;
      }
      console.log('Reconnected to mongodb');
      // Add new user
      this.db = client.db('ettmulti');
      this.db
        .collection('accounts')
        .insert({ user: newAcc.user, pass: newAcc.pass }, (err, records) => {
          console.log(`Created account for user ${records.ops[0].user}`);
        });
    });
  }
  leaveRoom(player) {
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
        this.updateRoomStatus(room);
      }
      player.sendChat(0, `${systemPrepend}Left room ${room.name}`);
    }
  }
  resendAllRooms() {
    const rooms = this.currentRooms.map(r => r.serialize());
    this.wss.clients.forEach(client => {
      client.player.sendRoomList(rooms);
    });
  }
  sendAll(message) {
    this.wss.clients.forEach(client => {
      client.player.send(message);
    });
  }
  chatToAll(type, message, _tab = '') {
    this.wss.clients.forEach(client => {
      client.player.sendChat(type, message, _tab);
    });
  }
  loadAccounts() {
    MongoClient.connect(this.mongoDBURL, (err, client) => {
      if (err || !client) {
        this.dbConnectionFailed = true;
        console.log(`mongodb connection failed to ${this.mongoDBURL} error: ${err}`);
        return;
      }
      console.log('Connected to mongodb');
      this.db = client.db('ettmulti');
      const collection = this.db.collection('accounts');
      collection.find().forEach(account => {
        this.accountList.push(account);
      });
    });
  }
  start() {
    this.db = null;
    this.dbConnectionFailed = false;
    this.loadAccounts();
    this.wss.on('connection', ws => {
      ws.tmpaux = ws.send;
      // If i dont check readystate sometimes it crashes
      if (this.logPackets) {
        ws.send = str => {
          if (ws.readyState === 1) {
            ws.tmpaux(str);
            console.log(`out: ${str}`);
          } else {
            console.log(`Connection closed so msg not sent: ${str}`);
          }
        };
      } else {
        ws.send = str => {
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
      // Ignore first interval (This way the first ping check will be in PINGINTERVAL * 2, this is because we dont
      //	know when the connection starts in the interval (Could be anywhere below PINGINTERVAL))
      ws.pingsToAnswer = 0;
      ws.msgId = 0;
      ws.player.sendRoomList(this.currentRooms.map(r => r.serialize()));
      ws.on('close', () => {
        console.log(`Client disconnected (${ws._socket.remoteAddress})`);
        this.removePlayer(ws.player);
      });

      ws.on('message', message => {
        if (this.logPackets) console.log(`in: ${message}`);
        message = JSON.parse(message);
        const handler = this.messageHandlers[message.type];
        if (handler) handler.call(this, ws.player, message.payload);
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
        if (this.logPackets) ws.player.send(makeMessage('ping'));
        ws.pingsToAnswer = ws.pingsToAnswer + 1;
      });
    }, this.pingInterval);
  }
  onSelectChart(player, message) {
    if (!player.room || !player.room.canSelect(player)) {
      player.sendChat(
        1,
        `${systemPrepend}You dont have the rights to select a chart!`,
        player.room.name
      );
      return;
    }
    player.room.selectChart(player, message);
  }
  onStartChart(player, message) {
    if (!player.room || !player.room.canSelect(player)) {
      player.sendChat(
        1,
        `${systemPrepend}You dont have the rights to start a chart!`,
        player.room.name
      );
      return;
    }
    let err = player.room.canStart();
    if (!err) {
      player.room.startChart(player, message);
      this.sendAll(makeMessage('updateroom', { room: player.room.serialize() }));
    } else player.room.sendChat(`${systemPrepend}Cant start (${err})`);
  }
  onLogin(player, message) {
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
          msg: 'Usernames and passwords must have more than 3 characters'
        })
      );
      return;
    }
    if (player.user) this.removePlayer(player);
    if (this.playerList.find(x => x.user === message.user)) {
      player.send(
        makeMessage('login', { logged: false, msg: `${message.user} is already logged in` })
      );
      return;
    }
    if (!this.mongoDBURL) {
      request.post(
        {
          url: 'https://api.etternaonline.com/v1/login',
          form: { username: message.user, password: message.pass }
        },
        function(error, response, body) {
          if (response && response.statusCode == 200) {
            if (JSON.parse(body).success === 'Valid') {
              player.user = message.user;
              player.pass = message.pass;
              player.sendChat(0, `Welcome to ${colorize(this.serverName)}`);
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
        if (foundUser.pass === message.pass) {
          // normal login
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
      } else {
        // New account
        player.user = message.user;
        player.pass = message.pass;
        this.createAccount(player);
        player.sendChat(0, `Welcome to ${colorize(this.serverName)}`);
        player.send(makeMessage('login', { logged: true, msg: '' }));
      }
    }
  }
  onLeaveRoom(player, message) {
    if (!player.user) return;
    this.leaveRoom(player);
  }
  onHasChart(player, message) {}
  onStartingChart(player, message) {
    player.state = 1;
    this.updateRoomStatus(player.room);
  }
  onEnterOptions(player, message) {
    player.state = 3;
    this.updateRoomStatus(player.room);
  }
  onLeaveOptions(player, message) {
    player.state = 0;
    this.updateRoomStatus(player.room);
  }
  onEnterEval(player, message) {
    player.state = 2;
    this.updateRoomStatus(player.room);
  }
  onLeaveEval(player, message) {
    player.state = 0;
    this.updateRoomStatus(player.room);
  }
  updateRoomStatus(room) {
    if (!room) return;
    let oldStatus = room.status;
    room.updateStatus();
    if (oldStatus != room.status)
      this.sendAll(makeMessage('updateroom', { room: room.serialize() }));
  }
  onGameOver(player, message) {
    player.state = 0;
    this.updateRoomStatus(player.room);
  }
  onScore(player, message) {
    if (!player.user || !player.room) return;
    player.room.send(makeMessage('score', { name: player.user, score: message }));
  }
  onMissingChart(player, message) {
    if (!player.user || !player.room) return;
    if (player.room) player.room.sendChat(`${systemPrepend}${player.user} doesnt have the chart`);
  }
  onCreateRoom(player, message) {
    if (!player.user) return;
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
  enterRoom(player, room) {
    room.enter(player);
    this.sendAll(makeMessage('updateroom', { room: room.serialize() }));
  }
  onEnterRoom(player, message) {
    if (!player.user) return;
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
  onPing(player, message) {
    if (player.ws.pingsToAnswer > 0) player.ws.pingsToAnswer = player.ws.pingsToAnswer - 1;
  }
  onCommand(player, message, commandName, params) {
    if (player.room) {
      let command = this.roomCommands[commandName];
      if (command) {
        command(player, message, command, params);
        return true;
      }
    }
    let command = this.globalCommands[commandName];
    if (command) {
      command(player, message, command, params);
      return true;
    }
    return false;
  }
  onChat(player, message) {
    if (!player.user) return;
    if (message.msg.startsWith('/')) {
      var params = message.msg.split(' ');
      var command = params[0].substring(1);
      params = params.slice(1);
      if (this.onCommand(player, message, command, params)) return;
    }
    switch (message.msgtype) {
      case 0: // lobby (everyone)
        this.wss.clients.forEach(client => {
          client.player.sendChat(0, `${colorize(player.user, playerColor)}: ${message.msg}`);
        });
        if (this.useDiscord) this.discordChannel.send(`${player.user}: ${message.msg}`);
        break;
      case 1: // room (people in room)
        if (!player.room || player.room.name !== message.tab) {
          player.sendChat(1, `${systemPrepend}You're not in the room ${message.tab}`, message.tab);
          return;
        }
        player.room.players.forEach(pl => {
          pl.sendChat(
            1,
            `${colorize(
              player.user,
              player.user == player.room.owner
                ? ownerColor
                : player.room.ops.find(x => x === player.user) ? opColor : playerColor
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
  pm(player, receptorName, msg) {
    const playerToSendTo = this.playerList.find(x => x.user === receptorName);
    if (!playerToSendTo) {
      player.sendChat(0, `${systemPrepend}Could not find user ${receptorName}`);
    } else {
      playerToSendTo.sendChat(2, `${player.user}: ${msg}`, player.user);
      player.sendChat(2, `${player.user}: ${msg}`, receptorName);
    }
  }
}

module.exports = {
  Server,
  Room,
  Player
};
