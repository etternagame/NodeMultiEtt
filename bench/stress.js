const WebSocket = require('ws');
var gotten = 0;
var sent = 0;
function createTestClient(user, pass, message, chatinterval, room) {
  var conn = new WebSocket(
    'ws://nodejs-mongodb-example-ettmulti.a3c1.starter-us-west-1.openshiftapps.com:80'
  );
  var int = null;
  conn.onopen = function() {
    // connection is opened and ready to use
  };
  conn.onclose = function(reason) {
    console.log(reason.reason);
    if (int) clearInterval(int);
  };
  var id = 1;
  function dealWith(msg) {
    id = id + 1;
    function send(x) {
      if (conn.readyState != conn.CLOSED) conn.send(x);
    }
    switch (msg.type) {
      case 'hello':
        send(
          JSON.stringify({
            type: 'login',
            id: id,
            payload: {
              user: user,
              pass: pass
            }
          })
        );
        break;
      case 'chat':
        gotten = gotten + 1;
        break;
      case 'login':
        if (msg.payload.logged) {
          send(
            JSON.stringify({
              type: 'createroom',
              id: id,
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
              id: id,
              payload: {
                name: room,
                desc: '',
                pass: ''
              }
            })
          );
          int = setInterval(() => {
            sent = sent + 1;
            send(
              JSON.stringify({
                type: 'chat',
                id: id,
                payload: {
                  msgtype: room ? 1 : 0,
                  msg: message,
                  tab: room
                }
              })
            );
          }, chatinterval);
        } else {
          //???
        }
        break;
      case 'ping':
        send(JSON.stringify({ type: 'ping', id: id }));
        break;
    }
  }
  conn.onmessage = function(message) {
    // try to decode json (I assume that each message
    // from server is json)
    try {
      var json = JSON.parse(message.data);
      dealWith(json);
    } catch (e) {
      console.log("This doesn't look like a valid JSON: ", message.data);
      return;
    }
    // handle incoming message
  };
}
function randomstr(n) {
  var text = '';
  var possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstu][\';}{":?><s\\!@#$%^&*()_+tring,.vwxyz0123456789';

  for (var i = 0; i < n; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));

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
    'asdsd' + JSON.stringify(i),
    'asdsd',
    randomstr(msgSize),
    msgInterval,
    JSON.stringify((i % rooms) * 100)
  );
}

setInterval(() => {
  console.log(
    'gotten ' +
      JSON.stringify(gotten) +
      ' sent ' +
      JSON.stringify(sent) +
      ' shouldGet ~= ' +
      JSON.stringify((sent * players) / rooms)
  );
}, 10000);
