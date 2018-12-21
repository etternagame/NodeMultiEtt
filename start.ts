import { ETTServer } from './src/ettServer';

const winston = require('winston');
const argv = require('minimist')(process.argv.slice(2));
const Table = require('cli-table');
const colors = require('colors');
require('dotenv').load();

const logger = winston.createLogger({
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

const DB_NAME = argv.DB_NAME || process.env.DB_NAME || 'ettmulti';
const PORT =
  process.env.OPENSHIFT_INTERNAL_PORT ||
  process.env.OPENSHIFT_NODEJS_PORT ||
  argv.PORT ||
  process.env.PORT ||
  8765;

const LOGPACKETS = argv.LOG_PACKETS || process.env.LOG_PACKETS || true;
const MONGODB_URI = argv.MONGODB_URI || process.env.MONGODB_URI;
const PING_INTERVAL = argv.PING_INTERVAL || process.env.PING_INTERVAL || 15000;
const BOT_TOKEN = argv.BOT_TOKEN || process.env.BOT_TOKEN || '';
const OPT_IP = process.env.IP || process.env.OPENSHIFT_NODEJS_IP;

if ('help' in argv) {
  logger.info(colors.bold.blue('Example: '));
  logger.info('node start.js --MONGODB_URI mongodb://localhost:27017/ --DB_NAME etterna\n');
  logger.info(colors.bold.blue('Options: '));

  const table = new Table({
    head: [
      colors.bold.red('Option'),
      colors.bold.red('Default'),
      colors.bold.red('Example'),
      colors.bold.red('Required')
    ]
  });

  table.push(
    {
      '--MONGODB_URI': [
        'undefined',
        'mongodb://localhost:27017/',
        (!process.env.MONGODB_URI).toString()
      ]
    },
    { '--PORT': ['8765', '4655', 'false'] },
    { '--IP': ['localhost', '0.0.0.0', ''] },
    { '--DB_NAME': ['ettmulti', 'myDatabaseName', 'false'] },
    { '--LOGPACKETS': ['true', 'false', 'false'] },
    { '--PING_INTERVAL': ['15000', '20000', 'false'] },
    { '--BOT_TOKEN': ['undefined', 'Mg-this-Iz-is.not-DCeFB-a.real-t0ken-qe', 'false'] }
  );

  logger.info(table.toString());

  process.exit();
}

const server = new ETTServer({
  handlers: {},
  allowAccountCreation: false,
  serverName: 'Etterna Online',
  pingCountToDisconnect: 2,
  pingInterval: PING_INTERVAL,
  logPackets: LOGPACKETS,
  port: PORT,
  mongoDBURL: MONGODB_URI,
  mongoDBName: DB_NAME,
  ip: OPT_IP,
  discord: { botToken: BOT_TOKEN }
});

server.start();
