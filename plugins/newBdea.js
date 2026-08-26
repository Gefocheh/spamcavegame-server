/*MIT License

Copyright (c) 2026 Gefocheh

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.*/
// ====================== UUID MANAGEMENT ======================
function getOrCreateClientUUID() {
    let uuid = localStorage.getItem('clientUUID');
    if (!uuid) {
        uuid = 'client_' + Math.random().toString(36).substr(2, 16);
        localStorage.setItem('clientUUID', uuid);
    }
    return uuid;
}
const CLIENT_UUID = getOrCreateClientUUID();

// ====================== CHUNK RENDERER ======================
const CHUNK_SIZE = 16;
const CHUNK_HEIGHT_MIN = -16;
const CHUNK_HEIGHT_MAX = 64;

function getChunkCoord(coord) { return Math.floor(coord / CHUNK_SIZE); }
function getChunkKey(cx, cz) { return `${cx}|${cz}`; }

class OptimizedRenderer {
    constructor(world) {
        this.world = world;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87ceeb);
        this.renderer = new THREE.WebGLRenderer();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
		this.entityMeshes = new Map();
        document.body.appendChild(this.renderer.domElement);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 200);
        this.yaw = new THREE.Object3D();
        this.pitch = new THREE.Object3D();
        this.yaw.add(this.pitch);
        this.pitch.position.y = 1.6;
        this.pitch.add(this.camera);
        this.scene.add(this.yaw);

        this.chunkMeshes = new Map();
        this.activeChunks = new Set();
        this.renderDist = 3;

        this.initMaterials();
        this.initLights();
        this.loadTextures();

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    initMaterials() {
    // colors used while texture loads
    const colorTex = (c) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 16;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 16, 16);
        const tex = new THREE.CanvasTexture(canvas);
        tex.magFilter = tex.minFilter = THREE.NearestFilter;
        return tex;
    };
    this.materials = {
        grass:     new THREE.MeshLambertMaterial({ map: colorTex('#3cb043'), vertexColors: true }),
        dirt:      new THREE.MeshLambertMaterial({ map: colorTex('#7a4a2e'), vertexColors: true }),
        stone:     new THREE.MeshLambertMaterial({ map: colorTex('#888888'), vertexColors: true }),
        glass:     new THREE.MeshLambertMaterial({ map: colorTex('#aaffff'), transparent: true, opacity: 0.6, vertexColors: true }),
        пакет: new THREE.MeshLambertMaterial({ map: colorTex('#555555'), vertexColors: true }),
        planks:    new THREE.MeshLambertMaterial({ map: colorTex('#c89a6e'), vertexColors: true }),
        араваХунты:      new THREE.MeshLambertMaterial({ map: colorTex('#8b5a2b'), vertexColors: true })
    };
}

