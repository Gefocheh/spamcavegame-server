const WebSocket = require('ws');
const fs = require('fs');
const path = require('path'); // добавлен недостающий импорт

/* ================= CONFIG ================= */

const CLIENT_VERSION = '0.3.0';
const SAVE_FILE = 'world.json';

const MAX_PLAYERS = 20;
const MAX_BLOCKS = 200_000;
const MAX_MOVE_DIST = 10;
const BLOCK_INTERACT_DIST = 6;
const MSG_LIMIT = 30; // сообщений
const MSG_INTERVAL = 1000; // мс

/* ================= HELPERS ================= */

const isNumber = n => typeof n === 'number' && Number.isFinite(n);

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

/* ================= WORLD ================= */

class ServerWorld {
  constructor() {
    this.blocks = new Map();
    this.players = new Map();
    this.wss = null;
    this.silent = false;
  }

  key(x, y, z) {
    return `${x}|${y}|${z}`;
  }

  /* ===== BLOCKS ===== */

  setBlock(x, y, z, type) {
    const k = this.key(x, y, z);

    if (type === null) this.blocks.delete(k);
    else {
      if (this.blocks.size >= MAX_BLOCKS) return false;
      this.blocks.set(k, { x, y, z, type });
    }

    if (!this.silent) {
      this.broadcast({
        type: type ? 'blockPlaced' : 'blockBroken',
        x, y, z,
        blockType: type
      });
    }
    return true;
  }

  /* ===== PLAYERS ===== */

  addPlayer(ws) {
    const id = 'p' + Math.floor(Math.random() * 100000);
    const player = {
      x: 0, y: 5, z: 0,
      rotationY: 0,
      rotationX: 0,
      nickname: id
    };

    ws.id = id;
    ws.nickname = id;
    this.players.set(id, player);

    return { id, player };
  }

  removePlayer(id) {
    if (!this.players.has(id)) return;
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

    this.broadcast({
      type: 'playerMoved',
      playerId: ws.id,
      ...p
    }, ws.id);
  }

  /* ===== NETWORK ===== */

  broadcast(msg, excludeId = null) {
    if (!this.wss) return;
    const str = JSON.stringify(msg);
    this.wss.clients.forEach(c => {
      if (c.readyState === WebSocket.OPEN && c.id !== excludeId) {
        c.send(str);
      }
    });
  }

  /* ===== SAVE / LOAD ===== */

  save() {
    const data = {
      blocks: [...this.blocks.values()]
    };
    fs.writeFileSync(SAVE_FILE, JSON.stringify(data));
    console.log('[SAVE] world saved');
  }

  load() {
    if (!fs.existsSync(SAVE_FILE)) {
      this.generateDefaultWorld(25);
      return;
    }

    try {
      const data = JSON.parse(fs.readFileSync(SAVE_FILE));
      this.blocks.clear();
      (data.blocks || []).forEach(b =>
        this.blocks.set(this.key(b.x, b.y, b.z), b)
      );
    } catch (e) {
      console.error('World load error, regenerating', e);
      this.generateDefaultWorld(25);
    }
  }

  generateDefaultWorld(size) {
    console.log('[WORLD] generating');
    this.silent = true;
    for (let x = -size; x <= size; x++)
      for (let z = -size; z <= size; z++) {
        this.setBlock(x, 0, z, 'grass');
        this.setBlock(x, -1, z, 'dirt');
        this.setBlock(x, -2, z, 'stone');
      }
    this.silent = false;
  }
}

/* ================= PLUGIN SYSTEM ================= */

class PluginAPI {
  constructor(world) {
    this._world = world;
    this._wss = null;
    this._pluginName = 'unknown';

    /* ===== util ===== */
    this.log = (...args) => console.log('[PLUGIN]', ...args);

    /* ===== events ===== */
    this.events = {
      playerJoin: [],
      playerLeave: [],
      blockPlace: [],
      blockBreak: [],
      chat: [],
      tick: []
    };

    /* ===== storage ===== */
    this.storage = {
      get: (key, def = null) => {
        const data = this._loadStorage();
        return key in data ? data[key] : def;
      },
      set: (key, value) => {
        const data = this._loadStorage();
        data[key] = value;
        this._saveStorage(data);
      },
      all: () => this._loadStorage()
    };

    /* ===== world ===== */
    this.world = {
      getBlock: (x, y, z) =>
        world.blocks.get(world.key(x, y, z)) || null,
      setBlock: (x, y, z, type) =>
        world.setBlock(x, y, z, type)
    };

    /* ===== players ===== */
    this.players = {
      get: id => world.players.get(id) || null,
      getAll: () => [...world.players.entries()],
      sendMessage: (id, text) => {
        if (!this._wss) return;
        for (const c of this._wss.clients) {
          if (c.id === id && c.readyState === WebSocket.OPEN) {
            c.send(JSON.stringify({
              type: 'chat',
              playerId: 'SYSTEM',
              text: String(text)
            }));
          }
        }
      },
      kick: (id, reason = 'Kicked') => {
        if (!this._wss) return;
        for (const c of this._wss.clients) {
          if (c.id === id) {
            c.send(JSON.stringify({ type: 'kick', reason }));
            c.close();
          }
        }
      }
    };

    /* ===== commands ===== */
    this.commands = new Map();
  }

