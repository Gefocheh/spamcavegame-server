const WebSocket = require('ws');
const fs = require('fs');
const { db, initDB } = require('./db');

/* ================= CONFIG ================= */

const CLIENT_VERSION = '1.0.0';

const MAX_PLAYERS = 19;
const MAX_BLOCKS = 200000;

const MAX_MOVE_DIST = 10;
const BLOCK_INTERACT_DIST = 6;

const MSG_LIMIT = 30;
const MSG_INTERVAL = 1000;

/* ================= HELPERS ================= */

const isNumber = n => typeof n === 'number' && Number.isFinite(n);

// ИСПРАВЛЕНО: (a.x-a.x) -> (a.x-b.x)
const dist = (a, b) =>
  Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);

const escapeHTML = s =>
  String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

function rateLimit(ws) {
  const now = Date.now();
  ws._rate = ws._rate || { count: 0, time: now };

  if (now - ws._rate.time > MSG_INTERVAL) {
    ws._rate.count = 0;
    ws._rate.time = now;
  }

  ws._rate.count++;
  return ws._rate.count <= MSG_LIMIT;
}
console.log('=== ENV CHECK ===');
console.log('DB_CLIENT:', process.env.DB_CLIENT);
console.log('DATABASE_URL exists?', !!process.env.DATABASE_URL);
console.log('INTERNAL_DATABASE_URL exists?', !!process.env.INTERNAL_DATABASE_URL);
console.log('DB_HOST:', process.env.DB_HOST);
console.log('=== END ENV CHECK ===');
/* ================= WORLD ================= */

class ServerWorld {
  constructor() {
    this.blocks = new Map();
    this.players = new Map();
    this.wss = null;
  }

  key(x, y, z) { return `${x}|${y}|${z}`; }

  async load() {
    const rows = await db('blocks');
    for (const r of rows) {
      this.blocks.set(this.key(r.x, r.y, r.z), r);
    }
    if (this.blocks.size === 0) this.generateDefaultWorld();
  }

  async save() {
    await db('blocks').del();
    for (const b of this.blocks.values()) {
      await db('blocks').insert(b);
    }
  }

  // Изменённый метод generateDefaultWorld
generateDefaultWorld() {
    console.log("generating default world")
    for (let x = -70; x <= 70; x++)
        for (let z = -70; z <= 70; z++) {
            this.blocks.set(this.key(x, -2, z), { x, y: -2, z, type: 'stone' });
            this.blocks.set(this.key(x, -1, z), { x, y: -1, z, type: 'dirt' });
            this.blocks.set(this.key(x, 0, z), { x, y: 0, z, type: 'grass' });
        }
}

  addPlayer(ws) {
    const id = 'p' + Math.floor(Math.random() * 100000);
    const p = { x: 0, y: 5, z: 0, rotationY: 0, rotationX: 0, nickname: id };
    ws.id = id;
    this.players.set(id, p);
    return { id, player: p };
  }

  removePlayer(id) {
    this.players.delete(id);
    this.broadcast({ type: 'playerLeft', playerId: id });
  }

  movePlayer(ws, data) {
    const p = this.players.get(ws.id);
    if (!p) return;

    const delta = {
      x: data.x - p.x,
      y: data.y - p.y,
      z: data.z - p.z
    };

    if (
      Math.abs(delta.x) > MAX_MOVE_DIST ||
      Math.abs(delta.y) > MAX_MOVE_DIST ||
      Math.abs(delta.z) > MAX_MOVE_DIST
    ) return;

    p.x = data.x;
    p.y = data.y;
    p.z = data.z;
    p.rotationY = data.rotationY;
    p.rotationX = data.rotationX;

    this.broadcast({ type: 'playerMoved', playerId: ws.id, ...p }, ws.id);
  }

  setBlock(x, y, z, type) {
    const k = this.key(x, y, z);

    if (type === null) this.blocks.delete(k);
    else {
      if (this.blocks.size >= MAX_BLOCKS) return false;
      this.blocks.set(k, { x, y, z, type });
    }

    this.broadcast({
      type: type ? 'blockPlaced' : 'blockBroken',
      x, y, z, blockType: type
    });

    return true;
  }

  async savePlayer(id, p) {
    await db('players').insert({
      id,
      x: p.x, y: p.y, z: p.z,
      rotationY: p.rotationY,
      rotationX: p.rotationX,
      nickname: p.nickname
    }).onConflict('id').merge();
  }

  broadcast(msg, exclude = null) {
    const s = JSON.stringify(msg);
    this.wss.clients.forEach(c => {
      if (c.readyState === WebSocket.OPEN && c.id !== exclude) {
        c.send(s);
      }
    });
  }
}

/* ================= PLUGINS ================= */

