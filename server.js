import WebSocket, { WebSocketServer } from "ws";
import { createRandomString, lerp, getRandomColor } from './helpers.js';

const messageObjs = [];
let userMap = { };
let chans = {
    'chan1': {maxUsers: 5, users: []},
    'chan2': {maxUsers: 3, users: []},
    'chan3': {maxUsers: 2, users: []}
};

const MAX_USER_TIMEOUT = 120 * 1000; // milli seconds

const MIN_WORLD_LIMIT = -15;
const MAX_WORLD_LIMIT = 15;

const MAX_MESSAGES_PER_SECOND = 100;

let numConnections = 0;

const wss = new WebSocketServer({ port: 8080 }, () => {
    console.log('the server is listening');
});

wss.on('connection', function connection(ws) {

    // assign an anonymous id to this user
    let randString = createRandomString(10);
    while (Object.keys(userMap).includes(randString)) {
        randString = createRandomString(10);
    } 

    /* assign a random id */
    ws._user_id = randString;
    ws._chan = null;
    
    /* initialize */
    ws._cur_pos = { x: 0, y: 0 };
    ws._max_speed = 6; /* units per second */
    ws._color = getRandomColor();
    ws._last_pinged = Date.now();

    ws._messages_past_second = 0;
    ws._last_rate_limit_reset = Date.now();

    numConnections++;
    // users.push(ws._user_id);
    userMap[ws._user_id] = ws;

    ws.on('error', console.error);

    ws.on('message', function message(data) {

        /* rate limiting */
        const now = Date.now();
        if (now - ws._last_rate_limit_reset >= 1000) {
            ws._messages_past_second = 0;
            ws._last_rate_limit_reset = now;
        }

        if (ws._messages_past_second >= MAX_MESSAGES_PER_SECOND) { return; } /* hitting us too often */
        ws._messages_past_second++;
        /* */

        // console.log('received: %s', data);
        let dataJson;
        try {
            dataJson = JSON.parse(data);
        } catch (err) {
            console.error(err);
        }

        if (!dataJson) return;
        
        if (dataJson?.type === 'move') { /* update the user's target position */ 
            if (typeof dataJson.targetPos?.x === 'number' && typeof dataJson.targetPos?.y === 'number') {
                if (dataJson.targetPos.x < MIN_WORLD_LIMIT || dataJson.targetPos.x > MAX_WORLD_LIMIT || dataJson.targetPos.y < MIN_WORLD_LIMIT || dataJson.targetPos.y > MAX_WORLD_LIMIT) {return;}
                ws._target_pos = { x : dataJson.targetPos.x, y : dataJson.targetPos.y };
                if (JSON.stringify(ws._cur_pos) !== (JSON.stringify(ws._target_pos))) { ws._moving = true; }
                // console.log('user ' + ws._user_id + ' wants to move to ' + JSON.stringify(ws._target_pos));
            }
            
            return; 
        }

        if (dataJson?.type === 'join-chan') { 
            if (!(dataJson.chan)) { ws.send(JSON.stringify({type: 'error', logText: 'No channel specified'})); return; }
            if (!(Object.keys(chans).includes(dataJson.chan))) { ws.send(JSON.stringify({type: 'error', logText: 'Invalid channel specified'})); return; }
            if (chans[dataJson.chan].users.length === chans[dataJson.chan].maxUsers) { ws.send(JSON.stringify({type: 'error', logText: 'Channel is full'})); return; }
            if (ws._chan) { ws.send(JSON.stringify({type: 'error', logText: 'Please leave current channel first'})); return; }
            
            chans[dataJson.chan].users.push(ws._user_id);
            ws._chan = dataJson.chan;
            ws.send(JSON.stringify({type: 'logs', logText: 'Joined ' + dataJson.chan}));
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN && client._chan === ws._chan) { client.send(JSON.stringify({type: 'logs', logText:ws._user_id + ' joined the channel'})) }
            });
            return; 
        } else if (dataJson?.type === 'leave-chan') {
            if (ws._chan) {
                chans[ws._chan].users = chans[ws._chan].users.filter(user => user !== ws._user_id);
                ws.send(JSON.stringify({type: 'logs', logText: 'Left ' + ws._chan}));

                // broadcast to all channel members
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN && client._chan === ws._chan) { client.send(JSON.stringify({type: 'logs', logText:ws._user_id + ' left the channel'})) }
                });
                ws._chan = null;
            }
            return;
        } else if (dataJson?.type === 'ping') {
            console.log('received a ping from ', ws._user_id);
            ws._last_pinged = Date.now();
        } else if (dataJson?.type === 'set_name') {
            console.log(ws._user_id + ' wants to set their name to ' + dataJson.username);
            ws._display_name = dataJson.username ?? ws._user_id;

            sendPositionsAll();
            return;
        }
        
        const logMsg = { user: ws._user_id, content: dataJson.q?.toString(), at: Date.now(), chan: dataJson.chan };
        messageObjs.push(logMsg); 
        // console.log(logMsg);
        
        if (dataJson.chan && dataJson.chan === 'global') {
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) { client.send(JSON.stringify({type: 'logs', logText:ws._user_id + ' says: ' + dataJson.q})) }
            });
        } else if (dataJson.chan) {
            if (!(Object.keys(chans).includes(dataJson.chan))) { ws.send(JSON.stringify({type: 'error', logText: 'No such channel: ' + dataJson.chan})); return; }
            if (ws._chan !== dataJson.chan) { ws.send(JSON.stringify({type: 'error', logText: 'You are not a member of this channel'})); return; }
            /* only broadcast to chan members */
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN && client._chan === dataJson.chan) { client.send(JSON.stringify({type: 'logs', logText:ws._user_id + ' says: ' + dataJson.q})) }
            });
        }
    });

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            // client.send('a websocket connection was opened');
            client.send(JSON.stringify({type: 'logs', logText:ws._user_id + ' joined the server'}));
            client.send(JSON.stringify({type: 'ulist-update', ulist: Object.keys(userMap)}));

            sendPositionsAll(client);

    
        }
    });

    ws.on('close', function message() {
        numConnections--;
        // users = users.filter(item => item !== ws._user_id);
        delete userMap[ws._user_id];
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) { 
                // client.send('a websocket was closed'); 
                client.send(JSON.stringify({type: 'logs', logText:ws._user_id + ' left the server'}));
                client.send(JSON.stringify({type: 'ulist-update', ulist: Object.keys(userMap)}));

                sendPositionsAll(client);
            }
        })
    });
    console.log('total connected users: ' + numConnections);
});

