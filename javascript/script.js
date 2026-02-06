import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GAME_VERSION } from './version.js';

// --- CONFIGURAZIONE GLOBALE ---
const CONFIG = {
    stepFrequency: 60,
    gravity: -25,
    chassisWidth: 2.0,
    chassisHeight: 0.5,
    chassisLength: 3.6,
    mass: 500,
    engineForce: 2000,
    brakeForce: 75,
    maxSteerVal: 0.30,
    suspensionStiffness: 45,
    suspensionRestLength: 0.5,
    frictionSlip: 2.0,
};
// Enum Stati Gioco
const GAME_STATE = {
    MENU: -1,
    START: 0,
    RACING: 1,
    RESPAWNING_FLYING: 2,
    FINISHED: 3,
    PAUSED: 4
};

//records su localStorage
const STORAGE_KEY_RECORDS = "webmania_records";
const STORAGE_KEY_SETTINGS = "webmania_settings";
const ACTIONS = {
    ACCEL: 'accel',
    BRAKE: 'brake',
    HANDBRAKE: 'handbrake',
    LEFT: 'left',
    RIGHT: 'right',
    RESPAWN_FLY: 'resp_fly',
    RESPAWN_STAND: 'resp_stand',
    RESTART: 'restart',
    PAUSE: 'pause'
};

const DEFAULT_SETTINGS = {
    renderHeight: 468,
    antialias: true,
    renderDistance: 150,
    maxRecords: 25,
    maxSkidmarks: 200,
    touchEnabled: false,
    gamepadEnabled: true,
    keyBinds: {
        [ACTIONS.ACCEL]: ['w', 'ArrowUp'],
        [ACTIONS.BRAKE]: ['s', 'ArrowDown'],
        [ACTIONS.HANDBRAKE]: [' ', 'Shift'],
        [ACTIONS.LEFT]: ['a', 'ArrowLeft'],
        [ACTIONS.RIGHT]: ['d', 'ArrowRight'],
        [ACTIONS.RESPAWN_FLY]: ['Enter', ''],
        [ACTIONS.RESPAWN_STAND]: ['r', 'R'],
        [ACTIONS.RESTART]: ['Delete', 'Backspace'],
        [ACTIONS.PAUSE]: ['Escape', 'p']
    },
    // Indici bottoni gamepad (Standard Mapping)
    gamepadBinds: {
        [ACTIONS.ACCEL]: 7, // R2
        [ACTIONS.BRAKE]: 6, // L2
        [ACTIONS.HANDBRAKE]: 0, // X / A
        [ACTIONS.RESPAWN_FLY]: 3, // Triangolo / Y
        [ACTIONS.RESPAWN_STAND]: 1, // Cerchio / B
        [ACTIONS.RESTART]: 8, // Select / Back
        [ACTIONS.PAUSE]: 9  // Start
    },

    touchLayout: {
        "btn-t-left": {left: "2%", bottom: "5%", top: "auto", right: "auto", scale: 1.5},
        "btn-t-right": {left: "15%", bottom: "5%", top: "auto", right: "auto", scale: 1.5},
        "btn-t-accel": {right: "5%", bottom: "20%", top: "auto", left: "auto", scale: 1.6},
        "btn-t-brake": {right: "5%", bottom: "5%", top: "auto", left: "auto", scale: 1.4},
        "btn-t-handbrake": {right: "20%", bottom: "10%", top: "auto", left: "auto", scale: 1.7},
        "btn-t-pause": {left: "2%", top: "2%", bottom: "auto", right: "auto", scale: 1.0},
        "btn-t-toggle": {right: "2%", top: "2%", bottom: "auto", left: "auto", scale: 1.0}
    }
};

let gameSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
const inputState = { accel: 0, brake: 0, handbrake: 0, steerL: 0, steerR: 0 };

function loadSettings() {
    const saved = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (saved) {
        const parsed = JSON.parse(saved);
        // Merge profondo per non perdere nuove chiavi (es. HANDBRAKE) se l'utente ha vecchi settings
        gameSettings = {
            ...DEFAULT_SETTINGS,
            ...parsed,
            keyBinds: {...DEFAULT_SETTINGS.keyBinds, ...parsed.keyBinds},
            gamepadBinds: {...DEFAULT_SETTINGS.gamepadBinds, ...parsed.gamepadBinds}
        };
    } else {
        if('ontouchstart' in window || navigator.maxTouchPoints > 0) {
            gameSettings.touchEnabled = true;
        }
    }
    applySettings();
}

function saveSettings() {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(gameSettings));
    applySettings();
}

function applySettings() {
    // Fog
    if(scene && scene.fog) {
        scene.fog.far = parseInt(gameSettings.renderDistance);
    }

    // Aggiorna etichette nel menu (così si vedono i numeri salvati)
    const elHeight = document.getElementById('val-render-height');
    if(elHeight) elHeight.innerText = gameSettings.renderHeight + "p";
    document.getElementById('opt-render-height').value = gameSettings.renderHeight;

    const elDist = document.getElementById('val-render-dist');
    if(elDist) elDist.innerText = gameSettings.renderDistance;
    document.getElementById('opt-render-dist').value = gameSettings.renderDistance;

    const elSkids = document.getElementById('val-max-skids');
    if(elSkids) elSkids.innerText = gameSettings.maxSkidmarks;
    document.getElementById('opt-max-skids').value = gameSettings.maxSkidmarks;

    // Aggiorna Checkbox Antialias
    const chkAA = document.getElementById('opt-antialias');
    if(chkAA) chkAA.checked = (gameSettings.antialias !== undefined ? gameSettings.antialias : true);

    // Applica Risoluzione
    if(renderer) {
        onWindowResize();
    }

    // Touch UI - Aggiornamento Immediato
    const touchDiv = document.getElementById('touch-controls');
    if(touchDiv) {
        // Mostra solo se abilitato E siamo in gioco (non nel menu principale)
        const shouldShow = gameSettings.touchEnabled && currentState !== GAME_STATE.MENU;
        touchDiv.style.display = shouldShow ? 'block' : 'none';

        // Applica layout
        if(gameSettings.touchLayout) {
            for(const [id, params] of Object.entries(gameSettings.touchLayout)) {
                const el = document.getElementById(id);
                if(el) {
                    // Posizione
                    el.style.left = params.left || '';
                    el.style.right = params.right || '';
                    el.style.top = params.top || '';
                    el.style.bottom = params.bottom || '';

                    // Scala (Default 1.0 se manca)
                    const scale = params.scale || 1.0;
                    el.style.transform = `scale(${scale})`;
                    // Importante: transform origin center per zoomare sul posto
                    el.style.transformOrigin = "center center";
                }
            }
        }
    }
    updateTouchVisibility();
}
function updateTouchVisibility() {
    const touchDiv = document.getElementById('touch-controls');
    if(!touchDiv) return;
    // Controlliamo l'hardware, non solo il setting
    const hasHardware = window.hasTouchHardware;
    const isGame = currentState !== GAME_STATE.MENU;
    const isEditing = document.getElementById('touch-editor-overlay').style.display === 'flex';
    // Il contenitore generale appare se siamo in gioco (o editor) e abbiamo uno schermo touch
    if (isGame || isEditing) {
        touchDiv.style.display = 'block';
        // Ora gestiamo la visibilità dei SINGOLI pulsanti
        const btns = touchDiv.querySelectorAll('.touch-btn');
        btns.forEach(btn => {
            // Il pulsante Toggle e Pause si vedono sempre se il contenitore è attivo
            if (btn.id === 'btn-t-toggle') {
                btn.style.display = 'flex';
                // Cambia icona in base allo stato
                btn.innerText = gameSettings.touchEnabled ? '✖' : '👁';
                btn.style.opacity = '1';
            }
            // Editor: mostra tutto
            else if (isEditing) {
                btn.style.display = 'flex';
            }
            // Pulsanti di gioco: dipendono dal setting
            else {
                btn.style.display = gameSettings.touchEnabled ? 'flex' : 'none';
            }
        });
    } else {
        touchDiv.style.display = 'none';
    }
}

// --- VARIABILI GLOBALI ---
let scene, camera, renderer, world;
let vehicle, chassisMesh, chassisBody, brakeLightL, brakeLightR;
let trackMeshes = [], trackBodies = [], skidmarkMeshes = [];

// Stato Corrente
let currentState = GAME_STATE.START;
let gameTime = 0; // Tempo di gioco effettivo (escluso pause)
let lastFrameTime = 0;
let bestTime = null;
const BEST_TIME_KEY = 'trackmaniaCloneBestTime'; //localstorage

let currentSeed = "";
let rng;
// Simple Mulberry32 PRNG
function createRNG(str) {
    let h = 1779033703 ^ str.length;
    for(let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = h << 13 | h >>> 19;
    }
    return function() {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        return ((h ^= h >>> 16) >>> 0) / 4294967296;
    }
}

// Gestione Checkpoint Avanzata
let currentCheckpointData = {
    position: new CANNON.Vec3(0, 5, -10),
    quaternion: new CANNON.Quaternion(0, 0, 0, 1),
    velocity: new CANNON.Vec3(0, 0, 0),
    angularVelocity: new CANNON.Vec3(0, 0, 0),
    timeStamp: 0,
    index: -1 // Per evitare trigger doppi
};

// Gestione Input Respawn
let enterPressTime = 0;
let isEnterPressed = false;
let keys = { w: false, a: false, s: false, d: false, space: false };

// UI Elements
const uiTimer = document.getElementById('timer');
const uiMsg = document.getElementById('message');
const uiCountdown = document.getElementById('countdown');
const uiBestTime = document.getElementById('best-time');

// Funzione helper per formattare i millisecondi in stringa M:S:MS
function formatTime(ms) {
    if (ms === null || ms === undefined) return '--:--.---';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = Math.floor(ms % 1000);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
}

