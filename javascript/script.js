import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// --- CONFIGURAZIONE GLOBALE ---
const CONFIG = {
    stepFrequency: 60,
    gravity: -25,
    chassisWidth: 2.0,
    chassisHeight: 0.5,
    chassisLength: 4.2,
    mass: 500,
    engineForce: 2000,
    brakeForce: 75,
    maxSteerVal: 0.30,
    suspensionStiffness: 40,
    suspensionRestLength: 0.4,
    frictionSlip: 2.0,
};

// --- VARIABILI GLOBALI ---
let scene, camera, renderer, world;
let vehicle, chassisMesh;
let chassisBody; // Riferimento diretto al corpo fisico
let lastCheckpointPosition = new CANNON.Vec3(0, 5, 0);
let lastCheckpointQuaternion = new CANNON.Quaternion();
let timerStart = 0;
let isRacing = false;
let keys = { w: false, a: false, s: false, d: false, space: false };
const trackMeshes = [];
const trackBodies = [];

// Elementi UI
const uiTimer = document.getElementById('timer');
const uiMsg = document.getElementById('message');

function init() {
    try {
        // 1. Setup Three.js
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x87CEEB);
        scene.fog = new THREE.Fog(0x87CEEB, 20, 150);

        camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
        camera.position.set(0, 10, -20); // Posizione iniziale di debug
        camera.lookAt(0, 0, 0);

        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        document.getElementById('game-container').appendChild(renderer.domElement);

        // Luci
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(50, 100, 50);
        dirLight.castShadow = true;
        scene.add(dirLight);

        // 2. Setup Cannon.js (Fisica)
        world = new CANNON.World();
        world.gravity.set(0, CONFIG.gravity, 0);
        world.broadphase = new CANNON.SAPBroadphase(world);

        // Materiali
        const groundMat = new CANNON.Material('ground');
        const turboMat = new CANNON.Material('turbo');

        const wheelMat = new CANNON.Material('wheel');
        const wheelGroundContact = new CANNON.ContactMaterial(wheelMat, groundMat, {
            friction: 0.3,
            restitution: 0,
            contactEquationStiffness: 1000
        });
        const wheelTurboContact = new CANNON.ContactMaterial(wheelMat, turboMat, {
            friction: 0.3, restitution: 0, contactEquationStiffness: 1000
        });
        world.addContactMaterial(wheelGroundContact);
        world.addContactMaterial(wheelTurboContact);

        // 3. Setup Gioco
        setupInputs();
        generateTrack(groundMat, turboMat);
        createCar(wheelMat);

        // Avvia loop
        timerStart = performance.now();
        animate();

        // UI Listener
        document.getElementById('gen-btn').addEventListener('click', () => {window.location.reload();})

        setTimeout(() => {
            // Forza la posizione al centro del primo blocco (-10)
            lastCheckpointPosition.set(0, 5, -10); 
            lastCheckpointQuaternion.set(0, 0, 0, 1);
            respawn();
            console.log("Auto posizionata allo start.");
        }, 100);


        console.log("Gioco Inizializzato Correttamente");

    } catch (e) {
        console.error(e);
        document.getElementById('error-log').style.display = 'block';
        document.getElementById('error-log').innerText = "Errore Init: " + e.message;
    }
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
    maxRampSlope: 0.6, // Pendenza massima (evita muri verticali)
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
        const totalH = params.height || 10;
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

    // --- CURVA CON CUNEI (NO GAP) ---
    turn: (container, body, params) => {
        const isLeft = params.isLeft;
        const r = params.radius;
        const width = params.width || TRACK_CFG.blockSize;
        const segments = 12; // Aumentiamo i segmenti per fluidità
        const angleTotal = Math.PI / 2;
        const angleStep = angleTotal / segments;

        // Parametri per il cuneo
        // Larghezza esterna e interna del segmento trapezoidale
        // rOuter = r + width/2, rInner = r - width/2
        // Corda esterna ~ 2 * rOuter * sin(angleStep/2)
        // Corda interna ~ 2 * rInner * sin(angleStep/2)

        const rOuter = r + width/2;
        const rInner = r - width/2;
        const chordOuter = 2 * rOuter * Math.tan(angleStep/2) + 0.1; // +0.1 sovrapposizione sicurezza
        const chordInner = 2 * rInner * Math.tan(angleStep/2) + 0.1;

        for (let i = 0; i < segments; i++) {
            const theta = (i * angleStep) + (angleStep / 2);
            const sign = isLeft ? 1 : -1;
            const angle = theta * sign;

            // Posizione centro del segmento
            const dx = (r * (1 - Math.cos(theta))) * (isLeft ? -1 : 1);
            const dz = -r * Math.sin(theta);

            const segPos = new CANNON.Vec3(dx, 0, dz);
            const segRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);

            // Aggiunta CUNEO FISICO (Trapezio)
            // Se è Left, la parte stretta (Inner) è a sinistra locale (+X locale) ?
            // In Three/Cannon coordinate:
            // Sinistra (-X), Destra (+X).
            // Curva a sinistra: Interno è a Sinistra (-X). Quindi wLeft < wRight.
            // Attenzione all'orientamento del cuneo.

            let wBack, wFront;
            // Usiamo simmetria: il trapezio è simmetrico rispetto al suo asse Z locale.
            // wOuter è la base maggiore, wInner base minore.
            // I cunei risolvono il gap.

            const shape = createTrapezoidPhysics(chordOuter, chordInner, 0.5, width, 0); // Scambiamo assi: Lunghezza è Width stradale, larghezze sono le corde

            // NOTA: createTrapezoidPhysics crea un cuneo lungo Z con larghezze w1 e w2.
            // Noi vogliamo un cuneo orientato trasversalmente? No, seguiamo la strada.
            // Strada va lungo -Z.
            // Larghezza strada è X.
            // Nella curva, la "Larghezza" visiva del trapezio varia lungo X? No.
            // Il trapezio ha larghezza costante (Width strada) ma lunghezza variabile (Corde).
            // Quindi: Lungo X (larghezza strada) è costante. Lungo Z (direzione marcia) varia.
            // Z-Back (verso origine curva), Z-Front (verso uscita).
            // Z-Left side (interno curva Sx) deve essere corto. Z-Right side lungo.

            // Soluzione semplice: Costruiamo il cuneo ruotato.
            // w1 (Back width) e w2 (Front width) nella funzione trapezio sono larghezze X.
            // Qui invece variano le lunghezze Z.

            // Usiamo ConvexPolyhedron custom diretto sui 4 punti del pavimento
            const localR = new THREE.Matrix4().makeRotationY(angle);
            // Non serve complicarsi, usiamo il trapezio helper ruotandolo di 90 gradi se necessario
            // Oppure, semplicemente:
            // Cuneo orientato normale: base maggiore wOuter, base minore wInner.
            // Questo riempie il gap.

            // Parametri corretti per createTrapezoid (qui "len" è la larghezza strada, w1/w2 sono le lunghezze d'arco)
            // w1 (back) e w2 (front) uguali? No.
            // Un segmento di anello è un trapezio isoscele se "srotolato"?
            // No, è un prisma dove la faccia interna è più corta di quella esterna.

            // Definiamo i vertici esatti del segmento curvo nello spazio locale del blocco curva
            // e li aggiungiamo al body principale (che è statico a 0,0,0 nel container)
            // MA il container è già posizionato e ruotato.
            // Lavoriamo in spazio locale del container (dx, dz).

            // Semplificazione:
            // Usiamo il trapezio con:
            // width = larghezza strada
            // len = media delle corde
            // E applichiamo uno skew? No.

            // Torniamo al pratico: createTrapezoidPhysics accetta w1(back) e w2(front).
            // Noi vogliamo w(left) e w(right).
            // Ruotiamo il cuneo di 90 gradi.

            const mesh = createTrapezoidMesh(chordOuter, chordInner, 0.5, width, TRACK_CFG.colors.road);
            const shapePoly = createTrapezoidPhysics(chordOuter, chordInner, 0.5, width);

            // Orientamento: La base maggiore (chordOuter) deve stare all'esterno.
            // Se Curva SX: Esterno è Destra (+X). Interno (-X).
            // createTrapezoid ha w1 (-Z?), w2 (+Z?).
            // Ruotiamo di -90 gradi su Y.
            // Cosi w1/w2 diventano Left/Right.
            // w1 è Back (-Z ruotato -> +X), w2 è Front (+Z ruotato -> -X).

            // Facciamo prima a passare i vertici manuali per ogni segmento:
            const pInnerBack = new CANNON.Vec3(isLeft ? -width/2 : width/2, 0, -chordInner/2);
            const pInnerFront = new CANNON.Vec3(isLeft ? -width/2 : width/2, 0, chordInner/2);
            const pOuterBack = new CANNON.Vec3(isLeft ? width/2 : -width/2, 0, -chordOuter/2);
            const pOuterFront = new CANNON.Vec3(isLeft ? width/2 : -width/2, 0, chordOuter/2);

            // ...troppo complicato in real-time.
            // Torniamo alla soluzione "Overlap intelligente" con Trapezoid precalcolato.
            // Il segmento è un trapezio. Base maggiore = chordOuter, Base minore = chordInner. Altezza = width.
            // Lo piazziamo al centro (dx, dz) e ruotiamo di (angle).
            // MA il trapezio deve avere la base maggiore verso l'esterno.

            const qSegFix = segRot.clone();
            // Ruotiamo il cuneo affinché le basi siano laterali (lungo X)
            qSegFix.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), Math.PI/2));

            // Se sinistra: Esterno a Destra. Base maggiore (+Z locale dopo rotazione 90) deve andare a +X globale del segmento?
            // createTrapezoid: w1 (-Z), w2 (+Z).
            // Se w2 > w1. w2 è "davanti".
            // Ruotato 90 deg: w2 va a sinistra (-X) o destra (+X)?

            let c1 = chordInner, c2 = chordOuter;
            if(isLeft) {
                // Sinistra: Interno (-X), Esterno (+X).
                // Vogliamo che a -X ci sia la corda corta, a +X la lunga.
                c1 = chordInner; // "Dietro" nel trapezio standard
                c2 = chordOuter; // "Davanti"
                // Rotazione necessaria per mettere c1 a sinistra e c2 a destra?
                // Standard: w1(-Z), w2(+Z).
                // Ruotando -90 su Y: -Z diventa +X (destra), +Z diventa -X (sinistra).
                // Quindi a Destra finisce w1 (Back).
                // Vogliamo c2 (Lungo) a destra. Quindi w1 = c2.
                c1 = chordOuter;
                c2 = chordInner;
            } else {
                // Destra: Interno (+X), Esterno (-X).
                // Vogliamo c1(Lungo) a Sinistra (-X), c2(Corto) a Destra (+X).
                // Ruotando -90: Destra è w1. Sinistra è w2.
                // Vogliamo w1 = corto, w2 = lungo.
                c1 = chordInner;
                c2 = chordOuter;
            }

            const wTrapeze = width; // Lunghezza del trapezio (da base a base)

            // Mesh
            const tMesh = createTrapezoidMesh(c1, c2, 0.5, wTrapeze, TRACK_CFG.colors.road);
            tMesh.position.copy(segPos);
            tMesh.quaternion.copy(qSegFix);
            container.add(tMesh);

            // Physics
            const tShape = createTrapezoidPhysics(c1, c2, 0.5, wTrapeze);
            body.addShape(tShape, segPos, qSegFix);

            // Walls (Box standard vanno bene, ma devono seguire l'inclinazione)
            // Inner Wall
            const innerOff = isLeft ? -width/2 + 0.5 : width/2 - 0.5;
            const wInPos = new THREE.Vector3(innerOff, TRACK_CFG.wallHeight/2, 0).applyQuaternion(segRot).add(segPos);
            // Usiamo chordInner per la lunghezza muro interno
            addBox(container, body, wInPos, new CANNON.Vec3(1, TRACK_CFG.wallHeight, chordInner + 0.2), true, segRot);

            // Outer Wall
            const outerOff = isLeft ? width/2 - 0.5 : -width/2 + 0.5;
            const wOutPos = new THREE.Vector3(outerOff, TRACK_CFG.wallHeight/2, 0).applyQuaternion(segRot).add(segPos);
            addBox(container, body, wOutPos, new CANNON.Vec3(1, TRACK_CFG.wallHeight, chordOuter + 0.2), true, segRot);
        }
    }
};