loadTextures() {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
        const createTex = (sx, sy) => {
            const canvas = document.createElement('canvas');
            canvas.width = 16; canvas.height = 16;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, sx, sy, 16, 16, 0, 0, 16, 16);
            const tex = new THREE.CanvasTexture(canvas);
            tex.magFilter = tex.minFilter = THREE.NearestFilter;
            return tex;
        };
        this.materials.grass     = new THREE.MeshLambertMaterial({ map: createTex(0, 0), vertexColors: true });
        this.materials.dirt      = new THREE.MeshLambertMaterial({ map: createTex(16, 0), vertexColors: true });
        this.materials.stone     = new THREE.MeshLambertMaterial({ map: createTex(32, 0), vertexColors: true });
        this.materials.glass     = new THREE.MeshLambertMaterial({ map: createTex(48, 0), transparent: true, opacity: 0.6, vertexColors: true });
        this.materials.пакет = new THREE.MeshLambertMaterial({ map: createTex(64, 0), vertexColors: true });
        this.materials.planks    = new THREE.MeshLambertMaterial({ map: createTex(80, 0), vertexColors: true });
        this.materials.араваХунты      = new THREE.MeshLambertMaterial({ map: createTex(96, 0), vertexColors: true });

        // Refresh all existing chunks with new textures
        for (let chunk of this.chunkMeshes.values()) {
            for (let type in this.materials) {
                const mesh = chunk[type + 'Mesh'];
                if (mesh) mesh.material = this.materials[type];
            }
        }
    };
    img.onerror = () => console.warn("textures8.png not found, using colors");
    img.src = 'textures8.png';
}

    initLights() {
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.3));
        const sun = new THREE.DirectionalLight(0xffffff, 1);
        sun.position.set(10, 20, 10);
        this.scene.add(sun);
    }
	
	getFilteredBlock(x, y, z) {
		let block = this.world.getBlock(x,y,z);
		if (block == undefined) {
			return false
		}
		if (block.type == 'glass') { 
			return false;
		} else {
			return block;
		}
	}
	
	
    buildChunkGeometry(cx, cz, blockType) {
        const positions = [];
        const normals = [];
        const indices = [];
        const uvs = [];
        const startX = cx * CHUNK_SIZE;
        const startZ = cz * CHUNK_SIZE;
        const colors = [];
        const dirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
        const norms = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
        const quadUV = [[0,0],[1,0],[1,1],[0,1]];

        let idxOffset = 0;

        for (let x = 0; x < CHUNK_SIZE; x++) {
            for (let z = 0; z < CHUNK_SIZE; z++) {
                for (let y = CHUNK_HEIGHT_MIN; y <= CHUNK_HEIGHT_MAX; y++) {
                    const wx = startX + x;
                    const wz = startZ + z;
                    const block = this.world.getBlock(wx, y, wz);
                    if (!block || block.type !== blockType) continue;
                    const hasBlockDirectlyAbove = (wx, y, wz) => {
                        return this.world.isSolid(wx, y + 1, wz);
                    };
                    const hasBlockAnywhereAbove = (wx, y, wz) => {
                        for (let yy = y + 2; yy <= CHUNK_HEIGHT_MAX; yy++) {
                            if (this.world.isSolid(wx, yy, wz)) return true;
                        }
                        return false;
                    };
                    const getShade = (wx, y, wz, face) => {
                        let shade = 1.0;
                        const directAbove = hasBlockDirectlyAbove(wx, y, wz);
                        const above = hasBlockAnywhereAbove(wx, y, wz);
                        if (directAbove) return shade;
                        if (face === 2 && above) shade *= 0.4;
                        if (face === 3) shade *= 0.5;
                        return shade;
                    };
                    for (let face = 0; face < 6; face++) {
                        const [dx, dy, dz] = dirs[face];
                        const nx = wx + dx;
                        const ny = y + dy;
                        const nz = wz + dz;
                        const neighbor = this.getFilteredBlock(nx, ny, nz);
                        if (!neighbor) {
                            const shade = getShade(wx, y, wz, face, dx, dy, dz);
                            const [normX, normY, normZ] = norms[face];
                            const w = 0.5;
                            let verts;
                            if (face === 0) verts = [[ w, w,-w],[ w,-w,-w],[ w,-w, w],[ w, w, w]];
                            else if (face === 1) verts = [[-w, w, w],[-w,-w, w],[-w,-w,-w],[-w, w,-w]];
                            else if (face === 2) verts = [[-w, w,-w],[ w, w,-w],[ w, w, w],[-w, w, w]];
                            else if (face === 3) verts = [[-w,-w, w],[ w,-w, w],[ w,-w,-w],[-w,-w,-w]];
                            else if (face === 4) verts = [[-w, w, w],[ w, w, w],[ w,-w, w],[-w,-w, w]];
                            else verts = [[ w, w,-w],[-w, w,-w],[-w,-w,-w],[ w,-w,-w]];

                            for (let i = 0; i < 4; i++) {
                                colors.push(shade, shade, shade);
                                const px = wx + 0.5 + verts[i][0];
                                const py = y  + 0.5 + verts[i][1];
                                const pz = wz + 0.5 + verts[i][2];
                                positions.push(px, py, pz);
                                normals.push(normX, normY, normZ);
                                uvs.push(quadUV[i][0], quadUV[i][1]);
                            }
                            const base = idxOffset;
                            indices.push(base, base+2, base+1, base, base+3, base+2);
                            idxOffset += 4;
                        }
                    }
                }
            }
        }

        if (positions.length === 0) return null;
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
        geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
        geom.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
        geom.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
        geom.setIndex(indices);
        return geom;
    }

    rebuildChunk(cx, cz) {
    const key = getChunkKey(cx, cz);
    const old = this.chunkMeshes.get(key);
    if (old && old.group) {
        this.scene.remove(old.group);
        // Dispose geometries of all meshes that exist
        const meshNames = ['grassMesh', 'dirtMesh', 'stoneMesh', 'glassMesh', 'пакетMesh', 'planksMesh', 'араваХунтыMesh'];
        for (let name of meshNames) {
            const mesh = old[name];
            if (mesh && mesh.geometry) mesh.geometry.dispose();
        }
    }

    const group = new THREE.Group();
    const meshes = {};

    for (let type of ['grass', 'dirt', 'stone', 'glass', 'пакет', 'planks', 'араваХунты']) {
        const geo = this.buildChunkGeometry(cx, cz, type);
        if (geo) {
            const material = this.materials[type];
            const mesh = new THREE.Mesh(geo, material);
            group.add(mesh);
            meshes[type + 'Mesh'] = mesh;
        } else {
            meshes[type + 'Mesh'] = null;
        }
    }

    this.chunkMeshes.set(key, { group, ...meshes, cx, cz });
    if (this.activeChunks.has(key)) this.scene.add(group);
    return this.chunkMeshes.get(key);
}

    onBlockChanged(x, y, z) {
        const cx = getChunkCoord(x);
        const cz = getChunkCoord(z);
        const toRebuild = new Set([getChunkKey(cx, cz)]);
        for (let dx = -1; dx <= 1; dx++)
            for (let dz = -1; dz <= 1; dz++)
                if (dx !== 0 || dz !== 0) toRebuild.add(getChunkKey(cx+dx, cz+dz));
        for (const key of toRebuild) {
            const [rcx, rcz] = key.split('|').map(Number);
            this.rebuildChunk(rcx, rcz);
            if (this.activeChunks.has(key)) {
                const data = this.chunkMeshes.get(key);
                if (data && data.group && !this.scene.children.includes(data.group))
                    this.scene.add(data.group);
            }
        }
    }

    updateVisibleChunks() {
        const camX = this.yaw.position.x;
        const camZ = this.yaw.position.z;
        const centerCX = getChunkCoord(camX);
        const centerCZ = getChunkCoord(camZ);

        const newActive = new Set();
        const rad = this.renderDist;
        for (let dx = -rad; dx <= rad; dx++) {
            for (let dz = -rad; dz <= rad; dz++) {
                const cx = centerCX + dx;
                const cz = centerCZ + dz;
                const key = getChunkKey(cx, cz);
                newActive.add(key);
                if (!this.chunkMeshes.has(key)) this.rebuildChunk(cx, cz);
                const data = this.chunkMeshes.get(key);
                if (data && data.group && !this.scene.children.includes(data.group))
                    this.scene.add(data.group);
            }
        }

        for (let oldKey of this.activeChunks) {
            if (!newActive.has(oldKey)) {
                const data = this.chunkMeshes.get(oldKey);
                if (data && data.group) this.scene.remove(data.group);
            }
        }
        this.activeChunks = newActive;
    }

    setRenderDistance(dist) {
        this.renderDist = Math.max(2, Math.min(20, dist));
        this.updateVisibleChunks();
    }

    syncBlocks() {
        this.updateVisibleChunks();
    }

    clearAllChunks() {
    for (let data of this.chunkMeshes.values()) {
        if (data.group) this.scene.remove(data.group);
        const meshNames = ['grassMesh', 'dirtMesh', 'stoneMesh', 'glassMesh', 'пакетMesh', 'planksMesh', 'араваХунтыMesh'];
        for (let name of meshNames) {
            if (data[name] && data[name].geometry) data[name].geometry.dispose();
        }
    }
    this.chunkMeshes.clear();
    this.activeChunks.clear();
}

    // --- Players ---
    playerMeshes = new Map();
    nickLabels = new Map();

    createPlayerMesh(id, x, y, z, nickname) {
        const g = new THREE.Group();
        const bodyGeo = new THREE.BoxGeometry(0.6, 1.8, 0.6);
        const bodyMat = new THREE.MeshLambertMaterial({ color: Math.random() * 0xffffff });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 0.9;
        g.add(body);
        const headGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
        const headMat = new THREE.MeshLambertMaterial({ color: 0xffaa88 });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = 1.85;
        g.add(head);
        const rayPoints = [new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(0, 1.6, -3)];
        const rayGeo = new THREE.BufferGeometry().setFromPoints(rayPoints);
        const rayMat = new THREE.LineBasicMaterial({ color: 0xff0000 });
        const ray = new THREE.Line(rayGeo, rayMat);
        ray.name = 'lookRay';
        g.add(ray);
        g.position.set(x, y, z);
        g.userData = { id, nickname };
        const div = document.createElement('div');
        div.className = 'nickname';
        div.innerText = nickname;
        document.body.appendChild(div);
        this.nickLabels.set(id, div);
        return g;
    }

    syncPlayers() {
        this.playerMeshes.forEach((mesh, id) => {
            if (!this.world.players.has(id)) {
                this.scene.remove(mesh);
                if (this.nickLabels.has(id)) {
                    document.body.removeChild(this.nickLabels.get(id));
                    this.nickLabels.delete(id);
                }
                this.playerMeshes.delete(id);
            }
        });
        this.world.players.forEach((p, id) => {
            let mesh = this.playerMeshes.get(id);
            if (!mesh) {
                mesh = this.createPlayerMesh(id, p.x, p.y, p.z, p.nickname);
                this.scene.add(mesh);
                this.playerMeshes.set(id, mesh);
            } else {
                mesh.position.set(p.x, p.y, p.z);
                mesh.rotation.y = p.rotationY || 0;
                const ray = mesh.getObjectByName('lookRay');
                if (ray) ray.rotation.x = p.rotationX || 0;
            }
            const label = this.nickLabels.get(id);
            if (label) {
                const pos = new THREE.Vector3(p.x, p.y+2, p.z);
                pos.project(this.camera);
                const x = (pos.x * 0.5 + 0.5) * window.innerWidth;
                const y = (-pos.y * 0.5 + 0.5) * window.innerHeight;
                label.style.left = x + 'px';
                label.style.top = y + 'px';
            }
        });
    }
