import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GAME_VERSION, MIN_TRACK_VERSION_COMPATIBILITY } from './version.js';

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
    LEFT: 'left',
    RIGHT: 'right',
    RESPAWN_FLY: 'resp_fly',
    RESPAWN_STAND: 'resp_stand',
    RESTART: 'restart',
    PAUSE: 'pause',
    CAM_TOGGLE: 'cam_toggle',
    MENU_CONFIRM: 'menu_confirm',
    MENU_UP: 'menu_up',
    MENU_DOWN: 'menu_down'
};
const GAMEPAD_BUTTON_NAMES = {
    0: "A / Croce", 1: "B / Cerchio", 2: "X / Quadrato", 3: "Y / Triangolo",
    4: "L1 / LB", 5: "R1 / RB", 6: "L2 / LT", 7: "R2 / RT",
    8: "Select / View", 9: "Start / Menu", 10: "L3", 11: "R3",
    12: "D-Pad Su", 13: "D-Pad Giù", 14: "D-Pad Sinistra", 15: "D-Pad Destra"
};
function getGpBtnName(idx) {
    return GAMEPAD_BUTTON_NAMES[idx] || `Button ${idx}`;
}

const DEFAULT_SETTINGS = {
    renderHeight: 468,
    antialias: true,
    maxFPS: 60,
    renderDistance: 150,
    maxRecords: 25,
    maxSkidmarks: 200,
    sfxVolume: 0.4,
    musicVolume: 0.4,
    touchEnabled: false,
    gamepadEnabled: true,
    ghostEnabled: true,
    carColors: {
        body: '#d92525',
        wheels: '#111111',
        rims: '#ffffff',
        spoiler: '#ffffff',
        speedo: '#ffffff'
    },
    keyBinds: {
        [ACTIONS.ACCEL]: ['w', 'ArrowUp'],
        [ACTIONS.BRAKE]: ['s', 'ArrowDown'],
        [ACTIONS.LEFT]: ['a', 'ArrowLeft'],
        [ACTIONS.RIGHT]: ['d', 'ArrowRight'],
        [ACTIONS.RESPAWN_FLY]: ['Enter', ''],
        [ACTIONS.RESPAWN_STAND]: ['r', ''],
        [ACTIONS.RESTART]: ['Delete', 'Backspace'],
        [ACTIONS.CAM_TOGGLE]: ['v', ''],
        [ACTIONS.PAUSE]: ['Escape', 'p']
    },
    // Indici bottoni gamepad (Standard Mapping)
    gamepadBinds: {
        [ACTIONS.ACCEL]: 7, // R2
        [ACTIONS.BRAKE]: 6, // L2
        [ACTIONS.RESPAWN_FLY]: 3, // Triangolo / Y
        [ACTIONS.RESPAWN_STAND]: 1, // Cerchio / B
        [ACTIONS.RESTART]: 8, // Select / Back
        [ACTIONS.PAUSE]: 9,  // Start
        [ACTIONS.CAM_TOGGLE]: 2, // Quadrato / X
        [ACTIONS.MENU_CONFIRM]: 0, // A / X (Nei menu)
        [ACTIONS.MENU_UP]: 12,     // D-Pad Su
        [ACTIONS.MENU_DOWN]: 13    // D-Pad Giù
    },

    touchLayout: {
        "btn-t-left": { scale: 2, left: '8vh', right: 'auto', bottom: '8vh', top: 'auto' },
        "btn-t-right": { scale: 2, left: '39vh', right: 'auto', bottom: '8vh', top: 'auto' },
        "btn-t-accel": { scale: 1.9, right: '25.5vh', left: 'auto', bottom: '20vh', top: 'auto' },
        "btn-t-brake": { scale: 1.5, right: '4.5vh', left: 'auto', bottom: '5vh', top: 'auto' },
        "btn-t-pause": { scale: 1.3, left: '1.5vh', right: 'auto', top: '1.5vh', bottom: 'auto' },
        "btn-t-toggle": { scale: 1.3, right: '1.5vh', left: 'auto', top: '1.5vh', bottom: 'auto' },
        "btn-t-cam": { scale: 1.3, left: '20vh', right: 'auto', top: '1.5vh', bottom: 'auto' }
    }
};

const AUDIO_FILES = {
    engine: 'audio/engine.wav',
    skid: 'audio/skid.wav',
    collision: 'audio/collision.ogg',
    checkpoint: 'audio/checkpoint.and.menuClick.ogg',
    countdown1: 'audio/countdown.3-2-1.ogg',
    countdownGo: 'audio/countdown.go.ogg',
    music: [
        'audio/music.Pulp.mp3',
        'audio/music.StartOff.mp3',
        'audio/music.TicTac.mp3'
    ]
};
let audioCtx = null;
let sfxBuffers = {};
let engineSource = null;
let engineGain = null;
let skidSource = null;
let skidGain = null;
let musicElement = new Audio();
let currentMusicIndex = -1;
let isMusicPlaying = false;

let gameSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
const inputState = { accel: 0, brake: 0, steerL: 0, steerR: 0 };

function loadSettings() {
    const saved = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (saved) {
        const parsed = JSON.parse(saved);
        gameSettings = {
            ...DEFAULT_SETTINGS,
            ...parsed,
            keyBinds: { ...DEFAULT_SETTINGS.keyBinds, ...parsed.keyBinds },
            gamepadBinds: { ...DEFAULT_SETTINGS.gamepadBinds, ...parsed.gamepadBinds }
        };
    } else {
        if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
            gameSettings.touchEnabled = true;
        }
    }
    const askFs = localStorage.getItem('webmania_ask_fs') !== 'false';
    const chkFs = document.getElementById('opt-ask-fs');
    if (chkFs) chkFs.checked = askFs;
    applySettings();
    applyCarColors();
}
function applyCarColors() {
    if (matBody) matBody.color.set(gameSettings.carColors.body);
    if (matSpoiler) matSpoiler.color.set(gameSettings.carColors.spoiler);
    if (matWheelVis) matWheelVis.color.set(gameSettings.carColors.wheels);
    if (matRim) matRim.color.set(gameSettings.carColors.rims);
    if (speedoTexture && speedoCtx) {
        speedoCtx.clearRect(0, 0, 128, 64);
        if (currentState === GAME_STATE.MENU) {
            drawDigitalNumber(speedoCtx, 999, 64, 32, 24, 44, 6);
        }
        speedoTexture.needsUpdate = true;
    }
}

function saveSettings() {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(gameSettings));
    applySettings();
}