function init() {
    try {
        // 1. Setup Three.js
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x87CEEB);
        scene.fog = new THREE.Fog(0x87CEEB, 20, gameSettings.renderDistance || 150);
        camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
        renderer = new THREE.WebGLRenderer({
            antialias: (gameSettings.antialias !== undefined ? gameSettings.antialias : true),
            powerPreference: "high-performance"
        });
        renderer.setPixelRatio(1);
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.getElementById('game-container').appendChild(renderer.domElement);
        onWindowResize();
        window.addEventListener('resize', onWindowResize, false);

        // Luci
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(50, 100, 50);
        dirLight.castShadow = true;
        scene.add(dirLight);

        // 2. Setup Cannon
        world = new CANNON.World();
        world.gravity.set(0, CONFIG.gravity, 0);
        world.broadphase = new CANNON.SAPBroadphase(world);
        const groundMat = new CANNON.Material('ground');
        const turboMat = new CANNON.Material('turbo');
        const wheelMat = new CANNON.Material('wheel');
        const wheelGroundContact = new CANNON.ContactMaterial(wheelMat, groundMat, { friction: 0.3, restitution: 0, contactEquationStiffness: 1000 });
        const wheelTurboContact = new CANNON.ContactMaterial(wheelMat, turboMat, { friction: 0.3, restitution: 0, contactEquationStiffness: 1000 });
        world.addContactMaterial(wheelGroundContact);
        world.addContactMaterial(wheelTurboContact);

        // 3. Setup Gioco
        setupInputs();
        createCar(wheelMat);

        // Versione UI
        document.getElementById('version-display').innerText = "v" + GAME_VERSION;
        // Gestione URL per Seed Diretto
        // Supporto per http://sito/#SEEDCODE
        const hashSeed = window.location.hash.replace('#', '');
        // O supporto per http://sito/SEEDCODE (se supportato dal server, altrimenti usa hash)
        const pathSeed = window.location.pathname.split('/').pop();
        const urlSeed = hashSeed || (pathSeed && pathSeed.length > 0 && pathSeed !== 'index.html' ? pathSeed : null);
        if (urlSeed) {
            window.uiStartGame(urlSeed);
        } else {
            currentState = GAME_STATE.MENU; // Start in Menu
        }
        // Inizializza loop
        lastFrameTime = performance.now();
        loadSettings();
        animate();
        // Rimuovi vecchio listener se presente
        // document.getElementById('gen-btn')... RIMOSSO
        console.log("Gioco Inizializzato v" + GAME_VERSION);
    } catch (e) {
        console.error(e);
    }
}
function onWindowResize() {
    if(!camera || !renderer) return;
    // 1. Calcola il nuovo aspetto della finestra
    const aspect = window.innerWidth / window.innerHeight;
    // 2. Aggiorna la camera
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    // 3. Calcola la risoluzione interna basata sulle impostazioni (es. 468p)
    const h = parseInt(gameSettings.renderHeight) || parseInt(DEFAULT_SETTINGS.renderHeight);
    const w = Math.floor(h * aspect);
    // 4. Imposta la risoluzione interna (buffer pixel)
    // 'false' dice a Three.js di NON cambiare lo stile CSS, ma noi lo forziamo sotto per sicurezza
    renderer.setSize(w, h, false);
    // 5. Forza lo stile del canvas per riempire sempre lo schermo
    // Questo risolve il problema del rettangolino piccolo in alto a sinistra
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
}

// Funzione Helper Countdown
function startCountdown(count) {
    currentState = GAME_STATE.START;
    uiCountdown.style.display = 'block';

    uiCountdown.innerText = count;

    // Blocca auto
    if(chassisBody) {
        chassisBody.velocity.set(0,0,0);
        chassisBody.angularVelocity.set(0,0,0);
        chassisBody.position.copy(currentCheckpointData.position);
        chassisBody.quaternion.copy(currentCheckpointData.quaternion);
    }

    const interval = setInterval(() => {
        count--;
        if (count > 0) {
            uiCountdown.innerText = count;
        } else if (count === 0) {
            uiCountdown.innerText = "GO!";
            uiCountdown.style.color = "#00ff00";
        } else {
            clearInterval(interval);
            uiCountdown.style.display = 'none';
            uiCountdown.style.color = "#fff";
            currentState = GAME_STATE.RACING;
        }
    }, 400);
}

// --- GENERATORE MODULARE PISTA ---
const MODULES = {
    START: 'start',
    STRAIGHT: 'straight',
    TURN_LEFT: 'left',
    TURN_RIGHT: 'right',
    RAMP_UP: 'ramp_up',
    RAMP_DOWN: 'ramp_down',
    TURBO: 'turbo',
    CHECKPOINT: 'checkpoint',
    FINISH: 'finish'
};

// Configurazione Geometria Pista
const TRACK_CFG = {
    blockSize: 20,
    wallHeight: 1.5,
    rampPadding: 4.0, // Segmento piatto inizio/fine rampa
    maxRampSlope: 0.4, // Pendenza massima (evita muri verticali)
    colors: {
        road: 0x444444,
        wall: 0x888888,
        turbo: 0x00ffff,
        startRing: 0x00ff00, // Verde
        finishRing: 0xff0000, // Rosso
        checkRing: 0xffff00  // Giallo
    }
};

// Dizionario dei costruttori per ogni tipo di blocco
const BLOCK_BUILDERS = {
    default: (container, body, params) => {
        const len = params.length || TRACK_CFG.blockSize;
        const width = params.width || TRACK_CFG.blockSize;

        addBox(container, body, new CANNON.Vec3(0, 0, -len/2), new CANNON.Vec3(width, 0.5, len), false, null, params.isTurbo);
        addBox(container, body, new CANNON.Vec3(-width/2 + 0.5, TRACK_CFG.wallHeight/2, -len/2), new CANNON.Vec3(1, TRACK_CFG.wallHeight, len), true);
        addBox(container, body, new CANNON.Vec3(width/2 - 0.5, TRACK_CFG.wallHeight/2, -len/2), new CANNON.Vec3(1, TRACK_CFG.wallHeight, len), true);

        // Decorazioni (Finish/Start/Checkpoint)
        if (params.type === MODULES.FINISH || params.type === MODULES.START || params.type === MODULES.CHECKPOINT) {
            let color = TRACK_CFG.colors.checkRing;
            if (params.type === MODULES.START) color = TRACK_CFG.colors.startRing;
            if (params.type === MODULES.FINISH) color = TRACK_CFG.colors.finishRing;

            const arch = new THREE.Mesh(
                new THREE.TorusGeometry(8, 1, 8, 24, Math.PI),
                                        new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: 0.5 })
            );
            arch.position.set(0, 0, -len/2);
            container.add(arch);
            if(params.type === MODULES.FINISH) body.isFinish = true;
            if(params.type === MODULES.CHECKPOINT) body.isCheckpoint = true;
        }
        if (params.isTurbo) body.isTurbo = true;
    },

    // --- RAMPA CURVA (S-CURVE) ---
    ramp: (container, body, params) => {
        const len = params.length || TRACK_CFG.blockSize;
        const totalH = params.height || TRACK_CFG.blockSize;
        const width = params.width || TRACK_CFG.blockSize;

        // Dividiamo la rampa in segmenti per fare la curva
        const segments = 10;
        const segLen = len / segments;

        for(let i=0; i<segments; i++) {
            // Calcolo posizione lungo la curva (0.0 -> 1.0)
            const tStart = i / segments;
            const tEnd = (i+1) / segments;

            // Interpolazione Coseno (Ease-InOut)
            // Formula: y = H * (1 - cos(t*PI)) / 2
            const hStart = totalH * (1 - Math.cos(tStart * Math.PI)) / 2;
            const hEnd = totalH * (1 - Math.cos(tEnd * Math.PI)) / 2;

            const segY = (hStart + hEnd) / 2;
            const segZ = -(i * segLen) - (segLen/2);

            // Calcolo angolo inclinazione del segmento
            const dy = hEnd - hStart;
            const angle = Math.atan2(dy, segLen);
            const qSeg = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), angle);

            // Lunghezza ipotenusa del segmento
            const hypLen = Math.sqrt(segLen**2 + dy**2);

            const pos = new CANNON.Vec3(0, segY, segZ);

            // Pavimento
            addBox(container, body, pos, new CANNON.Vec3(width, 0.5, hypLen), false, qSeg);

            // Muri
            const wallOffL = new THREE.Vector3(-width/2+0.5, TRACK_CFG.wallHeight/2, 0).applyQuaternion(qSeg).add(pos);
            const wallOffR = new THREE.Vector3(width/2-0.5, TRACK_CFG.wallHeight/2, 0).applyQuaternion(qSeg).add(pos);
            addBox(container, body, wallOffL, new CANNON.Vec3(1, TRACK_CFG.wallHeight, hypLen), true, qSeg);
            addBox(container, body, wallOffR, new CANNON.Vec3(1, TRACK_CFG.wallHeight, hypLen), true, qSeg);
        }
    },

    // --- CURVA SETTORIALE ---
    turn: (container, body, params) => {
        const isLeft = params.isLeft;
        const r = params.radius;
        const width = params.width || TRACK_CFG.blockSize;

        const segments = 12;
        const angleTotal = Math.PI / 2;
        const angleStep = angleTotal / segments;

        // Offset laterale per i muri (metà strada - metà muro)
        // Larghezza muro = 1. Offset = (Width/2 - 0.5)
        const latOffset = width/2 - 0.5;

        for (let i = 0; i < segments; i++) {
            const theta = (i * angleStep) + (angleStep / 2);

            // Calcolo posizione centro strada
            const sign = isLeft ? 1 : -1;
            const blockAngle = theta * sign;
            const dx = (r * (1 - Math.cos(theta))) * (isLeft ? -1 : 1);
            const dz = -r * Math.sin(theta);

            const segPos = new CANNON.Vec3(dx, 0, dz);
            const segRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), blockAngle);

            // 1. PAVIMENTO (Centrato su segPos)
            const roadMesh = createSectorMesh(r, width, 0.5, angleStep, isLeft, TRACK_CFG.colors.road);
            roadMesh.position.copy(segPos);
            roadMesh.quaternion.copy(segRot);
            container.add(roadMesh);

            const roadShape = createSectorPhysics(r, width, 0.5, angleStep, isLeft);
            body.addShape(roadShape, segPos, segRot);

            // 2. MURI (Offset laterale)
            // Raggio dei muri per la geometria (Curvatura)
            const rInnerWall = r - latOffset;
            const rOuterWall = r + latOffset;
            const wH = TRACK_CFG.wallHeight;

            // Calcolo offset vettoriale locale ruotato
            // Inner Wall: Se Left, è a sinistra (-X). Se Right, è a destra (+X).
            // Outer Wall: Opposto.
            // Attenzione: In coordinate curve locali, Inner è sempre verso il centro curvatura.
            // Se Left (centro a -X), Inner è a -X.
            // Se Right (centro a +X), Inner è a +X.

            const xInner = isLeft ? -latOffset : latOffset;
            const xOuter = isLeft ? latOffset : -latOffset;

            // Posizione verticale muri (centrati su wH/2 per poggiare a terra)
            // ThreeJS Position
            const innerPos = new THREE.Vector3(xInner, wH/2, 0).applyQuaternion(segRot).add(segPos);
            const outerPos = new THREE.Vector3(xOuter, wH/2, 0).applyQuaternion(segRot).add(segPos);

            // Muro Interno
            const innerMesh = createSectorMesh(rInnerWall, 1, wH, angleStep, isLeft, TRACK_CFG.colors.wall);
            innerMesh.position.copy(innerPos);
            innerMesh.quaternion.copy(segRot);
            container.add(innerMesh);

            const innerShape = createSectorPhysics(rInnerWall, 1, wH, angleStep, isLeft);
            body.addShape(innerShape, innerPos, segRot);

            // Muro Esterno
            const outerMesh = createSectorMesh(rOuterWall, 1, wH, angleStep, isLeft, TRACK_CFG.colors.wall);
            outerMesh.position.copy(outerPos);
            outerMesh.quaternion.copy(segRot);
            container.add(outerMesh);

            const outerShape = createSectorPhysics(rOuterWall, 1, wH, angleStep, isLeft);
            body.addShape(outerShape, outerPos, segRot);
        }
    }
};