setInterval(serverTick, 1000 / 50, userMap);

setInterval(checkGhosts, MAX_USER_TIMEOUT, userMap);

function checkGhosts(userMap) {
    const currentTime = Date.now();

    for (const user of Object.keys(userMap)) {
        // console.log(userMap[user]?._last_pinged);
        if (!(userMap[user]?._last_pinged)) {
                kickUser(user);
                continue;
        }

        const timeSinceLastPing = currentTime - userMap[user]._last_pinged;
        // console.log(user + ' time since last ping: ', timeSinceLastPing);
        if (timeSinceLastPing > MAX_USER_TIMEOUT) { kickUser( user ); }
    }
}

function kickUser(user) {

    console.log('kicking user ', user);

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) { 
            // client.send('a websocket was closed'); 
            client.send(JSON.stringify({type: 'logs', logText:user + ' was kicked'}));
            client.send(JSON.stringify({type: 'ulist-update', ulist: Object.keys(userMap)}));

            sendPositionsAll(client);
        }
    });
    if (userMap[user].readyState === WebSocket.OPEN) { userMap[user].terminate(); }

    numConnections--;
    // users = users.filter(item => item !== user);
    delete userMap[user];

}

function sendPositionsAll(client) {
    /* refresh all positions for all players because someone just joined*/
    const payload = { type: "playerPositions" ,  positions: {  }, refresh: true};

    for (const user of wss.clients) {
        console.log(user._display_name);
        payload.positions[user._user_id] = JSON.parse(JSON.stringify(user._cur_pos));
        if (client?._user_id === user._user_id) { payload.positions[user._user_id].self = true }
        payload.positions[user._user_id].color = user._color;
        payload.positions[user._user_id]._display_name = user._display_name ? user._display_name : user._user_id;
    }
    if (client?.readyState === WebSocket.OPEN) {
        // client.send('a websocket connection was opened');
        // console.log(JSON.stringify(payload) + " sent to " + client._user_id);
        console.log(payload);
        client.send(JSON.stringify(payload));
    }
}

let previousTickTimeStamp = Date.now();

async function serverTick(userMap) {

    /* get time elapsed from previous tick */
    const currentTime = Date.now();
    let deltaTime = currentTime - previousTickTimeStamp;
    previousTickTimeStamp = currentTime;

    /* check if we need to move any players */

    const payload = { type: 'playerPositions', positions: { } };

    Object.values(userMap).forEach(user => {
        if (user._moving) {

            const userNewPosition = lerp(user._cur_pos, user._target_pos, user._max_speed, deltaTime);
            user._cur_pos = userNewPosition;
            payload.positions[user._user_id] = JSON.parse(JSON.stringify(user._cur_pos));
            payload.positions[user._user_id].color = user._color;
            payload.positions[user._user_id]._display_name = user._display_name;
            // console.log(JSON.stringify(user._cur_pos));
            if (user._cur_pos.x === user._target_pos.x && user._cur_pos.y === user._target_pos.y) { user._moving = false; }
        }
    });

    if (!(Object.keys(payload.positions).length)) return; /* no need to broadcast if nothing has changed */

    /* broadcast the new user positions */
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            // client.send('a websocket connection was opened');
            client.send(JSON.stringify(payload));
        }
    });

};
