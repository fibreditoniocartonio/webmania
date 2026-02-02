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
let lastCheckpointPosition = new CANNON.Vec3(50, 5, 0); // Più in alto per sicurezza
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
const BLOCK_SIZE = 20;
const WALL_HEIGHT = 1.5;
const RAMP_ANGLE = Math.PI / 12;
const RAMP_HEIGHT = BLOCK_SIZE * Math.tan(RAMP_ANGLE);
const TURN_RADIUS = BLOCK_SIZE;

function createBlock(type, x, y, z, dirIndex, matPhysics, matTurbo) {
    const isCurve = type === MODULES.TURN_LEFT || type === MODULES.TURN_RIGHT;

    const container = new THREE.Object3D();
    container.position.set(x, y, z);
    container.rotation.y = dirIndex * (Math.PI / 2);
    scene.add(container);
    trackMeshes.push(container);

    const body = new CANNON.Body({ mass: 0 });
    body.position.copy(container.position);
    body.quaternion.copy(container.quaternion);

    const matRoad = new THREE.MeshStandardMaterial({ color: 0x444444 });
    const matWall = new THREE.MeshStandardMaterial({ color: 0x888888 });

    // ====================================================================
    // --- BLOCCHI CURVI (Logica Stabile) ---
    // ====================================================================
    if (isCurve) {
        const segments = 12;
        const roadWidth = BLOCK_SIZE;

        // La curva è un quarto di anello. Il suo centro è spostato
        // in modo che l'ingresso sia sempre a (0,0,0) locale.
        const innerRadius = roadWidth / 2;
        const outerRadius = roadWidth * 1.5;

        const shape = new THREE.Shape();
        const angle = Math.PI / 2;
        shape.moveTo(innerRadius, 0);
        shape.absarc(0, 0, outerRadius, 0, angle, false);
        shape.lineTo(innerRadius * Math.cos(angle), innerRadius * Math.sin(angle));
        shape.absarc(0, 0, innerRadius, angle, 0, true);

        const roadGeo = new THREE.ShapeGeometry(shape, segments);
        const roadMesh = new THREE.Mesh(roadGeo, matRoad);
        roadMesh.rotation.x = -Math.PI / 2;

        // POSIZIONAMENTO CHIAVE: sposta la geometria in modo che l'inizio
        // della curva coincida con l'origine del container.
        if (type === MODULES.TURN_LEFT) {
            roadMesh.position.set(outerRadius, 0, 0);
        } else { // TURN_RIGHT
            roadMesh.position.set(outerRadius, 0, -BLOCK_SIZE);
            roadMesh.scale.z = -1;
        }
        container.add(roadMesh);

        // FISICA: Usa una griglia di Box semplici per approssimare la curva.
        // È molto più veloce e stabile di un Trimesh per la fisica delle auto.
        for (let i = 0; i <= segments; i++) {
            const t = (i / segments) * (Math.PI / 2);
            const x_pos = outerRadius - (roadWidth * Math.cos(t));
            const z_pos = -(roadWidth * Math.sin(t));
            const angle = (type === MODULES.TURN_LEFT) ? -t : t;

            const segmentShape = new CANNON.Box(new CANNON.Vec3(BLOCK_SIZE / segments, 0.25, BLOCK_SIZE / 2.2));
            const q = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0,1,0), angle);

            const offset = new CANNON.Vec3(x_pos, 0, z_pos);
            if(type === MODULES.TURN_RIGHT) offset.z += BLOCK_SIZE;

            body.addShape(segmentShape, offset, q);
        }
    }
    // ====================================================================
    // --- BLOCCHI DRITTI E RAMPE (Logica Semplice) ---
    // ====================================================================
    else {
        let slope = 0;
        if (type === MODULES.RAMP_UP) slope = -RAMP_ANGLE;
        if (type === MODULES.RAMP_DOWN) slope = RAMP_ANGLE;

        const slopeQuat = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(1, 0, 0), slope);

        // --- FIX GEOMETRICO RAMPE ---
        // Problema: Ruotando il blocco dal suo centro, l'inizio della rampa si disallinea (si alza o abbassa).
        // Soluzione: Calcoliamo un offset verticale correttivo.
        // Formula: Spostiamo il blocco in Y in modo che il punto iniziale (Start) sia sempre a Y=0.
        // Math.sin(slope) ci dà la componente verticale della rotazione su metà lunghezza.
        const verticalOffset = (BLOCK_SIZE / 2) * Math.sin(slope);

        // Il centro del blocco è spostato indietro (-Z) e corretto in altezza (Y)
        const offset = new CANNON.Vec3(0, verticalOffset, -BLOCK_SIZE / 2);

        // 1. PAVIMENTO
        const floorShape = new CANNON.Box(new CANNON.Vec3(BLOCK_SIZE / 2, 0.25, BLOCK_SIZE / 2));
        const floorMesh = new THREE.Mesh(new THREE.BoxGeometry(BLOCK_SIZE, 0.5, BLOCK_SIZE), matRoad);

        // Applichiamo posizione e rotazione
        floorMesh.position.copy(offset);
        floorMesh.rotation.x = slope;
        container.add(floorMesh);

        body.addShape(floorShape, offset, slopeQuat);

        // 2. MURI (Ora visibili!)
        // Geometria Three.js per i muri (Larghezza 1, Altezza WALL_HEIGHT, Profondità BLOCK_SIZE)
        const wallGeo = new THREE.BoxGeometry(1, WALL_HEIGHT, BLOCK_SIZE);

        // Calcolo posizioni muri (Sinistra e Destra)
        // Nota: Aggiungiamo verticalOffset anche qui per seguire l'inclinazione della rampa
        const wallLeftPos = new CANNON.Vec3(-(BLOCK_SIZE / 2 - 0.5), WALL_HEIGHT / 2 + verticalOffset, -BLOCK_SIZE/2);
        const wallRightPos = new CANNON.Vec3(BLOCK_SIZE / 2 - 0.5, WALL_HEIGHT / 2 + verticalOffset, -BLOCK_SIZE/2);

        // Creazione Mesh Muri
        const wallMeshL = new THREE.Mesh(wallGeo, matWall);
        wallMeshL.position.copy(wallLeftPos);
        wallMeshL.rotation.x = slope; // Il muro deve ruotare con la rampa
        container.add(wallMeshL);

        const wallMeshR = new THREE.Mesh(wallGeo, matWall);
        wallMeshR.position.copy(wallRightPos);
        wallMeshR.rotation.x = slope;
        container.add(wallMeshR);

        // Creazione Fisica Muri
        const wallShape = new CANNON.Box(new CANNON.Vec3(0.5, WALL_HEIGHT / 2, BLOCK_SIZE / 2));
        body.addShape(wallShape, wallLeftPos, slopeQuat);
        body.addShape(wallShape, wallRightPos, slopeQuat);
    }

    world.addBody(body);
    trackBodies.push(body);
}