// --- HELPER FISICA AVANZATA ---

// CURVE PERFETTE -> Calcola i vertici di un settore di anello (Road o Wall)
function getSectorVertices(r, width, height, angle, isLeft) {
    // Calcola i vertici esatti per un settore curvo
    const rInner = r - width / 2;
    const rOuter = r + width / 2;
    const halfAngle = angle / 2;

    // Y range: Centrato su 0, come i Box standard (che vanno da -H/2 a +H/2)
    const yBot = -height / 2;
    const yTop = height / 2;

    // Helper Polare: converte raggio/angolo in x/z locali
    // Il pivot del blocco è al centro della "fetta" (Angle=0) sulla linea mediana (Radius=r)
    // Quindi sottraiamo il raggio centrale 'r' per avere coordinate relative (0,0) al centro strada
    const getPoint = (radius, theta) => {
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);

        let px, pz;
        if (isLeft) {
            // Centro curvatura a (-r, 0).
            // P = Centro + vettore rotante
            px = -r + radius * cos;
            pz = -radius * sin;
        } else {
            // Centro curvatura a (+r, 0).
            px = r - radius * cos;
            pz = radius * sin;
        }
        return { x: px, z: pz };
    };

    // 4 Vertici base
    const vBackInner  = getPoint(rInner, -halfAngle);
    const vFrontInner = getPoint(rInner,  halfAngle);
    const vBackOuter  = getPoint(rOuter, -halfAngle);
    const vFrontOuter = getPoint(rOuter,  halfAngle);

    // Ordine vertici per Cannon (ConvexPolyhedron)
    return [
        new CANNON.Vec3(vBackInner.x, yBot, vBackInner.z),  // 0
        new CANNON.Vec3(vBackOuter.x, yBot, vBackOuter.z),  // 1
        new CANNON.Vec3(vFrontOuter.x, yBot, vFrontOuter.z),// 2
        new CANNON.Vec3(vFrontInner.x, yBot, vFrontInner.z),// 3
        new CANNON.Vec3(vBackInner.x, yTop, vBackInner.z),  // 4
        new CANNON.Vec3(vBackOuter.x, yTop, vBackOuter.z),  // 5
        new CANNON.Vec3(vFrontOuter.x, yTop, vFrontOuter.z),// 6
        new CANNON.Vec3(vFrontInner.x, yTop, vFrontInner.z) // 7
    ];
}

function createSectorPhysics(r, width, height, angle, isLeft) {
    const verts = getSectorVertices(r, width, height, angle, isLeft);
    const faces = [
        [3, 2, 1, 0], // Bottom
        [4, 5, 6, 7], // Top
        [0, 1, 5, 4], // Back
        [2, 3, 7, 6], // Front
        [0, 4, 7, 3], // Inner Side
        [1, 2, 6, 5]  // Outer Side
    ];
    return new CANNON.ConvexPolyhedron({ vertices: verts, faces });
}

function createSectorMesh(r, width, height, angle, isLeft, color) {
    const verts = getSectorVertices(r, width, height, angle, isLeft);
    const geo = new THREE.BufferGeometry();
    const v = verts;

    const positions = [];
    const addTri = (a, b, c) => {
        positions.push(v[a].x, v[a].y, v[a].z);
        positions.push(v[b].x, v[b].y, v[b].z);
        positions.push(v[c].x, v[c].y, v[c].z);
    };
    const addQuad = (a, b, c, d) => {
        addTri(a, b, c); addTri(a, c, d);
    };

    addQuad(4, 5, 6, 7); // Top
    addQuad(3, 2, 1, 0); // Bottom
    addQuad(0, 1, 5, 4); // Back
    addQuad(2, 3, 7, 6); // Front
    addQuad(3, 0, 4, 7); // Inner
    addQuad(1, 2, 6, 5); // Outer

    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.7 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}

// Helper interno per createBlock (deve essere accessibile dai builders)
function addBox(container, body, offset, dim, isWall, localRot, isTurbo=false) {
    const shape = new CANNON.Box(new CANNON.Vec3(dim.x / 2, dim.y / 2, dim.z / 2));
    const q = localRot || new CANNON.Quaternion();
    body.addShape(shape, offset, q);

    const geo = new THREE.BoxGeometry(dim.x, dim.y, dim.z);
    let color = isWall ? TRACK_CFG.colors.wall : TRACK_CFG.colors.road;
    if(isTurbo) color = TRACK_CFG.colors.turbo;

    const mat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.7 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(offset);
    if (localRot) mesh.quaternion.copy(localRot);

    mesh.castShadow = true;
    mesh.receiveShadow = true;
    container.add(mesh);
}

function createBlock(type, x, y, z, dirAngle, params = {}) {
    params.type = type;

    const quat = new THREE.Quaternion();
    quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), dirAngle * Math.PI / 2);

    const container = new THREE.Object3D();
    container.position.set(x, y, z);
    container.quaternion.copy(quat);
    scene.add(container);
    trackMeshes.push(container);

    const body = new CANNON.Body({ mass: 0 });
    body.position.copy(container.position);
    body.quaternion.copy(container.quaternion);

    // Dispatcher pattern
    if (type === MODULES.RAMP_UP || type === MODULES.RAMP_DOWN) {
        // Fix per Ramp Down: Inverti altezza e logica nel builder
        const h = params.height || 10;
        const actualH = (type === MODULES.RAMP_UP) ? h : -h;
        // Per ramp down, il trucco è costruirla come Up ma gestire l'elevazione nel generatore
        // Oppure renderizzare la geometria specchiata.
        // Soluzione semplice: passiamo altezza relativa.
        params.height = actualH;
        BLOCK_BUILDERS.ramp(container, body, params);
    }
    else if (type === MODULES.TURN_LEFT || type === MODULES.TURN_RIGHT) {
        params.isLeft = (type === MODULES.TURN_LEFT);
        BLOCK_BUILDERS.turn(container, body, params);
    }
    else {
        params.isTurbo = (type === MODULES.TURBO);
        BLOCK_BUILDERS.default(container, body, params);
    }

    world.addBody(body);
    trackBodies.push(body);
}


// --- FUNZIONI DI GENERAZIONE PISTA ---

// Helper per collisioni tra segmenti pista
const occupiedPoints = []; // Lista di {x, z, r}
function checkTrackCollision(x, y, z, radiusCheck) {
    const ignoreLast = 1;
    const heightTolerance = 8;
    for(let i = 0; i < occupiedPoints.length - ignoreLast; i++) {
        const p = occupiedPoints[i];
        if (Math.abs(p.y - y) > heightTolerance) {
            continue; // Se c'è dislivello sufficiente, non è collisione
        }
        const dist = Math.sqrt((x - p.x)**2 + (z - p.z)**2);
        if (dist < (p.r + radiusCheck)) {
            return true; // Collisione
        }
    }
    return false;
}

