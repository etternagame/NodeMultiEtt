# NodeMultiEtt

Example server for the new websocket protocol/client in etterna (currently working in https://github.com/Nickito12/etterna/tree/uws) using json for packets/messages.

## JSON messages

This follows a modified version of flux standard actions (https://github.com/redux-utilities/flux-standard-action#actions)

### Messages
A message MUST

be a plain JavaScript object.
have a type property.

An action MAY

have an error property.
have a payload property.
have an id (Unique) property.
An action MUST NOT include properties other than type, payload and error.

#### type
The type of an action identifies to the consumer the nature of the action that has occurred. type is a string constant. If two types are the same, they MUST be strictly equivalent (using ===).

#### payload
The optional payload property MAY be any type of value. It represents the payload of the action. Any information about the message that is not the type or status of the action should be part of the payload field.


#### error
The optional error property MAY be present, and if it is a true boolean the payload should describe the error. payload.msg should be a desscriptive error message, and payload.code the error code.

#### id
unique message id present in messages sent from the client.

### Client

#### hello

Should be sent once after connection is established. Sends server name and version.

Response: None.

```elixir
{
  *"type": "hello",
  *"payload": {
    "version":"0.54",
    "client":"Etterna",
    "packs": ["Otakus Dream 11"]
  }
}
```

#### ping

Sent on response to a server ping message.

Response: None.

```elixir
{
  "type": "ping",
  "id": 1
}
```

#### login

Request login.

Response: Login.

```elixir
{
  "type": "login",
  "payload": {
    "user": "test",
    "pass": "123"
  },
  "id": 1
}
```

#### selectchart

Request to select a chart.

Response: None (Server will probably send a chat message or if selection succeeds it will send selectchart messages to everyone in the room).

```elixir
{
  "type": "selectchart",
  "payload": {
    "title": "Doin the kirby",
    "subtitle": "",
    "artist": "",
    "difficulty": "Hard",
    "meter": 10,
    "chartkey": "",
    "filehash": ""
  },
  "id": 1
}
```

#### startchart

Request to start a chart

Response: None (Server will probably send a chat message or if the request succeeds it will send selectchart messages to everyone in the room).

```elixir
{
  "type": "startchart",
  "payload": {
    "title": "Doin the kirby",
    "subtitle": "",
    "artist": "",
    "difficulty": "Hard",
    "meter": 10,
    "chartkey": "",
    "filehash": ""
  },
  "id": 1
}
```

#### haschart

Response to selectchart from the server if the client has the chart.

Response: None.

```elixir
{
  "type": "haschart",
  "id": 1
}
```

#### missingchart

Response to selectchart from the server if the client doesnt have the chart.

Response: None.

```elixir
{
  "type": "missingchart",
  "id": 1
}
```

#### createroom

Request to create a room.

Response: createroom.

```elixir
{
  "type": "createroom",
  "payload": {
    "name": "nicks",
    "desc": "noob inside",
    "pass": "123"
  },
  "id": 1
}
```

#### enterroom

Request to enter a room.

Response: enterroom.

```elixir
{
  "type": "enterroom",
  "payload": {
    "name": "nicks",
    "desc": "noob inside",
    "pass": "123"
  },
  "id": 1
}
```

#### chat

Send a chat message. msgtype 0 is lobby, 1 is room, 2 is private message. tab is useless for lobby, room name for room and username for PMs.

Response: None (If the message gets through the server will send it back as a chat message).

```elixir
{
  "type": "chat",
  "payload": {
    "msgtype": 0,
    "msg": "hi",
    "tab": ""
  },
  "id": 1
}
```

#### openoptions

Sent when the options screen starts.

```elixir
{
  "type": "openoptions",
  "id": 1
}
```

#### closeoptions

Sent when the options screen is left (Back to room).

```elixir
{
  "type": "closeoptions",
  "id": 1
}
```

#### openeval

Sent when the evaluation screen starts. This may or may not be sent after the gameover message (If it isn't then the player quitted or the theme doesnt have an evaluation screen).

```elixir
{
  "type": "openeval",
  "id": 1
}
```


#### closeeval

Sent when the evaluation (Score display after gameplay) screen is left (Back to room).

```elixir
{
  "type": "closeeval",
  "id": 1
}
```

### Server

Fields marked with an * are required/mandatory.

#### login

Response to login message from client. logged is weather or not login was succesful. msg is the error message if it wasnt.

Response: None.

```elixir
{
  *"type": "login",
  *"payload": {
    *"logged": false,
    "msg": "Wrong password"
  }
}
```

#### selectchart

Tells the client to select a chart if it has it. It's answered by either a missingchart or haschart message. The client tries to find a chart using all parameters sent that are not null, not empty and greater than 0, looking for a chart that verifies all criteria.

Response: haschart or missingchart.

```elixir
{
  *"type": "selectchart",
  *"payload": {
    "title": "Doin the kirby",
    "subtitle": "",
    "artist": "",
    "difficulty": "Hard",
    "meter": 10,
    "chartkey": "",
    "filehash": ""
  }
}
```

#### startchart

Tells the client to start a chart if it has it. It's answered by either a startingchart or notstartingchart message. The client tries to find a chart using all parameters sent that are not null, not empty and greater than 0, looking for a chart that verifies all criteria.

Response: startingchart or notstartingchart.

```elixir
{
  *"type": "startchart",
  *"payload": {
    "title": "Doin the kirby",
    "subtitle": "",
    "artist": "",
    "difficulty": "Hard",
    "meter": 10,
    "chartkey": "",
    "filehash": ""
  }
}
```

#### enterroom

Response to an enterroom client message. Tells the client whether or not access to the room was granted (Room still exists, right password, etc).

Response: None.

```elixir
{
  *"type": "enterroom",
  *"payload": {
    *"entered":true
  }
}
```

#### createroom

Response to a createroom client message. Tells the client whether or not the room was created (There wasnt a room with that name already, no invalid characters, etc).

Response: None.

```elixir
{
  *"type": "createroom",
  *"payload": {
    *"created":true
  }
}
```

#### roomlist

Sends the client a roomlist. The client deletes all the rooms it currently knows and replaces them with the ones present in this mesage (It's recommended to only send this on new connections, and then update rooms accordingly using deleteroom, updateroom, newroom).

Response: None.

```elixir
{
  *"type": "roomlist",
  *"payload": {
    *"rooms": [
      {
        *"name": "Nick's",
        "desc":"",
        "state":0,
        "players": ["Nick"]
      }
    ]
  }
}
```

#### hello

Should be sent once after connection is established. Sends server name and version.

Response: None.

```elixir
{
  *"type": "hello",
  *"payload": {
    "name":"NodeMultiEtt",
    "version":1
  }
}
```

#### ping

Request the client to answer with a ping (Used as a "heartbeat" to know when connection dies unexpectedly).

Response: ping.

```elixir
{
  *"type": "ping"
}
```

#### chat

Send a chat message to the client. msgtype can be 0 (Lobby), 1 (A room) or 2 (Private Message). Tab name is the room name or user name.

Response: None.

```elixir
{
  *"type": "chat"
  *"payload": {
    *"msgtype":0,
    *"tab":"",
    *"msg":"hi"
  }
}
```

#### newroom

Tells the client to add a room to its roomlist.

Response: None.

```elixir
{
  *"type": "newroom"
  *"payload": {
    *"room": {
      *"name": "Nick's",
      "desc":"",
      "state":0,
      "players": ["Nick"]
    }
  }
}
```

#### updateroom

Tells the client to replace the room with the name sent from its roomlist for the room sent.

Response: None.

```elixir
{
  *"type": "updateroom"
  *"payload": {
    *"room": {
      *"name": "Nick's",
      "desc":"",
      "state":0,
      "players": ["Nick"]
    }
  }
}
```

#### deleteroom

Tells the client to remove the room with the name sent from its roomlist.

Response: None.

```elixir
{
  *"type": "deleteroom"
  *"payload": {
    *"room": {
      *"name": "Nick's"
    }
  }
}
```