// --- HELPER FISICA AVANZATA ---

// Crea un corpo trapezoidale (Cuneo) per le curve perfette
function createTrapezoidPhysics(w1, w2, h, len, offset) {
    // w1: larghezza 'dietro', w2: larghezza 'davanti'
    // Definiamo gli 8 vertici del cuneo centrati localmente
    const dy = h / 2;
    const dz = len / 2;

    // Vertici (ordine specifico per CannonJS)
    const vertices = [
        new CANNON.Vec3(-w1/2, -dy, -dz), // 0: BL Back
        new CANNON.Vec3( w1/2, -dy, -dz), // 1: BR Back
        new CANNON.Vec3( w1/2,  dy, -dz), // 2: TR Back
        new CANNON.Vec3(-w1/2,  dy, -dz), // 3: TL Back
        new CANNON.Vec3(-w2/2, -dy,  dz), // 4: BL Front
        new CANNON.Vec3( w2/2, -dy,  dz), // 5: BR Front
        new CANNON.Vec3( w2/2,  dy,  dz), // 6: TR Front
        new CANNON.Vec3(-w2/2,  dy,  dz)  // 7: TL Front
    ];

    // Facce (indici dei vertici, senso antiorario guardando da fuori)
    const faces = [
        [3, 2, 1, 0], // Back
        [4, 5, 6, 7], // Front
        [5, 4, 0, 1], // Bottom
        [2, 3, 7, 6], // Top
        [0, 4, 7, 3], // Left
        [1, 2, 6, 5]  // Right
    ];

    return new CANNON.ConvexPolyhedron({ vertices, faces });
}

