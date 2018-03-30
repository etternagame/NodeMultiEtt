const argv = require('minimist')(process.argv.slice(2));
const Server = require('./ettServer.js').Server;
require('dotenv').load();

const PORT = argv.PORT || process.env.PORT || 8765;
const LOGPACKETS = argv.LOG_PACKETS || process.env.LOG_PACKETS || true;
const MONGODB_URI = argv.MONGODB_URI || process.env.MONGODB_URI || '';
const PING_INTERVAL = argv.PING_INTERVAL || process.env.PING_INTERVAL || 15000;
const BOT_TOKEN = argv.BOT_TOKEN || process.env.BOT_TOKEN || '';
const server = new Server({
  pingInterval: PING_INTERVAL,
  logPackets: LOGPACKETS,
  port: PORT,
  mongoDBURL: MONGODB_URI,
  botToken: BOT_TOKEN
});
server.start();
