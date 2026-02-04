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
                    const h = 5 + Math.random() * 10;
                    potentialMoves.push({ type: MODULES.RAMP_UP, nextDir: dir, dx: dS.x, dy: h, dz: dS.z, len: straightLen, height: h, w: 5 });
                }
                if (cy > 10) {
                    // Discesa
                    const h = 5 + Math.random() * 10;
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
