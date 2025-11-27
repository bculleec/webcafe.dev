import WebSocket from "ws";

/* create a new websocket */
const socket = new WebSocket('ws://localhost:8080');

/* execute when connection established */
socket.addEventListener('open', event => {
    socket.send('Hello server.');
});

socket.on('message', function message(data){
    console.log('%s', data);
});