class PluginAPI {
  constructor(world) {
    this._world = world;
    this._pluginName = 'unknown';
    this._wss = null;

    this.events = {
      playerJoin: [],
      playerLeave: [],
      blockPlace: [],
      blockBreak: [],
      chat: [],
      tick: []
    };

    this.commands = new Map();

    this.storage = {
      get: async (key, def = null) => {
        const row = await db('plugin_data')
          .where({ plugin: this._pluginName, key }).first();
        return row ? JSON.parse(row.value) : def;
      },
      set: async (key, val) => {
        await db('plugin_data')
          .insert({ plugin: this._pluginName, key, value: JSON.stringify(val) })
          .onConflict(['plugin', 'key']).merge();
      }
    };

    // ограниченный доступ к миру
    this.world = {
      getBlock: (x, y, z) => this._world.blocks.get(this._world.key(x, y, z)) || null,
      setBlock: (x, y, z, type) => this._world.setBlock(x, y, z, type)
    };

    // НОВОЕ: методы для работы с игроками
    this.players = {
      get: (id) => this._world.players.get(id) || null,
      getAll: () => [...this._world.players.entries()],
      sendMessage: (id, text) => {
        if (!this._wss) return;
        for (const client of this._wss.clients) {
          if (client.id === id && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'chat',
              playerId: 'SYSTEM',
              text: String(text)
            }));
            break;
          }
        }
      },
      kick: (id, reason = 'Kicked') => {
        if (!this._wss) return;
        for (const client of this._wss.clients) {
          if (client.id === id && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'kick', reason }));
            client.close();
            break;
          }
        }
      }
    };
  }

  _setPluginName(n) { this._pluginName = n; }
  attachWSS(wss) { this._wss = wss; }

  on(event, fn) {
    if (this.events[event]) this.events[event].push(fn);
  }

  emit(event, data) {
    if (!this.events[event]) return true;

    for (const fn of this.events[event]) {
      try {
        if (fn(data) === false) return false;
      } catch (e) {
        console.error('[PLUGIN ERROR]', e);
      }
    }
    return true;
  }

  registerCommand(cmd) {
    if (!cmd.name || typeof cmd.handler !== 'function') return;
    this.commands.set(cmd.name, cmd);
  }
}

class PluginManager {
  constructor(api) { this.api = api; }

  loadAll() {
    if (!fs.existsSync('./plugins')) return;

    fs.readdirSync('./plugins')
      .filter(f => f.endsWith('.js'))
      .forEach(file => {
        try {
          const p = require('./plugins/' + file);
          this.api._setPluginName(file.replace('.js', ''));
          p.init(this.api);
          console.log('[PLUGIN]', file);
        } catch (e) {
          console.error(e);
        }
      });
  }
}

/* ================= START ================= */

(async () => {

  await initDB();

  const world = new ServerWorld();
  await world.load();

  const api = new PluginAPI(world);
  const plugins = new PluginManager(api);
  plugins.loadAll();

  const PORT = process.env.PORT || 8080;
  const wss = new WebSocket.Server({ port: PORT });

  world.wss = wss;
  api.attachWSS(wss);

  console.log('Server started');

  wss.on('connection', ws => {

    if (world.players.size >= MAX_PLAYERS) {
      ws.close(); return;
    }

    const { id, player } = world.addPlayer(ws);

    api.emit('playerJoin', { playerId: id });
    console.log(`Player joined: ${id} (${player.nickname})`);
    ws.send(JSON.stringify({
      type: 'worldState',
      blocks: [...world.blocks.values()],
      players: [...world.players.entries()],
      playerId: id
    }));

    world.broadcast({ type: 'playerJoined', playerId: id, ...player }, id);

    ws.on('message', async raw => {
      if (!rateLimit(ws)) return;

      let data;
      try { data = JSON.parse(raw); } catch { return; }

      if (data.clientVersion && data.clientVersion !== CLIENT_VERSION) {
        ws.close(); return;
      }

      if (data.type === 'playerUpdate') {
        if (
          isNumber(data.x) && isNumber(data.y) && isNumber(data.z) &&
          isNumber(data.rotationY) && isNumber(data.rotationX)
        ) {
          world.movePlayer(ws, data);
        }
      }

      if (data.type === 'blockPlace' || data.type === 'blockBreak') {
        const p = world.players.get(ws.id);
        if (!p) return;

        if (dist(p, data) > BLOCK_INTERACT_DIST) return;

        const evt = {
          playerId: ws.id,
          x: data.x, y: data.y, z: data.z,
          blockType: data.blockType
        };

        const ok = api.emit(
          data.type === 'blockPlace' ? 'blockPlace' : 'blockBreak',
          evt
        );

        if (!ok) return;

        world.setBlock(
          data.x, data.y, data.z,
          data.type === 'blockPlace' ? data.blockType : null
        );
      }

      if (data.type === 'chat') {
        const text = escapeHTML(data.text).slice(0, 200);

        if (text.startsWith('/')) {
          const [name, ...args] = text.slice(1).split(/\s+/);
          const cmd = api.commands.get(name);

          if (cmd) cmd.handler(ws.id, args);
          return;
        }

        if (api.emit('chat', { playerId: ws.id, text }) === false) return;

        world.broadcast({ type: 'chat', playerId: ws.id, text });
      }
    });

    ws.on('close', async () => {
      api.emit('playerLeave', { playerId: id });
      console.log(`Player left: ${id}`);
      world.removePlayer(id);
    });
  });

  // Автосохранение мира и всех игроков раз в минуту
  setInterval(async () => {
    api.emit('tick', {});
    await world.save();

    // Сохраняем всех текущих игроков (состояние на момент таймера)
    for (const [id, p] of world.players) {
      await world.savePlayer(id, p);
    }
  }, 60000);

})();