//funzione principale di generazione pista
function generateTrack(matPhysics, matTurbo, seed) {
    // Setup Seed
    currentSeed = seed || Math.random().toString(36).substring(7);
    rng = createRNG(currentSeed); // Inizializza il generatore

    console.log("Generating Seed:", currentSeed);

    const history = JSON.parse(localStorage.getItem(STORAGE_KEY_RECORDS) || "[]");
    const existingRecord = history.find(r => r.seed === currentSeed);
    if (existingRecord) {
        bestTime = existingRecord.time;
        uiBestTime.innerText = `Best: ${formatTime(bestTime)}`;
    } else {
        bestTime = null;
        uiBestTime.innerText = "Best: --:--.---";
    }

    trackMeshes.forEach(m => scene.remove(m));
    trackBodies.forEach(b => world.removeBody(b));
    trackMeshes.length = 0;
    trackBodies.length = 0;
    occupiedPoints.length = 0;

    const trackLength = 40;
    let cx = 0, cy = 0, cz = 0;
    let dir = 0;

    // ... START Block (codice esistente) ...
    createBlock(MODULES.START, cx, cy, cz, dir, { length: TRACK_CFG.blockSize });
    trackBodies[trackBodies.length-1].isStart = true;
    occupiedPoints.push({x:cx, y:cy, z:cz, r:TRACK_CFG.blockSize});
    cz -= TRACK_CFG.blockSize; // startOffset

    for (let i = 0; i < trackLength; i++) {
        let validMoveFound = false;
        let attempts = 0;

        while(!validMoveFound && attempts < 10) {
            attempts++;
            let potentialMoves = [];

            const getDelta = (d, len) => { /* ... existing ... */
                const rad = d * Math.PI / 2;
                return { x: -Math.sin(rad) * len, z: -Math.cos(rad) * len };
            };
            const fwdDir = dir;
            const leftDir = (dir + 1) % 4;
            const rightDir = (dir + 3) % 4;

            // --- 1. RETTILINEI & RAMPE ---
            // USA rng() INVECE DI Math.random()
            const straightLen = TRACK_CFG.blockSize * (rng() > 0.6 ? 2 : 1);
            const dS = getDelta(fwdDir, straightLen);

            if (!checkTrackCollision(cx + dS.x, cy, cz + dS.z, 5)) {
                potentialMoves.push({ type: MODULES.STRAIGHT, nextDir: dir, dx: dS.x, dy: 0, dz: dS.z, len: straightLen, w: 10 });
                if (cy < 40) {
                    // USA rng()
                    const h = 5 + rng() * 10;
                    potentialMoves.push({ type: MODULES.RAMP_UP, nextDir: dir, dx: dS.x, dy: h, dz: dS.z, len: straightLen, height: h, w: 5 });
                }
                if (cy > 10) {
                    // USA rng()
                    const h = 5 + rng() * 10;
                    potentialMoves.push({ type: MODULES.RAMP_DOWN, nextDir: dir, dx: dS.x, dy: -h, dz: dS.z, len: straightLen, height: h, w: 5 });
                }
            }

            // --- 2. CURVE ---
            const turnRadii = [TRACK_CFG.blockSize, TRACK_CFG.blockSize * 2.5];
            turnRadii.forEach(r => {
                const calcTurnEnd = (currDir, isLeft) => { /* ... existing ... */
                    const fwd = getDelta(currDir, r);
                    const sideDir = isLeft ? (currDir + 1)%4 : (currDir + 3)%4;
                    const side = getDelta(sideDir, r);
                    return { x: fwd.x + side.x, z: fwd.z + side.z };
                };

                const endL = calcTurnEnd(dir, true);
                if (!checkTrackCollision(cx + endL.x, cy, cz + endL.z, r/1.5)) {
                    potentialMoves.push({ type: MODULES.TURN_LEFT, nextDir: leftDir, dx: endL.x, dy: 0, dz: endL.z, radius: r, w: 6 });
                }
                const endR = calcTurnEnd(dir, false);
                if (!checkTrackCollision(cx + endR.x, cy, cz + endR.z, r/1.5)) {
                    potentialMoves.push({ type: MODULES.TURN_RIGHT, nextDir: rightDir, dx: endR.x, dy: 0, dz: endR.z, radius: r, w: 6 });
                }
            });

            if (potentialMoves.length > 0) {
                const totalW = potentialMoves.reduce((a,b)=>a+b.w,0);
                // USA rng()
                let rand = rng() * totalW;
                const move = potentialMoves.find(m => (rand -= m.w) < 0) || potentialMoves[0];

                if (move.type === MODULES.STRAIGHT && i % 6 === 0 && i > 0) move.type = MODULES.CHECKPOINT;
                if (i === trackLength - 1) move.type = MODULES.FINISH;

                createBlock(move.type, cx, cy, cz, dir, {
                    length: move.len, height: move.height, radius: move.radius, isLeft: (move.type === MODULES.TURN_LEFT)
                });

                // Update collision logic existing...
                const steps = 3;
                for(let k=1; k<=steps; k++) {
                    occupiedPoints.push({ x: cx + (move.dx * k/steps), z: cz + (move.dz * k/steps), r: 15 });
                }

                cx += move.dx; cy += move.dy; cz += move.dz; dir = move.nextDir;
                validMoveFound = true;
            }
        }
        if (!validMoveFound) {
            createBlock(MODULES.FINISH, cx, cy, cz, dir, { length: TRACK_CFG.blockSize });
            break;
        }
    }

    // Non avviamo resetTrack qui automaticamente. La generazione è solo fisica.
    // resetTrack verrà chiamato da startGame o dal loop.
}

// --- CREAZIONE AUTO ---
let speedoCtx, speedoTexture;

function createCar(wheelMat) {
    // 1. FISICA (Anti-Scraping)
    // Hitbox sollevata per non toccare terra sulle rampe
    chassisBody = new CANNON.Body({ mass: CONFIG.mass });
    const physLen = 3.8; 
    const physWidth = 1.8;
    const physHeight = 0.4;
    const chassisShape = new CANNON.Box(new CANNON.Vec3(physWidth/2, physHeight/2, physLen/2));
    
    // Offset +0.5: la pancia fisica è alta
    chassisBody.addShape(chassisShape, new CANNON.Vec3(0, 0.5, 0));
    
    chassisBody.position.set(0, 4, -10);
    chassisBody.quaternion.set(0, 0, 0, 1);
    chassisBody.angularDamping = 0.5;
    world.addBody(chassisBody);

    // 2. GRAFICA (F1 Low Poly)
    const carGroup = new THREE.Group();
    
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd92525 }); // Rosso
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x222222 }); // Carbonio

    // Offset visuale negativo per "schiacciare" l'auto a terra visivamente
    const visualY = -0.4; 

    // A. Corpo Centrale
    const bodyGeo = new THREE.BoxGeometry(0.8, 0.4, 2.0);
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.position.set(0, 0.5 + visualY, 0.2); 
    bodyMesh.castShadow = true;
    carGroup.add(bodyMesh);

    // B. Naso
    const noseGeo = new THREE.BoxGeometry(0.6, 0.25, 1.8);
    const noseMesh = new THREE.Mesh(noseGeo, bodyMat);
    noseMesh.position.set(0, 0.35 + visualY, -1.6); // Muso basso
    noseMesh.castShadow = true;
    carGroup.add(noseMesh);

    // C. Pance Laterali
    const sideGeo = new THREE.BoxGeometry(0.6, 0.35, 1.4);
    const sideL = new THREE.Mesh(sideGeo, bodyMat);
    sideL.position.set(-0.8, 0.4 + visualY, 0.4);
    sideL.castShadow = true;
    carGroup.add(sideL);

    const sideR = new THREE.Mesh(sideGeo, bodyMat);
    sideR.position.set(0.8, 0.4 + visualY, 0.4);
    sideR.castShadow = true;
    carGroup.add(sideR);

    // D. Alettone Posteriore
    const spoilerGeo = new THREE.BoxGeometry(2.2, 0.1, 0.6);
    const spoilerMesh = new THREE.Mesh(spoilerGeo, darkMat);
    spoilerMesh.position.set(0, 0.9 + visualY, 1.4);
    spoilerMesh.castShadow = true;
    carGroup.add(spoilerMesh);
    
    // Supporti alettone
    const strutGeo = new THREE.BoxGeometry(0.1, 0.4, 0.4);
    const strutL = new THREE.Mesh(strutGeo, darkMat);
    strutL.position.set(-0.5, 0.7 + visualY, 1.4);
    carGroup.add(strutL);
    const strutR = new THREE.Mesh(strutGeo, darkMat);
    strutR.position.set(0.5, 0.7 + visualY, 1.4);
    carGroup.add(strutR);

    //luci freno
    const brakeLightGeo = new THREE.BoxGeometry(0.1, 0.1, 0.05);
    const brakeLightMat = new THREE.MeshStandardMaterial({
        color: 0x880000,
        emissive: 0x000000,
        emissiveIntensity: 2
    });
    brakeLightL = new THREE.Mesh(brakeLightGeo, brakeLightMat);
    brakeLightR = new THREE.Mesh(brakeLightGeo, brakeLightMat);
    brakeLightL.position.copy(strutL.position).add(new THREE.Vector3(0, -0.1, 0.21));
    brakeLightR.position.copy(strutR.position).add(new THREE.Vector3(0, -0.1, 0.21));
    carGroup.add(brakeLightL);
    carGroup.add(brakeLightR);

    // --- E. TACHIMETRO ---
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 64;
    speedoCtx = canvas.getContext('2d');
    speedoCtx.imageSmoothingEnabled = false;
    speedoTexture = new THREE.CanvasTexture(canvas);
    speedoTexture.minFilter = THREE.NearestFilter;
    speedoTexture.magFilter = THREE.NearestFilter;
    speedoTexture.generateMipmaps = false;
    const speedoPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(0.6, 0.3),
        new THREE.MeshBasicMaterial({
            map: speedoTexture,
            transparent: true,
            opacity: 1.0
        })
    );
    // Posizione: sul retro del corpo centrale (Z ~ 1.21), altezza media
    speedoPlane.position.set(0, 0.5 + visualY, 1.21);
    speedoPlane.rotation.y = 0; 
    carGroup.add(speedoPlane);
    chassisMesh = carGroup; 
    scene.add(chassisMesh);

    // 3. VEICOLO (Sospensioni e Ruote)
    vehicle = new CANNON.RaycastVehicle({
        chassisBody: chassisBody,
        indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2
    });
    const options = {
        radius: 0.45,
        directionLocal: new CANNON.Vec3(0, -1, 0),
        suspensionStiffness: 45,
        suspensionRestLength: 0.55,
        frictionSlip: 2.5,
        dampingRelaxation: 2.3,
        dampingCompression: 4.4,
        maxSuspensionForce: 100000,
        rollInfluence: 0.01,
        axleLocal: new CANNON.Vec3(-1, 0, 0),
        chassisConnectionPointLocal: new CANNON.Vec3(1, 1, 0),
        maxSuspensionTravel: 0.4,
        customSlidingRotationalSpeed: -30,
        useCustomSlidingRotationalSpeed: true
    };
    const axisY = 0.3; 
    const axisZF = -1.4; 
    const axisZR = 1.3;  
    const widthHalf = 1.1;
    vehicle.addWheel({...options, chassisConnectionPointLocal: new CANNON.Vec3(widthHalf, axisY, axisZF)});
    vehicle.addWheel({...options, chassisConnectionPointLocal: new CANNON.Vec3(-widthHalf, axisY, axisZF)});
    vehicle.addWheel({...options, chassisConnectionPointLocal: new CANNON.Vec3(widthHalf, axisY, axisZR)});
    vehicle.addWheel({...options, chassisConnectionPointLocal: new CANNON.Vec3(-widthHalf, axisY, axisZR)});
    vehicle.addToWorld(world);
    // Mesh Ruote
    const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.6, 24); 
    wheelGeo.rotateZ(Math.PI/2);
    const wheelMatVis = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 });
    const rimGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.62, 16);
    rimGeo.rotateZ(Math.PI/2);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xffff00 });
    vehicle.wheelInfos.forEach(w => {
        const wheelGroup = new THREE.Group();
        const tire = new THREE.Mesh(wheelGeo, wheelMatVis);
        const rim = new THREE.Mesh(rimGeo, rimMat);
        tire.castShadow = true;
        wheelGroup.add(tire);
        wheelGroup.add(rim);
        scene.add(wheelGroup);
        w.mesh = wheelGroup;
    });
}
// --- HELPER: TACHIMETRO DIGITALE A 7 SEGMENTI ---
// Ordine segmenti: Top, TopRight, BotRight, Bottom, BotLeft, TopLeft, Middle
const DIGIT_SEGMENTS = [
    [1,1,1,1,1,1,0], // 0
[0,1,1,0,0,0,0], // 1
[1,1,0,1,1,0,1], // 2
[1,1,1,1,0,0,1], // 3
[0,1,1,0,0,1,1], // 4
[1,0,1,1,0,1,1], // 5
[1,0,1,1,1,1,1], // 6
[1,1,1,0,0,0,0], // 7
[1,1,1,1,1,1,1], // 8
[1,1,1,1,0,1,1]  // 9
];
function drawDigitalNumber(ctx, number, startX, startY, digitWidth, digitHeight, thickness) {
    const strNum = number.toString();
    const spacing = thickness * 1.5; // Spazio tra i numeri
    // Calcola l'offset X per centrare tutto il blocco di testo
    const totalWidth = (strNum.length * digitWidth) + ((strNum.length - 1) * spacing);
    let currentX = startX - (totalWidth / 2);
    ctx.fillStyle = "#ffffff"; // Colore led (Bianco puro, zero sfumature)
    for (let i = 0; i < strNum.length; i++) {
        const digit = parseInt(strNum[i]);
        if (isNaN(digit)) continue;
        const segs = DIGIT_SEGMENTS[digit];
        const x = currentX;
        const y = startY - (digitHeight / 2);
        const w = digitWidth;
        const h = digitHeight;
        const t = thickness;
        // Disegna i rettangoli in base ai segmenti attivi
        if (segs[0]) ctx.fillRect(x, y, w, t);                 // Top
        if (segs[1]) ctx.fillRect(x + w - t, y, t, h / 2);     // TopRight
        if (segs[2]) ctx.fillRect(x + w - t, y + h / 2, t, h / 2); // BotRight
        if (segs[3]) ctx.fillRect(x, y + h - t, w, t);         // Bottom
        if (segs[4]) ctx.fillRect(x, y + h / 2, t, h / 2);     // BotLeft
        if (segs[5]) ctx.fillRect(x, y, t, h / 2);             // TopLeft
        if (segs[6]) ctx.fillRect(x, y + (h / 2) - (t / 2), w, t); // Middle
        currentX += digitWidth + spacing;
    }
}

