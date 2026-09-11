const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

/* ================= CONFIG ================= */

const CLIENT_VERSION = 'bdea-ng';
const SAVE_FILE = 'world.json';

const MAX_PLAYERS = 19;
const MAX_BLOCKS = 200_000 || process.env.BLOCKS;
const MAX_MOVE_DIST = 10;
const BLOCK_INTERACT_DIST = 6;
const MSG_LIMIT = 60;      // messages
const MSG_INTERVAL = 1000; // ms

/* creatures + mangos */
const MAX_ENTITIES = 100;
const CREATURE_HEALTH = 1500;
const CREATURE_SPAWN_COUNT = 5 || process.env.CREATURE_SPAWN_COUNT;
const CREATURE_SPAWN_INTERVAL_MS = 5 * 60 * 1000;   // 5 minutes
const CREATURE_ATTACK_DAMAGE = 100 || process.env.CREATURE_ATTACK_DAMAGE;
const CREATURE_ATTACK_INTERVAL_MS = 1000 || process.env.CREATURE_ATTACK_INTERVAL;           // 100 dmg / second
const CREATURE_ATTACK_RANGE = 2 || process.env.CREATURE_ATTACK_RANGE;
const CREATURE_CHASE_RANGE = 6 || process.env.CREATURE_CHASE_RANGE;
const CREATURE_WANDER_DIST = 5;
const CREATURE_WANDER_INTERVAL_MS = 10 * 1000;      // 10 seconds
const CREATURE_TICK_MS = 100;
const PLAYER_HIT_DAMAGE = 100;

const MANGO_SPREAD_INTERVAL_MS = 60 * 1000;         // 1 minute

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
    this.entities = new Map();       // id -> entity record
    this.wss = null;
    this.silent = false;
    this._nextEntityId = 0;
  }

  key(x, y, z) {
    return `${x}|${y}|${z}`;
  }

  /* ===== BLOCKS ===== */

  setBlock(x, y, z, type) {
    const k = this.key(x, y, z);

    if (type === null) {
      this.blocks.delete(k);
    } else {
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
      x: 0, y: 1, z: 0,
      rotationY: 0,
      rotationX: 0,
      nickname: id,
      health: 1993
    };

    ws.id = id;
    ws.nickname = id;
    this.players.set(id, player);
    console.log('newplayer ' + player.nickname);
    return { id, player };
  }

  removePlayer(id) {
    console.log('player discornect');
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

  /* ===== ENTITIES ===== */

  spawnEntity(data) {
    const id = 'e' + (++this._nextEntityId);
    const entity = {
      id,
      health: CREATURE_HEALTH,
      vy: 0,
      rotationY: 0,
      ...data
    };
    this.entities.set(id, entity);

    // note: `type` on the wire must be 'entitySpawn' so the client picks it up,
    // the real entity kind is carried on `entityType`
    this.broadcast({
      type: 'entitySpawn',
      entityId: id,
      id,
      x: entity.x,
      y: entity.y,
      z: entity.z,
      rotationY: entity.rotationY,
      entityType: entity.entityType || 'creature',
      health: entity.health
    });

    return entity;
  }

  updateEntity(id, patch) {
    const e = this.entities.get(id);
    if (!e) return;
    Object.assign(e, patch);
    this.broadcast({
      type: 'entityUpdate',
      entityId: id,
      ...patch
    });
  }

  removeEntity(id) {
    if (!this.entities.delete(id)) return;
    this.broadcast({ type: 'entityDespawn', entityId: id });
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
    console.log('no saving lol');
  }

  load() {
    this.generateDefaultWorld(100);
  }

  generateDefaultWorld(size) {
    console.log('[WORLD] generating');
    this.silent = true;
    for (let x = -size; x <= size; x++) {
      for (let z = -size; z <= size; z++) {
        const h = Math.floor(Math.sin(x / 5) * 2 + Math.cos(z / 5) * 2);

        this.setBlock(x, h, z, 'grass');
        this.setBlock(x, h - 1, z, 'dirt');
        this.setBlock(x, h - 2, z, 'stone');

        // healing 'mango' blocks sit on top of dirt, replacing the grass
        if (Math.random() < 0.03) {
          this.setBlock(x, h, z, 'mango');
        }
      }
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
              playerId: 'SERVER',
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
      },
      correctPos: (id, x, y, z) => {
        if (!this._wss) return;
        for (const c of this._wss.clients) {
          if (c.id === id && c.readyState === WebSocket.OPEN) {
            c.send(JSON.stringify({
              type: 'positionCorrection',
              x: Number(x),
              y: Number(y),
              z: Number(z)
            }));
          }
        }
      }
    };

    /* ===== commands ===== */
    this.commands = new Map();
  }

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