  // Методы класса
  _setPluginName(name) {
    this._pluginName = name;
  }

  _storageFile() {
    return path.join(__dirname, 'plugins', 'data', this._pluginName + '.json');
  }

  _loadStorage() {
    try {
      const file = this._storageFile();
      if (!fs.existsSync(file)) return {};
      return JSON.parse(fs.readFileSync(file));
    } catch {
      return {};
    }
  }

  _saveStorage(data) {
    const dir = path.join(__dirname, 'plugins', 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this._storageFile(), JSON.stringify(data, null, 2));
  }

  attachWSS(wss) {
    this._wss = wss;
  }

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
  constructor(api) {
    this.api = api;
  }

  loadAll() {
    if (!fs.existsSync('./plugins')) return;

    fs.readdirSync('./plugins')
      .filter(f => f.endsWith('.js'))
      .forEach(file => {
        try {
          const plugin = require('./plugins/' + file);
          this.api._setPluginName(file.replace('.js', ''));
          plugin.init(this.api);
          console.log('[PLUGIN]', file, 'loaded');
        } catch (e) {
          console.error('[PLUGIN ERROR]', file, e);
        }
      });
  }
}
// Лишняя функция loadAll удалена

/* ================= SERVER START ================= */

const world = new ServerWorld();
world.load();

const api = new PluginAPI(world);
const plugins = new PluginManager(api);
plugins.loadAll();

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });
world.wss = wss;
api.attachWSS(wss);

console.log('Server started on ws://localhost:8080');

/* ================= CONNECTION ================= */

wss.on('connection', ws => {
  if (world.players.size >= MAX_PLAYERS) {
    ws.close();
    return;
  }

  ws.on('message', raw => {
    if (!rateLimit(ws)) return;

    let data;
    try { data = JSON.parse(raw); } catch { return; }

    if (data.clientVersion && data.clientVersion !== CLIENT_VERSION) {
      ws.send(JSON.stringify({
        type: 'versionMismatch',
        serverVersion: CLIENT_VERSION
      }));
      ws.close();
      return;
    }

    if (data.type === 'playerUpdate') {
      if (
        isNumber(data.x) &&
        isNumber(data.y) &&
        isNumber(data.z) &&
        isNumber(data.rotationY) &&
        isNumber(data.rotationX)
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
        x: data.x,
        y: data.y,
        z: data.z,
        blockType: data.blockType
      };

      const ok = api.emit(
        data.type === 'blockPlace' ? 'blockPlace' : 'blockBreak',
        evt
      );

      if (!ok) return;

      world.setBlock(data.x, data.y, data.z,
        data.type === 'blockPlace' ? data.blockType : null
      );
    }

    if (data.type === 'chat') {
      const text = escapeHTML(data.text).slice(0, 200);

      // команды
      if (text.startsWith('/')) {
        const [name, ...args] = text.slice(1).split(/\s+/);
        const cmd = api.commands.get(name);

        if (cmd) {
          try {
            cmd.handler(ws.id, args);
          } catch (e) {
            api.log('Command error:', e);
          }
        } else {
          api.players.sendMessage(ws.id, 'Unknown command');
        }
        return;
      }

      if (api.emit('chat', { playerId: ws.id, text }) === false) return;
      world.broadcast({ type: 'chat', playerId: ws.id, text });
    }
  });

  const { id, player } = world.addPlayer(ws);
  api.emit('playerJoin', { playerId: id });

  ws.send(JSON.stringify({
    type: 'worldState',
    blocks: [...world.blocks.values()],
    players: [...world.players.entries()],
    playerId: id
  }));

  world.broadcast({ type: 'playerJoined', playerId: id, ...player }, id);

  ws.on('close', () => {
    api.emit('playerLeave', { playerId: id });
    world.removePlayer(id);
  });
});

/* ================= AUTOSAVE ================= */

setInterval(() => {
  api.emit('tick', {});
  world.save();

}, 60000);