syncEntities() {
    // Remove entities that no longer exist
    for (let [id, mesh] of this.entityMeshes) {
        if (!this.world.entities.has(id)) {
            this.scene.remove(mesh);
            this.entityMeshes.delete(id);
        }
    }
    // Add/update existing entities
    this.world.entities.forEach((data, id) => {
        let mesh = this.entityMeshes.get(id);
        if (!mesh) {
            // Create entity mesh based on type
            /*if (data.type === 'monster') {
                mesh = this.createMonsterMesh(data.x, data.y, data.z);
            } else {*/
                // Fallback to player-like model for unknown types
                mesh = this.createPlayerMesh(id, data.x, data.y, data.z, data.type);
            /*}*/
            this.scene.add(mesh);
            this.entityMeshes.set(id, mesh);
        } else {
            mesh.position.set(data.x, data.y, data.z);
            if (data.rotationY !== undefined) mesh.rotation.y = data.rotationY;
            
        }
    });
}

/*createMonsterMesh(x, y, z) {
    const group = new THREE.Group();
    const bodyGeo = new THREE.BoxGeometry(0.6, 1.8, 0.6);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0xaa4444 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.9;
    group.add(body);
    const headGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const headMat = new THREE.MeshLambertMaterial({ color: 0x884444 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.85;
    group.add(head);
    group.position.set(x, y, z);
    return group;
}*/
    setCameraPos(x, y, z) { this.yaw.position.set(x, y, z); }
    rotateCamera(dyaw, dpitch) {
        this.yaw.rotation.y += dyaw;
        this.pitch.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, this.pitch.rotation.x + dpitch));
    }
    getCamDir() {
        const dir = new THREE.Vector3();
        this.camera.getWorldDirection(dir);
        return dir;
    }
    render() { this.renderer.render(this.scene, this.camera); }
}