// --- LOOP PRINCIPALE ---
function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const dt = Math.min((now - lastFrameTime) / 1000, 0.1);

    // Se siamo in pausa o nel menu, aggiorniamo lastFrameTime ma non la fisica
    if (currentState === GAME_STATE.PAUSED || currentState === GAME_STATE.MENU) {
        lastFrameTime = now;
        renderer.render(scene, camera); // Renderizza statico (freeze)
        return;
    }
    lastFrameTime = now;

    if (currentState !== GAME_STATE.START && currentState !== GAME_STATE.FINISHED) {
        world.step(1 / CONFIG.stepFrequency);
        if (currentState === GAME_STATE.RACING || currentState === GAME_STATE.RESPAWNING_FLYING) {
            gameTime += dt * 1000;
        }
    }

    if (vehicle && chassisMesh) {
        chassisMesh.position.copy(chassisBody.position);
        chassisMesh.quaternion.copy(chassisBody.quaternion);

        const localVelocity = new CANNON.Vec3(0,0,0);
        chassisBody.quaternion.inverse().vmult(chassisBody.velocity, localVelocity);
        const forwardSpeed = -localVelocity.z;

        pollInputs(); // Leggi tutti gli input

        let engine = 0, brake = 0, steer = 0;

        const inSteer = window.inputAnalog ? window.inputAnalog.steer : 0;
        const inThrottle = window.inputAnalog ? window.inputAnalog.throttle : 0;
        const inBrake = window.inputAnalog ? window.inputAnalog.brake : 0;
        const inHandbrake = window.inputAnalog ? window.inputAnalog.handbrake : 0;

        if (currentState === GAME_STATE.RACING) {
            // Motore
            if (inThrottle > 0) engine = CONFIG.engineForce * inThrottle;
            else if (inBrake > 0) {
                if (forwardSpeed > 1.0) brake = CONFIG.brakeForce * inBrake;
                else engine = -CONFIG.engineForce / 2;
            }
            // Freno a mano (somma forza)
            if (inHandbrake > 0.1) {
                brake += CONFIG.brakeForce * 2;
                // Opzionale: lock ruote posteriori o slittamento laterale aumentato
            }
            steer = inSteer * CONFIG.maxSteerVal;
        }

        // Luci Freno
        if (brakeLightL && (inBrake > 0.1 || inHandbrake > 0.1)) {
            brakeLightL.material.emissive.setHex(0xff0000);
        } else if (brakeLightL) {
            brakeLightL.material.emissive.setHex(0x000000);
        }

        // Sgommate (Skidmarks)
        vehicle.wheelInfos.forEach(w => {
            if (w.sliding && currentState === GAME_STATE.RACING) {
                // Throttling: crea una sgommata solo ogni 50ms per non intasare
                if (gameTime % 50 < 25) {
                    const skidGeo = new THREE.PlaneGeometry(0.35, 1.3);
                    const skidMat = new THREE.MeshBasicMaterial({
                        color: 0x000000,
                        transparent: true,
                        opacity: 0.4
                    });
                    const skidMesh = new THREE.Mesh(skidGeo, skidMat);

                    // Posiziona la sgommata nel punto di contatto e ruotala con l'auto
                    skidMesh.position.copy(w.raycastResult.hitPointWorld).add(new THREE.Vector3(0, 0.02, 0)); // Leggero offset per evitare Z-fighting
                    skidMesh.quaternion.copy(chassisBody.quaternion);
                    skidMesh.rotateX(-Math.PI / 2); // Orienta il piano orizzontalmente

                    scene.add(skidMesh);
                    skidmarkMeshes.push(skidMesh);
                    const limit = parseInt(gameSettings.maxSkidmarks) || parseInt(DEFAULT_SETTINGS.maxSkidmarks);
                    while (skidmarkMeshes.length > limit) {
                        const oldSkid = skidmarkMeshes.shift();
                        scene.remove(oldSkid);
                        oldSkid.geometry.dispose();
                        oldSkid.material.dispose();
                    }
                }
            }
        });

        vehicle.applyEngineForce(engine, 0);
        vehicle.applyEngineForce(engine, 1);
        vehicle.applyEngineForce(engine, 2);
        vehicle.applyEngineForce(engine, 3);
        vehicle.setBrake(brake, 0);
        vehicle.setBrake(brake, 1);
        vehicle.setBrake(brake, 2);
        vehicle.setBrake(brake, 3);
        vehicle.setSteeringValue(steer, 0);
        vehicle.setSteeringValue(steer, 1);

        for (let i=0; i<vehicle.wheelInfos.length; i++) {
            vehicle.updateWheelTransform(i);
            vehicle.wheelInfos[i].mesh.position.copy(vehicle.wheelInfos[i].worldTransform.position);
            vehicle.wheelInfos[i].mesh.quaternion.copy(vehicle.wheelInfos[i].worldTransform.quaternion);
        }

        const camOffset = new THREE.Vector3(0, 4.0, 6.5);
        camOffset.applyMatrix4(chassisMesh.matrixWorld);
        camera.position.lerp(camOffset, 0.2);
        camera.lookAt(chassisMesh.position.x, chassisMesh.position.y + 1.5, chassisMesh.position.z);

        if (chassisBody.position.y < -10 && currentState === GAME_STATE.RACING) {
            doRespawn('standing');
        }

        const kmh = Math.floor(Math.abs(forwardSpeed * 3.6));
        speedoCtx.clearRect(0, 0, 128, 64);
        drawDigitalNumber(speedoCtx, kmh, 64, 32, 24, 44, 6);
        speedoTexture.needsUpdate = true;

        trackBodies.forEach((b, index) => {
            if (!b.isCheckpoint && !b.isFinish && !b.isStart) return;

            const carPosWorld = chassisBody.position;
            const blockPosWorld = b.position;
            const blockQuatInverse = b.quaternion.inverse();
            const relPos = carPosWorld.clone().vsub(blockPosWorld);
            const localPos = blockQuatInverse.vmult(relPos);

            const archZ = -TRACK_CFG.blockSize / 2;
            const triggerDepth = 2.0; // Aumentiamo un po' la tolleranza
            const triggerWidth = TRACK_CFG.blockSize / 2;
            const triggerHeight = 8;

            const insideTrigger = Math.abs(localPos.x) < triggerWidth &&
            localPos.y > 0 && localPos.y < triggerHeight &&
            Math.abs(localPos.z - archZ) < triggerDepth;

            if (insideTrigger) {
                if(currentState === GAME_STATE.RESPAWNING_FLYING && currentCheckpointData.index === index) {
                    // PUNTO 4: Ritorna il controllo al giocatore quando ripassa il checkpoint
                    currentState = GAME_STATE.RACING;
                    uiMsg.style.display = 'none';
                }

                if (b.isCheckpoint && currentState === GAME_STATE.RACING && currentCheckpointData.index !== index) {
                    currentCheckpointData.index = index;
                    currentCheckpointData.position.copy(chassisBody.position);
                    currentCheckpointData.quaternion.copy(chassisBody.quaternion);
                    currentCheckpointData.velocity.copy(chassisBody.velocity);
                    currentCheckpointData.angularVelocity.copy(chassisBody.angularVelocity);
                    currentCheckpointData.timeStamp = gameTime;

                    uiMsg.innerText = "CHECKPOINT";
                    uiMsg.style.display = 'block';
                    uiMsg.style.color = '#ffff00';
                    setTimeout(() => { if(currentState === GAME_STATE.RACING) uiMsg.style.display='none'; }, 800);
                }

                if (b.isFinish && currentState === GAME_STATE.RACING) {
                    currentState = GAME_STATE.FINISHED;
                    saveRunToHistory(gameTime);

                    // PUNTO 3: Logica Miglior Tempo
                    if (bestTime === null || gameTime < bestTime) {
                        bestTime = gameTime;
                        localStorage.setItem(BEST_TIME_KEY, bestTime);
                        uiBestTime.innerText = `Best: ${formatTime(bestTime)}`;
                        uiMsg.innerText = "NEW BEST!\n" + formatTime(gameTime);
                        uiMsg.style.color = '#ffd700';
                    } else {
                        uiMsg.innerText = "FINISH!\n" + formatTime(gameTime);
                        uiMsg.style.color = '#00ff00';
                    }
                    uiMsg.style.display = 'block';
                }
            }
        });
    }

    // Update UI Timer usando la nuova funzione
    uiTimer.innerText = formatTime(gameTime);
    renderer.render(scene, camera);
}