const sockets = new Map(); // playerId -> ws
console.log('Server started on ws://localhost:' + PORT);

/* ================= ENTITY HELPERS ================= */

/* does an aabb at (x,y,z) with the player-like size hit any solid block? */
function entityCollides(x, y, z) {
  const halfW = 0.3;
  const minX = Math.floor(x - halfW);
  const maxX = Math.floor(x + halfW);
  const minY = Math.floor(y);
  const maxY = Math.floor(y + 1.8);
  const minZ = Math.floor(z - halfW);
  const maxZ = Math.floor(z + halfW);

  for (let bx = minX; bx <= maxX; bx++) {
    for (let by = minY; by <= maxY; by++) {
      for (let bz = minZ; bz <= maxZ; bz++) {
        if (world.blocks.has(world.key(bx, by, bz))) return true;
      }
    }
  }
  return false;
}

function sendDamageToPlayer(playerId, damage) {
  const target = sockets.get(playerId);
  if (target && target.readyState === WebSocket.OPEN) {
    target.send(JSON.stringify({ type: 'damage', damage }));
  }
}

/* ================= CREATURE SPAWN ================= */

function spawnCreatures() {
  for (const [, player] of world.players) {
    for (let i = 0; i < CREATURE_SPAWN_COUNT; i++) {
      if (world.entities.size >= MAX_ENTITIES) {
        console.log('[SPAWN] reached entity cap, stopping');
        return;
      }

      const angle = Math.random() * Math.PI * 2;
      const d = 10 + Math.random() * 10;
      const x = Math.floor(player.x + Math.cos(angle) * d);
      const z = Math.floor(player.z + Math.sin(angle) * d);

      // find ground
      let y = 64;
      while (y > -16 && !world.blocks.has(world.key(x, y, z))) y--;
      if (y <= -16) continue;

      const spawnY = y + 1;

      // need empty space for the creature
      if (world.blocks.has(world.key(x, spawnY, z))) continue;
      if (world.blocks.has(world.key(x, spawnY + 1, z))) continue;

      world.spawnEntity({
        type: 'creature',
        entityType: 'creature',
        x: x + 0.5,
        y: spawnY,
        z: z + 0.5,
        rotationY: 0
      });
    }
  }
  console.log('[SPAWN] entities now:', world.entities.size);
}

/* ================= CREATURE TICK ================= */

function tickEntities() {
  const now = Date.now();

  for (const entity of [...world.entities.values()]) {

    // ---- find nearest player ----
    let nearest = null;
    let nearestId = null;
    let nearestDist = Infinity;

    for (const [pid, p] of world.players) {
      const dx = entity.x - p.x;
      const dy = entity.y - p.y;
      const dz = entity.z - p.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = p;
        nearestId = pid;
      }
    }

    // ---- attack if in range ----
    if (nearest && nearestDist <= CREATURE_ATTACK_RANGE) {
      if (now - (entity.lastAttack || 0) >= CREATURE_ATTACK_INTERVAL_MS) {
        entity.lastAttack = now;
        sendDamageToPlayer(nearestId, CREATURE_ATTACK_DAMAGE);
      }
    }

    // ---- choose target position ----
    let targetX, targetZ;

    if (nearest && nearestDist <= CREATURE_CHASE_RANGE) {
      targetX = nearest.x;
      targetZ = nearest.z;
    } else {
      if (
        !entity.wanderTarget ||
        now - (entity.lastWanderPick || 0) >= CREATURE_WANDER_INTERVAL_MS
      ) {
        entity.lastWanderPick = now;
        const a = Math.random() * Math.PI * 2;
        entity.wanderTarget = {
          x: entity.x + Math.cos(a) * CREATURE_WANDER_DIST,
          z: entity.z + Math.sin(a) * CREATURE_WANDER_DIST
        };
      }
      targetX = entity.wanderTarget.x;
      targetZ = entity.wanderTarget.z;
    }

    // ---- move toward target, no passing through blocks ----
    const dx = targetX - entity.x;
    const dz = targetZ - entity.z;
    const dHoriz = Math.sqrt(dx * dx + dz * dz);

    if (dHoriz > 0.4) {
      const speed = 0.08;
      const stepX = (dx / dHoriz) * speed;
      const stepZ = (dz / dHoriz) * speed;

      // try each axis separately so we can slide along walls
      if (!entityCollides(entity.x + stepX, entity.y, entity.z)) {
        entity.x += stepX;
      }
      if (!entityCollides(entity.x, entity.y, entity.z + stepZ)) {
        entity.z += stepZ;
      }

      entity.rotationY = Math.atan2(dx, dz);
    }

    // ---- gravity ----
    entity.vy -= 0.02;
    const ny = entity.y + entity.vy;

    if (!entityCollides(entity.x, ny, entity.z)) {
      entity.y = ny;
    } else {
      if (entity.vy < 0) {
        // land on the block below
        entity.y = Math.floor(entity.y) + 1;
      }
      entity.vy = 0;
    }

    // ---- periodic broadcast (5hz) ----
    if (now - (entity.lastBroadcast || 0) >= 200) {
      entity.lastBroadcast = now;
      world.broadcast({
        type: 'entityUpdate',
        entityId: entity.id,
        x: entity.x,
        y: entity.y,
        z: entity.z,
        rotationY: entity.rotationY,
        health: entity.health
      });
    }
  }
}

