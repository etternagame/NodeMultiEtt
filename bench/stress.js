const WebSocket = require('ws');

var gotten = 0;
var sent = 0;
function createTestClient(user, pass, message, chatinterval, room) {
  const conn = new WebSocket(
    'ws://nodejs-mongodb-example-ettmulti.a3c1.starter-us-west-1.openshiftapps.com:80'
  );
  let int = null;
  conn.addEventListener('open', () => {
    // connection is opened and ready to use
  });
  conn.onclose = function(reason) {
    console.log(reason.reason);
    if (int) clearInterval(int);
  };
  let id = 1;
  function dealWith(msg) {
    id += 1;
    function send(x) {
      if (conn.readyState != conn.CLOSED) conn.send(x);
    }
    switch (msg.type) {
      case 'hello':
        send(
          JSON.stringify({
            type: 'login',
            id,
            payload: {
              user,
              pass
            }
          })
        );
        break;
      case 'chat':
        gotten += 1;
        break;
      case 'login':
        if (msg.payload.logged) {
          send(
            JSON.stringify({
              type: 'createroom',
              id,
              payload: {
                name: room,
                desc: '',
                pass: ''
              }
            })
          );
          send(
            JSON.stringify({
              type: 'enterroom',
              id,
              payload: {
                name: room,
                desc: '',
                pass: ''
              }
            })
          );
          int = setInterval(() => {
            sent += 1;
            send(
              JSON.stringify({
                type: 'chat',
                id,
                payload: {
                  msgtype: room ? 1 : 0,
                  msg: message,
                  tab: room
                }
              })
            );
          }, chatinterval);
        } else {
          // ???
        }
        break;
      case 'ping':
        send(JSON.stringify({ type: 'ping', id }));
        break;
    }
  }
  conn.addEventListener('message', message => {
    // try to decode json (I assume that each message
    // from server is json)
    try {
      const json = JSON.parse(message.data);
      dealWith(json);
    } catch (e) {
      console.log("This doesn't look like a valid JSON: ", message.data);
    }
    // handle incoming message
  });
}
function randomstr(n) {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstu][\';}{":?><s\\!@#$%^&*()_+tring,.vwxyz0123456789';

  for (let i = 0; i < n; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));

  return text;
}
var i;
const players = 4;
const rooms = 300;
const msgSize = 2;
const msgInterval = 10000;
// roomsize increases shouldGet
// players increases sent
for (i = 0; i < players; i++) {
  createTestClient(
    `asdsd${JSON.stringify(i)}`,
    'asdsd',
    randomstr(msgSize),
    msgInterval,
    JSON.stringify((i % rooms) * 100)
  );
}

setInterval(() => {
  console.log(
    `gotten ${JSON.stringify(gotten)} sent ${JSON.stringify(sent)} shouldGet ~= ${JSON.stringify(
      (sent * players) / rooms
    )}`
  );
}, 10000);