// Crea la mesh ThreeJS corrispondente al cuneo
function createTrapezoidMesh(w1, w2, h, len, color) {
    const geo = new THREE.BufferGeometry();
    const vertices = new Float32Array([
        // Back Face
        -w1/2, h/2, -len/2,   w1/2, h/2, -len/2,   -w1/2, -h/2, -len/2,
        w1/2, h/2, -len/2,    w1/2, -h/2, -len/2,  -w1/2, -h/2, -len/2,
        // Front Face
        -w2/2, -h/2, len/2,   w2/2, -h/2, len/2,   -w2/2, h/2, len/2,
        w2/2, h/2, len/2,     -w2/2, h/2, len/2,   w2/2, -h/2, len/2,
        // Top Face
        -w1/2, h/2, -len/2,   -w2/2, h/2, len/2,   w1/2, h/2, -len/2,
        w1/2, h/2, -len/2,    -w2/2, h/2, len/2,   w2/2, h/2, len/2,
        // Bottom Face
        -w1/2, -h/2, -len/2,  w1/2, -h/2, -len/2,  -w2/2, -h/2, len/2,
        w1/2, -h/2, -len/2,   w2/2, -h/2, len/2,   -w2/2, -h/2, len/2,
        // Left Face
        -w1/2, h/2, -len/2,   -w1/2, -h/2, -len/2, -w2/2, h/2, len/2,
        -w2/2, h/2, len/2,    -w1/2, -h/2, -len/2, -w2/2, -h/2, len/2,
        // Right Face
        w1/2, h/2, -len/2,    w2/2, h/2, len/2,    w1/2, -h/2, -len/2,
        w2/2, h/2, len/2,     w2/2, -h/2, len/2,   w1/2, -h/2, -len/2
    ]);

    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
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
function checkTrackCollision(x, z, radiusCheck) {
    // Controlla se il punto è troppo vicino a segmenti precedenti
    // Ignoriamo gli ultimi 2 segmenti aggiunti per permettere la continuità
    const ignoreLast = 3;
    for(let i = 0; i < occupiedPoints.length - ignoreLast; i++) {
        const p = occupiedPoints[i];
        const dist = Math.sqrt((x - p.x)**2 + (z - p.z)**2);
        if (dist < (p.r + radiusCheck)) {
            return true; // Collisione
        }
    }
    return false;
}

//funzione principale di generazione pista
function generateTrack(matPhysics, matTurbo) {
    trackMeshes.forEach(m => scene.remove(m));
    trackBodies.forEach(b => world.removeBody(b));
    trackMeshes.length = 0;
    trackBodies.length = 0;
    occupiedPoints.length = 0; // Reset collisioni

    const trackLength = 40;
    let cx = 0, cy = 0, cz = 0;
    let dir = 0;

    // START
    createBlock(MODULES.START, cx, cy, cz, dir, { length: TRACK_CFG.blockSize });
    occupiedPoints.push({x:cx, z:cz, r:TRACK_CFG.blockSize}); // Add Start

    // Avanzamento iniziale sicuro
    const startOffset = TRACK_CFG.blockSize;
    cz -= startOffset;

    for (let i = 0; i < trackLength; i++) {
        let validMoveFound = false;
        let attempts = 0;

        while(!validMoveFound && attempts < 10) {
            attempts++;
            let potentialMoves = [];

            // Helper direzione
            const getDelta = (d, len) => {
                const rad = d * Math.PI / 2;
                return {
                    x: -Math.sin(rad) * len,
                    z: -Math.cos(rad) * len
                };
            };

            const fwdDir = dir;
            const leftDir = (dir + 1) % 4;
            const rightDir = (dir + 3) % 4;

            // --- 1. RETTILINEI & RAMPE ---
            const straightLen = TRACK_CFG.blockSize * (Math.random() > 0.6 ? 2 : 1);
            const dS = getDelta(fwdDir, straightLen);

            // Check Straight
            if (!checkTrackCollision(cx + dS.x, cz + dS.z, 5)) {
                // Opzioni Rettilineo
                potentialMoves.push({ type: MODULES.STRAIGHT, nextDir: dir, dx: dS.x, dy: 0, dz: dS.z, len: straightLen, w: 10 });

                // Opzioni Rampa (solo se abbastanza spazio verticale)
                if (cy < 40) {
                    // Salita
                    const h = 10 + Math.random() * 10;
                    potentialMoves.push({ type: MODULES.RAMP_UP, nextDir: dir, dx: dS.x, dy: h, dz: dS.z, len: straightLen, height: h, w: 5 });
                }
                if (cy > 10) {
                    // Discesa
                    const h = 10 + Math.random() * 10;
                    // Per discesa: creiamo un blocco che scende.
                    // Nota: createBlock gestisce la visuale, qui passiamo il delta Y negativo
                    potentialMoves.push({ type: MODULES.RAMP_DOWN, nextDir: dir, dx: dS.x, dy: -h, dz: dS.z, len: straightLen, height: h, w: 5 });
                }
            }

            // --- 2. CURVE ---
            const turnRadii = [TRACK_CFG.blockSize, TRACK_CFG.blockSize * 2.5];
            turnRadii.forEach(r => {
                // Calcolo fine curva (approssimato a 90 gradi)
                // Se guardo Nord(0) e giro SX: finisco a X-r, Z-r.
                // Delta relativo alla posizione attuale e direzione attuale.

                // Formule generiche per fine curva 90°
                // NewPos = OldPos + (Forward * R) + (Side * R)
                // Side è Left o Right vector.

                const calcTurnEnd = (currDir, isLeft) => {
                    const fwd = getDelta(currDir, r); // Vettore avanti R
                    const sideDir = isLeft ? (currDir + 1)%4 : (currDir + 3)%4;
                    const side = getDelta(sideDir, r); // Vettore lato R
                    return { x: fwd.x + side.x, z: fwd.z + side.z };
                };

                // Check Left
                const endL = calcTurnEnd(dir, true);
                if (!checkTrackCollision(cx + endL.x, cz + endL.z, r/1.5)) {
                    potentialMoves.push({ type: MODULES.TURN_LEFT, nextDir: leftDir, dx: endL.x, dy: 0, dz: endL.z, radius: r, w: 6 });
                }

                // Check Right
                const endR = calcTurnEnd(dir, false);
                if (!checkTrackCollision(cx + endR.x, cz + endR.z, r/1.5)) {
                    potentialMoves.push({ type: MODULES.TURN_RIGHT, nextDir: rightDir, dx: endR.x, dy: 0, dz: endR.z, radius: r, w: 6 });
                }
            });

            if (potentialMoves.length > 0) {
                // Scegli mossa pesata
                const totalW = potentialMoves.reduce((a,b)=>a+b.w,0);
                let rand = Math.random() * totalW;
                const move = potentialMoves.find(m => (rand -= m.w) < 0) || potentialMoves[0];

                // Checkpoint logic
                if (move.type === MODULES.STRAIGHT && i % 6 === 0 && i > 0) move.type = MODULES.CHECKPOINT;
                if (i === trackLength - 1) move.type = MODULES.FINISH;

                createBlock(move.type, cx, cy, cz, dir, {
                    length: move.len,
                    height: move.height,
                    radius: move.radius,
                    isLeft: (move.type === MODULES.TURN_LEFT)
                });

                // Aggiorna collisioni
                // Aggiungiamo punti intermedi per curve grandi o rettilinei lunghi
                const steps = 3;
                for(let k=1; k<=steps; k++) {
                    occupiedPoints.push({
                        x: cx + (move.dx * k/steps),
                                        z: cz + (move.dz * k/steps),
                                        r: 8 // Raggio sicurezza
                    });
                }

                cx += move.dx;
                cy += move.dy;
                cz += move.dz;
                dir = move.nextDir;
                validMoveFound = true;
            }
        }

        if (!validMoveFound) {
            // Se bloccato, piazza finish ed esci
            createBlock(MODULES.FINISH, cx, cy, cz, dir, { length: TRACK_CFG.blockSize });
            break;
        }
    }

    lastCheckpointPosition.set(0, 5, -10);
    lastCheckpointQuaternion.set(0, 0, 0, 1);
    isRacing = true;
    uiMsg.style.display = 'none';

    if(chassisBody) {
        chassisBody.position.set(0, 4, -10);
        chassisBody.quaternion.set(0,0,0,1);
        chassisBody.velocity.set(0,0,0);
        chassisBody.angularVelocity.set(0,0,0);

        // Reset code sospensioni
        vehicle.wheelInfos.forEach((w, i) => {
            vehicle.applyEngineForce(0, i);
            vehicle.setBrake(0, i);
        });
    }
}

// --- CREAZIONE AUTO ---
let speedoCtx, speedoTexture;

function createCar(wheelMat) {
    // 1. Telaio Fisico
    const chassisShape = new CANNON.Box(new CANNON.Vec3(CONFIG.chassisWidth/2, CONFIG.chassisHeight/2, CONFIG.chassisLength/2));
    chassisBody = new CANNON.Body({ mass: CONFIG.mass });
    chassisBody.addShape(chassisShape);
    chassisBody.position.set(0, 4, -10);
    chassisBody.quaternion.set(0, 0, 0, 1);
    chassisBody.angularDamping = 0.5; // Riduce rotazioni incontrollate
    world.addBody(chassisBody);

    // Mesh Grafica Telaio
    const geo = new THREE.BoxGeometry(CONFIG.chassisWidth, CONFIG.chassisHeight, CONFIG.chassisLength);
    const mat = new THREE.MeshStandardMaterial({ color: 0xd92525 });
    chassisMesh = new THREE.Mesh(geo, mat);
    scene.add(chassisMesh);

    // --- TACHIMETRO ---
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 64; // Più piccolo
    speedoCtx = canvas.getContext('2d');
    speedoTexture = new THREE.CanvasTexture(canvas);
    const speedoPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 0.4),
        new THREE.MeshBasicMaterial({ map: speedoTexture, transparent: true, opacity: 1 })
    );
    speedoPlane.position.set(0, 0, CONFIG.chassisLength / 2 + 0.01);
    chassisMesh.add(speedoPlane);

    // 2. Veicolo
    vehicle = new CANNON.RaycastVehicle({
        chassisBody: chassisBody,
        indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2
    });

    const options = {
        radius: 0.45, // Ruote un po' più grandi
        directionLocal: new CANNON.Vec3(0, -1, 0),
        suspensionStiffness: CONFIG.suspensionStiffness,
        suspensionRestLength: CONFIG.suspensionRestLength,
        frictionSlip: CONFIG.frictionSlip,
        dampingRelaxation: 2.3,
        dampingCompression: 4.4,
        maxSuspensionForce: 100000,
        rollInfluence: 0.01, // Impedisce il ribaltamento laterale
        axleLocal: new CANNON.Vec3(-1, 0, 0),
        chassisConnectionPointLocal: new CANNON.Vec3(1, 1, 0),
        maxSuspensionTravel: 0.3,
        customSlidingRotationalSpeed: -30,
        useCustomSlidingRotationalSpeed: true
    };

    // Aggiunta Ruote - FIX POSIZIONE VERTICALE
    // Alziamo il punto di connessione (Y=0 invece di negativo)
    // Questo fa sì che il peso del telaio "penda" sotto le sospensioni = stabilità
    const w = CONFIG.chassisWidth / 2;
    const h = 0; // Connessione al centro altezza, non sotto
    const l = CONFIG.chassisLength / 2 - 0.6;

    // FL, FR
    options.chassisConnectionPointLocal.set(w - 0.2, h, -l);
    vehicle.addWheel(options);
    options.chassisConnectionPointLocal.set(-w + 0.2, h, -l);
    vehicle.addWheel(options);
    // RL, RR
    options.chassisConnectionPointLocal.set(w - 0.2, h, l);
    vehicle.addWheel(options);
    options.chassisConnectionPointLocal.set(-w + 0.2, h, l);
    vehicle.addWheel(options);

    vehicle.addToWorld(world);

    // Mesh Ruote
    const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.5, 16);
    wheelGeo.rotateZ(Math.PI/2);
    const wheelMatVis = new THREE.MeshStandardMaterial({ color: 0x333333 });

    vehicle.wheelInfos.forEach(w => {
        const mesh = new THREE.Mesh(wheelGeo, wheelMatVis);
        scene.add(mesh);
        w.mesh = mesh;
    });
}