// ====================== WORLD ======================
class WorldSystem {
    constructor(){ 
        this.blocks = new Map(); 
        this.players = new Map();
        this.entities = new Map(); // id -> { type, x, y, z, rotationY, rotationX, health? }
    }
    key(x,y,z){ return `${Math.floor(x)}|${Math.floor(y)}|${Math.floor(z)}`; }
    getBlock(x,y,z){
    	return this.blocks.get(this.key(x,y,z)); 
    }
    setBlock(x,y,z,type){
        const k=this.key(x,y,z);
        if(type===null) this.blocks.delete(k);
        else this.blocks.set(k,{x:Math.floor(x),y:Math.floor(y),z:Math.floor(z),type});
    }
    isSolid(x,y,z){ return this.blocks.has(this.key(x,y,z)); }
    
    // Players
    updatePlayer(id,x,y,z,rotY,rotX,nickname){ this.players.set(id,{x,y,z,rotY,rotX,nickname}); }
    removePlayer(id){ this.players.delete(id); }
    
    // Entities
    updateEntity(id, data){ this.entities.set(id, data); }
    removeEntity(id){ this.entities.delete(id); }
    
    saveToJSON(){ 
        return JSON.stringify({
            blocks: [...this.blocks.values()],
            players: [...this.players.entries()],
            entities: [...this.entities.entries()]
        }); 
    }
    loadFromJSON(json){
        let data;
        try{ data=JSON.parse(json); } catch(e){ data={blocks:[], players:[], entities:[]}; }
        this.blocks.clear();
        (Array.isArray(data.blocks)?data.blocks:[]).forEach(b=>this.blocks.set(this.key(b.x,b.y,b.z),b));
        this.players.clear();
        (Array.isArray(data.players)?data.players:[]).forEach(([id,p])=>this.players.set(id,p));
        this.entities.clear();
        (Array.isArray(data.entities)?data.entities:[]).forEach(([id,e])=>this.entities.set(id,e));
    }
    generateDefaultWorld(size=10){
        for(let x=-size;x<=size;x++)
            for(let z=-size;z<=size;z++){
                const h=Math.floor(Math.sin(x/5)*2+Math.cos(z/5)*2);
                this.setBlock(x,h,z,'grass');
                this.setBlock(x,h-1,z,'dirt');
                this.setBlock(x,h-2,z,'stone');
            }
    }
    findTopY(x,z){ for(let y=100;y>=-100;y--) if(this.isSolid(x,y,z)) return y; return 0; }
}
// ================================ AUDIO
const gameAudio = {}
gameAudio.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
gameAudio.playTone = function (frequency, duration, volume = 0.3, type = "sine") {
    const now = gameAudio.audioCtx.currentTime;
    const oscillator = gameAudio.audioCtx.createOscillator();
    const gain = gameAudio.audioCtx.createGain();
    oscillator.connect(gain);
    gain.connect(gameAudio.audioCtx.destination);
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.start(now);
    oscillator.stop(now + duration);
}
gameAudio.playPlaceSound = function () { gameAudio.playTone(300, 0.1, 0.15, "sine"); }
gameAudio.playBreakSound = function () { gameAudio.playTone(150, 0.1, 0.2, "triangle"); }
gameAudio.playServerConnectSound = function () {
    gameAudio.playTone(180, 0.08, 0.15);
    setTimeout(() => gameAudio.playTone(240, 0.12, 0.2, "triangle"), 50);
    setTimeout(() => gameAudio.playTone(320, 0.2, 0.25, "sine"), 110);
}
gameAudio.playServerDisconnectSound = function () {
    gameAudio.playTone(320, 0.08, 0.2);
    setTimeout(() => gameAudio.playTone(200, 0.15, 0.25, "triangle"), 60);
    setTimeout(() => gameAudio.playTone(140, 0.25, 0.2, "triangle"), 130);
}
gameAudio.playErrorSound = function () {
    gameAudio.playTone(220, 0.08, 0.25, 'triangle');
    setTimeout(() => gameAudio.playTone(180, 0.12, 0.3, 'triangle'), 80);
}
//version of client
const version = "bdea-ng"

