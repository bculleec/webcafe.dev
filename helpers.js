
/* helpers */
function createRandomString(length) {
    const chars = 'ABCDEFG12345';
    let result = '';

    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function lerp(curPos, targetPos, speed, deltaTime) {
    const dx = targetPos.x - curPos.x;
    const dy = targetPos.y - curPos.y;
    const dist = Math.hypot(dx, dy);

    /* the user's speed represents amount moved per deltatime*/
    speed = speed * deltaTime / 1000;

    if (dist === 0) return curPos;      
    if (dist <= speed) return targetPos;

    const ratio = speed / dist;       

    return {
        x: curPos.x + dx * ratio,
        y: curPos.y + dy * ratio
    };
}

function getRandomColor() {
    const randomColor = Math.floor(Math.random() * 16777215);
    return randomColor;
}

export { createRandomString, lerp, getRandomColor };