/* ================= MANGO SPREAD ================= */

function spreadMangos() {
  const mangos = [];
  for (const b of world.blocks.values()) {
    if (b.type === 'mango') mangos.push(b);
  }
  if (!mangos.length) return;

  const maxNew = mangos.length; // "double" cap
  const additions = [];
  const seen = new Set();

  for (const m of mangos) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;

          const x = m.x + dx;
          const y = m.y + dy;
          const z = m.z + dz;

          const k = world.key(x, y, z);
          if (seen.has(k)) continue;
          seen.add(k);

          const nb = world.blocks.get(k);
          if (!nb || nb.type !== 'dirt') continue;

          // dirt must not be covered (nothing above)
          if (world.blocks.has(world.key(x, y + 1, z))) continue;

          additions.push({ x, y: y + 1, z });
          if (additions.length >= maxNew) break;
        }
        if (additions.length >= maxNew) break;
      }
      if (additions.length >= maxNew) break;
    }
    if (additions.length >= maxNew) break;
  }

  for (const a of additions) {
    world.setBlock(a.x, a.y, a.z, 'mango');
  }

  if (additions.length) {
    console.log(`[MANGO] spread ${additions.length} new blocks`);
  }
}

/* ================= TIMERS ================= */

setInterval(tickEntities, CREATURE_TICK_MS);
setInterval(spawnCreatures, CREATURE_SPAWN_INTERVAL_MS);
setInterval(spreadMangos, MANGO_SPREAD_INTERVAL_MS);

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

    /* damage: player attacking a player or a creature */
    if (data.type === 'damage') {
      const targetId = data.playerId;

      if (world.entities.has(targetId)) {
        // player hit a creature
        const entity = world.entities.get(targetId);
        entity.health = (entity.health ?? CREATURE_HEALTH) - PLAYER_HIT_DAMAGE;

        if (entity.health <= 0) {
          console.log('[ENTITY] ' + targetId + ' died');
          world.removeEntity(targetId);
        } else {
          world.updateEntity(targetId, { health: entity.health });
        }
      } else {
        // legacy: player hit another player
        const target = sockets.get(targetId);
        if (target && target.readyState === WebSocket.OPEN) {
          target.send(JSON.stringify({ type: 'damage', damage: PLAYER_HIT_DAMAGE }));
        }
      }
    }

    /* auth handshake: tell the client we support entities */
    if (data.type === 'auth') {
      ws.send(JSON.stringify({
        type: 'serverInfo',
        info: { version: CLIENT_VERSION }
      }));
    }
  });

  const { id, player } = world.addPlayer(ws);
  sockets.set(id, ws);
  console.log('playerJoin ' + id);
  api.emit('playerJoin', { playerId: id });

  ws.send(JSON.stringify({
    type: 'worldState',
    blocks: [...world.blocks.values()],
    players: [...world.players.entries()],
    entities: [...world.entities.entries()],
    playerId: id
  }));

  world.broadcast({ type: 'playerJoined', playerId: id, ...player }, id);

  ws.on('close', () => {
    api.emit('playerLeave', { playerId: id });
    world.removePlayer(id);
    sockets.delete(id);
  });
});

/* ================= AUTOSAVE ================= */

setInterval(() => {
  api.emit('tick', {});
  // world.save();
}, 60000);