// ====================== LOCAL PLAYER ======================
class LocalPlayer {
    constructor(world, renderer){
        this.world = world;
        this.renderer = renderer;
        this.x = 0; this.y = 3; this.z = 5;
        this.vy = 0; this.w = 0.6; this.h = 1.7; this.d = 0.6;
        this.onGround = false;
        this.keys = {};
        this.fallThreshold = -10;
        this.initControls();
        this.vyr = 0.01;
        this.flying = false;
        this.shifted = false;
        this.ершик = 0.05;
    }
    initControls(){
        onkeydown = e => this.keys[e.code] = true;
        onkeyup = e => this.keys[e.code] = false;
        onclick = () => document.body.requestPointerLock();
        onmousemove = e => {
            if(document.pointerLockElement !== document.body) return;
            this.renderer.rotateCamera(-e.movementX*0.002, -e.movementY*0.002);
        };
    }
    isSolid(x,y,z){ return this.world.isSolid(Math.floor(x),Math.floor(y),Math.floor(z)); }
    collide(pos){
        const minX = Math.floor(pos.x - this.w/2);
        const maxX = Math.floor(pos.x + this.w/2);
        const minY = Math.floor(pos.y);
        const maxY = Math.floor(pos.y + this.h);
        const minZ = Math.floor(pos.z - this.d/2);
        const maxZ = Math.floor(pos.z + this.d/2);
        for(let x = minX; x <= maxX; x++){
            for(let y = minY; y <= maxY; y++){
                for(let z = minZ; z <= maxZ; z++){
                    if(this.world.isSolid(x, y, z)) return true;
                }
            }
        }
        return false;
    }
    enableFlying() {
    	//lol 
    	this.vyr = 0;
    	this.flying = true;
    }
    disableFlying() {
    	this.vyr = 0.01;
    	this.flying = false;
    }
    //добавить 0.01 к vy еще кстати бесполезно
    addToVy() {
    	this.vy += 0.01;
    }
    // оптимизировано ебать
    isChunkInRightPlace(chunk) {
        var CXGood = false;
        var CZGood = false;
        var pcx = 0;
        var pcz = 0;
        if (this.x > 0 && this.x < 16) {
            pcx = 1;
        } else if (this.x >= 16) {
            pcx = Math.floor(this.x / 16);
        } else if (this.x < 0 && this.x > -16) {
            pcx = -1;
        } else if (this.x <= -16) {
            pcx = Math.floor(this.x / 16);
        };
        if (this.z > 0 && this.z < 16) {
            pcz = 1;
        } else if (this.z >= 16) {
            pcz = Math.floor(this.z / 16);
        } else if (this.z < 0 && this.z > -16) {
            pcz = -1;
        } else if (this.z <= -16) {
            pcz = Math.floor(this.z / 16);
        };
        const {cx, cz} = chunk;
        if (cx > 0 && pcx > 0) {
            if (cx <= pcx + 1) {
                CXGood = true;
            };
        } else if (cx < 0 && pcx < 0) {
            if (cx <= pcx - 1) {
                CXGood = true;
            };
        };
        if (cz > 0 && pcz > 0) {
            if (cz <= pcz + 1) {
                CZGood = true;
            };
        } else if (cz < 0 && pcz < 0) {
            if (cz <= pcz - 1) {
                CZGood = true;
            };
        };
        const bs = [pcx, pcz, CXGood, CZGood]
        console.log(bs.join(" | "))
        if (CZGood && CXGood) {
            console.log("yayci");
        };
        return CZGood && CXGood;
    }
    update(){
        const speed = 0.08;
        const dir = this.renderer.getCamDir(); dir.y = 0; dir.normalize();
        const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0,1,0));
        let nx = this.x, nz = this.z;
        if(this.keys.KeyW){ nx += dir.x*speed; nz += dir.z*speed; }
        if(this.keys.KeyS){ nx -= dir.x*speed; nz -= dir.z*speed; }
        if(this.keys.KeyA){ nx -= right.x*speed; nz -= right.z*speed; }
        if(this.keys.KeyD){ nx += right.x*speed; nz += right.z*speed; }
        if(!this.collide({x:nx, y:this.y, z:nz})){ this.x = nx; this.z = nz; }
        //врубить вырубить полет
		if(this.keys.KeyF){this.enableFlying()}
		if(this.keys.KeyG){this.disableFlying()}
		// шифт при полете типа ну как бы летаешь вниз лол
		if(this.keys.ShiftLeft && this.flying){this.vy -= this.ершик; this.shifted = true}
		//летаем вверх нах ебать
		if(this.keys.Space && this.flying){this.vy += this.ершик; this.shifted = true} //shifted true потому что я ленивый уебок
		//дебаг нету
        this.vy -= this.vyr;
        let ny = this.y + this.vy;
        if(this.vy > 0){
            if(!this.collide({x:this.x, y:ny+0.001, z:this.z})) this.y = ny;
            else this.vy = 0;
        } else {
            if(!this.collide({x:this.x, y:ny, z:this.z})){ this.y = ny; this.onGround = false; }
            else { this.onGround = true; this.vy = 0; this.y = Math.floor(ny) + 1; }
        }
        if(this.keys.Space && this.onGround && !this.flying){ this.vy = 0.22; this.onGround = false; }
        if(this.y < this.fallThreshold){ this.y = this.world.findTopY(this.x, this.z) + 1.6; this.vy = 0; }
        this.renderer.setCameraPos(this.x, this.y, this.z);
        // чиним шифт ато улетим нах
        if(this.shifted) {this.vy = 0; this.shifted = false}
        return {x:this.x, y:this.y, z:this.z, rotationY: this.renderer.yaw.rotation.y, rotationX: this.renderer.pitch.rotation.x};
    }
    getTargetBlock(){
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera({x:0,y:0}, this.renderer.camera);
        const meshes = [];
        for (let chunk of this.renderer.chunkMeshes.values())
            if (chunk.group /*&& this.isChunkInRightPlace(chunk)*/) meshes.push(chunk.group); //ебаная математика не работает нихуя такшо закоменчено
        const hits = raycaster.intersectObjects(meshes, true);
        if (hits.length && hits[0].distance <= 5) {
            const hit = hits[0];
            const point = hit.point;
            const normal = hit.face.normal;
            const bx = Math.floor(point.x - normal.x * 0.5);
            const by = Math.floor(point.y - normal.y * 0.5);
            const bz = Math.floor(point.z - normal.z * 0.5);
            const block = this.world.getBlock(bx, by, bz);
            if (block) {
                return {
                    object: { userData: { x: bx, y: by, z: bz, type: block.type } },
                    point: point,
                    face: { normal: normal }
                };
            }
        }
        return null;
    }
}

