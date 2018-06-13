const argv = require('minimist')(process.argv.slice(2));
const Server = require('./ettServer.js').Server;
const Table = require('cli-table');
const colors = require('colors');
require('dotenv').load();

if ('help' in argv || !('MONGODB_URI' in argv)) {
  console.log('Example: '.bold.blue);
  console.log('node start.js --MONGODB_URI mongodb://localhost:27017/ --DB_NAME etterna\n');
  console.log('Options: '.bold.blue);

  const table = new Table({
    head: ['Option'.bold.red, 'Default'.bold.red, 'Example'.bold.red, 'Required'.bold.red]
  });

  table.push(
    { '--MONGODB_URI': ['undefined', 'mongodb://localhost:27017/', 'true'] },
    { '--PORT': ['8765', '4655', 'false'] },
    { '--DB_NAME': ['ettmulti', 'myDatabaseName', 'false'] },
    { '--LOGPACKETS': ['true', 'false', 'false'] },
    { '--PING_INTERVAL': ['15000', '20000', 'false'] },
    { '--BOT_TOKEN': ['undefined', 'Mg-this-Iz-is.not-DCeFB-a.real-t0ken-qe', 'false'] }
  );

  console.log(table.toString());

  process.exit();
}

const DB_NAME = argv.DB_NAME || process.env.DB_NAME || 'ettmulti';
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
  mongoDBName: DB_NAME,
  botToken: BOT_TOKEN
});

server.start();