// --- LOOP PRINCIPALE ---
function animate() {
    requestAnimationFrame(animate);
    world.step(1/60);

    if (vehicle && chassisMesh) {
        chassisMesh.position.copy(chassisBody.position);
        chassisMesh.quaternion.copy(chassisBody.quaternion);

        // Calcolo velocità locale (Avanti/Indietro)
        const localVelocity = new CANNON.Vec3(0,0,0);
        const invQuat = chassisBody.quaternion.inverse();
        invQuat.vmult(chassisBody.velocity, localVelocity);
        const forwardSpeed = -localVelocity.z;

        // Input & Fisica
        let engine = 0;
        let brake = 0;

        if (keys.w) {
            engine = CONFIG.engineForce;
        } else if (keys.s) {
            // Se vai avanti (>1 m/s) frena, altrimenti retromarcia
            if (forwardSpeed > 1.0) brake = CONFIG.brakeForce;
            else engine = -CONFIG.engineForce / 2;
        }

        if (keys.space) brake = CONFIG.brakeForce * 2;

        // Trazione integrale
        vehicle.applyEngineForce(engine, 0);
        vehicle.applyEngineForce(engine, 1);
        vehicle.applyEngineForce(engine, 2);
        vehicle.applyEngineForce(engine, 3);

        vehicle.setBrake(brake, 0);
        vehicle.setBrake(brake, 1);
        vehicle.setBrake(brake, 2);
        vehicle.setBrake(brake, 3);

        const steer = keys.a ? CONFIG.maxSteerVal : (keys.d ? -CONFIG.maxSteerVal : 0);
        vehicle.setSteeringValue(steer, 0);
        vehicle.setSteeringValue(steer, 1);

        // Update Ruote Mesh
        for (let i=0; i<vehicle.wheelInfos.length; i++) {
            vehicle.updateWheelTransform(i);
            const t = vehicle.wheelInfos[i].worldTransform;
            vehicle.wheelInfos[i].mesh.position.copy(t.position);
            vehicle.wheelInfos[i].mesh.quaternion.copy(t.quaternion);
        }

        // Camera Follow (più distante per vedere il tachimetro)
        const camOffset = new THREE.Vector3(0, 3.5, 7.5);
        camOffset.applyMatrix4(chassisMesh.matrixWorld);
        camera.position.lerp(camOffset, 0.1);
        camera.lookAt(chassisMesh.position.x, chassisMesh.position.y + 1, chassisMesh.position.z);

        if (chassisBody.position.y < -10) respawn();

        // --- TACHIMETRO VISIBILE ---
        const kmh = Math.floor(Math.abs(forwardSpeed * 3.6));
        speedoCtx.clearRect(0, 0, 128, 64);
        speedoCtx.fillStyle = '#ffffff';
        speedoCtx.font = 'bold 50px Courier New';
        speedoCtx.textAlign = 'center';
        speedoCtx.textBaseline = 'middle';
        speedoCtx.fillText(kmh.toString(), 64, 32);
        speedoTexture.needsUpdate = true;

        // Checkpoints logic (invariata)
        trackBodies.forEach(b => {
            // Distanza semplice
            if (b.position.distanceTo(chassisBody.position) < TRACK_CFG.blockSize/2 + 2) {
                if(b.isTurbo) {
                    vehicle.applyEngineForce(CONFIG.engineForce * 3, 2);
                    vehicle.applyEngineForce(CONFIG.engineForce * 3, 3);
                }
                if(b.isFinish && isRacing) {
                    isRacing = false;
                    uiMsg.style.display = 'block';
                    uiMsg.innerText = "FINISH!\n" + uiTimer.innerText;
                    uiMsg.style.color = '#00ff00';
                }
                // Checkpoint logic esistente...
                if(b.isCheckpoint) {
                    if(b.position.distanceTo(chassisBody.position) < 8) {
                        if(b.position.distanceTo(lastCheckpointPosition) > 5) { // aumentato raggio
                            lastCheckpointPosition.copy(b.position);
                            lastCheckpointPosition.y += 3;
                            lastCheckpointQuaternion.copy(chassisBody.quaternion);

                            // Visual feedback
                            const notif = document.getElementById('message');
                            notif.innerText = "CHECKPOINT";
                            notif.style.display = 'block';
                            notif.style.color = '#fff';
                            setTimeout(() => { if(isRacing) notif.style.display='none'; }, 800);
                        }
                    }
                }
            }
        });
    }

    if (isRacing) {
        const t = performance.now() - timerStart;
        const s = Math.floor(t/1000);
        const ms = Math.floor(t % 1000);
        uiTimer.innerText = `${s}:${ms.toString().padStart(3,'0')}`;
    }

    renderer.render(scene, camera);
}