function generateTrack(matPhysics, matTurbo) {
    trackMeshes.forEach(m => scene.remove(m));
    trackBodies.forEach(b => world.removeBody(b));
    trackMeshes.length = 0;
    trackBodies.length = 0;

    const trackLength = 50;
    let cursor = {
        position: new THREE.Vector3(0, 0, 0),
        quaternion: new THREE.Quaternion()
    };
    const occupied = new Set();
    const getKey = (pos) => `${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)}`;

    // Definiamo i punti di uscita LOCALI per ogni tipo di blocco
    const exits = {
        [MODULES.STRAIGHT]: { pos: new THREE.Vector3(0, 0, -BLOCK_SIZE), quat: new THREE.Quaternion() },
        [MODULES.RAMP_UP]: { pos: new THREE.Vector3(0, RAMP_HEIGHT, -BLOCK_SIZE), quat: new THREE.Quaternion() },
        [MODULES.RAMP_DOWN]: { pos: new THREE.Vector3(0, -RAMP_HEIGHT, -BLOCK_SIZE), quat: new THREE.Quaternion() },
        [MODULES.TURBO]: { pos: new THREE.Vector3(0, 0, -BLOCK_SIZE), quat: new THREE.Quaternion() },
        [MODULES.CHECKPOINT]: { pos: new THREE.Vector3(0, 0, -BLOCK_SIZE), quat: new THREE.Quaternion() },
        [MODULES.TURN_LEFT]: {
            pos: new THREE.Vector3(-BLOCK_SIZE, 0, -BLOCK_SIZE),
            quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
        },
        [MODULES.TURN_RIGHT]: {
            pos: new THREE.Vector3(BLOCK_SIZE, 0, -BLOCK_SIZE),
            quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2)
        }
    };

    // Funzione per calcolare il prossimo cursore
    function getNextCursor(currentCursor, moveType) {
        const exit = exits[moveType];
        const newPos = currentCursor.position.clone().add(exit.pos.clone().applyQuaternion(currentCursor.quaternion));
        const newQuat = currentCursor.quaternion.clone().multiply(exit.quat);
        return { position: newPos, quaternion: newQuat };
    }

    // START
    const startDirIndex = 0;
    createBlock(MODULES.START, cursor.position.x, cursor.position.y, cursor.position.z, startDirIndex, matPhysics, matTurbo);
    occupied.add(getKey(cursor.position));
    cursor = getNextCursor(cursor, MODULES.STRAIGHT);
    createBlock(MODULES.STRAIGHT, cursor.position.x, cursor.position.y, cursor.position.z, startDirIndex, matPhysics, matTurbo);
    occupied.add(getKey(cursor.position));

    for (let i = 2; i < trackLength; i++) {
        const possibleMoves = [];
        const moveTypes = [MODULES.STRAIGHT, MODULES.TURN_LEFT, MODULES.TURN_RIGHT, MODULES.RAMP_UP, MODULES.RAMP_DOWN];

        for (const type of moveTypes) {
            const next = getNextCursor(cursor, type);
            if (!occupied.has(getKey(next.position))) {
                if (type === MODULES.RAMP_UP && cursor.position.y < RAMP_HEIGHT * 4) possibleMoves.push({ type, next, weight: 1 });
                else if (type === MODULES.RAMP_DOWN && cursor.position.y >= RAMP_HEIGHT) possibleMoves.push({ type, next, weight: 1 });
                else if (type === MODULES.STRAIGHT) possibleMoves.push({ type, next, weight: 4 });
                else if (type === MODULES.TURN_LEFT || type === MODULES.TURN_RIGHT) possibleMoves.push({ type, next, weight: 2 });
            }
        }

        if (possibleMoves.length === 0) {
            const dir = new THREE.Euler().setFromQuaternion(cursor.quaternion).y;
            createBlock(MODULES.FINISH, cursor.position.x, cursor.position.y, cursor.position.z, dir / (Math.PI/2), matPhysics, matTurbo);
            break;
        }

        const totalWeight = possibleMoves.reduce((sum, move) => sum + move.weight, 0);
        let rand = Math.random() * totalWeight;
        let chosenMove = possibleMoves.find(move => (rand -= move.weight) < 0) || possibleMoves[0];

        if(i % 8 === 0) chosenMove.type = MODULES.CHECKPOINT;

        const euler = new THREE.Euler().setFromQuaternion(cursor.quaternion);
        const dirIndex = Math.round(euler.y / (Math.PI / 2));

        const finalType = (i === trackLength - 1) ? MODULES.FINISH : chosenMove.type;
        createBlock(finalType, cursor.position.x, cursor.position.y, cursor.position.z, dirIndex, matPhysics, matTurbo);

        cursor = chosenMove.next;
        occupied.add(getKey(cursor.position));
    }

    lastCheckpointPosition.set(0, 5, 0);
    lastCheckpointQuaternion.set(0, 0, 0, 1);
    isRacing = true;
    uiMsg.style.display = 'none';
}

// --- CREAZIONE AUTO ---
let speedoCtx, speedoTexture;

function createCar(wheelMat) {
    // 1. Telaio Fisico
    const chassisShape = new CANNON.Box(new CANNON.Vec3(CONFIG.chassisWidth/2, CONFIG.chassisHeight/2, CONFIG.chassisLength/2));
    chassisBody = new CANNON.Body({ mass: CONFIG.mass });
    chassisBody.addShape(chassisShape);
    chassisBody.position.set(0, 3, 0);
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
            if (b.position.distanceTo(chassisBody.position) < BLOCK_SIZE/2 + 2) {
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
    chassisBody.velocity.set(0,0,0);
    chassisBody.angularVelocity.set(0,0,0);
    chassisBody.position.copy(lastCheckpointPosition);
    chassisBody.quaternion.copy(lastCheckpointQuaternion);
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