// --- UTILS ---
function doRespawn(type) {
    if (!chassisBody) return;

    if (type === 'standing') { //INVIO lungo
        let count = 3;
        const blockBody = trackBodies[currentCheckpointData.index];
        if (blockBody) { //respawn a checkpoint
            const spawnPosition = blockBody.position.clone();
            const localOffset = new CANNON.Vec3(0, 2, -TRACK_CFG.blockSize / 2);
            const rotatedOffset = new CANNON.Vec3();
            blockBody.quaternion.vmult(localOffset, rotatedOffset);
            spawnPosition.vadd(rotatedOffset, spawnPosition);
            chassisBody.position.copy(spawnPosition);
            chassisBody.quaternion.copy(blockBody.quaternion);
            count = 1;
        }else{
            chassisBody.position.copy(currentCheckpointData.position);
            chassisBody.quaternion.copy(currentCheckpointData.quaternion);
        }
        chassisBody.velocity.set(0, 0, 0);
        chassisBody.angularVelocity.set(0, 0, 0);
        //gameTime = currentCheckpointData.timeStamp;
        startCountdown(count);

    } else if (type === 'flying') {
        uiMsg.innerText = "Rewind...";
        uiMsg.style.display = 'block';

        // Spostiamo indietro la macchina di 0.5 secondi lungo il suo vettore velocità
        const rewindDuration = 0.5; // secondi
        const rewindVector = currentCheckpointData.velocity.clone().scale(rewindDuration);
        const rewindPosition = currentCheckpointData.position.clone().vsub(rewindVector);

        chassisBody.position.copy(rewindPosition);
        chassisBody.quaternion.copy(currentCheckpointData.quaternion);
        chassisBody.velocity.copy(currentCheckpointData.velocity);
        chassisBody.angularVelocity.copy(currentCheckpointData.angularVelocity);

        //gameTime = currentCheckpointData.timeStamp;
        currentState = GAME_STATE.RESPAWNING_FLYING;
    }

    if(vehicle) {
        vehicle.wheelInfos.forEach((w, i) => {
            vehicle.applyEngineForce(0, i);
            vehicle.setBrake(CONFIG.brakeForce, i);
        });
    }
}
function triggerRespawnLogic(type) {
    if(currentState === GAME_STATE.MENU) return;
    if(currentState === GAME_STATE.FINISHED || currentCheckpointData.index <= 0) {
        resetTrack(false);
        return;
    }
    doRespawn(type);
}

function resetTrack(generateNew = false) {
    if (generateNew) {
        window.location.reload();
        return;
    }

    skidmarkMeshes.forEach(m => scene.remove(m));
    skidmarkMeshes = [];

    // Reset Logico (Delete Key)
    currentCheckpointData.index = -1;
    currentCheckpointData.timeStamp = 0;

    // Trova lo start
    const startBody = trackBodies.find(b => b.isStart);
    if (startBody) {
        const spawnPosition = startBody.position.clone();
        const startOffset = new CANNON.Vec3(0, 0, -TRACK_CFG.blockSize / 2);
        spawnPosition.vadd(startOffset, spawnPosition);
        spawnPosition.y += 1.3;
        currentCheckpointData.position.copy(spawnPosition);
        currentCheckpointData.quaternion.copy(startBody.quaternion); // La rotazione è corretta
    } else {
        // Fallback di sicurezza se non trova lo start (non dovrebbe mai succedere)
        console.error("Blocco di partenza non trovato! Spawn di default.");
        currentCheckpointData.position.set(0, 5, -10);
        currentCheckpointData.quaternion.set(0,0,0,1);
    }
    currentCheckpointData.velocity.set(0,0,0);
    currentCheckpointData.angularVelocity.set(0,0,0);

    gameTime = 0;
    uiMsg.style.display = 'none';
    doRespawn('standing');
}

function setupInputs() {
    // 1. TASTIERA
    window.addEventListener('keydown', e => handleKey(e.key, true));
    window.addEventListener('keyup', e => handleKey(e.key, false));

    function handleKey(key, isPressed) {
        if(isBindingKey) return; // Se stiamo rimappando, ignora

        // Cerca azione associata
        for (const [action, binds] of Object.entries(gameSettings.keyBinds)) {
            if (binds.includes(key)) {
                // Se è un tasto continuo, aggiorna lo stato
                if([ACTIONS.ACCEL, ACTIONS.BRAKE, ACTIONS.LEFT, ACTIONS.RIGHT, ACTIONS.HANDBRAKE].includes(action)) {
                    updateActionState(action, isPressed ? 1 : 0);
                }
                // Se è un evento ONE-SHOT (solo su pressione)
                else if (isPressed) {
                    if(action === ACTIONS.PAUSE) togglePauseGame();
                    if(action === ACTIONS.RESTART) resetTrack(false);
                    if(action === ACTIONS.RESPAWN_STAND) triggerRespawnLogic('standing');
                    if(action === ACTIONS.RESPAWN_FLY) triggerRespawnLogic('flying');
                }
            }
        }
    }

    // 2. TOUCH
    const touchBtns = document.querySelectorAll('.touch-btn');
    touchBtns.forEach(btn => {
        // Disabilita menu contestuale
        btn.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); return false; };
        // Handler unificato per l'inizio del tocco/click
        const handlePointerStart = (e) => {
            const isEditing = document.getElementById('touch-editor-overlay').style.display === 'flex';

            if (isEditing) {
                // Se siamo nell'editor, inizia il trascinamento
                dragStart(e);
            } else {
                // Altrimenti, esegui l'azione di gioco
                e.preventDefault(); // Previene eventi mouse fantasma su mobile
                handleTouchInput(btn.dataset.action, true);
            }
        };
        // Handler unificato per la fine del tocco/click
        const handlePointerEnd = (e) => {
            // L'evento di fine drag è gestito globalmente in dragEnd.
            // Questo serve solo per fermare l'azione di gioco.
            const isEditing = document.getElementById('touch-editor-overlay').style.display === 'flex';
            if (!isEditing) {
                e.preventDefault();
                handleTouchInput(btn.dataset.action, false);
            }
        };
        // Assegna i listener
        btn.addEventListener('mousedown', handlePointerStart);
        btn.addEventListener('mouseup', handlePointerEnd);
        btn.addEventListener('mouseleave', handlePointerEnd); // Ferma l'azione se il mouse esce dal pulsante
        btn.addEventListener('touchstart', handlePointerStart, { passive: false });
        btn.addEventListener('touchend', handlePointerEnd, { passive: false });
    });
}
function updateActionState(action, val) {
    if(action === ACTIONS.ACCEL) inputState.accel = val;
    if(action === ACTIONS.BRAKE) inputState.brake = val;
    if(action === ACTIONS.HANDBRAKE) inputState.handbrake = val;
    if(action === ACTIONS.LEFT) inputState.steerL = val;
    if(action === ACTIONS.RIGHT) inputState.steerR = val;
}