function applySettings() {
    // Fog
    if (scene && scene.fog) {
        scene.fog.far = parseInt(gameSettings.renderDistance);
    }

    // Aggiorna etichette nel menu (così si vedono i numeri salvati)
    const elHeight = document.getElementById('val-render-height');
    if (elHeight) elHeight.innerText = gameSettings.renderHeight + "p";
    document.getElementById('opt-render-height').value = gameSettings.renderHeight;

    const elDist = document.getElementById('val-render-dist');
    if (elDist) elDist.innerText = gameSettings.renderDistance;
    document.getElementById('opt-render-dist').value = gameSettings.renderDistance;

    const elFps = document.getElementById('opt-max-fps');
    if (elFps) elFps.value = gameSettings.maxFPS;

    const elSkids = document.getElementById('val-max-skids');
    if (elSkids) elSkids.innerText = gameSettings.maxSkidmarks;
    document.getElementById('opt-max-skids').value = gameSettings.maxSkidmarks;

    const elRecords = document.getElementById('val-max-records');
    if (elRecords) elRecords.innerText = gameSettings.maxRecords;
    document.getElementById('opt-max-records').value = gameSettings.maxRecords;

    const chkGamepad = document.getElementById('chk-gamepad');
    if (chkGamepad) chkGamepad.checked = (gameSettings.gamepadEnabled !== undefined ? gameSettings.gamepadEnabled : true);
    const chkTouch = document.getElementById('chk-touch');
    if (chkTouch) chkTouch.checked = !!gameSettings.touchEnabled;

    const chkGhost = document.getElementById('opt-ghost-enabled');
    if (chkGhost) chkGhost.checked = !!gameSettings.ghostEnabled;
    const btnGhost = document.getElementById('btn-toggle-ghost');
    if (btnGhost) btnGhost.innerText = `REPLAY GHOSTCAR: ${gameSettings.ghostEnabled ? 'ON' : 'OFF'}`;

    const chkFs = document.getElementById('opt-ask-fs');
    if (chkFs) {
        const askFs = localStorage.getItem('webmania_ask_fs') !== 'false';
        chkFs.checked = askFs;
    }

    // Aggiorna UI Volume
    const elVolMus = document.getElementById('val-vol-music');
    if (elVolMus) elVolMus.innerText = Math.round(gameSettings.musicVolume * 100) + "%";
    document.getElementById('opt-vol-music').value = gameSettings.musicVolume;
    const elVolSfx = document.getElementById('val-vol-sfx');
    if (elVolSfx) elVolSfx.innerText = Math.round(gameSettings.sfxVolume * 100) + "%";
    document.getElementById('opt-vol-sfx').value = gameSettings.sfxVolume;

    // Aggiorna Checkbox Antialias
    const chkAA = document.getElementById('opt-antialias');
    if (chkAA) chkAA.checked = (gameSettings.antialias !== undefined ? gameSettings.antialias : true);

    // Applica Risoluzione
    if (renderer) {
        onWindowResize();
    }

    // Touch UI - Aggiornamento Immediato
    const touchDiv = document.getElementById('touch-controls');
    if (touchDiv) {
        // Mostra solo se abilitato E siamo in gioco (non nel menu principale)
        const shouldShow = gameSettings.touchEnabled && currentState !== GAME_STATE.MENU;
        touchDiv.style.display = shouldShow ? 'block' : 'none';

        // Applica layout
        if (gameSettings.touchLayout) {
            for (const [id, params] of Object.entries(gameSettings.touchLayout)) {
                const el = document.getElementById(id);
                if (el) {
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
    if (!touchDiv) return;
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
window.gameSettings = gameSettings;
// --- VARIABILI GLOBALI ---
let scene, camera, renderer, world;
let frameAccumulator = 0;
let physicsMaterials = {}; // Contenitore per i materiali fisici globali
let vehicle, chassisMesh, chassisBody, brakeLightL, brakeLightR;
let trackMeshes = [], trackBodies = [], skidmarkMeshes = [];
let lastMenuNavTime = 0; // Debounce per navigazione menu

let cameraMode = 0; // 0 = Chase (dietro), 1 = FPS (prima persona)
let speedoMesh = null; // Riferimento globale al tachimetro

//ghostcar Replay
let ghostMesh = null; // La mesh visiva del fantasma
let ghostDataRecording = []; // Array per registrare la corsa corrente
let ghostDataPlayback = null; // Array della corsa caricata (Best Time)
let isReplayMode = false; // Se true, stiamo guardando un replay (non giochiamo)
let currentGhostIndex = 0; // Indice per ottimizzare il replay

let matBody, matSpoiler, matWheelVis, matRim;
let previewScene, previewCamera, previewRenderer, carPreviewGroup;
let isPreviewActive = false;
let previewAngle = 0;

let bestRunSplits = []; // Tempi dei checkpoint del record salvato
let currentRunSplits = []; // Tempi dei checkpoint della corsa attuale
let checkpointCount = 0; // Contatore per assegnare l'ordine ai checkpoint
let flyingRespawnSequence = [];
let flyingRespawnIndex = 0;

// Stato Corrente
let currentState = GAME_STATE.START;
let gameTime = 0; // Tempo di gioco effettivo (escluso pause)
let lastFrameTime = 0;
let lastRenderTime = 0; //variable per cap fps
let bestTime = null;
const BEST_TIME_KEY = 'trackmaniaCloneBestTime'; //localstorage

let currentSeed = "";
let rng;
// Simple Mulberry32 PRNG
function createRNG(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = h << 13 | h >>> 19;
    }
    return function () {
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
function formatDiffHTML(ms) { // Helper per formattare il diff (parte non significante bianca/piccola)
    const str = formatTime(ms);
    let splitIdx = str.search(/[1-9]/);
    if (splitIdx === -1) splitIdx = str.length - 1
    const insignificant = str.substring(0, splitIdx);
    const significant = str.substring(splitIdx);
    return `<span style="font-size: 0.5em;">${insignificant}</span>${significant}`;
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

        // Inizializza materiali globali
        physicsMaterials.ground = new CANNON.Material('ground');
        physicsMaterials.wheel = new CANNON.Material('wheel');
        physicsMaterials.chassis = new CANNON.Material('chassis');
        physicsMaterials.turbo = new CANNON.Material('turbo');

        const wheelGroundContact = new CANNON.ContactMaterial(physicsMaterials.wheel, physicsMaterials.ground, {
            friction: 0.4,
            restitution: 0.0,
            contactEquationStiffness: 1e8,
            contactEquationRelaxation: 3,
            frictionEquationStiffness: 1e8,
        });
        const wheelTurboContact = new CANNON.ContactMaterial(physicsMaterials.wheel, physicsMaterials.turbo, {
            friction: 0.4,
            restitution: 0,
            contactEquationStiffness: 1e8,
            contactEquationRelaxation: 3
        });

        const chassisGroundContact = new CANNON.ContactMaterial(physicsMaterials.chassis, physicsMaterials.ground, {
            friction: 0.02,
            restitution: 0,
            contactEquationStiffness: 1e8,
            contactEquationRelaxation: 3
        });

        world.addContactMaterial(wheelGroundContact);
        world.addContactMaterial(chassisGroundContact);
        world.addContactMaterial(wheelTurboContact);

        // 3. Setup Gioco
        setupInputs();
        createCar();

        // Versione UI
        document.getElementById('version-display').innerText = "v" + GAME_VERSION;
        
        // Gestione URL Hash
        const hash = window.location.hash.replace('#', '');
        if (hash.startsWith('share=')) {
            // Modalità Importazione Replay
            currentState = GAME_STATE.MENU;
            // Un piccolo timeout per assicurarsi che LZString sia caricato e il DOM pronto
            setTimeout(() => handleSharedReplay(hash.substring(6)), 100);
        } else {
            // Modalità Seed Diretto o Menu Classico
            const pathSeed = window.location.pathname.split('/').pop();
            const urlSeed = hash || (pathSeed && pathSeed.length > 0 && pathSeed !== 'index.html' ? pathSeed : null);
            if (urlSeed) {
                window.uiStartGame(urlSeed);
            } else {
                currentState = GAME_STATE.MENU; 
            }
        }

        // Inizializza loop
        lastFrameTime = performance.now();
        loadSettings();
        initAudioSystem();
        animate();
        // Rimuovi vecchio listener se presente
        // document.getElementById('gen-btn')... RIMOSSO
        console.log("Gioco Inizializzato v" + GAME_VERSION);
    } catch (e) {
        console.error(e);
    }
}
function onWindowResize() {
    if (!camera || !renderer) return;
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
    if (uiCountdown.style.display === 'block') { return } //avoid multiple countDown
    currentState = GAME_STATE.START;
    uiCountdown.style.display = 'block';
    playSfx('countdown1');
    uiCountdown.innerText = count;
    lastFrameTime = performance.now();
    const interval = setInterval(() => {
        count--;
        if (count > 0) {
            uiCountdown.innerText = count;
            playSfx('countdown1');
        } else if (count === 0) {
            uiCountdown.innerText = "GO!";
            uiCountdown.style.color = "#00ff00";
            playSfx('countdownGo');
        } else {
            clearInterval(interval);
            uiCountdown.style.display = 'none';
            uiCountdown.style.color = "#fff";
            currentState = GAME_STATE.RACING;
            lastFrameTime = performance.now();
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
    maxRampSlope: 0.4, // Pendenza massima rampe
    maxInclination: 0.4, // Massimo cambio di inclinazione
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

        addBox(container, body, new CANNON.Vec3(0, 0, -len / 2), new CANNON.Vec3(width, 0.5, len), 'road');
        addBox(container, body, new CANNON.Vec3(-width / 2 + 0.5, TRACK_CFG.wallHeight / 2, -len / 2), new CANNON.Vec3(1, TRACK_CFG.wallHeight, len), 'wall');
        addBox(container, body, new CANNON.Vec3(width / 2 - 0.5, TRACK_CFG.wallHeight / 2, -len / 2), new CANNON.Vec3(1, TRACK_CFG.wallHeight, len), 'wall');

        // Decorazioni (Finish/Start/Checkpoint)
        if (params.type === MODULES.FINISH || params.type === MODULES.START || params.type === MODULES.CHECKPOINT) {
            let color = TRACK_CFG.colors.checkRing;
            if (params.type === MODULES.START) color = TRACK_CFG.colors.startRing;
            if (params.type === MODULES.FINISH) color = TRACK_CFG.colors.finishRing;
            //1. ARCO
            const arch = new THREE.Mesh(
                new THREE.TorusGeometry(8, 1, 8, 24, Math.PI),
                new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: 0.5 })
            );
            arch.position.set(0, 0, -len / 2);
            // 2. LINEA A TERRA
            // Creiamo un piano leggermente più largo della strada
            const lineGeo = new THREE.BoxGeometry(width, 0.1, 1.5);
            const lineMat = new THREE.MeshStandardMaterial({
                color: color,
                transparent: false
            });
            const lineMesh = new THREE.Mesh(lineGeo, lineMat);
            lineMesh.position.set(0, 0.26, -len / 2);
            container.add(lineMesh);
            container.add(arch);
            body.triggerZ = -len / 2;
            if (params.type === MODULES.FINISH) body.isFinish = true;
            if (params.type === MODULES.CHECKPOINT) body.isCheckpoint = true;
        }
        if (params.isTurbo) body.isTurbo = true;
    },

    // --- TRANSIZIONE INCLINAZIONE ---
    bank_transition: (container, body, params) => {
        const len = params.length || TRACK_CFG.blockSize;
        const width = params.width || TRACK_CFG.blockSize;
        const startAngle = params.startBank || 0;
        const endAngle = params.endBank || 0;

        // Aumentiamo i segmenti per una torsione più morbida
        const segments = 10;
        const segLen = len / segments;

        for (let i = 0; i < segments; i++) {
            // Calcoliamo l'angolo interpolato per questo segmento
            const t = i / segments;
            const currentAngle = startAngle + (endAngle - startAngle) * t;

            // Posizione locale lungo -Z
            const zPos = -(i * segLen) - (segLen / 2);
            const pos = new CANNON.Vec3(0, 0, zPos);

            // Rotazione locale (Roll sull'asse Z)
            const relativeAngle = currentAngle - startAngle;
            const quatDir = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (params.dirAngle || 0) * Math.PI / 2);
            const zRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), relativeAngle);

            // Applichiamo la "Sandwich Transform" per allineare l'asse di rotazione interno a quello globale
            const rot = quatDir.clone().conjugate().multiply(zRot).multiply(quatDir);
            // Pavimento
            addBox(container, body, pos, new CANNON.Vec3(width, 0.5, segLen), 'road', rot);

            // Muri (Calcolati ruotati attorno al centro strada)
            const wH = TRACK_CFG.wallHeight;
            // Vettori offset per i muri a sinistra e destra (non ruotati)
            const vLeft = new THREE.Vector3(-width / 2 + 0.5, wH / 2, 0);
            const vRight = new THREE.Vector3(width / 2 - 0.5, wH / 2, 0);

            // Applichiamo la rotazione Z ai vettori
            vLeft.applyQuaternion(rot).add(pos);
            vRight.applyQuaternion(rot).add(pos);

            addBox(container, body, vLeft, new CANNON.Vec3(1, wH, segLen), 'wall', rot);
            addBox(container, body, vRight, new CANNON.Vec3(1, wH, segLen), 'wall', rot);
        }
    },

    // --- RAMPA CURVA (S-CURVE) ---
    ramp: (container, body, params) => {
        const len = params.length || TRACK_CFG.blockSize;
        const totalH = params.height || TRACK_CFG.blockSize;
        const width = params.width || TRACK_CFG.blockSize;

        // Dividiamo la rampa in segmenti per fare la curva
        const segments = 10;
        const segLen = len / segments;

        for (let i = 0; i < segments; i++) {
            // Calcolo posizione lungo la curva (0.0 -> 1.0)
            const tStart = i / segments;
            const tEnd = (i + 1) / segments;

            // Interpolazione Coseno (Ease-InOut)
            // Formula: y = H * (1 - cos(t*PI)) / 2
            const hStart = totalH * (1 - Math.cos(tStart * Math.PI)) / 2;
            const hEnd = totalH * (1 - Math.cos(tEnd * Math.PI)) / 2;

            const segY = (hStart + hEnd) / 2;
            const segZ = -(i * segLen) - (segLen / 2);

            // Calcolo angolo inclinazione del segmento
            const dy = hEnd - hStart;
            const angle = Math.atan2(dy, segLen);
            const qSeg = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle);

            // Lunghezza ipotenusa del segmento
            const hypLen = Math.sqrt(segLen ** 2 + dy ** 2);
            const pos = new CANNON.Vec3(0, segY, segZ);

            // Pavimento
            addBox(container, body, pos, new CANNON.Vec3(width, 0.5, hypLen), 'road', qSeg);

            // Muri
            const wallOffL = new THREE.Vector3(-width / 2 + 0.5, TRACK_CFG.wallHeight / 2, 0).applyQuaternion(qSeg).add(pos);
            const wallOffR = new THREE.Vector3(width / 2 - 0.5, TRACK_CFG.wallHeight / 2, 0).applyQuaternion(qSeg).add(pos);
            addBox(container, body, wallOffL, new CANNON.Vec3(1, TRACK_CFG.wallHeight, hypLen), 'wall', qSeg);
            addBox(container, body, wallOffR, new CANNON.Vec3(1, TRACK_CFG.wallHeight, hypLen), 'wall', qSeg);
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
        const latOffset = width / 2 - 0.5;

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
            roadShape.colorKey = 'road';
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
            const innerPos = new THREE.Vector3(xInner, wH / 2, 0).applyQuaternion(segRot).add(segPos);
            const outerPos = new THREE.Vector3(xOuter, wH / 2, 0).applyQuaternion(segRot).add(segPos);

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

// Helper CURVE
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
    const vBackInner = getPoint(rInner, -halfAngle);
    const vFrontInner = getPoint(rInner, halfAngle);
    const vBackOuter = getPoint(rOuter, -halfAngle);
    const vFrontOuter = getPoint(rOuter, halfAngle);

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
function addBox(container, body, offset, dim, colorKey, localRot) {
    const shape = new CANNON.Box(new CANNON.Vec3(dim.x / 2, dim.y / 2, dim.z / 2));
    shape.colorKey = colorKey;
    const q = localRot || new CANNON.Quaternion();
    body.addShape(shape, offset, q);
    const geo = new THREE.BoxGeometry(dim.x, dim.y, dim.z);
    const color = TRACK_CFG.colors[colorKey] || 0xffffff;
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
    params.dirAngle = dirAngle;

    // 1. Rotazione Y (Direzione Cardinale: Nord, Ovest, Sud, Est)
    const quatDir = new THREE.Quaternion();
    quatDir.setFromAxisAngle(new THREE.Vector3(0, 1, 0), dirAngle * Math.PI / 2);

    // 2. Rotazione Z (Banking / Inclinazione)
    const appliedBankAngle = (type === 'bank_transition') ? (params.startBank || 0) : (params.bankAngle || 0);

    const quatBank = new THREE.Quaternion();
    quatBank.setFromAxisAngle(new THREE.Vector3(0, 0, 1), appliedBankAngle);

    // Combinazione: Prima incliniamo (Roll), poi ruotiamo nella direzione (Yaw)
    const finalQuat = quatBank.multiply(quatDir);

    const container = new THREE.Object3D();
    container.position.set(x, y, z);
    container.quaternion.copy(finalQuat);
    scene.add(container);
    trackMeshes.push(container);

    const body = new CANNON.Body({ mass: 0, material: physicsMaterials.ground });
    body.position.copy(container.position);
    body.quaternion.copy(container.quaternion);

    // Dispatcher pattern
    if (type === MODULES.CHECKPOINT) { body.isCheckpoint = true; body.cpOrder = checkpointCount++; }
    if (type === MODULES.FINISH) body.isFinish = true;
    if (type === MODULES.START) body.isStart = true;

    if (type === 'bank_transition') {
        BLOCK_BUILDERS.bank_transition(container, body, params);
    }
    else if (type === MODULES.RAMP_UP || type === MODULES.RAMP_DOWN) {
        const h = params.height || 10;
        const actualH = (type === MODULES.RAMP_UP) ? h : -h;
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
    const heightTolerance = 10;
    for (let i = 0; i < occupiedPoints.length - ignoreLast; i++) {
        const p = occupiedPoints[i];
        if (Math.abs(p.y - y) > heightTolerance) {
            continue; // Se c'è dislivello sufficiente, non è collisione
        }
        const dist = Math.sqrt((x - p.x) ** 2 + (z - p.z) ** 2);
        if (dist < (p.r + radiusCheck)) {
            return true; // Collisione
        }
    }
    return false;
}
//funzione principale di generazione pista
function generateTrack(matPhysics, matTurbo, seed) {
    currentSeed = seed || Math.random().toString(36).substring(7);
    rng = createRNG(currentSeed);
    console.log("Generating Seed:", currentSeed);

    // Reset vari
    checkpointCount = 0;
    currentRunSplits = [];
    bestRunSplits = [];
    const history = JSON.parse(localStorage.getItem(STORAGE_KEY_RECORDS) || "[]");
    const existingRecord = history.find(r => r.seed === currentSeed);
    currentGhostIndex = 0;

    // --- NUOVA LOGICA COMPATIBILITÀ ---
    let isCompatibleVersion = false;
    if (existingRecord) {
        const recVer = parseInt(existingRecord.version || "0");
        const minVer = parseInt(MIN_TRACK_VERSION_COMPATIBILITY);
        isCompatibleVersion = recVer >= minVer;
    }
    if (existingRecord && isCompatibleVersion) {
        bestTime = existingRecord.time;
        uiBestTime.innerText = `Best: ${formatTime(bestTime)}`;
        bestRunSplits = existingRecord.splits || [];
        ghostDataPlayback = existingRecord.ghostData || null;
        console.log("Record compatibile caricato.");
    } else {
        if (existingRecord) console.log("Record esistente ma versione obsoleta. Tratto come nuova corsa.");
        bestTime = null;
        uiBestTime.innerText = "Best: --:--.---";
        ghostDataPlayback = null;
        if (ghostMesh) ghostMesh.visible = false;
    }
    if (!ghostMesh) createGhostVisuals();

    // Pulizia
    trackMeshes.forEach(m => scene.remove(m));
    trackBodies.forEach(b => world.removeBody(b));
    trackMeshes.length = 0;
    trackBodies.length = 0;
    occupiedPoints.length = 0;

    // MODIFICA QUESTO VALORE PER CAMBIARE LA LUNGHEZZA MEDIA DELLA PISTA
    // Valori più alti (es: 60, 80) ritardano l'aumento della probabilità di fine.
    const PREFERRED_TRACK_LENGTH = 40 + (rng() * 20 - 10);

    let cx = 0, cy = 0, cz = 0;
    let dir = 0;

    // START
    createBlock(MODULES.START, cx, cy, cz, dir, { length: TRACK_CFG.blockSize });
    trackBodies[trackBodies.length - 1].isStart = true;
    occupiedPoints.push({ x: cx, y: cy, z: cz, r: TRACK_CFG.blockSize });
    cz -= TRACK_CFG.blockSize;

    // STATO
    let lastWasRamp = false;
    let bankingState = { active: false, angle: 0, counter: 0, cooldown: 0 };

    // Nuove variabili di stato per la logica richiesta
    let checkpointAccumulator = -0.03; // Aumenta probabilità CP
    let finishProbAccumulator = 0.0; // Aumenta probabilità Fine
    let forcedStraightCounter = 0;   // Se > 0, forza blocchi dritti (dopo Turbo)
    let blockCount = 0;
    let isTrackFinished = false;
    let trackHistory = []; // Memorizza { type, cx, cy, cz, dir, occupiedLength, meshId, bodyId }

    const applyMove = (localDx, localDz, dirIdx, bankAngle) => {
        const v = new THREE.Vector3(localDx, 0, localDz);
        const quatDir = new THREE.Quaternion();
        quatDir.setFromAxisAngle(new THREE.Vector3(0, 1, 0), dirIdx * Math.PI / 2);
        const quatBank = new THREE.Quaternion();
        quatBank.setFromAxisAngle(new THREE.Vector3(0, 0, 1), bankAngle);
        const finalQuat = quatBank.multiply(quatDir);
        v.applyQuaternion(finalQuat);
        return v;
    };

    // Loop dinamico (While) invece di For fisso
    while (!isTrackFinished && blockCount < 200) { // Safety break a 200
        blockCount++;
        const currentSnapshot = {
            cx: cx, cy: cy, cz: cz, dir: dir,
            occupiedLength: occupiedPoints.length,
            meshLength: trackMeshes.length,
            bodyLength: trackBodies.length,
            bankingState: JSON.parse(JSON.stringify(bankingState)),
            forcedStraightCounter: forcedStraightCounter,
        };
        let validMoveFound = false;
        let attempts = 0;
        if (bankingState.active) bankingState.counter++;
        else if (bankingState.cooldown > 0) bankingState.cooldown--;
        // Incremento probabilità checkpoint ad ogni blocco piazzato
        checkpointAccumulator += 0.015;
        // Calcolo probabilità fine pista
        if (blockCount > PREFERRED_TRACK_LENGTH) {
            // Aumenta del 2% per ogni blocco oltre la lunghezza preferita
            finishProbAccumulator += 0.02;
        }

        while (!validMoveFound && attempts < 15) {
            attempts++;
            let potentialMoves = [];
            const leftDir = (dir + 1) % 4;
            const rightDir = (dir + 3) % 4;

            // Se siamo in una sequenza forzata (Turbo), ignoriamo tutto e proviamo solo dritto
            const isForcedStraight = (forcedStraightCounter > 0);

            // --- 1. GESTIONE BANKING (Priorità bassa) ---
            const canStartBank = !isForcedStraight && !bankingState.active && bankingState.cooldown <= 0 && !lastWasRamp;
            const mustEndBank = bankingState.active && bankingState.counter >= 8;

            // Transizione INIZIO Banking (bassa frequenza)
            if (canStartBank && rng() > 0.7) {
                const minInc = 0.2;
                const maxInc = TRACK_CFG.maxInclination || 0.5;
                const angle = (rng() > 0.5 ? 1 : -1) * (minInc + rng() * (maxInc - minInc));
                const len = TRACK_CFG.blockSize;
                const v = applyMove(0, -len, dir, 0);

                if (!checkTrackCollision(cx + v.x, cy + v.y, cz + v.z, 5)) {
                    potentialMoves.push({
                        type: 'bank_transition', nextDir: dir, moveV: v, len: len,
                        w: 7, // PESO MOLTO BASSO
                        isBankTrans: true, startBank: 0, endBank: angle
                    });
                }
            }

            // Transizione FINE Banking
            if (mustEndBank && rng() > 0.3) {
                const len = TRACK_CFG.blockSize;
                const v = applyMove(0, -len, dir, bankingState.angle);
                if (!checkTrackCollision(cx + v.x, cy + v.y, cz + v.z, 5)) {
                    potentialMoves.push({
                        type: 'bank_transition', nextDir: dir, moveV: v, len: len,
                        w: 1000, // Priorità massima se dobbiamo finire il banking
                        isBankTrans: true, startBank: bankingState.angle, endBank: 0, stopBanking: true
                    });
                }
            }

            // --- 2. MOSSE STANDARD (Dritto, Curve, Rampe) ---
            const straightLen = TRACK_CFG.blockSize;
            const vStr = applyMove(0, -straightLen, dir, bankingState.angle);

            // DRITTO
            if (!checkTrackCollision(cx + vStr.x, cy + vStr.y, cz + vStr.z, 5)) {
                let weightStraight = 85; // PESO ALTO (Più frequente)
                if (isForcedStraight) weightStraight = 99999; // Se forzato da Turbo

                potentialMoves.push({
                    type: MODULES.STRAIGHT, nextDir: dir, moveV: vStr, len: straightLen,
                    w: weightStraight
                });

                // RAMPE (Meno frequenti dei dritti, impossibili durante banking o turbo)
                if (!isForcedStraight && !bankingState.active && !lastWasRamp) {
                    const rampMult = 1 + Math.floor(rng() * 2.99);
                    const rLen = TRACK_CFG.blockSize * rampMult;
                    const maxH = rLen * TRACK_CFG.maxRampSlope;
                    const h = 5 + rng() * (maxH - 5);

                    // Salita (Solo se non siamo troppo in alto)
                    if (cy < 40) {
                        const vRamp = applyMove(0, -rLen, dir, 0);
                        vRamp.y += h;
                        potentialMoves.push({
                            type: MODULES.RAMP_UP, nextDir: dir, moveV: vRamp, len: rLen, height: h,
                            w: 25, // PESO MEDIO-BASSO
                            isRamp: true
                        });
                    }
                    // Discesa (Solo se siamo in alto)
                    if (cy > 15) {
                        const vRamp = applyMove(0, -rLen, dir, 0);
                        vRamp.y -= h;
                        potentialMoves.push({
                            type: MODULES.RAMP_DOWN, nextDir: dir, moveV: vRamp, len: rLen, height: h,
                            w: 25, // PESO MEDIO-BASSO
                            isRamp: true
                        });
                    }
                }
            }

            // CURVE (Frequenti come i dritti, ma non durante turbo o rampe appena finite)
            if (!isForcedStraight && !lastWasRamp) { // Le curve col banking attivo sono permesse (Banking influenza Y)
                const turnRadii = [TRACK_CFG.blockSize, TRACK_CFG.blockSize * 2.5];
                turnRadii.forEach(r => {
                    const wCurve = 50; // PESO ALTO

                    // Sx
                    const vL = applyMove(-r, -r, dir, bankingState.angle);
                    if (!checkTrackCollision(cx + vL.x, cy + vL.y, cz + vL.z, r / 1.5)) {
                        potentialMoves.push({ type: MODULES.TURN_LEFT, nextDir: leftDir, moveV: vL, radius: r, w: wCurve });
                    }
                    // Dx
                    const vR = applyMove(r, -r, dir, bankingState.angle);
                    if (!checkTrackCollision(cx + vR.x, cy + vR.y, cz + vR.z, r / 1.5)) {
                        potentialMoves.push({ type: MODULES.TURN_RIGHT, nextDir: rightDir, moveV: vR, radius: r, w: wCurve });
                    }
                });
            }

            // --- 3. LOGICA TURBO (Rara) ---
            // Solo se non banking, non rampa, non forzato, e su un dritto valido
            if (!isForcedStraight && !bankingState.active && !lastWasRamp && rng() < 0.3) {
                // Cerca se esiste già la mossa STRAIGHT in potentialMoves
                const straightMove = potentialMoves.find(m => m.type === MODULES.STRAIGHT);
                if (straightMove) {
                    // Sostituiamo o aggiungiamo Turbo
                    potentialMoves.push({
                        type: MODULES.TURBO, nextDir: dir, moveV: straightMove.moveV, len: straightLen,
                        w: 5, // Peso basso, ma se esce...
                        isTurboStart: true
                    });
                }
            }

            // --- SELEZIONE MOSSA ---
            if (potentialMoves.length > 0) {
                const totalW = potentialMoves.reduce((a, b) => a + b.w, 0);
                let rand = rng() * totalW;
                const move = potentialMoves.find(m => (rand -= m.w) < 0) || potentialMoves[0];

                // Gestione Turbo Sequence
                if (move.isTurboStart) {
                    move.type = MODULES.TURBO; // È un blocco dritto ma turbo
                    forcedStraightCounter = 3; // Obbliga i prossimi 3 a essere dritti
                } else if (forcedStraightCounter > 0) {
                    forcedStraightCounter--;
                }

                // Gestione Checkpoint Dinamica
                // Solo su rettilinei normali (non banking trans, non turbo start)
                if (move.type === MODULES.STRAIGHT && !move.isBankTrans && !move.isTurboStart) {
                    if (rng() < checkpointAccumulator) {
                        move.type = MODULES.CHECKPOINT;
                        checkpointAccumulator = 0; // Azzera probabilità
                    }
                }

                // Gestione Fine Pista Dinamica
                if (rng() < finishProbAccumulator) {
                    move.type = MODULES.FINISH;
                    isTrackFinished = true; // Esce dal loop while
                    console.log("Truck ended by finishProbAccumulator, blockCount: "+blockCount);
                }

                lastWasRamp = !!move.isRamp;

                // Aggiorna stato Banking
                if (move.isBankTrans) {
                    if (move.stopBanking) {
                        bankingState.active = false;
                        bankingState.angle = 0;
                        bankingState.cooldown = 6;
                        bankingState.counter = 0;
                    } else {
                        bankingState.active = true;
                        bankingState.angle = move.endBank;
                        bankingState.counter = 0;
                    }
                }

                // Creazione Blocco
                createBlock(move.type, cx, cy, cz, dir, {
                    length: move.len,
                    height: move.height,
                    radius: move.radius,
                    isLeft: (move.type === MODULES.TURN_LEFT),
                    bankAngle: bankingState.angle,
                    startBank: move.startBank,
                    endBank: move.endBank
                });

                // Update coordinate occupate (collisioni)
                const steps = Math.ceil(move.len / 10) || 3;
                for (let k = 1; k <= steps; k++) {
                    const ratio = k / steps;
                    occupiedPoints.push({
                        x: cx + move.moveV.x * ratio,
                        y: cy + move.moveV.y * ratio,
                        z: cz + move.moveV.z * ratio,
                        r: 15
                    });
                }

                // Salvataggio History
                trackHistory.push({
                    type: move.type,
                    isTurn: (move.type === MODULES.TURN_LEFT || move.type === MODULES.TURN_RIGHT),
                    snapshot: currentSnapshot
                });

                cx += move.moveV.x;
                cy += move.moveV.y;
                cz += move.moveV.z;
                dir = move.nextDir;
                validMoveFound = true;
            }
        }

        // Fallback se incastrato
        if (!validMoveFound) {
            console.log("Bloccato! Cambio direzione dell'ultima curva e riprovo.");
            let foundTurn = false;
            let backtrackIndex = -1;
            // 1. Cerca l'ultima curva nella history andando all'indietro
            for (let i = trackHistory.length - 1; i >= 0; i--) {
                if (trackHistory[i].isTurn) {
                    backtrackIndex = i;
                    foundTurn = true;
                    break;
                }
            }
            if (foundTurn) {
                const badTurn = trackHistory[backtrackIndex];
                const snap = badTurn.snapshot;
                // 2. Ripristina stato VARIABILI (cx, cy, dir, ecc)
                cx = snap.cx; cy = snap.cy; cz = snap.cz; dir = snap.dir;
                bankingState = snap.bankingState;
                forcedStraightCounter = snap.forcedStraightCounter;
                blockCount = backtrackIndex; // Resetta contatore blocchi
                // 3. Ripristina STATO FISICO (Rimuovi blocchi successivi)
                // Rimuoviamo da THREE (Scene)
                for (let j = trackMeshes.length - 1; j >= snap.meshLength; j--) {
                    scene.remove(trackMeshes[j]);
                }
                trackMeshes.length = snap.meshLength;
                // Rimuoviamo da CANNON (World)
                for (let j = trackBodies.length - 1; j >= snap.bodyLength; j--) {
                    if (trackBodies[j].isCheckpoint) {checkpointCount--;}
                    world.removeBody(trackBodies[j]);
                }
                trackBodies.length = snap.bodyLength;
                // Ripristina OccupiedPoints
                occupiedPoints.length = snap.occupiedLength;
                // Troncata la history
                trackHistory.length = backtrackIndex;
                // 4. Esegui la Curva OPPOSTA
                // Se era Left, ora forziamo Right e viceversa
                const oldType = badTurn.type;
                const newType = (oldType === MODULES.TURN_LEFT) ? MODULES.TURN_RIGHT : MODULES.TURN_LEFT;
                const newDir = (oldType === MODULES.TURN_LEFT) ? (dir + 3) % 4 : (dir + 1) % 4; // Right logic vs Left logic
                const r = TRACK_CFG.blockSize * 2.5; // Usiamo raggio largo per sicurezza
                // Calcoliamo il vettore movimento manuale per la nuova curva
                const moveV = applyMove((oldType === MODULES.TURN_LEFT ? r : -r), -r, dir, bankingState.angle);
                // Creiamo il blocco manualmente
                createBlock(newType, cx, cy, cz, dir, {
                    radius: r,
                    isLeft: (newType === MODULES.TURN_LEFT),
                            bankAngle: bankingState.angle
                });
                // Update collisioni manuale
                const steps = 3;
                for (let k = 1; k <= steps; k++) {
                    const ratio = k / steps;
                    occupiedPoints.push({
                        x: cx + moveV.x * ratio, y: cy + moveV.y * ratio, z: cz + moveV.z * ratio, r: 15
                    });
                }
                // Update variabili posizione
                cx += moveV.x; cy += moveV.y; cz += moveV.z;
                dir = newDir;
                // Aggiungiamo la nuova mossa forzata alla history (non come Turn per evitare loop infiniti sullo stesso punto)
                trackHistory.push({
                    type: newType,
                    isTurn: false, // Trick: segniamola false così se si incastra ancora torna alla curva PRIMA di questa
                    snapshot: currentSnapshot // Usiamo lo snapshot originale di questo step
                });
                continue; // Riprova il loop dal nuovo punto
            } else {
                // Se non ci sono curve o fallisce tutto, chiudi
                createBlock(MODULES.FINISH, cx, cy, cz, dir, { length: TRACK_CFG.blockSize });
                isTrackFinished = true;
                console.log("Truck ended by !validMoveFound, blockCount: "+blockCount);
            }
        }
    }
}

// --- CREAZIONE AUTO ---
let speedoCtx, speedoTexture;
function createCar() {
    // 1. FISICA
    chassisBody = new CANNON.Body({
        mass: CONFIG.mass,
        material: physicsMaterials.chassis
    });
    const physLen = 3.8;
    const physWidth = 1.8;
    const physHeight = 0.4;
    const chassisShape = new CANNON.Box(new CANNON.Vec3(physWidth / 2, physHeight / 2, physLen / 2));
    chassisBody.addShape(chassisShape, new CANNON.Vec3(0, 0.5, 0));
    chassisBody.position.set(0, 4, -10);
    chassisBody.angularDamping = 0.5;

    // --- AUDIO COLLISIONE ---
    chassisBody.addEventListener("collide", (e) => {
        // Calcola la forza dell'impatto (velocità relativa lungo la normale)
        const relativeVelocity = e.contact.getImpactVelocityAlongNormal();
        // Ignora impatti lievi (sotto 2.0)
        if (Math.abs(relativeVelocity) > 2.0 && currentState === GAME_STATE.RACING) {
            // Volume basato sull'impatto (max 1.0)
            const vol = Math.min(Math.abs(relativeVelocity) / 15, 1.0);
            playSfx('collision', vol);
        }
    });

    world.addBody(chassisBody);

    // 2. GRAFICA (F1 Low Poly) - MATERIALI GLOBALI
    matBody = new THREE.MeshStandardMaterial({ color: gameSettings.carColors.body });
    matSpoiler = new THREE.MeshStandardMaterial({ color: gameSettings.carColors.spoiler });
    matWheelVis = new THREE.MeshStandardMaterial({ color: gameSettings.carColors.wheels, roughness: 0.5 });
    matRim = new THREE.MeshStandardMaterial({ color: gameSettings.carColors.rims });

    const carGroup = new THREE.Group();
    const visualY = -0.4;

    // A. Corpo Centrale
    const bodyGeo = new THREE.BoxGeometry(0.8, 0.4, 2.0);
    const bodyMesh = new THREE.Mesh(bodyGeo, matBody);
    bodyMesh.position.set(0, 0.5 + visualY, 0.2);
    bodyMesh.castShadow = true;
    carGroup.add(bodyMesh);

    // B. Naso
    const noseGeo = new THREE.BoxGeometry(0.6, 0.3, 1.4);
    const noseMesh = new THREE.Mesh(noseGeo, matBody);
    noseMesh.position.set(0, 0.4 + visualY, -1.5);
    noseMesh.castShadow = true;
    carGroup.add(noseMesh);

    // C. Pance Laterali
    const sideGeo = new THREE.BoxGeometry(0.6, 0.35, 1.4);
    const sideL = new THREE.Mesh(sideGeo, matBody);
    sideL.position.set(-0.6, 0.4 + visualY, 0.4);
    sideL.castShadow = true;
    carGroup.add(sideL);

    const sideR = new THREE.Mesh(sideGeo, matBody);
    sideR.position.set(0.6, 0.4 + visualY, 0.4);
    sideR.castShadow = true;
    carGroup.add(sideR);

    // D. Alettone Posteriore
    const spoilerGeo = new THREE.BoxGeometry(2.2, 0.1, 0.6);
    const spoilerMesh = new THREE.Mesh(spoilerGeo, matSpoiler);
    spoilerMesh.position.set(0, 0.9 + visualY, 1.4);
    spoilerMesh.castShadow = true;
    carGroup.add(spoilerMesh);

    // E. Alettone Anteriore
    const frontSpoilerGeo = new THREE.BoxGeometry(2.2, 0.08, 0.4);
    const frontSpoilerMesh = new THREE.Mesh(frontSpoilerGeo, matSpoiler);
    frontSpoilerMesh.position.set(0, 0.25 + visualY, -2.2);
    frontSpoilerMesh.castShadow = true;
    carGroup.add(frontSpoilerMesh);

    // Supporti alettone posteriore
    const strutGeo = new THREE.BoxGeometry(0.1, 0.4, 0.4);
    const strutL = new THREE.Mesh(strutGeo, matSpoiler);
    strutL.position.set(-0.5, 0.7 + visualY, 1.4);
    carGroup.add(strutL);
    const strutR = new THREE.Mesh(strutGeo, matSpoiler);
    strutR.position.set(0.5, 0.7 + visualY, 1.4);
    carGroup.add(strutR);

    // Luci freno
    const brakeLightGeo = new THREE.BoxGeometry(0.1, 0.1, 0.05);
    const brakeLightMat = new THREE.MeshStandardMaterial({ color: 0x880000, emissive: 0x000000, emissiveIntensity: 2 });
    brakeLightL = new THREE.Mesh(brakeLightGeo, brakeLightMat);
    brakeLightR = new THREE.Mesh(brakeLightGeo, brakeLightMat);
    brakeLightL.position.copy(strutL.position).add(new THREE.Vector3(0, -0.1, 0.21));
    brakeLightR.position.copy(strutR.position).add(new THREE.Vector3(0, -0.1, 0.21));
    carGroup.add(brakeLightL);
    carGroup.add(brakeLightR);

    // Tachimetro
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 64;
    speedoCtx = canvas.getContext('2d');
    speedoTexture = new THREE.CanvasTexture(canvas);
    speedoTexture.minFilter = THREE.NearestFilter;
    speedoTexture.magFilter = THREE.NearestFilter;
    speedoMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.6, 0.3),
                                new THREE.MeshBasicMaterial({ map: speedoTexture, transparent: true })
    );
    speedoMesh.position.set(0, 0.5 + visualY, 1.21); // Posizione default (Chase)
    carGroup.add(speedoMesh);

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
        suspensionStiffness: 55,
        suspensionRestLength: 0.6,
        frictionSlip: 2.5,
        dampingRelaxation: 2.3,
        dampingCompression: 4.5,
        maxSuspensionForce: 200000,
        rollInfluence: 0.01,
        axleLocal: new CANNON.Vec3(-1, 0, 0),
        chassisConnectionPointLocal: new CANNON.Vec3(1, 1, 0),
        maxSuspensionTravel: 0.5,
        customSlidingRotationalSpeed: -30,
        useCustomSlidingRotationalSpeed: true
    };
    const axisY = 0.3, axisZF = -1.4, axisZR = 1.3, widthHalf = 1.1;

    vehicle.addWheel({ ...options, chassisConnectionPointLocal: new CANNON.Vec3(widthHalf, axisY, axisZF) });
    vehicle.addWheel({ ...options, chassisConnectionPointLocal: new CANNON.Vec3(-widthHalf, axisY, axisZF) });
    vehicle.addWheel({ ...options, chassisConnectionPointLocal: new CANNON.Vec3(widthHalf, axisY, axisZR) });
    vehicle.addWheel({ ...options, chassisConnectionPointLocal: new CANNON.Vec3(-widthHalf, axisY, axisZR) });
    vehicle.addToWorld(world);

    // Mesh Ruote
    const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.6, 24);
    wheelGeo.rotateZ(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.62, 16);
    rimGeo.rotateZ(Math.PI / 2);

    vehicle.wheelInfos.forEach(w => {
        const wheelGroup = new THREE.Group();
        const tire = new THREE.Mesh(wheelGeo, matWheelVis);
        const rim = new THREE.Mesh(rimGeo, matRim);
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
    [1, 1, 1, 1, 1, 1, 0], // 0
    [0, 1, 1, 0, 0, 0, 0], // 1
    [1, 1, 0, 1, 1, 0, 1], // 2
    [1, 1, 1, 1, 0, 0, 1], // 3
    [0, 1, 1, 0, 0, 1, 1], // 4
    [1, 0, 1, 1, 0, 1, 1], // 5
    [1, 0, 1, 1, 1, 1, 1], // 6
    [1, 1, 1, 0, 0, 0, 0], // 7
    [1, 1, 1, 1, 1, 1, 1], // 8
    [1, 1, 1, 1, 0, 1, 1]  // 9
];
function drawDigitalNumber(ctx, number, startX, startY, digitWidth, digitHeight, thickness) {
    const strNum = number.toString();
    const spacing = thickness * 1.5; // Spazio tra i numeri
    // Calcola l'offset X per centrare tutto il blocco di testo
    const totalWidth = (strNum.length * digitWidth) + ((strNum.length - 1) * spacing);
    let currentX = startX - (totalWidth / 2);
    ctx.fillStyle = gameSettings.carColors.speedo || "#ffffff";
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

    // --- GESTIONE AUDIO MOTORE ---
    if (currentState === GAME_STATE.RACING && engineSource && engineGain && chassisBody) {
        const localVelocity = new CANNON.Vec3(0, 0, 0);
        chassisBody.quaternion.inverse().vmult(chassisBody.velocity, localVelocity);
        const speed = Math.abs(localVelocity.z); // m/s
        // Pitch: 0.8 (minimo) -> 2.0 (massimo a circa 60 m/s ~ 200kmh)
        const pitch = 0.8 + (speed / 60) * 1.2;
        engineSource.playbackRate.value = Math.min(pitch, 2.4);
        // Volume: aumenta leggermente con la velocità + input acceleratore
        const baseVol = 0.3 + (Math.min(speed, 20) / 20) * 0.2;
        const throttleBoost = (window.inputAnalog ? window.inputAnalog.throttle : 0) * 0.3;
        engineGain.gain.value = (baseVol + throttleBoost) * gameSettings.sfxVolume;
        // --- GESTIONE AUDIO SGOMMATA ---
        if (skidGain) {
            let sliding = false;
            if (vehicle) {
                vehicle.wheelInfos.forEach(w => { if (w.sliding && w.raycastResult.hasHit) sliding = true; });
            }
            // Fade in/out rapido
            const targetSkidVol = sliding ? 0.6 : 0.0;
            skidGain.gain.setTargetAtTime(targetSkidVol * gameSettings.sfxVolume, audioCtx.currentTime, 0.1);
        }
    } else {
        // AZZERA VOLUMI se in pausa, countdown o menu
        if (engineGain) engineGain.gain.value = 0;
        if (skidGain) skidGain.gain.value = 0;
    }

    const now = performance.now();
    const dt = Math.min((now - lastFrameTime) / 1000, 0.1);

    // Se siamo in pausa o nel menu, aggiorniamo lastFrameTime ma non la fisica
    if (currentState === GAME_STATE.PAUSED || currentState === GAME_STATE.MENU) {
        handleMenuNavigation();
        lastFrameTime = now;
        renderer.render(scene, camera);
        return;
    }
    lastFrameTime = now;

    if (currentState !== GAME_STATE.START && currentState !== GAME_STATE.FINISHED) {
        // Se siamo in flying respawn, non eseguiamo la normale simulazione fisica per l'auto
        if (currentState === GAME_STATE.RESPAWNING_FLYING) {
            if (flyingRespawnIndex < flyingRespawnSequence.length) {
                const data = flyingRespawnSequence[flyingRespawnIndex];
                chassisBody.position.set(data.p[0], data.p[1], data.p[2]);
                chassisBody.quaternion.set(data.q[0], data.q[1], data.q[2], data.q[3]);
                chassisBody.velocity.copy(currentCheckpointData.velocity);
                chassisBody.angularVelocity.copy(currentCheckpointData.angularVelocity);
                flyingRespawnIndex++;
            } else {
                chassisBody.velocity.copy(currentCheckpointData.velocity);
                chassisBody.angularVelocity.copy(currentCheckpointData.angularVelocity);
                currentState = GAME_STATE.RACING;
                uiMsg.style.display = 'none';
                world.step(1 / CONFIG.stepFrequency);
            }
        } else {
            world.step(1 / CONFIG.stepFrequency);
        }
        if (currentState === GAME_STATE.RACING || currentState === GAME_STATE.RESPAWNING_FLYING) {
            gameTime += dt * 1000;
        }
    }

    // --- LOGICA GHOST CAR ---
    // 1. REGISTRAZIONE (Solo se stiamo gareggiando e non è un replay)
    if (currentState === GAME_STATE.RACING && !isReplayMode) {
        // Registra ogni frame o (meglio) usa gameTime per sincronizzare
        // Salviamo posizione e rotazione con precisione arrotondata per risparmiare spazio
        ghostDataRecording.push({
            t: Math.floor(gameTime),
                                p: [parseFloat(chassisBody.position.x.toFixed(3)), parseFloat(chassisBody.position.y.toFixed(3)), parseFloat(chassisBody.position.z.toFixed(3))],
                                q: [parseFloat(chassisBody.quaternion.x.toFixed(4)), parseFloat(chassisBody.quaternion.y.toFixed(4)), parseFloat(chassisBody.quaternion.z.toFixed(4)), parseFloat(chassisBody.quaternion.w.toFixed(4))]
        });
    }

    // INPUTS & PHYSICS SYNC
    if (vehicle && chassisMesh) {
        // Sync visuale parziale (necessaria per calcoli logici come skidmarks e camera target)
        // Nota: La posizione effettiva della mesh verrà renderizzata solo nel blocco di disegno,
        // ma aggiorniamo qui le coordinate per coerenza logica.
        chassisMesh.position.copy(chassisBody.position);
        chassisMesh.quaternion.copy(chassisBody.quaternion);

        const localVelocity = new CANNON.Vec3(0, 0, 0);
        chassisBody.quaternion.inverse().vmult(chassisBody.velocity, localVelocity);
        const forwardSpeed = -localVelocity.z;

        pollInputs(); // Leggi tutti gli input

        let wheelsOnGround = 0; //leggo se la macchina è in aria o no
        if (vehicle) {
            vehicle.wheelInfos.forEach(w => {
                if (w.raycastResult.hasHit) wheelsOnGround++;
            });
        }

        let engine = 0, brake = 0, steer = 0;

        const inSteer = window.inputAnalog ? window.inputAnalog.steer : 0;
        const inThrottle = window.inputAnalog ? window.inputAnalog.throttle : 0;
        const inBrake = window.inputAnalog ? window.inputAnalog.brake : 0;

        if (currentState === GAME_STATE.RACING) {
            // Motore
            if (inThrottle > 0) engine = CONFIG.engineForce * inThrottle;
            if (inBrake > 0) {
                if (forwardSpeed > 1.0) brake = CONFIG.brakeForce * inBrake;
                else engine = -CONFIG.engineForce / 2;
            }
            if (wheelsOnGround === 0) {
                if (inBrake) chassisBody.angularVelocity.set(0, 0, 0);
            } else {
                steer = inSteer * CONFIG.maxSteerVal;
            }
        }

        // Skidmarks Logica (creazione mesh)
        vehicle.wheelInfos.forEach(w => {
            if (w.sliding && currentState === GAME_STATE.RACING) {
                if (gameTime % 50 < 25) {
                    const speed = Math.abs(forwardSpeed);
                    const dynamicLength = Math.max(0.5, speed * 0.07);
                    // 1. IDENTIFICAZIONE COLORE
                    // Chiediamo alla forma fisica colpita (shape) la sua colorKey
                    const hitShape = w.raycastResult.shape;
                    const colorKey = (hitShape && hitShape.colorKey) ? hitShape.colorKey : 'road';
                    // Prendiamo il colore corrispondente da TRACK_CFG
                    const groundColor = new THREE.Color(TRACK_CFG.colors[colorKey]);
                    const tireColor = new THREE.Color(gameSettings.carColors.wheels);
                    // 2. MEDIAZIONE
                    tireColor.lerp(groundColor, 0.9);
                    const skidGeo = new THREE.PlaneGeometry(0.3, dynamicLength);
                    const skidMat = new THREE.MeshBasicMaterial({ color: tireColor, transparent: false, depthWrite: false });
                    const skidMesh = new THREE.Mesh(skidGeo, skidMat);
                    // 2. POSIZIONAMENTO
                    skidMesh.position.copy(w.raycastResult.hitPointWorld).add(new THREE.Vector3(0, 0.02, 0));
                    // 3. ORIENTAMENTO ALLA VELOCITÀ (Cruciale per il cambio direzione)
                    const velocity = chassisBody.velocity;
                    if (velocity.length() > 0.1) {
                        // Allinea il rettangolo alla direzione del movimento reale
                        const angle = Math.atan2(velocity.x, velocity.z);
                        skidMesh.rotation.set(-Math.PI / 2, 0, angle);
                    } else {
                        skidMesh.quaternion.copy(chassisBody.quaternion);
                        skidMesh.rotateX(-Math.PI / 2);
                    }
                    scene.add(skidMesh);
                    skidmarkMeshes.push(skidMesh);
                    // Limite massimo (impostato nelle opzioni)
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

        // CHECKPOINT & LOGICHE TRIGGER (Resta nel loop fisico per precisione)
        trackBodies.forEach((b, index) => {
            if (!b.isCheckpoint && !b.isFinish && !b.isStart) return;

            const carPosWorld = chassisBody.position;
            const blockPosWorld = b.position;
            const blockQuatInverse = b.quaternion.inverse();
            const relPos = carPosWorld.clone().vsub(blockPosWorld);
            const localPos = blockQuatInverse.vmult(relPos);

            const archZ = b.triggerZ !== undefined ? b.triggerZ : -TRACK_CFG.blockSize / 2;
            const triggerDepth = 2;
            const triggerWidth = TRACK_CFG.blockSize / 2;
            const triggerHeight = 8;

            const insideTrigger = Math.abs(localPos.x) < triggerWidth &&
            localPos.y > 0 && localPos.y < triggerHeight &&
            Math.abs(localPos.z - archZ) < triggerDepth;

            if (insideTrigger) {
                if (b.isCheckpoint && currentState === GAME_STATE.RACING && currentCheckpointData.index !== index) {
                    playSfx('checkpoint');
                    currentCheckpointData.index = index;
                    currentCheckpointData.position.copy(chassisBody.position);
                    currentCheckpointData.quaternion.copy(chassisBody.quaternion);
                    currentCheckpointData.velocity.copy(chassisBody.velocity);
                    currentCheckpointData.angularVelocity.copy(chassisBody.angularVelocity);

                    currentCheckpointData.timeStamp = gameTime;
                    const cpOrder = b.cpOrder;
                    currentRunSplits[cpOrder] = currentCheckpointData.timeStamp;
                    let html = `<div style="color: #ffff00;">${formatTime(currentCheckpointData.timeStamp)}</div>`;
                    if (bestRunSplits[cpOrder] !== undefined) {
                        const diff = currentCheckpointData.timeStamp - bestRunSplits[cpOrder];
                        const sign = diff >= 0 ? "+" : "-";
                        const diffColor = diff <= 0 ? "#00ff00" : "#ff0000";
                        html += `<div style="color: ${diffColor}; font-size: 0.8em;">${sign}${formatDiffHTML(Math.abs(diff))}</div>`;
                    }
                    uiMsg.innerHTML = html; // Usiamo innerHTML
                    uiMsg.style.display = 'block';
                    setTimeout(() => { if (currentState === GAME_STATE.RACING) uiMsg.style.display = 'none'; }, 800);
                }

                if (b.isFinish && currentState === GAME_STATE.RACING) {
                    const hitCount = Object.keys(currentRunSplits).length;
                    if (hitCount < checkpointCount) {
                        uiMsg.innerHTML = `
                        <div style="color: #ff0000; font-size: 1.5em;">CHECKPOINT MANCANTI!</div>
                        <div style="color: #ffffff; font-size: 1.1em;">Hai preso ${hitCount} checkpoint su ${checkpointCount}</div>
                        `;
                        uiMsg.style.display = 'block';
                        setTimeout(() => { if (currentState === GAME_STATE.RACING) uiMsg.style.display = 'none'; }, 2000);
                    } else {
                        playSfx('checkpoint');
                        currentState = GAME_STATE.FINISHED;
                        let html = `<div style="color: #ffff00;">${formatTime(gameTime)}</div>`;
                        if (bestTime !== null) {
                            const diff = gameTime - bestTime;
                            const sign = diff >= 0 ? "+" : "-";
                            const diffColor = diff <= 0 ? "#00ff00" : "#ff0000";
                            html += `<div style="color: ${diffColor}; font-size: 0.8em;">${sign}${formatTime(Math.abs(diff))}</div>`;
                            if (gameTime < bestTime) {
                                bestTime = gameTime;
                                html += `<div style="color: ${diffColor}; font-size: 1.3em; margin-top:10px;">NEW BEST TIME!</div>`;
                                html += `<div style="color: #ffd700; font-size: 0.5em; margin-top:10px;">(old ${uiBestTime.innerText})</div>`;
                                bestRunSplits = currentRunSplits;
                                uiBestTime.innerText = `Best: ${formatTime(bestTime)}`;
                            } else {
                                html += `<div style="color: ${diffColor}; font-size: 1.3em; margin-top:10px;">FINISH!</div>`;
                            }
                        } else {
                            // Prima volta che finisce la pista
                            bestTime = gameTime;
                            bestRunSplits = currentRunSplits;
                            uiBestTime.innerText = `Best: ${formatTime(bestTime)}`;
                            html += `<div style="color: #ffd700; font-size: 1.3em; margin-top:10px;">FINISH!</div>`;
                        }
                        uiMsg.innerHTML = html;
                        uiMsg.style.display = 'block';
                        saveRunToHistory(gameTime);
                    }
                }
            }
        });
    }

    // --- RENDER LOOP (Limitato da Max FPS tramite frameAccumulator) ---
    frameAccumulator = Math.min(frameAccumulator + (gameSettings.maxFPS / 60), 2);
    if (frameAccumulator >= 1) {
        lastRenderTime = now;
        frameAccumulator -= 1; //disegno il frame e resetto.

        // GHOST VISUAL (Update solo quando renderizziamo)
        const hasGhostData = ghostDataPlayback && ghostDataPlayback.length > 0;
        if (isReplayMode && hasGhostData) {
            const lastRecTime = ghostDataPlayback[ghostDataPlayback.length - 1].t;
            if (gameTime >= lastRecTime && currentState !== GAME_STATE.FINISHED) {
                gameTime = lastRecTime;
                currentState = GAME_STATE.FINISHED;
                uiMsg.innerHTML = `<div style="color: #00ffff; font-size: 1.5em;">REPLAY FINISHED</div>`;
                uiMsg.style.display = 'block';
            }
        }
        if (hasGhostData && ghostMesh) {
            const shouldShow = gameSettings.ghostEnabled &&
            (currentState === GAME_STATE.RACING || currentState === GAME_STATE.FINISHED || isReplayMode || currentState === GAME_STATE.START);
            ghostMesh.visible = shouldShow
            if (shouldShow) {
                while (currentGhostIndex < ghostDataPlayback.length - 1 && ghostDataPlayback[currentGhostIndex + 1].t <= gameTime) {
                    currentGhostIndex++;
                }
                const data = ghostDataPlayback[currentGhostIndex];
                if (data) {
                    ghostMesh.position.set(data.p[0], data.p[1], data.p[2]);
                    ghostMesh.quaternion.set(data.q[0], data.q[1], data.q[2], data.q[3]);
                }
            }
        }

        // CAMERA UPDATE (Visuale)
        if (isReplayMode) {
            if (hasGhostData && ghostMesh) {
                const camOffset = new THREE.Vector3(0, 3.5, 6.0);
                camOffset.applyMatrix4(ghostMesh.matrixWorld);
                camera.position.lerp(camOffset, 0.25 * (60/gameSettings.maxFPS));
                camera.lookAt(ghostMesh.position.x, ghostMesh.position.y + 1.5, ghostMesh.position.z);
            }
        } else {
            if (cameraMode === 1) { // FPS
                const camOffset = new THREE.Vector3(0, 1, -0.15);
                camOffset.applyQuaternion(chassisMesh.quaternion);
                camOffset.add(chassisMesh.position);
                camera.position.copy(camOffset);
                const lookTarget = new THREE.Vector3(0, 0.75, -80);
                lookTarget.applyMatrix4(chassisMesh.matrixWorld);
                camera.lookAt(lookTarget);
            } else { // CHASE
                const camOffset = new THREE.Vector3(0, 3.5, 6.0);
                camOffset.applyMatrix4(chassisMesh.matrixWorld);
                camera.position.lerp(camOffset, 0.25 * (60/gameSettings.maxFPS));
                camera.lookAt(chassisMesh.position.x, chassisMesh.position.y + 1.5, chassisMesh.position.z);
            }
        }

        // SYNC RUOTE (Visuale)
        if (vehicle) {
            for (let i = 0; i < vehicle.wheelInfos.length; i++) {
                vehicle.updateWheelTransform(i);
                vehicle.wheelInfos[i].mesh.position.copy(vehicle.wheelInfos[i].worldTransform.position);
                vehicle.wheelInfos[i].mesh.quaternion.copy(vehicle.wheelInfos[i].worldTransform.quaternion);
            }
        }

        // AGGIORNAMENTO LUCI FRENO (Visuale)
        const inBrake = window.inputAnalog ? window.inputAnalog.brake : 0;
        if (brakeLightL && (inBrake > 0.1)) {
            brakeLightL.material.emissive.setHex(0xff0000);
        } else if (brakeLightL) {
            brakeLightL.material.emissive.setHex(0x000000);
        }

        // AGGIORNAMENTO TACHIMETRO (Canvas Draw - Pesante, fare solo se si renderizza)
        const localVelocity = new CANNON.Vec3(0, 0, 0);
        chassisBody.quaternion.inverse().vmult(chassisBody.velocity, localVelocity);
        const forwardSpeed = -localVelocity.z;
        const kmh = Math.floor(Math.abs(forwardSpeed * 3.6));
        speedoCtx.clearRect(0, 0, 128, 64);
        drawDigitalNumber(speedoCtx, kmh, 64, 32, 24, 44, 6);
        speedoTexture.needsUpdate = true;

        // UI TIMER TEXT
        uiTimer.innerText = formatTime(gameTime);

        // DISEGNO FINALE
        renderer.render(scene, camera);
    }
}

// --- UTILS ---
function doRespawn(type) {
    if (!chassisBody) return;
    uiMsg.style.display = 'none'; //tolgo i messaggi attivi
    if (type === 'standing') {
        let count = 3;
        const blockBody = trackBodies[currentCheckpointData.index];
        if (blockBody) { //respawn a checkpoint
            chassisBody.quaternion.copy(blockBody.quaternion);
            const spawnPos = blockBody.position.clone();
            const zPos = blockBody.triggerZ !== undefined ? blockBody.triggerZ : -TRACK_CFG.blockSize / 2;
            const localOffset = new CANNON.Vec3(0, 1.3, zPos);
            const worldOffset = new CANNON.Vec3();
            blockBody.quaternion.vmult(localOffset, worldOffset);
            spawnPos.vadd(worldOffset, spawnPos);
            chassisBody.position.copy(spawnPos);
            count = 1; // Countdown veloce
        } else {
            chassisBody.position.copy(currentCheckpointData.position);
            chassisBody.quaternion.copy(currentCheckpointData.quaternion);
        }
        chassisBody.velocity.set(0, 0, 0);
        chassisBody.angularVelocity.set(0, 0, 0);
        startCountdown(count);
    } else if (type === 'flying') {
        // Recuperiamo i dati registrati prima del checkpoint
        const cpTime = currentCheckpointData.timeStamp;
        // Troviamo l'indice nel recording che corrisponde al tempo del checkpoint
        // Cerchiamo l'ultimo frame registrato che non superi il tempo del checkpoint
        let targetIdx = ghostDataRecording.findIndex(d => d.t >= cpTime);
        if (targetIdx === -1) targetIdx = ghostDataRecording.length - 1;
        // Prendiamo gli ultimi 40 frame (circa 0.6 secondi a 60fps) per il playback
        const startIdx = Math.max(0, targetIdx - 40);
        flyingRespawnSequence = ghostDataRecording.slice(startIdx, targetIdx + 1);
        flyingRespawnIndex = 0;
        if (flyingRespawnSequence.length > 0) {
            uiMsg.innerText = "Rewind...";
            uiMsg.style.display = 'block';
            // Posizioniamo subito l'auto all'inizio della sequenza di recupero
            const firstFrame = flyingRespawnSequence[0];
            chassisBody.position.set(firstFrame.p[0], firstFrame.p[1], firstFrame.p[2]);
            chassisBody.quaternion.set(firstFrame.q[0], firstFrame.q[1], firstFrame.q[2], firstFrame.q[3]);
            // Azzeriamo le velocità temporaneamente per evitare attriti fisici strani durante il "trascinamento"
            chassisBody.velocity.set(0, 0, 0);
            chassisBody.angularVelocity.set(0, 0, 0);
            currentState = GAME_STATE.RESPAWNING_FLYING;
        } else {
            doRespawn('standing');
        }
    }
    // Reset Audio immediato per evitare code di suoni vecchi
    if (engineGain) engineGain.gain.value = 0;
    if (skidGain) skidGain.gain.value = 0;
    if (vehicle) {
        vehicle.wheelInfos.forEach((w, i) => {
            vehicle.applyEngineForce(0, i);
            vehicle.setBrake(CONFIG.brakeForce, i);
        });
    }
}
function triggerRespawnLogic(type) {
    if (currentState === GAME_STATE.MENU) return;
    if (currentState === GAME_STATE.FINISHED || currentCheckpointData.index <= 0) {
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

    ghostDataRecording = [];
    currentGhostIndex = 0;

    if (isReplayMode) {
        currentState = GAME_STATE.START;
        if (chassisBody) {
            chassisBody.position.set(0, -100, 0);
            chassisBody.velocity.set(0, 0, 0);
            chassisBody.angularVelocity.set(0, 0, 0);
        }
        if (ghostMesh && ghostDataPlayback && ghostDataPlayback.length > 0) {
            const firstFrame = ghostDataPlayback[0];
            ghostMesh.position.set(firstFrame.p[0], firstFrame.p[1], firstFrame.p[2]);
            ghostMesh.quaternion.set(firstFrame.q[0], firstFrame.q[1], firstFrame.q[2], firstFrame.q[3]);
            ghostMesh.visible = true;
            ghostMesh.updateMatrixWorld(true);
            const camStartOffset = new THREE.Vector3(0, 4.0, 6.5);
            camStartOffset.applyMatrix4(ghostMesh.matrixWorld);
            camera.position.copy(camStartOffset);
            camera.lookAt(ghostMesh.position.x, ghostMesh.position.y + 1.5, ghostMesh.position.z);
        }

        gameTime = 0; // Reset tempo
        startCountdown(3);
    } else {
        skidmarkMeshes.forEach(m => scene.remove(m));
        skidmarkMeshes = [];

        // Reset Logico (Delete Key)
        currentCheckpointData.index = -1;
        currentCheckpointData.timeStamp = 0;
        currentRunSplits = []; // Resetta i tempi della corsa attuale

        // Trova lo start
        const startBody = trackBodies.find(b => b.isStart);
        if (startBody) {
            const spawnPosition = startBody.position.clone();
            const startOffset = new CANNON.Vec3(0, 1.3, -TRACK_CFG.blockSize / 2);
            spawnPosition.vadd(startOffset, spawnPosition);

            currentCheckpointData.position.copy(spawnPosition);
            currentCheckpointData.quaternion.copy(startBody.quaternion); // La rotazione è corretta
        } else {
            // Fallback di sicurezza se non trova lo start (non dovrebbe mai succedere)
            console.error("Blocco di partenza non trovato! Spawn di default.");
            currentCheckpointData.position.set(0, 5, -10);
            currentCheckpointData.quaternion.set(0, 0, 0, 1);
        }
        currentCheckpointData.velocity.set(0, 0, 0);
        currentCheckpointData.angularVelocity.set(0, 0, 0);

        gameTime = 0;
        uiMsg.style.display = 'none';
        doRespawn('standing');
    }
}

function setupInputs() {
    // 1. TASTIERA
    window.addEventListener('keydown', e => handleKey(e.key, true));
    window.addEventListener('keyup', e => handleKey(e.key, false));

    function handleKey(key, isPressed) {
        if (isBindingKey) return; // Se stiamo rimappando, ignora

        // Cerca azione associata
        for (const [action, binds] of Object.entries(gameSettings.keyBinds)) {
            if (binds.includes(key)) {
                // Se è un tasto continuo, aggiorna lo stato
                if ([ACTIONS.ACCEL, ACTIONS.BRAKE, ACTIONS.LEFT, ACTIONS.RIGHT].includes(action)) {
                    updateActionState(action, isPressed ? 1 : 0);
                }
                // Se è un evento ONE-SHOT (solo su pressione)
                else if (isPressed) {
                    if (action === ACTIONS.PAUSE) togglePauseGame();
                    if (action === ACTIONS.RESTART) resetTrack(false);
                    if (action === ACTIONS.RESPAWN_STAND) triggerRespawnLogic('standing');
                    if (action === ACTIONS.RESPAWN_FLY) triggerRespawnLogic('flying');
                    if (action === ACTIONS.CAM_TOGGLE) toggleCamera();
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
        const menuBtns = document.querySelectorAll('.menu-btn');
        menuBtns.forEach(btn => {
            let touchStartY = 0;
            let touchStartX = 0;

            btn.addEventListener('touchstart', (e) => {
                // Salviamo le coordinate iniziali
                touchStartY = e.touches[0].clientY;
                touchStartX = e.touches[0].clientX;
            }, { passive: true });

            btn.addEventListener('touchend', (e) => {
                if (e.cancelable) e.preventDefault(); // Previene eventi mouse fantasma
                // Calcoliamo quanto si è spostato il dito
                const endY = e.changedTouches[0].clientY;
                const endX = e.changedTouches[0].clientX;
                const diffX = Math.abs(endX - touchStartX);
                const diffY = Math.abs(endY - touchStartY);
                // Se lo spostamento è minimo (meno di 10px), lo consideriamo un click
                // Altrimenti è uno scroll e non facciamo nulla
                if (diffX < 10 && diffY < 10) {
                    btn.focus(); // Diamo focus per coerenza col controller
                    btn.click(); // Eseguiamo il click
                }
            }, { passive: false });
        });

    });
}
function updateActionState(action, val) {
    if (action === ACTIONS.ACCEL) inputState.accel = val;
    if (action === ACTIONS.BRAKE) inputState.brake = val;
    if (action === ACTIONS.LEFT) inputState.steerL = val;
    if (action === ACTIONS.RIGHT) inputState.steerR = val;
}

// Stato raw per touch direzionale (per gestire A+D premuti insieme)
let touchLeft = false, touchRight = false;
document.getElementById('btn-t-left').addEventListener('touchstart', (e) => { e.preventDefault(); touchLeft = true; });
document.getElementById('btn-t-left').addEventListener('touchend', (e) => { e.preventDefault(); touchLeft = false; });
document.getElementById('btn-t-right').addEventListener('touchstart', (e) => { e.preventDefault(); touchRight = true; });
document.getElementById('btn-t-right').addEventListener('touchend', (e) => { e.preventDefault(); touchRight = false; });
// Logica Touch Centralizzata
function handleTouchInput(action, active) {
    const btn = document.querySelector(`.touch-btn[data-action="${action}"]`);
    if (btn) {
        if (active) btn.classList.add('is-pressed');
        else btn.classList.remove('is-pressed');
    }
    if (action === 'left') inputState.steerL = active ? 1 : 0;
    if (action === 'right') inputState.steerR = active ? 1 : 0;
    if (action === 'accel') inputState.accel = active ? 1 : 0;
    if (action === 'brake') inputState.brake = active ? 1 : 0;
    if (action === 'pause' && active) { togglePauseGame(); }
    if (action === 'cam' && active) { toggleCamera(); }
    if (action === 'toggleui' && active) {
        // Inverte l'impostazione globale
        gameSettings.touchEnabled = !gameSettings.touchEnabled;
        // Aggiorna anche la checkbox nel menu opzioni (se l'utente ci andrà dopo)
        const chk = document.getElementById('chk-touch');
        if (chk) chk.checked = gameSettings.touchEnabled;
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
    if (inputState.steerL) str += 1;
    if (inputState.steerR) str -= 1;

    // 2. Gamepad Override (Analogici + Bottoni OneShot)
    if (gameSettings.gamepadEnabled) {
        const gp = navigator.getGamepads()[0];
        if (gp) {
            // Analogico Sinistro (Deadzone 0.2)
            if (Math.abs(gp.axes[0]) > 0.2) str = -gp.axes[0];

            // Trigger / Bottoni
            const btnAcc = gp.buttons[gameSettings.gamepadBinds[ACTIONS.ACCEL]];
            if (btnAcc) acc = Math.max(acc, btnAcc.value);

            const btnBrk = gp.buttons[gameSettings.gamepadBinds[ACTIONS.BRAKE]];
            if (btnBrk) brk = Math.max(brk, btnBrk.value);

            // D-Pad Steering
            if (gp.buttons[14] && gp.buttons[14].pressed) str = 1;
            if (gp.buttons[15] && gp.buttons[15].pressed) str = -1;

            // GESTIONE ONE-SHOT GAMEPAD (Senza ripetizione 60fps)
            // Usiamo un oggetto per tracciare lo stato precedente dei bottoni gamepad
            if (!window.gpPrevState) window.gpPrevState = {};

            const checkPress = (act, fn) => {
                const idx = gameSettings.gamepadBinds[act];
                const pressed = gp.buttons[idx] && gp.buttons[idx].pressed;
                if (pressed && !window.gpPrevState[act]) { fn(); }
                window.gpPrevState[act] = pressed;
            };

            checkPress(ACTIONS.PAUSE, togglePauseGame);
            checkPress(ACTIONS.RESTART, () => resetTrack(false));
            checkPress(ACTIONS.RESPAWN_STAND, () => triggerRespawnLogic('standing'));
            checkPress(ACTIONS.RESPAWN_FLY, () => triggerRespawnLogic('flying'));
            checkPress(ACTIONS.CAM_TOGGLE, toggleCamera);
        }
    }

    // Clamp valori finali
    str = Math.max(-1, Math.min(1, str));
    acc = Math.min(1, acc);
    brk = Math.min(1, brk);

    // Esporta per animate()
    window.inputAnalog = { steer: str, throttle: acc, brake: brk };
}

function toggleCamera() {
    cameraMode = (cameraMode + 1) % 2;
    if (!speedoMesh || !brakeLightL || !brakeLightR) return;
    const visualY = -0.4; // Deve matchare quello in createCar
    if (cameraMode === 1) {
        // --- MODALITÀ Prima Persona ---
        speedoMesh.position.set(0, 0.57 + visualY, -2);
        speedoMesh.rotation.x = -Math.PI / 2 ;
        speedoMesh.scale.set(0.7, 0.7, 0.7);
        brakeLightL.position.set(0, 0.501 + visualY, -2.18);
        brakeLightL.rotation.x = -Math.PI / 2;
        brakeLightL.scale.set(6.02, 0.5, 2);
        brakeLightR.visible = false;
    } else {
        // --- MODALITÀ Terza Persona ---
        speedoMesh.position.set(0, 0.5 + visualY, 1.21);
        speedoMesh.rotation.x = 0;
        speedoMesh.scale.set(1, 1, 1);
        brakeLightL.position.set(-0.5, 0.6 + visualY, 1.61);
        brakeLightL.rotation.x = 0;
        brakeLightL.scale.set(1, 1, 1);
        brakeLightR.visible = true;
    }
}

function saveRunToHistory(time) {
    const ghostDataClone = ghostDataRecording.length > 0 ? JSON.parse(JSON.stringify(ghostDataRecording)) : null;
    const record = {
        seed: currentSeed,
        version: GAME_VERSION,
        date: new Date().toLocaleString(),
        time: time,
        formattedTime: formatTime(time),
        ghostData: ghostDataClone,
        splits: currentRunSplits
    };
    console.log(ghostDataRecording);
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

    if (bestTime === null || time <= bestTime) {
        ghostDataPlayback = ghostDataClone;
        uiBestTime.innerText = `Best: ${formatTime(time)}`;
    }
}

// --- SISTEMA MENU UI ---

// Helper navigazione
function showScreen(id) {
    document.querySelectorAll('.menu-screen').forEach(el => el.style.display = 'none');
    document.getElementById(id).style.display = 'flex';
}
function handleMenuNavigation() {
    const gp = navigator.getGamepads()[0];
    if (!gp) return;
    const now = performance.now();
    if (now - lastMenuNavTime < 150) return; // Limita la velocità (debounce)
    // Recupera i tasti configurati
    const idxUp = gameSettings.gamepadBinds[ACTIONS.MENU_UP];
    const idxDown = gameSettings.gamepadBinds[ACTIONS.MENU_DOWN];
    const idxConfirm = gameSettings.gamepadBinds[ACTIONS.MENU_CONFIRM];
    // Determina se c'è input verticale (Stick ANALOGICO rimane hardcoded per comodità + D-Pad CONFIGURABILE)
    const axisY = gp.axes[1];
    // Verifica pulsanti configurati
    const dpadUp = gp.buttons[idxUp] && gp.buttons[idxUp].pressed;
    const dpadDown = gp.buttons[idxDown] && gp.buttons[idxDown].pressed;
    // Tasto Conferma configurabile
    const btnConfirm = gp.buttons[idxConfirm] && gp.buttons[idxConfirm].pressed;
    let dir = 0;
    if (axisY > 0.5 || dpadDown) dir = 1;
    if (axisY < -0.5 || dpadUp) dir = -1;
    if (dir !== 0) {
        // Trova il contenitore visibile (Menu principale o Modale Pausa)
        let visibleContainer = null;
        if (document.getElementById('fs-modal').style.display !== 'none') {
            visibleContainer = document.querySelector('#fs-modal .paused-box');
        } else if (document.getElementById('pause-modal').style.display !== 'none') {
            visibleContainer = document.querySelector('#pause-modal .paused-box');
        } else if (document.getElementById('main-menu').style.display !== 'none') {
            const screens = document.querySelectorAll('.menu-screen');
            screens.forEach(s => {
                if (s.style.display !== 'none') visibleContainer = s;
            });
        }
        if (visibleContainer) {
            // Seleziona solo i bottoni visibili e abilitati
            const buttons = Array.from(visibleContainer.querySelectorAll('button, input[type="text"], input[type="range"], input[type="checkbox"]'));
            // Trova indice del focus attuale
            let currentIndex = buttons.indexOf(document.activeElement);
            if (currentIndex === -1) {
                // Se nessuno è selezionato, seleziona il primo
                if (buttons.length > 0) buttons[0].focus();
            } else {
                // Calcola nuovo indice
                let newIndex = currentIndex + dir;
                // Clamp (non uscire dalla lista)
                if (newIndex < 0) newIndex = buttons.length - 1; // Loop
                if (newIndex >= buttons.length) newIndex = 0;    // Loop
                buttons[newIndex].focus();
                // Se è un input range, non vogliamo scorrere via subito se l'utente vuole cambiarlo,
                // ma per ora gestiamo solo la navigazione verticale focus.
            }
            playSfx('checkpoint', 2.0); // Feedback audio
            lastMenuNavTime = now;
        }
    }
    // Gestione Click (Conferma)
    if (btnConfirm) {
        if (document.activeElement && document.activeElement.click) {
            document.activeElement.click();
            lastMenuNavTime = now + 200; // Pausa extra dopo un click
        }
    }
}

window.updateFsPref = (val) => {
    localStorage.setItem('webmania_ask_fs', val ? 'true' : 'false');
    if (val) {
        const fsCheck = document.getElementById('fs-dont-ask');
        if (fsCheck) fsCheck.checked = false;
    }
    applySettings();
};
window.uiSetFullscreen = (activate) => {
    const dontAskAgain = document.getElementById('fs-dont-ask').checked;
    if (dontAskAgain) {
        localStorage.setItem('webmania_ask_fs', 'false');
        document.getElementById('opt-ask-fs').checked = false;
    }

    if (activate) {
        const docElm = document.documentElement;
        if (docElm.requestFullscreen) docElm.requestFullscreen();
        else if (docElm.webkitRequestFullscreen) docElm.webkitRequestFullscreen();
        else if (docElm.msRequestFullscreen) docElm.msRequestFullscreen();
    }

    document.getElementById('fs-modal').style.display = 'none';
    // Proseguiamo con l'apertura della schermata play
    showScreen('menu-play');
    setTimeout(() => {
        const startBtn = document.querySelector('#menu-play .menu-btn.primary');
        if (startBtn) startBtn.focus();
    }, 50);
};
window.uiOpenPlay = () => {
    const askFs = localStorage.getItem('webmania_ask_fs') !== 'false';
    const isAlreadyFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (askFs && !isAlreadyFs) {
        document.getElementById('fs-modal').style.display = 'flex';
        document.getElementById('seed-input').value = Math.random().toString(36).substring(7).toUpperCase();
        setTimeout(() => {
            const firstBtn = document.querySelector('#fs-modal .menu-btn.primary');
            if (firstBtn) firstBtn.focus();
        }, 50);
    } else {
        // Genera seed random precompilato
        document.getElementById('seed-input').value = Math.random().toString(36).substring(7).toUpperCase();
        showScreen('menu-play');
        setTimeout(() => {
            const startBtn = document.querySelector('#menu-play .menu-btn.primary');
            if (startBtn) startBtn.focus();
        }, 50);
    }
};

//RECORDS
window.uiOpenRecords = () => {
    const list = document.getElementById('records-list');
    list.innerHTML = '';
    const history = JSON.parse(localStorage.getItem(STORAGE_KEY_RECORDS) || "[]");

    if (history.length === 0) {
        list.innerHTML = '<div style="padding:20px; text-align:center; color:#888;">Nessun record trovato.</div>';
    } else {
            history.forEach((rec, index) => {
            const div = document.createElement('div');
            const recVer = parseInt(rec.version || "0");
            const minVer = parseInt(MIN_TRACK_VERSION_COMPATIBILITY);
            const isCompatible = recVer >= minVer;
            div.className = 'record-item';
            if (!isCompatible) div.classList.add('outdated');
            const importedLabel = rec.isImported ? `<span class="imported-tag">IMPORTED REPLAY</span>` : '';
            div.onclick = (e) => {
                if (e.target.tagName === 'BUTTON') return;
                navigator.clipboard.writeText(rec.seed);
                const originalText = div.querySelector('.record-seed').innerText;
                div.querySelector('.record-seed').innerText = "COPIATO!";
                setTimeout(() => div.querySelector('.record-seed').innerText = originalText, 1000);
            };
            let replayBtn = (isCompatible && rec.ghostData) ?
            `<button onclick="window.uiStartReplay('${rec.seed}')" style="background:#00aaaa;">REPLAY</button>` : '';
            let shareBtn = (isCompatible && rec.ghostData) ? 
            `<button class="btn-share" onclick="window.uiShareReplayLink('${rec.seed}')" title="Crea Link Condivisibile">🔗</button>` : '';
            div.innerHTML = `
            <div class="record-meta">
                ${rec.desc ? `<div class="record-desc">${rec.desc}</div>` : ''}
                <span class="record-seed ${rec.desc ? 'has-desc' : ''}">${rec.seed}<small>(v${recVer})</small></span>
                <span style="font-size:0.7em;">${rec.date}</span>
                ${importedLabel}
            </div>
            <div class="record-time">${rec.formattedTime}</div>
            <div class="record-actions">
            <button class="edit-desc-btn" onclick="window.uiEditDescription(${index})">✎</button>
            <button onclick="window.uiStartGame('${rec.seed}')">PLAY</button>
            ${replayBtn}
            ${shareBtn}
            </div>
            `;
            list.appendChild(div);
        });
    }
    showScreen('menu-records');
};
window.uiEditDescription = (index) => {
    let history = JSON.parse(localStorage.getItem(STORAGE_KEY_RECORDS) || "[]");
    const currentDesc = history[index].desc || "";
    const newDesc = prompt("Inserisci una descrizione per questo record:", currentDesc);
    if (newDesc !== null) {
        history[index].desc = newDesc.substring(0, 30); // Limite 30 caratteri
        localStorage.setItem(STORAGE_KEY_RECORDS, JSON.stringify(history));
        window.uiOpenRecords();
    }
};
let tempSelectionList = [];
window.uiToggleSelectAll = () => {
    const checkboxes = document.querySelectorAll('#selection-list input[type="checkbox"]');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => cb.checked = !allChecked);
    document.getElementById('btn-toggle-select').innerText = !allChecked ? "DESELEZIONA TUTTI" : "SELEZIONA TUTTI";
};
// ESPORTA RECORDS
window.uiOpenExport = () => {
    const history = JSON.parse(localStorage.getItem(STORAGE_KEY_RECORDS) || "[]");
    if (history.length === 0) return alert("Nessun record da esportare");
    renderSelectionModal(history, "ESPORTA SELEZIONATI", (selected) => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(selected));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", "webmania_records_export.json");
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
        document.getElementById('selection-modal').style.display = 'none';
    });
};
// IMPORTA RECORDS
window.uiTriggerImport = () => {
    document.getElementById('import-file-input').click();
};
document.getElementById('import-file-input').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const imported = JSON.parse(event.target.result);
            if (!Array.isArray(imported)) throw new Error("Formato non valido");
            renderSelectionModal(imported, "IMPORTA SELEZIONATI", (selected) => {
                let history = JSON.parse(localStorage.getItem(STORAGE_KEY_RECORDS) || "[]");
                selected.forEach(newItem => {
                    const exists = history.some(h => h.seed === newItem.seed && h.time === newItem.time);
                    if (!exists) {
                        newItem.isImported = true;
                        history.unshift(newItem);
                    }
                });
                    localStorage.setItem(STORAGE_KEY_RECORDS, JSON.stringify(history));
                    document.getElementById('selection-modal').style.display = 'none';
                    window.uiOpenRecords();
            });
        } catch (err) { alert("Errore nel caricamento del file JSON"); }
    };
    reader.readAsText(file);
    e.target.value = '';
};
function renderSelectionModal(data, btnText, onConfirm) {
    const modal = document.getElementById('selection-modal');
    const list = document.getElementById('selection-list');
    const confirmBtn = document.getElementById('btn-confirm-selection');
    const minVer = parseInt(MIN_TRACK_VERSION_COMPATIBILITY);
    list.innerHTML = '';
    modal.style.display = 'flex';
    confirmBtn.innerText = btnText;
    data.forEach((item, i) => {
        const row = document.createElement('div');
        const recVer = parseInt(item.version || "0");
        const isCompatible = recVer >= minVer;
        row.className = 'selection-item' + (isCompatible ? '' : ' outdated');
        const descPart = item.desc ? `${item.desc} - ` : '';
        const versionPart = `(v${item.version || '?'})${!isCompatible ? 'Outdated' : ''}`;
        const mainLabel = `${descPart}${item.seed}${versionPart}`;
        row.innerHTML = `
            <input type="checkbox" id="sel-${i}" ${isCompatible ? 'checked' : ''}>
            <label for="sel-${i}" style="color:white; font-size:14px; cursor:pointer; flex:1;">
            <div style="font-weight: bold; ${!isCompatible ? 'color: #bbb;' : 'color: #fff;'}">${mainLabel}</div>
            <div style="font-size: 12px; ${!isCompatible ? 'color: #bbb;' : 'color: #fff;'}">${item.formattedTime} - ${item.date}</div>
            </label>
        `;
        row.onclick = (e) => {
            if (e.target.tagName !== 'INPUT') {
                const cb = row.querySelector('input');
                cb.checked = !cb.checked;
            }
        };
        list.appendChild(row);
    });
    confirmBtn.onclick = () => {
        const selected = data.filter((_, i) => list.querySelectorAll('input[type="checkbox"]')[i].checked);
        if (selected.length === 0) return alert("Seleziona almeno un record");
        onConfirm(selected);
    };
}
//ghostcar
function createGhostVisuals() {
    if (ghostMesh) scene.remove(ghostMesh);
    ghostMesh = new THREE.Group();
    const ghostMat = new THREE.MeshBasicMaterial({
        color: 0xaaaaaa,
        transparent: true,
        opacity: 0.4,
        wireframe: true
    });
    const bodyGeo = new THREE.BoxGeometry(1.8, 0.4, 3.8);
    const body = new THREE.Mesh(bodyGeo, ghostMat);
    body.position.y = 0.1;
    const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.6, 16);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelY = -0.3;
    const pos = [
        [1.1, wheelY, -1.6], [-1.1, wheelY, -1.6],
        [1.1, wheelY, 1.1], [-1.1, wheelY, 1.1]
    ];
    pos.forEach(p => {
        const w = new THREE.Mesh(wheelGeo, ghostMat);
        w.position.set(...p);
        ghostMesh.add(w);
    });
    ghostMesh.add(body);
    ghostMesh.visible = false;
    scene.add(ghostMesh);
}
window.uiStartReplay = (seed) => {
    const history = JSON.parse(localStorage.getItem(STORAGE_KEY_RECORDS) || "[]");
    const rec = history.find(r => r.seed === seed);
    if (!rec || !rec.ghostData) { alert("No Replay"); return; }
    isReplayMode = true;
    window.keepReplayFlag = true;
    window.uiStartGame(seed);
};
window.toggleGhostInGame = () => {
    if (!ghostDataPlayback) {
        alert("Nessun fantasma disponibile per questa pista.");
        return;
    }
    gameSettings.ghostEnabled = !gameSettings.ghostEnabled;
    const btn = document.getElementById('btn-toggle-ghost');
    if (btn) btn.innerText = `GHOST: ${gameSettings.ghostEnabled ? 'ON' : 'OFF'}`;
    const chk = document.getElementById('opt-ghost-enabled');
    if (chk) chk.checked = gameSettings.ghostEnabled;
    saveSettings();
    window.uiResume();
};


window.uiOpenOptions = () => showScreen('menu-options');
window.uiBackToHome = () => showScreen('menu-home');

window.uiStartGame = (forceSeed = null) => {
    if (!window.keepReplayFlag) isReplayMode = false;
    window.keepReplayFlag = false;
    const inputSeed = document.getElementById('seed-input').value.trim();
    const finalSeed = forceSeed || inputSeed || "random";
    // --- AUDIO START ---
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    manageMusic('start_new_track'); // Avvia nuova traccia
    startCarSounds(); // Prepara i loop motore/skid
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

    generateTrack(physicsMaterials.ground, physicsMaterials.turbo, finalSeed);
    resetTrack(false); // Posiziona auto e start countdown
    updateTouchVisibility();
};

window.uiTogglePause = () => {
    if (currentState === GAME_STATE.PAUSED) {
        window.uiResume();
    } else {
        manageMusic('pause');
        if (engineGain) engineGain.gain.value = 0;
        if (skidGain) skidGain.gain.value = 0;
        document.getElementById('pause-modal').style.display = 'flex';
        const history = JSON.parse(localStorage.getItem(STORAGE_KEY_RECORDS) || "[]");
        const rec = history.find(r => r.seed === currentSeed);
        const canRespawn = (currentState !== GAME_STATE.FINISHED && currentCheckpointData.index > 0);
        const displayMode = canRespawn ? 'flex' : 'none';
        document.getElementById('btn-respawn-div').style.display = displayMode;
        const btnGhost = document.getElementById('btn-toggle-ghost');
        if (!rec || !rec.ghostData || rec.ghostData.length === 0) {
            btnGhost.style.display = 'none';
        } else {
            btnGhost.style.display = 'block';
            btnGhost.innerText = `REPLAY GHOSTCAR: ${gameSettings.ghostEnabled ? 'ON' : 'OFF'}`;
        }
        currentState = GAME_STATE.PAUSED;        
    }
    updateTouchVisibility();
};

window.uiResume = () => {
    currentState = GAME_STATE.RACING;
    manageMusic('resume');
    if (gameTime <= 0) currentState = GAME_STATE.START;
    document.getElementById('pause-modal').style.display = 'none';
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
    stopCarSounds();     // Ferma motore
    manageMusic('stop'); // Ferma musica

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

    if (id === 'opt-keys') renderKeyBinds();
    if (id === 'opt-gamepad') renderGamepadStatus();
};

window.updateSetting = (key, val) => {
    gameSettings[key] = val;
    if (key === 'renderHeight') {
        document.getElementById('val-render-height').innerText = val + "p";
        onWindowResize();
    }
    if (key === 'renderDistance') document.getElementById('val-render-dist').innerText = val;
    if (key === 'maxSkidmarks') document.getElementById('val-max-skids').innerText = val;
    if (key === 'maxRecords') document.getElementById('val-max-records').innerText = val;

    if (key === 'antialias') {
        saveSettings();
        if (confirm("Cambiare l'antialiasing richiede un riavvio della pagina. Ricaricare ora?")) {
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
        [ACTIONS.LEFT]: 'Sinistra',
        [ACTIONS.RIGHT]: 'Destra',
        [ACTIONS.RESPAWN_FLY]: 'Respawn Chekpoint (Movimento)',
        [ACTIONS.RESPAWN_STAND]: 'Respawn Chekpoint (Stazionario)',
        [ACTIONS.RESTART]: 'Ricomincia Pista',
        [ACTIONS.PAUSE]: 'Pausa'
    };

    for (const [action, keys] of Object.entries(gameSettings.keyBinds)) {
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
    if (!key) return '---';
    if (key === ' ') return 'SPACE';
    if (key.startsWith('Arrow')) return key.replace('Arrow', 'Freccia ');
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
    document.getElementById('binding-msg').innerText = "PREMI UN TASTO...";
    isBindingKey = false;
    isBindingGamepad = false;
    window.gpBindWaitRelease = false;
}

window.addEventListener('keydown', (e) => {
    if (!isBindingKey) return;
    e.preventDefault();
    e.stopPropagation(); // Evita che il gioco reagisca

    if (e.key === 'Escape') {
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
let startX = 0, startY = 0;
let startLeft = 0, startTop = 0;
document.getElementById('touch-size-slider').addEventListener('input', (e) => {
    if (selectedEl) {
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
        if (currentTransform && currentTransform.includes('scale')) {
            const match = currentTransform.match(/scale\(([^)]+)\)/);
            if (match) currentScale = parseFloat(match[1]);
        }
        btn.dataset.tempScale = currentScale;
    });
};
window.uiCloseTouchEditor = () => {
    document.getElementById('touch-editor-overlay').style.display = 'none';
    const ctrl = document.getElementById('touch-controls');
    ctrl.style.zIndex = '';
    const layout = {};
    const buttonIds = ['btn-t-left', 'btn-t-right', 'btn-t-accel', 'btn-t-brake', 'btn-t-pause', 'btn-t-toggle', 'btn-t-cam'];
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    buttonIds.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.classList.remove('editable-btn', 'selected-btn');
            const rect = btn.getBoundingClientRect();
            const currentScale = parseFloat(btn.dataset.tempScale || 1.0);
            // 1. Troviamo il centro (immutabile)
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            // 2. Calcoliamo i bordi del box ORIGINALE (scala 1.0)
            const halfW = (rect.width / currentScale) / 2;
            const halfH = (rect.height / currentScale) / 2;
            const unscaledLeft = centerX - halfW;
            const unscaledRight = centerX + halfW;
            const unscaledTop = centerY - halfH;
            const unscaledBottom = centerY + halfH;
            let params = { scale: currentScale };
            // 3. Conversione in VH basata sui bordi reali non scalati
            if (centerX > winW / 2) {
                params.right = (((winW - unscaledRight) / winH) * 100).toFixed(2) + "vh";
                params.left = 'auto';
            } else {
                params.left = ((unscaledLeft / winH) * 100).toFixed(2) + "vh";
                params.right = 'auto';
            }
            if (centerY > winH / 2) {
                params.bottom = (((winH - unscaledBottom) / winH) * 100).toFixed(2) + "vh";
                params.top = 'auto';
            } else {
                params.top = ((unscaledTop / winH) * 100).toFixed(2) + "vh";
                params.bottom = 'auto';
            }
            layout[id] = params;
            btn.style.left = params.left;
            btn.style.right = params.right;
            btn.style.top = params.top;
            btn.style.bottom = params.bottom;
        }
    });
    gameSettings.touchLayout = layout;
    console.log("Configurazione Touch salvata:\n", layout);
    saveSettings();
};
window.resetTouchDefault = () => {
    gameSettings.touchLayout = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.touchLayout));
    document.querySelectorAll('.touch-btn').forEach(btn => btn.style = "");
    saveSettings();
}
function selectBtn(btn) {
    if (selectedEl) selectedEl.classList.remove('selected-btn');
    selectedEl = btn;
    const label = document.getElementById('selected-btn-name');
    const slider = document.getElementById('touch-size-slider');
    if (selectedEl) {
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
    if (currentState !== GAME_STATE.MENU && document.getElementById('touch-editor-overlay').style.display !== 'flex') return;
    e.preventDefault();
    if (e.type === 'touchstart') e.stopPropagation();
    const target = e.target.closest('.touch-btn');
    if (!target) return;
    draggedEl = target;
    selectBtn(draggedEl);
    startX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
    startY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
    const rect = draggedEl.getBoundingClientRect();
    const currentScale = parseFloat(draggedEl.dataset.tempScale || 1.0);
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const unscaledWidth = rect.width / currentScale;
    const unscaledHeight = rect.height / currentScale;
    startLeft = centerX - unscaledWidth / 2;
    startTop = centerY - unscaledHeight / 2;
    draggedEl.style.right = 'auto';
    draggedEl.style.bottom = 'auto';
    draggedEl.style.left = startLeft + 'px';
    draggedEl.style.top = startTop + 'px';
    window.addEventListener('mousemove', dragMove);
    window.addEventListener('touchmove', dragMove, { passive: false });
    window.addEventListener('mouseup', dragEnd);
    window.addEventListener('touchend', dragEnd);
}
function dragMove(e) {
    if (!draggedEl) return;
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

// Gamepad Settings
function renderGamepadStatus() {
    const el = document.getElementById('gamepad-status');
    const gp = navigator.getGamepads()[0];
    const list = document.getElementById('gamepad-binds-list');
    if (gp) {
        el.innerText = `Connesso: ${gp.id}`;
        el.style.color = '#00ff00';
        if (list.innerHTML === '') renderGamepadBinds();
    } else {
        el.innerText = "Premi un tasto sul controller...";
        el.style.color = '#ffff00';
        list.innerHTML = ''; // Pulisci la lista se disconnesso
        requestAnimationFrame(renderGamepadStatus);
    }
}
window.renderGamepadBinds = () => {
    const list = document.getElementById('gamepad-binds-list');
    list.innerHTML = '';
    const friendlyNames = {
        [ACTIONS.ACCEL]: 'Acceleratore',
        [ACTIONS.BRAKE]: 'Freno / Retro',
        [ACTIONS.RESPAWN_FLY]: 'Respawn (Flying)',
        [ACTIONS.RESPAWN_STAND]: 'Respawn (Standing)',
        [ACTIONS.RESTART]: 'Ricomincia',
        [ACTIONS.PAUSE]: 'Pausa',
        [ACTIONS.MENU_CONFIRM]: 'Menu: Conferma (X/A)',
        [ACTIONS.MENU_UP]: 'Menu: Su',
        [ACTIONS.MENU_DOWN]: 'Menu: Giù'
    };
    // Filtra solo le azioni che hanno un binding per gamepad
    for (const [action, currentIdx] of Object.entries(gameSettings.gamepadBinds)) {
        if (!friendlyNames[action]) continue; // Salta azioni non mappabili se ce ne sono
        const row = document.createElement('div');
        row.className = 'bind-row';
        const label = document.createElement('span');
        label.className = 'bind-label';
        label.innerText = friendlyNames[action];

        const btn = document.createElement('button');
        btn.className = 'bind-btn';
        btn.innerText = getGpBtnName(currentIdx);
        btn.onclick = () => startGamepadBinding(action);

        row.appendChild(label);
        row.appendChild(btn);
        list.appendChild(row);
    }
};
let isBindingGamepad = false;
let gpBindAction = null;
function startGamepadBinding(action) {
    isBindingGamepad = true;
    gpBindAction = action;
    window.gpBindWaitRelease = true;
    const overlay = document.getElementById('binding-overlay');
    const msg = document.getElementById('binding-msg');
    msg.innerText = "PREMI IL NUOVO TASTO SUL CONTROLLER...";
    overlay.style.display = 'flex';
    checkForGamepadInput();
}
function checkForGamepadInput() {
    if (!isBindingGamepad) return;
    const gp = navigator.getGamepads()[0];
    if (gp) {
        const pressedIndex = gp.buttons.findIndex(b => b.pressed);
        if (window.gpBindWaitRelease) {
            if (pressedIndex === -1) {
                window.gpBindWaitRelease = false;
            }
        }
        else {
            if (pressedIndex !== -1) {
                applyGamepadBind(pressedIndex);
                return;
            }
        }
    }
    requestAnimationFrame(checkForGamepadInput);
}
function applyGamepadBind(newIndex) {
    gameSettings.gamepadBinds[gpBindAction] = newIndex;
    saveSettings();
    isBindingGamepad = false;
    window.gpBindWaitRelease = false;
    document.getElementById('binding-overlay').style.display = 'none';
    document.getElementById('binding-msg').innerText = "PREMI UN TASTO..."; // Reset msg
    renderGamepadBinds();
}
window.resetGamepadDefaults = () => {
    gameSettings.gamepadBinds = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.gamepadBinds));
    saveSettings();
    renderGamepadBinds();
};


//menu personalizza macchina
window.initPreview = () => {
    // Se il renderer esiste già, non fare nulla. La logica di setup è già a posto.
    if (previewRenderer) return;

    const container = document.getElementById('car-preview-container');
    const width = container.offsetWidth;
    const height = container.offsetHeight;

    previewScene = new THREE.Scene();
    previewScene.background = new THREE.Color(0x222222);
    previewScene.background = new THREE.Color(0x87CEEB);
    previewCamera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    previewCamera.position.set(0, 1.5, 8);
    previewCamera.lookAt(0, 0, 0);

    previewRenderer = new THREE.WebGLRenderer({ antialias: true });
    previewRenderer.setSize(width, height);
    container.appendChild(previewRenderer.domElement);

    // Luci Preview
    const pAmb = new THREE.AmbientLight(0xffffff, 0.8);
    const pDir = new THREE.DirectionalLight(0xffffff, 1);
    pDir.position.set(5, 5, 5);
    previewScene.add(pAmb, pDir);
};
function animatePreview() {
    if (!isPreviewActive) return;
    requestAnimationFrame(animatePreview);
    if (carPreviewGroup) {
        previewAngle += 0.01;
        carPreviewGroup.rotation.y = previewAngle;
    }
    previewRenderer.render(previewScene, previewCamera);
}
window.uiOpenCustomize = () => {
    // Apri la schermata del menu
    window.uiOpenSubMenu('opt-customize');
    // Assicurati che l'ambiente di preview sia inizializzato
    setTimeout(() => {
        window.initPreview();
        if (!carPreviewGroup) {
            carPreviewGroup = new THREE.Group();
        }
        // Svuota il gruppo da eventuali resti precedenti
        while (carPreviewGroup.children.length > 0) {
            carPreviewGroup.remove(carPreviewGroup.children[0]);
        }
        // 1. Prendi in prestito il TELAIO, aggiungilo al gruppo e resetta la sua posizione locale
        carPreviewGroup.add(chassisMesh);
        chassisMesh.position.set(0, 0, 0);
        chassisMesh.quaternion.set(0, 0, 0, 1);
        // 2. Prendi in prestito le RUOTE e POSIZIONALE MANUALMENTE
        vehicle.wheelInfos.forEach(w => {
            // Aggiungi la mesh della ruota al gruppo di preview
            carPreviewGroup.add(w.mesh);
            // Calcola la posizione Y corretta del centro della ruota
            // Partiamo dal punto di connessione della sospensione (w.chassisConnectionPointLocal.y)
            // e scendiamo della lunghezza a riposo della sospensione (w.suspensionRestLength)
            const wheelCenterY = w.chassisConnectionPointLocal.y - w.suspensionRestLength;

            // Imposta la posizione della ruota usando le coordinate salvate nella fisica
            w.mesh.position.set(
                w.chassisConnectionPointLocal.x,
                wheelCenterY,
                w.chassisConnectionPointLocal.z
            );
            // Resetta la rotazione della ruota per una vista "da garage" pulita
            w.mesh.quaternion.set(0, 0, 0, 1);
        });
        // 3. Aggiungi il gruppo completo alla scena della preview
        previewScene.add(carPreviewGroup);
        // Centra il gruppo nella vista
        carPreviewGroup.position.set(0, -1, 0); // Leggero offset Y per centrare verticalmente
        previewAngle = 0;
        // Avvia il loop di rendering della preview
        isPreviewActive = true;
        animatePreview();
    }, 50);
    // Popola i colori come prima
    document.getElementById('col-body').value = gameSettings.carColors.body;
    document.getElementById('col-wheels').value = gameSettings.carColors.wheels;
    document.getElementById('col-rims').value = gameSettings.carColors.rims;
    document.getElementById('col-spoiler').value = gameSettings.carColors.spoiler;
    document.getElementById('col-speedo').value = gameSettings.carColors.speedo || "#ffffff";
};
window.uiCloseCustomize = () => {
    isPreviewActive = false; // Ferma il loop di rendering della preview
    // 1. RESTITUISCI GLI OGGETTI ALLA SCENA PRINCIPALE
    // Iteriamo all'indietro per evitare problemi mentre si rimuovono elementi
    for (let i = carPreviewGroup.children.length - 1; i >= 0; i--) {
        const object = carPreviewGroup.children[i];
        scene.add(object); // Aggiungendoli a 'scene', vengono rimossi da 'carPreviewGroup'
    }
    // 2. RIMUOVI IL GRUPPO VUOTO DALLA SCENA PREVIEW
    previewScene.remove(carPreviewGroup);
    // Torna al menu opzioni
    window.uiOpenOptions();
};
window.updateCarColor = (part, val) => {
    gameSettings.carColors[part] = val;
    applyCarColors();
};
window.saveCustomize = () => {
    saveSettings();
    alert("Configurazione Salvata!");
};
window.resetCustomize = () => {
    gameSettings.carColors = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.carColors));
    // Aggiorna UI input
    document.getElementById('col-body').value = gameSettings.carColors.body;
    document.getElementById('col-wheels').value = gameSettings.carColors.wheels;
    document.getElementById('col-rims').value = gameSettings.carColors.rims;
    document.getElementById('col-spoiler').value = gameSettings.carColors.spoiler;
    document.getElementById('col-speedo').value = gameSettings.carColors.speedo;
    applyCarColors();
    saveSettings();
};

// --- AUDIO MANAGER ---
function initAudioSystem() {
    window.AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();
    // Carica tutti gli SFX in memoria (Buffer)
    for (const [key, path] of Object.entries(AUDIO_FILES)) {
        if (key === 'music') continue;
        fetch(path)
            .then(response => response.arrayBuffer())
            .then(arrayBuffer => audioCtx.decodeAudioData(arrayBuffer))
            .then(audioBuffer => {
                sfxBuffers[key] = audioBuffer;
            })
            .catch(e => console.error("Errore caricamento audio: " + path, e));
    }

    //sblocco audio nel caso in cui apro un link diretto a una pista
    const resumeAudio = () => {
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume().then(() => {
                console.log("AudioContext sbloccato con successo");
                // Se la musica doveva essere in riproduzione ma era bloccata, riproviamo
                if (isMusicPlaying && musicElement.paused) {
                    musicElement.play();
                }
                // Se i suoni dell'auto non erano partiti, avviamoli
                if (currentState !== GAME_STATE.MENU) {
                    startCarSounds();
                }
            });
        }
        // Rimuoviamo i listener dopo la prima interazione riuscita
        window.removeEventListener('click', resumeAudio);
        window.removeEventListener('keydown', resumeAudio);
        window.removeEventListener('touchstart', resumeAudio);
    };
    window.addEventListener('click', resumeAudio);
    window.addEventListener('keydown', resumeAudio);
    window.addEventListener('touchstart', resumeAudio);

    // Setup Musica
    musicElement.loop = false;
    musicElement.onended = () => {
        if (isMusicPlaying) manageMusic('start_new_track');
    };
    musicElement.volume = gameSettings.musicVolume;
}
function playSfx(name, volumeScale = 1.0) {
    if (!audioCtx || !sfxBuffers[name]) return;
    // Resume context se sospeso (succede su Chrome finché l'utente non interagisce)
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const source = audioCtx.createBufferSource();
    source.buffer = sfxBuffers[name];

    const gainNode = audioCtx.createGain();
    gainNode.gain.value = gameSettings.sfxVolume * volumeScale;

    source.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    source.start(0);
}
// Gestione Suoni Motore e Sgommata (Loop)
function startCarSounds() {
    if (!audioCtx || engineSource) return;
    // Motore
    if (sfxBuffers['engine']) {
        engineSource = audioCtx.createBufferSource();
        engineSource.buffer = sfxBuffers['engine'];
        engineSource.loop = true;

        engineGain = audioCtx.createGain();
        engineGain.gain.value = 0; // Parte muto

        engineSource.connect(engineGain);
        engineGain.connect(audioCtx.destination);
        engineSource.start(0);
    }
    // Sgommata
    if (sfxBuffers['skid']) {
        skidSource = audioCtx.createBufferSource();
        skidSource.buffer = sfxBuffers['skid'];
        skidSource.loop = true;

        skidGain = audioCtx.createGain();
        skidGain.gain.value = 0; // Parte muto

        skidSource.connect(skidGain);
        skidGain.connect(audioCtx.destination);
        skidSource.start(0);
    }
}
function stopCarSounds() {
    if (engineSource) { engineSource.stop(); engineSource = null; }
    if (skidSource) { skidSource.stop(); skidSource = null; }
}
function manageMusic(action) {
    if (action === 'start_new_track') {
        // Logica rotazione musica
        if (currentMusicIndex === -1) {
            // Prima volta assoluta: Random
            currentMusicIndex = Math.floor(Math.random() * AUDIO_FILES.music.length);
        } else {
            // Successive: Sequenziale
            currentMusicIndex = (currentMusicIndex + 1) % AUDIO_FILES.music.length;
        }

        musicElement.src = AUDIO_FILES.music[currentMusicIndex];
        musicElement.volume = gameSettings.musicVolume;
        musicElement.play().catch(e => console.log("Music play blocked", e));
        isMusicPlaying = true;
    }
    else if (action === 'stop') {
        musicElement.pause();
        musicElement.currentTime = 0;
        isMusicPlaying = false;
    }
    else if (action === 'pause') {
        musicElement.volume = gameSettings.musicVolume * 0.3; // Abbassa volume
    }
    else if (action === 'resume') {
        musicElement.volume = gameSettings.musicVolume; // Ripristina volume
    }
}
// Funzione speciale per l'UI settings per aggiornare realtime
window.updateAudioSetting = (key, val) => {
    window.updateSetting(key, val);
    const num = parseFloat(val);
    if (key === 'musicVolume') {
        document.getElementById('val-vol-music').innerText = Math.round(num * 100) + "%";
        // Se siamo in pausa, il volume deve restare basso, altrimenti normale
        if (currentState === GAME_STATE.PAUSED) musicElement.volume = num * 0.3;
        else musicElement.volume = num;
    }
    if (key === 'sfxVolume') {
        document.getElementById('val-vol-sfx').innerText = Math.round(num * 100) + "%";
        playSfx('checkpoint'); // Suono di test
    }
};
document.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON' && e.target.classList.contains('menu-btn')) {
        playSfx('checkpoint', 0.5); // Usa il suono checkpoint come click (o uno dedicato)
    }
});

