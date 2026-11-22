'use strict';
/**
 * VALOR STRIKE — WebSocket 中継サーバー
 *
 * 役割は「状態のリレー」だけ。ゲームロジック（当たり判定・HP計算・Bot AI）は
 * 一切持たず、各クライアントが自分のキャラをローカルで操作し、サーバーは
 * ルーム内の他メンバーへメッセージを転送する。
 *
 * プロトコル: JSON over WebSocket
 *  C→S {t:"join", room, name, team}
 *      → 本人へ {t:"welcome", id, peers:[{id,name,team}...]}
 *      → ルーム内他全員へ {t:"peer-join", id, name, team}
 *  C→S {t:"state", p:[x,y,z], yaw, pitch, flags:{crouch,ads,sprint,air}, hp, alive, weapon, bots?:[...]}
 *      → ルーム内他全員へ {t:"state", id:<送信者id>, ...そのまま}
 *  C→S {t:"event", kind, to?, data}
 *      → to があればその相手だけへ、無ければルーム内他全員へ {t:"event", kind, from:<送信者id>, data}
 *  切断時 → ルーム内へ {t:"peer-leave", id}、空ルームは破棄
 *
 * 制約:
 *  - 1ルーム最大10人（超過は {t:"error", msg} を返して切断）
 *  - 不正なJSON / join 前の state・event は無視
 *  - メッセージサイズ上限 16KB（超過は切断）
 *  - 30秒無通信は切断（ws の ping/pong ハートビート）
 * HTTP: GET / でステータス（稼働中・ルーム数・接続数）を返す
 * ポート: process.env.PORT || 8080
 */

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const MAX_PER_ROOM = 10;
const MAX_MESSAGE_BYTES = 16 * 1024; // 16KB
const HEARTBEAT_MS = 5000;           // 5秒ごとに ping、応答がなければ次回に切断（実質10秒無通信で切断）

/** rooms: Map<roomName, Map<clientId, client>> */
const rooms = new Map();
let nextId = 1;
let totalConnections = 0;

const httpServer = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    let members = 0;
    for (const room of rooms.values()) members += room.size;
    const body = JSON.stringify({
      ok: true,
      service: 'valor-strike-server',
      rooms: rooms.size,
      connections: members,
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
});

const wss = new WebSocketServer({
  server: httpServer,
  maxPayload: MAX_MESSAGE_BYTES,
});

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

/** ルーム内の「自分以外」全員へ送る */
function broadcast(roomMap, exceptId, obj) {
  const raw = JSON.stringify(obj);
  for (const [id, client] of roomMap) {
    if (id === exceptId) continue;
    if (client.ws.readyState === client.ws.OPEN) client.ws.send(raw);
  }
}

wss.on('connection', (ws) => {
  totalConnections++;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  let joined = false;
  let myId = null;
  let myRoom = null;

  ws.on('message', (data) => {
    // サイズ上限（maxPayload でも弾くが、明示チェックで確実に切断する）
    const size = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(String(data));
    if (size > MAX_MESSAGE_BYTES) {
      ws.terminate();
      return;
    }

    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return; // 不正なJSONは無視
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;

    if (msg.t === 'join') {
      if (joined) return; // 二重 join は無視
      const roomName = typeof msg.room === 'string' ? msg.room : '';
      if (!roomName) {
        send(ws, { t: 'error', msg: 'room is required' });
        ws.close();
        return;
      }
      let roomMap = rooms.get(roomName);
      if (!roomMap) {
        roomMap = new Map();
        rooms.set(roomName, roomMap);
      }
      if (roomMap.size >= MAX_PER_ROOM) {
        send(ws, { t: 'error', msg: 'room is full (max ' + MAX_PER_ROOM + ')' });
        ws.close();
        return;
      }
      myId = nextId++;
      myRoom = roomName;
      const me = {
        id: myId,
        name: typeof msg.name === 'string' ? msg.name : '',
        team: msg.team,
        ws,
      };
      const peers = [];
      for (const c of roomMap.values()) peers.push({ id: c.id, name: c.name, team: c.team });
      roomMap.set(myId, me);
      joined = true;
      send(ws, { t: 'welcome', id: myId, peers });
      broadcast(roomMap, myId, { t: 'peer-join', id: myId, name: me.name, team: me.team });
      return;
    }

    // join 前の state / event は無視
    if (!joined) return;

    const roomMap = rooms.get(myRoom);
    if (!roomMap) return;

    if (msg.t === 'state') {
      // 送信者 id を付けて（上書きして）ルーム内他全員へ転送
      msg.id = myId;
      broadcast(roomMap, myId, msg);
      return;
    }

    if (msg.t === 'event') {
      const out = { t: 'event', kind: msg.kind, from: myId, data: msg.data };
      if (msg.to != null) {
        const target = roomMap.get(msg.to);
        if (target) send(target.ws, out);
      } else {
        broadcast(roomMap, myId, out);
      }
      return;
    }
    if (msg.t === 'leave') {
      // 明示的な退出通知: ハートビート検出を待たず即座に片付けて peer-leave を配信する
      cleanup();
      try { ws.close(); } catch { /* noop */ }
      return;
    }
    // 未知のタイプは無視
  });

  function cleanup() {
    if (joined && myRoom != null) {
      const roomMap = rooms.get(myRoom);
      if (roomMap) {
        roomMap.delete(myId);
        broadcast(roomMap, myId, { t: 'peer-leave', id: myId });
        if (roomMap.size === 0) rooms.delete(myRoom);
      }
      joined = false;
    }
  }

  ws.on('close', cleanup);
  ws.on('error', () => {
    cleanup();
    try { ws.terminate(); } catch { /* noop */ }
  });
});

// ハートビート: 15秒ごとに ping。前回から pong が無ければ切断（＝30秒無通信で切断）
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);
wss.on('close', () => clearInterval(heartbeat));

httpServer.listen(PORT, () => {
  console.log(`valor-strike-server listening on port ${PORT}`);
});