// Stato raw per touch direzionale (per gestire A+D premuti insieme)
let touchLeft = false, touchRight = false;
document.getElementById('btn-t-left').addEventListener('touchstart', (e)=>{e.preventDefault(); touchLeft=true;});
document.getElementById('btn-t-left').addEventListener('touchend', (e)=>{e.preventDefault(); touchLeft=false;});
document.getElementById('btn-t-right').addEventListener('touchstart', (e)=>{e.preventDefault(); touchRight=true;});
document.getElementById('btn-t-right').addEventListener('touchend', (e)=>{e.preventDefault(); touchRight=false;});
// Logica Touch Centralizzata
function handleTouchInput(action, active) {
    if(action === 'left') inputState.steerL = active ? 1 : 0;
    if(action === 'right') inputState.steerR = active ? 1 : 0;
    if(action === 'accel') inputState.accel = active ? 1 : 0;
    if(action === 'brake') inputState.brake = active ? 1 : 0;
    if(action === 'handbrake') inputState.handbrake = active ? 1 : 0;
    if(action === 'pause' && active) {
        togglePauseGame();
    }
    if(action === 'toggleui' && active) {
        // Inverte l'impostazione globale
        gameSettings.touchEnabled = !gameSettings.touchEnabled;
        // Aggiorna anche la checkbox nel menu opzioni (se l'utente ci andrà dopo)
        const chk = document.getElementById('chk-touch');
        if(chk) chk.checked = gameSettings.touchEnabled;
        // Salva e applica (questo chiamerà updateTouchVisibility)
        saveSettings();
    }
}

function togglePauseGame() {
    if (currentState === GAME_STATE.RACING || currentState === GAME_STATE.START || currentState === GAME_STATE.FINISHED) window.uiTogglePause();
    else if (currentState === GAME_STATE.PAUSED) window.uiResume();
}

// Funzione chiamata nel Game Loop (animate) PRMA della fisica
function pollInputs() {
    let acc = 0, brk = 0, hbrk = 0, str = 0;

    // 1. Keyboard / Touch State (Digitali)
    acc = inputState.accel;
    brk = inputState.brake;
    hbrk = inputState.handbrake;
    if(inputState.steerL) str += 1;
    if(inputState.steerR) str -= 1;

    // 2. Gamepad Override (Analogici + Bottoni OneShot)
    if (gameSettings.gamepadEnabled) {
        const gp = navigator.getGamepads()[0];
        if (gp) {
            // Analogico Sinistro (Deadzone 0.2)
            if (Math.abs(gp.axes[0]) > 0.2) str = -gp.axes[0];

            // Trigger / Bottoni
            const btnAcc = gp.buttons[gameSettings.gamepadBinds[ACTIONS.ACCEL]];
            if(btnAcc) acc = Math.max(acc, btnAcc.value);

            const btnBrk = gp.buttons[gameSettings.gamepadBinds[ACTIONS.BRAKE]];
            if(btnBrk) brk = Math.max(brk, btnBrk.value);

            const btnHbrk = gp.buttons[gameSettings.gamepadBinds[ACTIONS.HANDBRAKE]];
            if(btnHbrk) hbrk = Math.max(hbrk, btnHbrk.value);

            // D-Pad Steering
            if(gp.buttons[14] && gp.buttons[14].pressed) str = 1;
            if(gp.buttons[15] && gp.buttons[15].pressed) str = -1;

            // GESTIONE ONE-SHOT GAMEPAD (Senza ripetizione 60fps)
            // Usiamo un oggetto per tracciare lo stato precedente dei bottoni gamepad
            if(!window.gpPrevState) window.gpPrevState = {};

            const checkPress = (act, fn) => {
                const idx = gameSettings.gamepadBinds[act];
                const pressed = gp.buttons[idx] && gp.buttons[idx].pressed;
                if(pressed && !window.gpPrevState[act]) { fn(); }
                window.gpPrevState[act] = pressed;
            };

            checkPress(ACTIONS.PAUSE, togglePauseGame);
            checkPress(ACTIONS.RESTART, () => resetTrack(false));
            checkPress(ACTIONS.RESPAWN_STAND, () => triggerRespawnLogic('standing'));
            checkPress(ACTIONS.RESPAWN_FLY, () => triggerRespawnLogic('flying'));
        }
    }

    // Clamp valori finali
    str = Math.max(-1, Math.min(1, str));
    acc = Math.min(1, acc);
    brk = Math.min(1, brk);

    // Esporta per animate()
    window.inputAnalog = { steer: str, throttle: acc, brake: brk, handbrake: hbrk };
}

function saveRunToHistory(time) {
    const record = {
        seed: currentSeed,
        version: GAME_VERSION,
        date: new Date().toLocaleString(),
        time: time,
        formattedTime: formatTime(time)
    };

    let history = JSON.parse(localStorage.getItem(STORAGE_KEY_RECORDS) || "[]");

    // Controlla se esiste già questo seed e se abbiamo migliorato
    const existingIndex = history.findIndex(r => r.seed === currentSeed);
    if (existingIndex >= 0) {
        if (time < history[existingIndex].time) {
            history[existingIndex] = record; // Aggiorna se migliore
        }
    } else {
        history.unshift(record); // Aggiungi in testa
    }

    // Tieni solo gli ultimi 100
    if (history.length > 100) history = history.slice(0, 100);

    localStorage.setItem(STORAGE_KEY_RECORDS, JSON.stringify(history));
}

// --- SISTEMA MENU UI ---

// Helper navigazione
function showScreen(id) {
    document.querySelectorAll('.menu-screen').forEach(el => el.style.display = 'none');
    document.getElementById(id).style.display = 'flex';
}

window.uiOpenPlay = () => {
    // Genera seed random precompilato
    document.getElementById('seed-input').value = Math.random().toString(36).substring(7).toUpperCase();
    showScreen('menu-play');
};

window.uiOpenRecords = () => {
    const list = document.getElementById('records-list');
    list.innerHTML = '';
    const history = JSON.parse(localStorage.getItem(STORAGE_KEY_RECORDS) || "[]");

    if(history.length === 0) {
        list.innerHTML = '<div style="padding:20px; text-align:center; color:#888;">Nessun record trovato.</div>';
    } else {
        history.forEach(rec => {
            const div = document.createElement('div');
            div.className = 'record-item';
            div.innerHTML = `
            <div class="record-meta">
            <span class="record-seed">${rec.seed}</span>
            <span style="color:#666; font-size:10px;">${rec.date} (v${rec.version})</span>
            </div>
            <div class="record-time">${rec.formattedTime}</div>
            <div class="record-actions">
            <button onclick="window.uiStartGame('${rec.seed}')">PLAY</button>
            <button onclick="navigator.clipboard.writeText('${window.location.origin}/#${rec.seed}'); alert('Link copiato!')">SHARE</button>
            </div>
            `;
            list.appendChild(div);
        });
    }
    showScreen('menu-records');
};

window.uiOpenOptions = () => showScreen('menu-options');
window.uiBackToHome = () => showScreen('menu-home');

window.uiStartGame = (forceSeed = null) => {
    const inputSeed = document.getElementById('seed-input').value.trim();
    const finalSeed = forceSeed || inputSeed || "random";

    // Nascondi Menu
    document.getElementById('main-menu').style.display = 'none';
    document.getElementById('pause-modal').style.display = 'none';

    // Aggiorna URL Hash (opzionale, per condivisione rapida)
    window.location.hash = finalSeed;

    // Genera Pista
    // Nota: dobbiamo recuperare i materiali dal world esistente o salvarli in init.
    // Per semplicità, li ricreiamo al volo o li salviamo globalmente.
    // Poiché generateTrack usa materiali passati, salviamo i riferimenti in init o usiamo globali.
    // Modifica rapida: rendi groundMat e turboMat accessibili o ricreali (sono leggeri).
    const groundMat = new CANNON.Material('ground');
    const turboMat = new CANNON.Material('turbo');
    // Nota: Per coerenza fisica bisognerebbe usare gli stessi materiali di init, ma Cannon li gestisce per ID.
    // L'ideale è salvarli globalmente in init. Per ora va bene ricrearli se le contactMaterial sono nel world.

    generateTrack(groundMat, turboMat, finalSeed);
    resetTrack(false); // Posiziona auto e start countdown
    updateTouchVisibility();
};

window.uiTogglePause = () => {
    if (currentState === GAME_STATE.PAUSED) {
        window.uiResume();
    } else {
        currentState = GAME_STATE.PAUSED;
        document.getElementById('pause-modal').style.display = 'flex';
        uiTimer.style.opacity = '0.5';
        // LOGICA VISIBILITÀ PULSANTI RESPAWN
        // Devono apparire solo se la logica di gioco lo permette (similmente al tasto INVIO)
        // 1. Non deve essere finito (FINISHED)
        // 2. Deve aver superato lo start (index > 0). Index 0 è lo start, index -1 è pre-start.
        const canRespawn = (currentState !== GAME_STATE.FINISHED && currentCheckpointData.index > 0);
        const displayMode = canRespawn ? 'block' : 'none';
        document.getElementById('btn-respawn-fly').style.display = displayMode;
        document.getElementById('btn-respawn-stand').style.display = displayMode;
    }
    updateTouchVisibility();
};

window.uiResume = () => {
    currentState = GAME_STATE.RACING;
    if (gameTime <= 0) currentState = GAME_STATE.START;
    document.getElementById('pause-modal').style.display = 'none';
    uiTimer.style.opacity = '1';
    lastFrameTime = performance.now(); // Evita salto temporale
    updateTouchVisibility();
};

window.uiRespawn = (type) => {
    window.uiResume();
    doRespawn(type);
};

window.uiRestartTrack = () => {
    window.uiResume();
    resetTrack(false);
};

window.uiExitToMenu = () => {
    document.getElementById('pause-modal').style.display = 'none';
    document.getElementById('main-menu').style.display = 'flex';
    showScreen('menu-home');
    currentState = GAME_STATE.MENU;
    // Pulisci URL hash
    history.pushState("", document.title, window.location.pathname + window.location.search);
};

