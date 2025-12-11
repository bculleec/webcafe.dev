/* imports */

import { WebSocketServer } from "ws";
import { createRandomString, getRandomColor, lerp } from "./helpers.js";
import { zones } from './zones.js';

console.log(zones);

/* constants */
const SERVER_LISTEN_PORT = 8080;
const SERVER_TICK_RATE_HZ = 50;
const MAX_USER_TIMEOUT = 120 * 1000; // milliseconds (time a client is allowed to be on the server without sending a heartbeat)
const MAX_MESSAGES_PER_SECOND = 100; // rate limit the user
const MAX_MESSAGE_CHARACTER_LENGTH = 71;
const PLAYER_ID_CHARACTER_LENGTH = 10;

const MIN_WORLD_LIMIT = -15;
const MAX_WORLD_LIMIT = 15; // used for bounds checking

/* global players object */
const userMap = {};

/* start the server */
const wss = new WebSocketServer({ port: SERVER_LISTEN_PORT }, () => {
    console.log(`Server is listening on port ${SERVER_LISTEN_PORT}`);
});

/* websocket server event listeners */
wss.on('connection', handleNewClientConnection);

/* websocket server event handlers */
function handleNewClientConnection (ws) {

    /* a new client joins */
    const newId = generateUserId(PLAYER_ID_CHARACTER_LENGTH, Object.keys(userMap));
    
    initializeUserProperties(ws, newId);
    addToUserMap(userMap, newId, ws);
    alertExistingClients(newId, userMap, 'join');

    /* client events */
    ws.on('error', handleClientError);

    ws.on('message', (data) => { handleClientMessage(data, ws) });

    ws.on('close', () => { handleClientLeaveEvent(ws) });
};

/* client event handlers */

function handleClientLeaveEvent(user) {
    delete userMap[user._user_id];
    alertExistingClients(user._user_id, userMap, 'leave');
}

function handleClientError(error) {
    console.error(error);
}

function handleClientMessage(data, user) {
    /* rate limit check the user */
    if (exceededRateLimit(user)) { 
        sendRateLimitExceededError(user);
        return; /* hitting us too often */ 
    }
    incrementUserMessageCount(user);

    /* parse the data */
    let jsonData;
    try {
        jsonData = JSON.parse(data);
    } catch (error) {
        console.error(error);
        return;
    }

    let messageType;
    if (jsonData.type) { messageType = jsonData.type; }
    else { console.error('No message type was provided.'); return; }

    /* handle different possible message types */
    if (messageType === 'move') { handleClientMoveMessage(user, jsonData); }
    else if (messageType === 'join-chan') { handleClientJoinChannelMessage(jsonData); }
    else if (messageType === 'leave-chan') { handleClientLeaveChannelMessage(jsonData); }
    else if (messageType === 'ping') { handleClientPingMessage(user, jsonData); }
    else if (messageType === 'set_name') { handleClientNameChangeMessage(user, jsonData); }
    else { handleClientChatMessage(user, jsonData); }
    
    console.log(user._user_id);
}

function handleClientMoveMessage(user, data) {
    /* Update the user's target position */
    if (!(data.targetPos)) { console.error('User tried to move but no target position.');return; } 
    if (isValidTargetPosition(data.targetPos)) {
        if (isOutOfWorldBounds(data.targetPos)) { 
            console.error('User tried to move but target position was out of bounds: ', JSON.stringify(data.targetPos));
            return;
        }

        /* user position should be valid */
        setUserTargetPosition(user, newTargetPositionObj(data.targetPos));

    } else {
        console.error('User tried to move but target position was invalid.')
    }
}

function handleClientJoinChannelMessage(data) {

}

function handleClientLeaveChannelMessage(data) {

}

function handleClientPingMessage(user, data) {
    user._last_pinged_time = Date.now();
}

function handleClientNameChangeMessage(user, data) {
    user._display_name = data.username ?? ws._user_id;
}

function handleClientChatMessage(user, data) {
    if (data.chan && data.chan === 'global') {
        const messageBroadcastTargets = wss.clients; /* to all connected clients */
        broadcastMessageToClients(user._display_name || user._user_id, data, messageBroadcastTargets);
    }
}

/* event handler helpers */

function alertExistingClients(userId, userMap, action) {
    /* alert existing clients that a new client has joined/left */
    const messageBroadcastTargets = wss.clients;

    let actionMessage;

    if (action === 'join') {
        actionMessage = ' joined the server'
    } else if (action === 'leave') {
        actionMessage = ' left the server'
    } else if (action === 'kick') {
        actionMessage = ' was kicked'
    }

    messageBroadcastTargets.forEach(client => {
        client.send(JSON.stringify({type: 'logs', logText: userId + actionMessage}));
        client.send(JSON.stringify({type: 'ulist-update', ulist: Object.keys(userMap)}));

        syncAllUserPositionsWith(client, userMap);
    });
}

