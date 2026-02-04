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
const BLOCK_SIZE = 20;
const WALL_HEIGHT = 1.5;
const RAMP_ANGLE = Math.PI / 12;
const RAMP_HEIGHT = BLOCK_SIZE * Math.tan(RAMP_ANGLE);
const TURN_RADIUS = BLOCK_SIZE;

function createBlock(type, x, y, z, dirAngle, matPhysics, matTurbo) {
    // dirAngle: 0 = -Z (Nord), 1 = -X (Ovest), 2 = +Z (Sud), 3 = +X (Est)
    const quat = new THREE.Quaternion();
    quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), dirAngle * Math.PI / 2);

    const container = new THREE.Object3D();
    container.position.set(x, y, z);
    container.quaternion.copy(quat);
    scene.add(container);
    trackMeshes.push(container);

    const body = new CANNON.Body({ mass: 0 }); // Corpo statico
    body.position.copy(container.position);
    body.quaternion.copy(container.quaternion);

    const matRoad = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.6 });
    const matWall = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.7 });
    const isTurbo = type === MODULES.TURBO;
    if (isTurbo) matRoad.color.setHex(0x00ffff);

    // Helper: Aggiunge box fisici e grafici
    const addBox = (offset, dim, isWall = false, localRot = null) => {
        const shape = new CANNON.Box(new CANNON.Vec3(dim.x / 2, dim.y / 2, dim.z / 2));
        const q = localRot || new CANNON.Quaternion();
        body.addShape(shape, offset, q);

        const geo = new THREE.BoxGeometry(dim.x, dim.y, dim.z);
        const mesh = new THREE.Mesh(geo, isWall ? matWall : matRoad);
        mesh.position.copy(offset);
        if (localRot) mesh.quaternion.copy(localRot);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        container.add(mesh);
    };

    // --- COSTRUZIONE GEOMETRIA ---

    if ([MODULES.START, MODULES.STRAIGHT, MODULES.TURBO, MODULES.CHECKPOINT, MODULES.FINISH].includes(type)) {
        // DRITTO
        addBox(new CANNON.Vec3(0, 0, -BLOCK_SIZE / 2), new CANNON.Vec3(BLOCK_SIZE, 0.5, BLOCK_SIZE));
        addBox(new CANNON.Vec3(-BLOCK_SIZE / 2 + 0.5, WALL_HEIGHT / 2, -BLOCK_SIZE / 2), new CANNON.Vec3(1, WALL_HEIGHT, BLOCK_SIZE), true);
        addBox(new CANNON.Vec3(BLOCK_SIZE / 2 - 0.5, WALL_HEIGHT / 2, -BLOCK_SIZE / 2), new CANNON.Vec3(1, WALL_HEIGHT, BLOCK_SIZE), true);

        if (isTurbo) body.isTurbo = true;
        if (type === MODULES.FINISH) {
            body.isFinish = true;
            const arch = new THREE.Mesh(new THREE.TorusGeometry(8, 1, 16, 32, Math.PI), new THREE.MeshStandardMaterial({color:0x00ff00}));
            arch.position.set(0,0,-BLOCK_SIZE/2);
            container.add(arch);
        }
        if (type === MODULES.CHECKPOINT) {
            body.isCheckpoint = true;
            const arch = new THREE.Mesh(new THREE.TorusGeometry(8, 1, 16, 32, Math.PI), new THREE.MeshStandardMaterial({color:0xffff00}));
            arch.position.set(0,0,-BLOCK_SIZE/2);
            container.add(arch);
        }

    } else if (type === MODULES.RAMP_UP || type === MODULES.RAMP_DOWN) {
        // RAMPE FIX: Calcolo corretto rotazione
        const elevation = (type === MODULES.RAMP_UP) ? RAMP_HEIGHT : -RAMP_HEIGHT;
        const rampLen = Math.sqrt(BLOCK_SIZE**2 + elevation**2);
        // Angolo positivo = Naso in su (ThreeJS X-Axis rule)
        const rampAngle = Math.atan2(elevation, BLOCK_SIZE);

        // Rotazione locale
        const qRamp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rampAngle);

        // Centro geometrico della rampa
        const centerPos = new CANNON.Vec3(0, elevation / 2, -BLOCK_SIZE / 2);

        // Pavimento
        addBox(centerPos, new CANNON.Vec3(BLOCK_SIZE, 0.5, rampLen), false, qRamp);

        // Muri
        const wallOffL = new THREE.Vector3(-BLOCK_SIZE / 2 + 0.5, WALL_HEIGHT / 2, 0).applyQuaternion(qRamp).add(centerPos);
        const wallOffR = new THREE.Vector3(BLOCK_SIZE / 2 - 0.5, WALL_HEIGHT / 2, 0).applyQuaternion(qRamp).add(centerPos);

        addBox(wallOffL, new CANNON.Vec3(1, WALL_HEIGHT, rampLen), true, qRamp);
        addBox(wallOffR, new CANNON.Vec3(1, WALL_HEIGHT, rampLen), true, qRamp);

    } else if (type === MODULES.TURN_LEFT || type === MODULES.TURN_RIGHT) {
        // CURVA FIX: Pavimento largo quanto il raggio esterno per chiudere i buchi
        const isLeft = (type === MODULES.TURN_LEFT);
        const segments = 6;
        const angleStep = (Math.PI / 2) / segments;
        const r = BLOCK_SIZE;
        const w = BLOCK_SIZE;

        const rInner = r - w/2 + 0.5;
        const rOuter = r + w/2 - 0.5;

        // Lunghezze corde
        const lenInner = 2 * rInner * Math.sin(angleStep / 2) + 0.2;
        const lenOuter = 2 * rOuter * Math.sin(angleStep / 2) + 0.2;

        // FIX PAVIMENTO: Usiamo lenOuter anche per il pavimento.
        // Questo crea sovrapposizione all'interno (invisibile) ma chiude i gap esterni.
        const lenFloor = lenOuter;

        for (let i = 0; i < segments; i++) {
            const theta = (i * angleStep) + (angleStep / 2);

            // Coordinate polari standard
            const sign = isLeft ? 1 : -1;
            const angle = theta * sign;

            // Posizione centro segmento
            const dx = (r * (1 - Math.cos(theta))) * (isLeft ? -1 : 1);
            const dz = -r * Math.sin(theta);

            const segPos = new CANNON.Vec3(dx, 0, dz);
            const segRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);

            // Floor (lunghezza lenFloor = lenOuter)
            addBox(segPos, new CANNON.Vec3(w, 0.5, lenFloor), false, segRot);

            // Walls
            const innerLocalX = isLeft ? (-w/2 + 0.5) : (w/2 - 0.5);
            const outerLocalX = isLeft ? (w/2 - 0.5) : (-w/2 + 0.5);

            const wInPos = new THREE.Vector3(innerLocalX, WALL_HEIGHT/2, 0).applyQuaternion(segRot).add(segPos);
            const wOutPos = new THREE.Vector3(outerLocalX, WALL_HEIGHT/2, 0).applyQuaternion(segRot).add(segPos);

            addBox(wInPos, new CANNON.Vec3(1, WALL_HEIGHT, lenInner), true, segRot);
            addBox(wOutPos, new CANNON.Vec3(1, WALL_HEIGHT, lenOuter), true, segRot);
        }

        // Piloni angoli interni per evitare incastri fisici
        const cornerX = isLeft ? -BLOCK_SIZE/2 : BLOCK_SIZE/2;
        addBox(new CANNON.Vec3(cornerX, WALL_HEIGHT/2, 0), new CANNON.Vec3(1, WALL_HEIGHT, 1), true);
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
    const occupied = new Set();
    const mark = (x, z) => occupied.add(`${Math.round(x/BLOCK_SIZE)},${Math.round(z/BLOCK_SIZE)}`);
    const isFree = (x, z) => !occupied.has(`${Math.round(x/BLOCK_SIZE)},${Math.round(z/BLOCK_SIZE)}`);

    // Cursore Griglia
    let cx = 0, cy = 0, cz = 0;
    let dir = 0; // 0: -Z (Nord), 1: -X (Ovest), 2: +Z (Sud), 3: +X (Est)

    // START
    createBlock(MODULES.START, cx, cy, cz, dir, matPhysics, matTurbo);
    mark(cx, cz);

    // Avanza cursore per uscire dallo start
    cz -= BLOCK_SIZE;
    mark(cx, cz);

    for (let i = 0; i < trackLength; i++) {
        let moves = [];

        const getDelta = (d) => {
            if(d===0) return {x:0, z:-BLOCK_SIZE};
            if(d===1) return {x:-BLOCK_SIZE, z:0};
            if(d===2) return {x:0, z:BLOCK_SIZE};
            if(d===3) return {x:BLOCK_SIZE, z:0};
        };

        const fwd = getDelta(dir);
        const left = getDelta((dir + 1) % 4);
        const right = getDelta((dir + 3) % 4);

        // 1. STRAIGHT & RAMPS
        if (isFree(cx + fwd.x, cz + fwd.z)) {
            // Straight base
            moves.push({ type: MODULES.STRAIGHT, nextDir: dir, dx: fwd.x, dy: 0, dz: fwd.z, w: 10 });

            // Turbo (solo piano)
            if(Math.random() > 0.9)
                moves.push({ type: MODULES.TURBO, nextDir: dir, dx: fwd.x, dy: 0, dz: fwd.z, w: 2 });

            // Ramp Up (se non troppo alto)
            if (cy < RAMP_HEIGHT * 3) {
                moves.push({ type: MODULES.RAMP_UP, nextDir: dir, dx: fwd.x, dy: RAMP_HEIGHT, dz: fwd.z, w: 4 });
            }
            // Ramp Down (se siamo in alto)
            if (cy >= RAMP_HEIGHT) {
                moves.push({ type: MODULES.RAMP_DOWN, nextDir: dir, dx: fwd.x, dy: -RAMP_HEIGHT, dz: fwd.z, w: 4 });
            }
        }

        // 2. TURNS (Solo se piano)
        const turnLPos = { x: cx + fwd.x + left.x, z: cz + fwd.z + left.z };
        if (isFree(cx + fwd.x, cz + fwd.z) && isFree(turnLPos.x, turnLPos.z)) {
            moves.push({ type: MODULES.TURN_LEFT, nextDir: (dir + 1) % 4, dx: fwd.x + left.x, dy: 0, dz: fwd.z + left.z, w: 5 });
        }

        const turnRPos = { x: cx + fwd.x + right.x, z: cz + fwd.z + right.z };
        if (isFree(cx + fwd.x, cz + fwd.z) && isFree(turnRPos.x, turnRPos.z)) {
            moves.push({ type: MODULES.TURN_RIGHT, nextDir: (dir + 3) % 4, dx: fwd.x + right.x, dy: 0, dz: fwd.z + right.z, w: 5 });
        }

        // Fallback: se bloccato, termina la pista
        if (moves.length === 0) {
            createBlock(MODULES.FINISH, cx, cy, cz, dir, matPhysics, matTurbo);
            break;
        }

        // Selezione casuale pesata
        const totalW = moves.reduce((a,b)=>a+b.w,0);
        let r = Math.random() * totalW;
        let move = moves.find(m => (r -= m.w) < 0) || moves[0];

        // --- FIX CHECKPOINT ---
        // Sovrascrivi SOLO se è un rettilineo. Mai su curve o rampe.
        if (move.type === MODULES.STRAIGHT && i % 8 === 0 && i > 0) {
            move.type = MODULES.CHECKPOINT;
        }

        if (i === trackLength - 1) move.type = MODULES.FINISH;

        // Genera blocco
        createBlock(move.type, cx, cy, cz, dir, matPhysics, matTurbo);

        // Occupa le celle
        mark(cx + fwd.x, cz + fwd.z); // Cella "davanti" (dove poggia la rampa/curva)
        if(move.type === MODULES.TURN_LEFT || move.type === MODULES.TURN_RIGHT) {
            mark(cx + move.dx, cz + move.dz); // Cella di destinazione curva
        }

        // Avanza cursore
        cx += move.dx;
        cy += move.dy;
        cz += move.dz;
        dir = move.nextDir;
    }

    // Reset Checkpoint sistema
    lastCheckpointPosition.set(0, 5, -10);
    lastCheckpointQuaternion.set(0, 0, 0, 1);

    isRacing = true;
    uiMsg.style.display = 'none';

    // Posiziona auto
    if(chassisBody) {
        chassisBody.position.set(0, 4, -10);
        chassisBody.quaternion.set(0,0,0,1);
        chassisBody.velocity.set(0,0,0);
        chassisBody.angularVelocity.set(0,0,0);
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