// --- LOGICA MENU OPZIONI & BINDING ---
window.uiOpenSubMenu = (id) => {
    document.querySelectorAll('.menu-screen').forEach(el => el.style.display = 'none');
    document.getElementById(id).style.display = 'flex';

    if(id === 'opt-keys') renderKeyBinds();
    if(id === 'opt-gamepad') renderGamepadStatus();
};

window.updateSetting = (key, val) => {
    gameSettings[key] = val;
    if(key === 'renderHeight') {
        document.getElementById('val-render-height').innerText = val + "p";
        onWindowResize();
    }
    if(key === 'renderDistance') document.getElementById('val-render-dist').innerText = val;
    if(key === 'maxSkidmarks') document.getElementById('val-max-skids').innerText = val;
    if(key === 'antialias') {
        saveSettings();
        if(confirm("Cambiare l'antialiasing richiede un riavvio della pagina. Ricaricare ora?")) {
            window.location.reload();
        }
        return;
    }
    saveSettings();
};

// Key Binding UI
function renderKeyBinds() {
    const list = document.getElementById('key-binds-list');
    list.innerHTML = '';

    const friendlyNames = {
        [ACTIONS.ACCEL]: 'Acceleratore',
        [ACTIONS.BRAKE]: 'Freno / Retro',
        [ACTIONS.HANDBRAKE]: 'Freno a Mano',
        [ACTIONS.LEFT]: 'Sinistra',
        [ACTIONS.RIGHT]: 'Destra',
        [ACTIONS.RESPAWN_FLY]: 'Respawn Chekpoint (Movimento)',
        [ACTIONS.RESPAWN_STAND]: 'Respawn Chekpoint (Stazionario)',
        [ACTIONS.RESTART]: 'Ricomincia Pista',
        [ACTIONS.PAUSE]: 'Pausa'
    };

    for(const [action, keys] of Object.entries(gameSettings.keyBinds)) {
        const row = document.createElement('div');
        row.className = 'bind-row';

        const label = document.createElement('span');
        label.className = 'bind-label';
        label.innerText = friendlyNames[action] || action;

        const btnContainer = document.createElement('div');

        // Slot 1
        const btn1 = createBindBtn(action, 0, keys[0]);
        // Slot 2
        const btn2 = createBindBtn(action, 1, keys[1]);

        btnContainer.appendChild(btn1);
        btnContainer.appendChild(btn2);

        row.appendChild(label);
        row.appendChild(btnContainer);
        list.appendChild(row);
    }
}

function createBindBtn(action, index, currentKey) {
    const btn = document.createElement('button');
    btn.className = 'bind-btn ' + (!currentKey ? 'empty' : '');
    btn.innerText = formatKeyName(currentKey);
    btn.onclick = () => startBinding(action, index);
    return btn;
}

function formatKeyName(key) {
    if(!key) return '---';
    if(key === ' ') return 'SPACE';
    if(key.startsWith('Arrow')) return key.replace('Arrow', 'Freccia ');
    return key.toUpperCase();
}

let isBindingKey = false;
let bindAction = null;
let bindIndex = 0;

function startBinding(action, index) {
    isBindingKey = true;
    bindAction = action;
    bindIndex = index;
    document.getElementById('binding-overlay').style.display = 'flex';
}

window.cancelBinding = () => {
    document.getElementById('binding-overlay').style.display = 'none';
    isBindingKey = false;
}

window.addEventListener('keydown', (e) => {
    if(!isBindingKey) return;
    e.preventDefault();
    e.stopPropagation(); // Evita che il gioco reagisca

    if(e.key === 'Escape') {
        window.cancelBinding();
        return;
    }

    // Salva Tasto
    const newBinds = [...gameSettings.keyBinds[bindAction]];
    newBinds[bindIndex] = e.key;
    gameSettings.keyBinds[bindAction] = newBinds;

    saveSettings();
    window.cancelBinding();
    renderKeyBinds();
}, true);

window.resetKeysDefault = () => {
    gameSettings.keyBinds = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.keyBinds));
    saveSettings();
    renderKeyBinds();
};

// --- TOUCH EDITOR ---
let draggedEl = null;
let selectedEl = null;
let startX=0, startY=0;
let startLeft=0, startTop=0;
document.getElementById('touch-size-slider').addEventListener('input', (e) => {
    if(selectedEl) {
        const val = e.target.value;
        selectedEl.style.transform = `scale(${val})`;
        selectedEl.dataset.tempScale = val;
    }
});

window.uiOpenTouchEditor = () => {
    const editorOverlay = document.getElementById('touch-editor-overlay');
    editorOverlay.style.display = 'flex';
    const ctrl = document.getElementById('touch-controls');
    ctrl.style.display = 'block';
    ctrl.style.zIndex = '3005';
    selectBtn(null);
    document.querySelectorAll('.touch-btn').forEach(btn => {
        btn.classList.add('editable-btn');
        const currentTransform = btn.style.transform;
        let currentScale = 1.0;
        if(currentTransform && currentTransform.includes('scale')) {
            const match = currentTransform.match(/scale\(([^)]+)\)/);
    if(match) currentScale = parseFloat(match[1]);
        }
        btn.dataset.tempScale = currentScale;
    });
};
window.uiCloseTouchEditor = () => {
    document.getElementById('touch-editor-overlay').style.display = 'none';
    const ctrl = document.getElementById('touch-controls');
    ctrl.style.zIndex = '';
    const layout = {};
    // 1. AGGIUNTO 'btn-t-toggle' ALLA LISTA
    const buttonIds = ['btn-t-left', 'btn-t-right', 'btn-t-accel', 'btn-t-brake', 'btn-t-pause', 'btn-t-handbrake', 'btn-t-toggle'];
    // Dimensioni finestra per calcolo percentuale
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    buttonIds.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.classList.remove('editable-btn', 'selected-btn');
            // 2. CONVERSIONE PIXEL -> PERCENTUALE
            // Usiamo getBoundingClientRect per avere la posizione visiva reale in pixel
            const rect = btn.getBoundingClientRect();
            // Calcoliamo la percentuale (con 2 decimali di precisione)
            const leftPerc = ((rect.left / winW) * 100).toFixed(2) + "%";
            const topPerc = ((rect.top / winH) * 100).toFixed(2) + "%";

            // Salviamo sempre come Top/Left in percentuale per uniformità
            layout[btn.id] = {
                left: leftPerc,
                top: topPerc,
                right: 'auto',   // Resettiamo right/bottom per evitare conflitti
                bottom: 'auto',
                scale: parseFloat(btn.dataset.tempScale || 1.0)
            };
            // Applichiamo subito lo stile pulito (percentuale) all'elemento
            btn.style.left = leftPerc;
            btn.style.top = topPerc;
            btn.style.right = 'auto';
            btn.style.bottom = 'auto';
        }
    });
    gameSettings.touchLayout = layout;
    saveSettings();
};
window.resetTouchDefault = () => {
    gameSettings.touchLayout = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.touchLayout));
    // Pulisci stili inline
    document.querySelectorAll('.touch-btn').forEach(btn => btn.style = "");
    saveSettings();
}
function selectBtn(btn) {
    if(selectedEl) selectedEl.classList.remove('selected-btn');
    selectedEl = btn;
    const label = document.getElementById('selected-btn-name');
    const slider = document.getElementById('touch-size-slider');
    if(selectedEl) {
        selectedEl.classList.add('selected-btn');
        label.innerText = "Modifica: " + selectedEl.id.replace('btn-t-', '').toUpperCase();
        slider.value = selectedEl.dataset.tempScale || 1.0;
        slider.disabled = false;
    } else {
        label.innerText = "Clicca un tasto per ridimensionarlo";
        slider.disabled = true;
    }
}
function dragStart(e) {
    if(currentState !== GAME_STATE.MENU && document.getElementById('touch-editor-overlay').style.display !== 'flex') return;

    // Preveniamo default browser (scrolling, selezione testo)
    e.preventDefault();
    if(e.type === 'touchstart') e.stopPropagation();

    // Identifica il bottone (anche se clicco sull'icona interna)
    const target = e.target.closest('.touch-btn');
    if(!target) return;

    draggedEl = target;
    selectBtn(draggedEl); // Seleziona per lo slider

    // Coordinate iniziali puntatore
    startX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
    startY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;

    // Posizione iniziale elemento (offset calcolato dal bounding rect è più sicuro)
    const rect = draggedEl.getBoundingClientRect();
    // Vogliamo settare top/left assoluti basati sulla viewport per il drag
    // Reset right/bottom per evitare conflitti CSS durante il drag
    draggedEl.style.right = 'auto';
    draggedEl.style.bottom = 'auto';
    draggedEl.style.left = rect.left + 'px';
    draggedEl.style.top = rect.top + 'px';

    startLeft = rect.left;
    startTop = rect.top;

    window.addEventListener('mousemove', dragMove);
    window.addEventListener('touchmove', dragMove, {passive: false});
    window.addEventListener('mouseup', dragEnd);
    window.addEventListener('touchend', dragEnd);
}
function dragMove(e) {
    if(!draggedEl) return;
    e.preventDefault();

    const clientX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
    const clientY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;

    const deltaX = clientX - startX;
    const deltaY = clientY - startY;

    draggedEl.style.left = (startLeft + deltaX) + 'px';
    draggedEl.style.top = (startTop + deltaY) + 'px';
}
function dragEnd() {
    draggedEl = null;
    window.removeEventListener('mousemove', dragMove);
    window.removeEventListener('touchmove', dragMove);
    window.removeEventListener('mouseup', dragEnd);
    window.removeEventListener('touchend', dragEnd);
}

// Gamepad UI Helper
function renderGamepadStatus() {
    const el = document.getElementById('gamepad-status');
    const gp = navigator.getGamepads()[0];
    if(gp) {
        el.innerText = `Connesso: ${gp.id}`;
        el.style.color = '#00ff00';
    } else {
        el.innerText = "Premi un tasto sul controller...";
        el.style.color = '#ffff00';
        requestAnimationFrame(renderGamepadStatus);
    }
}

// Init
init();
