import WebSocket, { WebSocketServer } from "ws";

const messageObjs = [];
let users = [];
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
    ws._x = 0;
    ws._y = 0;

    numConnections++;
    users.push(ws._user_id);

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
        
        if (dataJson?.type === 'move') { /**/ return; }
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
        }
    });

    ws.on('close', function message() {
        numConnections--;
        users = users.filter(item => item !== ws._user_id);
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) { 
                // client.send('a websocket was closed'); 
                client.send(JSON.stringify({type: 'logs', logText:ws._user_id + ' left the server'}));
                client.send(JSON.stringify({type: 'ulist-update', ulist: users}));
            }
        })
    });
    console.log('total connected users: ' + numConnections);
});

/* helpers */
function createRandomString(length) {
    const chars = 'ABCDEFG12345';
    let result = '';

    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