/* 
* the client argument is the one we want to sync with (i.e make sure they have up-to-date positions on all players)
*/
function syncAllUserPositionsWith(client, userMap) {
    /* initialize the payload object */
    const payload = { type: 'playerPositions', positions: {}, refresh: true };

    /* build the payload with all user positions */
    for (const userId of Object.keys(userMap)) {
        const user = userMap[userId];
        payload.positions[userId] = objectCopy(user._current_position);
        
        /* also provide details on color and name (visuals) */
        payload.positions[userId].color = user._avatar_color;
        payload.positions[userId]._display_name = user._display_name ? user._display_name : user._user_id;
        if (client._user_id === userId) { payload.positions[userId].self = true; }
    };

    if (client.readyState === WebSocket.OPEN) { client.send(JSON.stringify(payload)); }
}

function broadcastMessageToClients(senderName, message, clients) {
    if (!(message.q)) { console.error('User tried to send a message but no q property found...'); return; }
    message.q = message.q.substring(0, MAX_MESSAGE_CHARACTER_LENGTH);
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) { client.send(JSON.stringify(createUserChatMessage(senderName, message.q))); }
    });
}

function setUserTargetPosition(user, targetPos) {
    user._target_position = targetPos;
    if (JSON.stringify(user._current_position) !== JSON.stringify(user._target_position)) { user._is_moving = true; }
}

function exceededRateLimit(user) {
    const now = Date.now();
    const timeSinceLastRateLimitCheck = now - user._last_rate_limit_reset;

    if (timeSinceLastRateLimitCheck > 1000) { /* milliseconds */
        user._messages_past_second = 0;
        user._last_rate_limit_reset = now;
    }

    return (user._messages_past_second > MAX_MESSAGES_PER_SECOND);
}

function incrementUserMessageCount(user) {
    user._messages_past_second++;
}


function sendRateLimitExceededError(user) {

}

function addToUserMap(uMap, id ,user) {
    uMap[id] = user;
}


function initializeUserProperties(user, userId) {
    user._user_id = userId;

    /* networking */
    user._connected_channel = null;
    user._last_pinged_time = Date.now();

    user._messages_past_second = 0;
    user._last_rate_limit_reset = Date.now();

    user._current_position = { x: 0, y: 0 };
    user._target_position = { x: 0, y: 0 };
    user._max_speed = 6; /* units per second */
    user._is_moving = false;
    user._avatar_color = getRandomColor();

    console.log('Client properties initialized...');
}

/* helpers */
function generateUserId(idLength, existingIds) { /* keep generating until not in existing Ids */
    
    let generatedId = createRandomString(idLength);

    while (existingIds.includes(generatedId)) {
        generatedId = createRandomString(idLength);
    }

    return generatedId;
}

function isValidTargetPosition(targetPos) {
    return (typeof targetPos.x === 'number' && typeof targetPos.y === 'number');
}

function isOutOfWorldBounds(targetPos) {
    return (targetPos.x < MIN_WORLD_LIMIT || targetPos.x > MAX_WORLD_LIMIT || targetPos.y < MIN_WORLD_LIMIT || targetPos.y > MAX_WORLD_LIMIT);
}

function newTargetPositionObj(targetPos) {
    return { x: targetPos.x, y: targetPos.y };
}

function createUserChatMessage(userId, message) {
    return {type: 'logs', logText:userId + ' says: ' + message};
}

function objectCopy(obj) {
    return JSON.parse(JSON.stringify(obj));
}

/* server tick logic */
setInterval(serverTick, 1000 / SERVER_TICK_RATE_HZ, userMap);
setInterval(serverCheckGhosts, MAX_USER_TIMEOUT, userMap);
wss.previousTickTimeStamp = Date.now();

function serverTick(userMap) {
    const now = Date.now();
    const deltaTime = now - wss.previousTickTimeStamp;
    wss.previousTickTimeStamp = now;

    movePlayers(userMap, deltaTime);

    const messageBroadcastTargets = wss.clients;

    messageBroadcastTargets.forEach(client => {
        syncAllUserPositionsWith(client, userMap);
    });
}

function movePlayers(userMap, deltaTime) {
    for (const userId of Object.keys(userMap)) {
        const user = userMap[userId];
        if (user._is_moving) {
            const userNewPosition = lerp(user._current_position, user._target_position, user._max_speed, deltaTime);
            user._current_position.x = userNewPosition.x;
            user._current_position.y = userNewPosition.y;
            if (user._current_position.x === user._target_position.x && user._current_position.y === user._target_position.y) { user._is_moving = false; }
            const zone = userInZone(user, zones);
            if (zone) { user._current_position._zone = zone; }
            else {user._current_position._zone = null;}
        } 
    }
}

function userInZone(user, zones) {
    for (const zone of zones) {
        if (user._current_position.x >= zone.x1 && user._current_position.x <= zone.x2 && user._current_position.y >= zone.z1 && user._current_position.y <= zone.z2) {
            return zone.name;
        }
    }
}

function serverCheckGhosts(userMap) {
    const now = Date.now();

    for (const userId of Object.keys(userMap)) {
        const user = userMap[userId];
        if (!(user._last_pinged_time)) { kickUser(user); continue; }
        const timeSinceLastPing = now - user._last_pinged_time;

        if (timeSinceLastPing > MAX_USER_TIMEOUT) { kickUser(user); }
    }
}

function kickUser(user) {
    delete userMap[user._user_id];
    alertExistingClients(user._user_id, userMap, 'kick');
    if (user.readyState === WebSocket.OPEN) { user.terminate(); }
}