// --- SISTEMA DI CONDIVISIONE REPLAY TRAMITE URL ---
let pendingImportData = null; // Variabile temporanea per il replay in arrivo
function handleSharedReplay(compressedString) {
    try {
        // 1. Decompressione
        const jsonString = LZString.decompressFromEncodedURIComponent(compressedString);
        if (!jsonString) throw new Error("Decompressione fallita");
        
        const data = JSON.parse(jsonString);
        
        // 2. Controllo Versione
        const recVer = parseInt(data.v || "0");
        const minVer = parseInt(MIN_TRACK_VERSION_COMPATIBILITY);
        
        if (recVer < minVer) {
            alert(`Impossibile importare: il replay è di una versione vecchia (v${recVer}). Richiesta v${minVer}+.`);
            // Pulisci l'URL per evitare loop se l'utente ricarica
            history.pushState("", document.title, window.location.pathname + window.location.search);
            return;
        }

        // 3. Mostra Anteprima nel Menu
        pendingImportData = data;
        document.getElementById('import-meta-desc').innerText = data.d ? `"${data.d}"` : "";
        document.getElementById('import-meta-seed').innerText = "SEED: " + data.s;
        document.getElementById('import-meta-time').innerText = "TEMPO: " + formatTime(data.t);
        document.getElementById('import-meta-ver').innerText = `Versione Replay: v${data.v}`;
        
        // Nascondi gli altri menu e mostra quello di importazione
        document.querySelectorAll('.menu-screen').forEach(el => el.style.display = 'none');
        document.getElementById('menu-import-confirm').style.display = 'flex';
        document.getElementById('main-menu').style.display = 'flex'; // Assicura che l'overlay sia visibile

    } catch (e) {
        console.error(e);
        alert("Link di condivisione non valido o corrotto.");
        history.pushState("", document.title, window.location.pathname + window.location.search);
    }
}
window.uiCancelImport = () => {
    pendingImportData = null;
    history.pushState("", document.title, window.location.pathname + window.location.search);
    window.uiBackToHome();
};
window.uiConfirmImport = () => {
    if (!pendingImportData) return;
    
    const historyData = JSON.parse(localStorage.getItem(STORAGE_KEY_RECORDS) || "[]");
    
    // Costruiamo l'oggetto record standard
    const newRecord = {
        seed: pendingImportData.s,
        version: pendingImportData.v,
        date: new Date().toLocaleString(),
        time: pendingImportData.t,
        formattedTime: formatTime(pendingImportData.t),
        ghostData: pendingImportData.g,
        splits: pendingImportData.sp,
        desc: pendingImportData.d || "",
        isImported: true
    };

    // Controllo esistenza
    const existingIndex = historyData.findIndex(r => r.seed === newRecord.seed);
    
    if (existingIndex >= 0) {
        const existing = historyData[existingIndex];
        // Se esiste, chiedi conferma
        const msg = `Hai già un record per questo seed (${existing.formattedTime}).\nIl replay condiviso è: ${newRecord.formattedTime}.\n\nVuoi SOVRASCRIVERE il tuo record?`;
        if (!confirm(msg)) {
            return; // Utente annulla
        }
        // Sovrascrivi
        historyData[existingIndex] = newRecord;
    } else {
        // Aggiungi in cima
        historyData.unshift(newRecord);
        // Limita a 100
        if (historyData.length > 100) historyData = historyData.slice(0, 100);
    }

    localStorage.setItem(STORAGE_KEY_RECORDS, JSON.stringify(historyData));
    
    // Reset e vai ai record
    pendingImportData = null;
    history.pushState("", document.title, window.location.pathname + window.location.search); // Pulisci URL
    window.uiOpenRecords(); // Mostra la lista aggiornata
};
// Funzione per generare il link (Export)
window.uiShareReplayLink = (seed) => {
    const historyData = JSON.parse(localStorage.getItem(STORAGE_KEY_RECORDS) || "[]");
    const rec = historyData.find(r => r.seed === seed);
    
    if (!rec) { alert("Errore: record non trovato."); return; }

    // Creiamo un oggetto "minificato" per risparmiare caratteri nell'URL
    const shareObj = {
        v: rec.version,
        s: rec.seed,
        t: rec.time,
        g: rec.ghostData,
        sp: rec.splits,
        d: rec.desc
    };

    try {
        const jsonStr = JSON.stringify(shareObj);
        const compressed = LZString.compressToEncodedURIComponent(jsonStr);
        
        const shareUrl = `${window.location.origin}${window.location.pathname}#share=${compressed}`;
        
        // Copia nella clipboard
        navigator.clipboard.writeText(shareUrl).then(() => {
            alert("LINK COPIATO NEGLI APPUNTI!\n\nInvia questo URL a un amico per sfidarlo.");
        }, (err) => {
            prompt("Copia questo link:", shareUrl);
        });

    } catch (e) {
        console.error(e);
        alert("Errore durante la generazione del link (Replay troppo grande?)");
    }
};

// Init
init();
