#!/bin/bash

forever start --id "multi" /home/ubuntu/NodeEttMulti/start.ts --MONGODB_URI mongodb://localhost:27017/