// --- UTILS ---
function respawn() {
    if(!chassisBody) return;
    
    // Ferma tutto
    chassisBody.velocity.set(0,0,0);
    chassisBody.angularVelocity.set(0,0,0);
    
    // Teletrasporta
    chassisBody.position.copy(lastCheckpointPosition);
    chassisBody.quaternion.copy(lastCheckpointQuaternion);
    
    // Reset forze ruote (importante per evitare salti)
    if(vehicle) {
        for(let i=0; i<vehicle.wheelInfos.length; i++){
            vehicle.applyEngineForce(0, i);
            vehicle.setBrake(0, i);
        }
    }
}

function setupInputs() {
    window.addEventListener('keydown', e => {
        if(e.key === 'w' || e.key === 'ArrowUp') keys.w = true;
        if(e.key === 's' || e.key === 'ArrowDown') keys.s = true;
        if(e.key === 'a' || e.key === 'ArrowLeft') keys.a = true;
        if(e.key === 'd' || e.key === 'ArrowRight') keys.d = true;
        if(e.key === ' ') keys.space = true;
        if(e.key === 'Enter') respawn();
        if(e.key === 'Delete') resetTrack(false);
    });
    window.addEventListener('keyup', e => {
        if(e.key === 'w' || e.key === 'ArrowUp') keys.w = false;
        if(e.key === 's' || e.key === 'ArrowDown') keys.s = false;
        if(e.key === 'a' || e.key === 'ArrowLeft') keys.a = false;
        if(e.key === 'd' || e.key === 'ArrowRight') keys.d = false;
        if(e.key === ' ') keys.space = false;
    });
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

// Init
init();