// ====================== MULTIPLAYER ======================
class MultiplayerManager {
    constructor(world, renderer, localPlayer){
        this.lastSend = 0;
        this.sendInterval = 50;
        this.world = world;
        this.renderer = renderer;
        this.localPlayer = localPlayer;
        this.online = false;
        this.playerId = null;
        this.socket = null;
        this.toggleButton = document.getElementById('onlineToggle');
        this.toggleButton.onclick = () => this.setOnline(!this.online);
    }
    setOnline(val, url){
        this.online = val;
        this.toggleButton.innerText = `Online: ${val?'ON':'OFF'}`;
        if(val){
            if(!url) url = document.getElementById('newServerInput').value.trim();
            if(!url) url = 'wss://spamcavegame-server-1.onrender.com';
            this.connect(url);
        } else if(this.socket){
            this.socket.close();
            this.socket = null;
        }
    }
    connect(url){
        this.socket = new WebSocket(url);
        this.socket.onopen = () => {
        	console.log("[MP] CONNECTING TO SERVER");
            gameAudio.playServerConnectSound();
            // Send join message with UUID and nickname
            const nickname = localStorage.getItem('lastNickname') || 'Player';
            this.socket.send(JSON.stringify({
                type: 'join',
                uuid: CLIENT_UUID,
                nickname: nickname,
                clientVersion: version
            }));
            this.socket.send(JSON.stringify({
            	type: 'auth',
            	info: {version: version}
            }));
            console.log("[MP] SENT CLIENT INFO");
        };
        this.socket.onmessage = (e) => {
            const data = JSON.parse(e.data);
            if (data.type === 'serverInfo') {
            	if (data.info.version != 'bdea-ng') {
            		this.serverIsOld = true;
            	} else {
            		this.serverIsOld = false;
            	}
            	window.serverIsOld = this.serverIsOld;
            } else if(data.type === 'worldState'){
                this.world.blocks.clear();
                this.world.players.clear();
                this.renderer.clearAllChunks();
                data.blocks.forEach(b => this.world.setBlock(b.x,b.y,b.z,b.type));
                data.players.forEach(([id,p]) => this.world.updatePlayer(id,p.x,p.y,p.z,p.rotationY,p.rotationX,p.nickname));
                if (!this.serverIsOld) {
                 data.entities.forEach(([id,e]) => this.world.updateEntity(id,e));
                }
				this.playerId = data.playerId;
                this.renderer.updateVisibleChunks();
                // Save nickname if needed
                if(data.playerNickname) localStorage.setItem('lastNickname', data.playerNickname);
            }
            else if(data.type === 'playerMoved' || data.type === 'playerJoined'){
                if(data.playerId === this.playerId) return;
                this.world.updatePlayer(data.playerId,data.x,data.y,data.z,data.rotationY,data.rotationX,data.nickname);
            }
            else if(data.type === 'playerLeft') this.world.removePlayer(data.playerId);
            else if(data.type === 'blockPlaced'){
                this.world.setBlock(data.x,data.y,data.z,data.blockType);
                this.renderer.onBlockChanged(data.x,data.y,data.z);
            }
            else if(data.type === 'blockBroken'){
                this.world.setBlock(data.x,data.y,data.z,null);
                this.renderer.onBlockChanged(data.x,data.y,data.z);
            }
            else if(data.type === 'chat'){
                const nick = this.world.players.get(data.playerId)?.nickname || data.playerId.slice(0,8);
                appendChatMessage(`${nick}: ${data.text}`);
                console.log('[CHAT] ' + `${nick}: ${data.text}`)
            }
            else if(data.type === 'kick'){
                appendChatMessage(`[System] Kicked: ${data.reason}`);
                this.setOnline(false);
            }
			if (data.type === 'entitySpawn') {
    world.updateEntity(data.entityId, data);
    renderer.syncEntities(); // immediate creation
} else if (data.type === 'entityUpdate') {
    const existing = world.entities.get(data.entityId);
    if (existing) {
        // Update only changed fields
        Object.assign(existing, data);
        world.entities.set(data.entityId, existing);
        renderer.syncEntities(); // update positions
    }
} else if (data.type === 'entityDespawn') {
    world.removeEntity(data.entityId);
    renderer.syncEntities();
} else if (data.type === 'positionCorrection') {
    // Server sent authoritative position
    localPlayer.x = data.x;
    localPlayer.y = data.y;
    localPlayer.z = data.z;
    localPlayer.vy = 0; // reset vertical momentum
    renderer.setCameraPos(localPlayer.x, localPlayer.y, localPlayer.z);
    console.log('[MP] Position corrected to', localPlayer.x, localPlayer.y, localPlayer.z);
}
        };
        this.socket.onclose = () => {
            gameAudio.playServerDisconnectSound();
            this.setOnline(false);
        };
    }
    sendPlayerUpdate(pos){
        if(this.online && this.socket && this.socket.readyState === WebSocket.OPEN){
            this.socket.send(JSON.stringify({type:'playerUpdate', playerId:this.playerId, ...pos}));
        }
    }
    sendBlockPlace(x,y,z,type){
        if(this.online && this.socket) this.socket.send(JSON.stringify({type:'blockPlace', playerId:this.playerId, x,y,z, blockType:type}));
    }
    sendBlockBreak(x,y,z){
        if(this.online && this.socket) this.socket.send(JSON.stringify({type:'blockBreak', playerId:this.playerId, x,y,z}));
    }
    update(){
        const pos = this.localPlayer.update();
        if(this.online){
            const now = performance.now();
            if(now - this.lastSend >= this.sendInterval){
                this.lastSend = now;
                this.sendPlayerUpdate(pos);
            }
        }
    }
}

// ====================== GAME INITIALIZATION ======================
let world, renderer, localPlayer, multiplayer, gameLoopId;

