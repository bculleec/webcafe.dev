import WebSocket, { WebSocketServer } from "ws";

const messageObjs = [];
let users = [];
let userMap = { };
let chans = {
    'chan1': {maxUsers: 5, users: []},
    'chan2': {maxUsers: 3, users: []},
    'chan3': {maxUsers: 2, users: []}
};

let numConnections = 0;

const wss = new WebSocketServer({ port: 8080 }, () => {
    console.log('the server is listening');
});

wss.on('connection', function connection(ws) {

    // assign an anonymous id to this user
    let randString = createRandomString(10);
    while (users.includes(randString)) {
        randString = createRandomString(10);
    } 

    /* assign a random id */
    ws._user_id = randString;
    ws._chan = null;
    
    /* initialize */
    ws._cur_pos = { x: 0, y: 0 };
    ws._max_speed = 0.2; /* arbitrary num */

    numConnections++;
    users.push(ws._user_id);
    userMap[ws._user_id] = ws;

    ws.on('error', console.error);

    ws.on('message', function message(data) {
        console.log('received: %s', data);
        let dataJson;
        try {
            dataJson = JSON.parse(data);
        } catch (err) {
            console.error(err);
        }

        if (!dataJson) return;
        
        if (dataJson?.type === 'move') { /* update the user's target position */ 
            if (typeof dataJson.targetPos?.x === 'number' && typeof dataJson.targetPos?.y === 'number') {
                ws._target_pos = { x : dataJson.targetPos.x, y : dataJson.targetPos.y };
                if (JSON.stringify(ws._cur_pos) !== (JSON.stringify(ws._target_pos))) { ws._moving = true; }
                console.log('user ' + ws._user_id + ' wants to move to ' + JSON.stringify(ws._target_pos));
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
        }
        
        const logMsg = { user: ws._user_id, content: dataJson.q?.toString(), at: Date.now(), chan: dataJson.chan };
        messageObjs.push(logMsg); 
        console.log(logMsg);
        
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
            client.send(JSON.stringify({type: 'ulist-update', ulist: users}));

            sendPositionsAll(client);

    
        }
    });

    ws.on('close', function message() {
        numConnections--;
        users = users.filter(item => item !== ws._user_id);
        delete userMap[ws._user_id];
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) { 
                // client.send('a websocket was closed'); 
                client.send(JSON.stringify({type: 'logs', logText:ws._user_id + ' left the server'}));
                client.send(JSON.stringify({type: 'ulist-update', ulist: users}));

                sendPositionsAll(client);
            }
        })
    });
    console.log('total connected users: ' + numConnections);
});

setInterval(serverTick, 1000 / 50, userMap);

function sendPositionsAll(client) {
    /* refresh all positions for all players because someone just joined*/
    const payload = { type: "playerPositions" ,  positions: {  }, refresh: true};

    for (const user of wss.clients) {
        payload.positions[user._user_id] = user._cur_pos;
    }
    if (client.readyState === WebSocket.OPEN) {
        // client.send('a websocket connection was opened');
        client.send(JSON.stringify(payload));
    }
}

function serverTick(userMap) {
    /* check if we need to move any players */

    const payload = { type: 'playerPositions', positions: { } };

    Object.values(userMap).forEach(user => {
        if (user._moving) {
            const userNewPosition = lerp(user._cur_pos, user._target_pos, user._max_speed);
            user._cur_pos = userNewPosition;
            payload.positions[user._user_id] = user._cur_pos;
            console.log(JSON.stringify(user._cur_pos));
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

/* helpers */
function createRandomString(length) {
    const chars = 'ABCDEFG12345';
    let result = '';

    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function lerp(curPos, targetPos, speed) {
    const dx = targetPos.x - curPos.x;
    const dy = targetPos.y - curPos.y;
    const dist = Math.hypot(dx, dy);

    if (dist === 0) return curPos;      
    if (dist <= speed) return targetPos;

    const ratio = speed / dist;       

    return {
        x: curPos.x + dx * ratio,
        y: curPos.y + dy * ratio
    };
}