function startGame(mode, serverUrl) {
    // Hide menu
    document.getElementById('gameMenu').style.display = 'none';
    // Show game UI elements (they were hidden initially)
    document.getElementById('crosshair').style.display = 'block';
    document.getElementById('debug').style.display = 'block';
    document.getElementById('serverMenuToggle').style.display = 'block';
    document.getElementById('onlineToggle').style.display = 'block';
    document.querySelector('.chunk-slider').style.display = 'flex';
    document.getElementById('chatPanel').style.display = 'flex';
    document.getElementById('blockSelector').style.display = 'block';
    document.documentElement.requestFullscreen()
    world = new WorldSystem();
    renderer = new OptimizedRenderer(world);
    localPlayer = new LocalPlayer(world, renderer);
    multiplayer = new MultiplayerManager(world, renderer, localPlayer);

    if (mode === 'singleplayer') {
        // Load local world
        const saved = localStorage.getItem('savedWorld');
        if(saved) world.loadFromJSON(saved);
        if(world.blocks.size===0) world.generateDefaultWorld(10);
        multiplayer.online = false;
        document.getElementById('onlineToggle').style.display = 'none';
        // No server connection
    } else if (mode === 'multiplayer') {
        multiplayer.setOnline(true, serverUrl);
    }

    // Setup event handlers
    const slider = document.getElementById('chunkDistSlider');
    const distSpan = document.getElementById('distValue');
    slider.addEventListener('input', () => {
        const val = parseInt(slider.value, 10);
        distSpan.innerText = val;
        renderer.setRenderDistance(val);
    });
    renderer.setRenderDistance(parseInt(slider.value, 10));

    // Chat
    const chatMessagesDiv = document.getElementById('chatMessages');
    const chatInputNew = document.getElementById('chatInput');
    const chatSendBtn = document.getElementById('chatSend');
    window.appendChatMessage = function(msg) {
        const div = document.createElement('div');
        div.innerText = msg;
        chatMessagesDiv.appendChild(div);
        div.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        while(chatMessagesDiv.children.length > 60) chatMessagesDiv.removeChild(chatMessagesDiv.firstChild);
    };
    function sendChatMessage() {
        const text = chatInputNew.value.trim();
        if (text && multiplayer.online && multiplayer.socket && multiplayer.socket.readyState === WebSocket.OPEN) {
            multiplayer.socket.send(JSON.stringify({ type: 'chat', text }));
            chatInputNew.value = '';
        } else if (!multiplayer.online) {
            appendChatMessage("[System] Chat is only available in online mode");
            playErrorSound();
        }
    }
    chatSendBtn.onclick = sendChatMessage;
    chatInputNew.addEventListener('keypress', (e) => { if(e.key === 'Enter') sendChatMessage(); });

    // Block selection
    const blockTypes = ['grass', 'dirt', 'stone', 'glass', 'пакет', 'planks', 'араваХунты'];
    let selectedBlockIndex = 2; // stone (index 2)
    const blockSelectorDiv = document.getElementById('blockSelector');
    function updateBlockSelector() {
        blockSelectorDiv.innerText = `Block: ${blockTypes[selectedBlockIndex]}`;
    }
    updateBlockSelector();
    window.addEventListener('keydown', (e) => {
    if (e.code >= 'Digit1' && e.code <= 'Digit7') {
        selectedBlockIndex = parseInt(e.code.slice(-1), 10) - 1;
        updateBlockSelector();
        e.preventDefault();
    }
});

    // Block placement/break
    oncontextmenu = e => e.preventDefault();
    onmousedown = e => {
        const hit = localPlayer.getTargetBlock();
        if (!hit) return;
        const b = hit.object.userData;
        const n = hit.face.normal;
        if (e.button === 0) {
            if (world.getBlock(b.x, b.y, b.z)) {
                world.setBlock(b.x, b.y, b.z, null);
                renderer.onBlockChanged(b.x, b.y, b.z);
                if(multiplayer.online) multiplayer.sendBlockBreak(b.x, b.y, b.z);
                gameAudio.playBreakSound();
            }
        }
        if (e.button === 2) {
            const x = b.x + n.x;
            const y = b.y + n.y;
            const z = b.z + n.z;
            if (!world.isSolid(x,y,z) && !localPlayer.collide({x:x+0.5, y:y+0.5, z:z+0.5})) {
                const type = blockTypes[selectedBlockIndex];
                world.setBlock(x, y, z, type);
                renderer.onBlockChanged(x, y, z);
                if(multiplayer.online) multiplayer.sendBlockPlace(x, y, z, type);
                gameAudio.playPlaceSound();
            }
        }
		if (e.button === 2) {
    const x = b.x + n.x;
    const y = b.y + n.y;
    const z = b.z + n.z;
    // Check if there's an entity at the target block position
    let entityAtPos = false;
    for (let [id, ent] of world.entities) {
        const ex = Math.floor(ent.x);
        const ey = Math.floor(ent.y);
        const ez = Math.floor(ent.z);
        if (ex === x && ey === y && ez === z) {
            entityAtPos = true;
            break;
        }
    }
    if (!world.isSolid(x,y,z) && !localPlayer.collide({x:x+0.5, y:y+0.5, z:z+0.5}) && !entityAtPos) {
        const type = blockTypes[selectedBlockIndex];
        world.setBlock(x, y, z, type);
        renderer.onBlockChanged(x, y, z);
        multiplayer.sendBlockPlace(x, y, z, type);
        playPlaceSound();
    }
}
    };

    // Server menu
    const serverMenuToggle = document.getElementById('serverMenuToggle');
    const serverMenu = document.getElementById('serverMenu');
    const serverListDiv = document.getElementById('serverList');
    const serverInput = document.getElementById('newServerInput');
    const addServerBtn = document.getElementById('addServerBtn');
    const DEFAULT_SERVER = 'wss://spamcavegame-server-1.onrender.com';
    let servers = JSON.parse(localStorage.getItem('servers') || '[]');
    if(!servers.includes(DEFAULT_SERVER)) servers.unshift(DEFAULT_SERVER);
    serverInput.value = servers[0];

    function renderServerList() {
        serverListDiv.innerHTML = '';
        servers.forEach(url => {
            const div = document.createElement('div');
            div.innerText = url;
            div.style.cursor = 'pointer';
            div.style.padding = '2px 0';
            div.style.borderBottom = '1px solid #555';
            div.onclick = () => {
                serverInput.value = url;
                serverMenu.style.display = 'none';
                if(multiplayer.online){
                    multiplayer.setOnline(false);
                    setTimeout(()=>multiplayer.setOnline(true, url),100);
                } else {
                    multiplayer.setOnline(true, url);
                }
            };
            serverListDiv.appendChild(div);
        });
    }
    addServerBtn.onclick = () => {
        const url = serverInput.value.trim();
        if(url && !servers.includes(url)){
            servers.push(url);
            localStorage.setItem('servers', JSON.stringify(servers));
            serverInput.value = '';
            renderServerList();
        }
    };
    serverMenuToggle.onclick = () => {
        serverMenu.style.display = serverMenu.style.display === 'none' ? 'block' : 'none';
    };
    renderServerList();

    // Game loop
    function gameLoop(){
    requestAnimationFrame(gameLoop);
    multiplayer.update();
    renderer.syncBlocks();
    renderer.syncPlayers();
    renderer.syncEntities();
    renderer.render();
    document.getElementById('debug').innerHTML =
        `Pos: ${localPlayer.x.toFixed(2)}, ${localPlayer.y.toFixed(2)}, ${localPlayer.z.toFixed(2)}<br>`+
        `Blocks: ${world.blocks.size}<br>Players: ${world.players.size}<br>Entities: ${world.entities.size}<br>Chunks: ${renderer.activeChunks.size}`;
}
    gameLoopId = requestAnimationFrame(gameLoop);
}

// Menu handlers
document.getElementById('singleplayerBtn').onclick = () => {
    const nickname = document.getElementById('nicknameInput').value.trim();
    if(nickname) localStorage.setItem('lastNickname', nickname);
    startGame('singleplayer');
};
document.getElementById('multiplayerBtn').onclick = () => {
    const nickname = document.getElementById('nicknameInput').value.trim();
    if(nickname) localStorage.setItem('lastNickname', nickname);
    startGame('multiplayer');
};
// ====================== MOD SYSTEM ======================
window.__mods = {
    loaded: new Map(), // id -> mod object
    shared: {},        // shared things between mods
    hooks: {},         
};

function createSafeAPI(modId) {
    return {
        id: modId,

        get world() { return world; },
        get renderer() { return renderer; },
        get player() { return localPlayer; },
        get multiplayer() { return multiplayer; },
        THREE,
        version,
        gameAudio,

        shared: window.__mods.shared,

        getMod(id) {
            return window.__mods.loaded.get(id);
        },

        getAllMods() {
            return Array.from(window.__mods.loaded.keys());
        },

        on(event, fn) {
            if (!window.__mods.hooks[event]) {
                window.__mods.hooks[event] = [];
            }
            window.__mods.hooks[event].push({ modId, fn });
        },

        emit(event, data) {
            const list = window.__mods.hooks[event];
            if (!list) return;
            for (const h of list) {
                try {
                    h.fn(data);
                } catch (e) {
                    console.warn("Mod hook error:", h.modId, e);
                }
            }
        },

        override(obj, key, fn) {
            const original = obj[key];
            obj[key] = function(...args) {
                return fn.call(this, original, ...args);
            };
        },

        log(...args) {
            console.log(`[MOD:${modId}]`, ...args);
        }
    };
}

window.GameAPI = {
    getMod: (id) => window.__mods.loaded.get(id),
    getAllMods: () => Array.from(window.__mods.loaded.keys()),
    shared: window.__mods.shared,
    getModByName: (name) => getMod(getAllMods().find(id => getMod(id)?.name === name))
}; 
// ====================== MOD LOADER ======================
function loadMod(url) {
    const modId = "mod_" + Math.random().toString(36).slice(2);

    return new Promise((resolve, reject) => {
        const s = document.createElement('script');

        s.src = url;

        s.onload = () => {
            try {
                resolve(modId);
            } catch (e) {
                console.error("Mod init error:", e);
                reject(e);
            }
        };

        s.onerror = reject;

        document.body.appendChild(s);
    });
}

window.registerMod = function(initFn) {
    const modId = "mod_" + Math.random().toString(36).slice(2);

    const api = createSafeAPI(modId);

    try {
        const modExports = initFn(api) || {};
        window.__mods.loaded.set(modId, modExports);

        console.log("Mod loaded:", modId);
    } catch (e) {
        console.error("Mod crashed:", modId, e);
    }
};


function createModList(name, urlsString) {
    const urls = urlsString.split(",").map(s => s.trim()).filter(Boolean);

    const lists = JSON.parse(localStorage.getItem("modLists") || "{}");
    lists[name] = urls;

    localStorage.setItem("modLists", JSON.stringify(lists));
}

async function loadModList(name) {
    const lists = JSON.parse(localStorage.getItem("modLists") || "{}");

    if (!lists[name]) {
        console.warn("No mod list:", name);
        return;
    }

    for (const url of lists[name]) {
        try {
            await loadMod(url);
        } catch (e) {
            console.error("Failed to load mod:", url);
        }
    }
}
window.mod = loadMod;
window.modlist = createModList;
window.loadmods = loadModList;