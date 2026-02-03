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

function createBlock(type, x, y, z, quaternion, matPhysics, matTurbo) {
    const container = new THREE.Object3D();
    container.position.set(x, y, z);
    container.quaternion.copy(quaternion);
    scene.add(container);
    trackMeshes.push(container);

    const body = new CANNON.Body({ mass: 0 });
    body.position.copy(container.position);
    body.quaternion.copy(container.quaternion);

    const matRoad = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.6 });
    const matWall = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.7 });
    const isTurbo = type === MODULES.TURBO;
    if(isTurbo) matRoad.color.setHex(0x00ffff); // Colore diverso per turbo

    // Helper per creare muri e pavimento
    const addSegment = (posOffset, rotQ, size, isWall = false) => {
        // Fisica
        const shape = new CANNON.Box(new CANNON.Vec3(size.x/2, size.y/2, size.z/2));
        // Nota: body.addShape usa offset locali rispetto al corpo (che è a 0,0,0 relativo al container)
        body.addShape(shape, posOffset, rotQ);

        // Visuale
        const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
        const mesh = new THREE.Mesh(geo, isWall ? matWall : matRoad);
        mesh.position.copy(posOffset);
        mesh.quaternion.copy(rotQ);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        container.add(mesh);
    };

    // --- COSTRUZIONE BLOCCHI ---
    
    // 1. DRITTI e RAMPE (Geometria Lineare)
    if ([MODULES.START, MODULES.STRAIGHT, MODULES.RAMP_UP, MODULES.RAMP_DOWN, MODULES.TURBO, MODULES.CHECKPOINT, MODULES.FINISH].includes(type)) {
        let slope = 0;
        if (type === MODULES.RAMP_UP) slope = -RAMP_ANGLE;
        if (type === MODULES.RAMP_DOWN) slope = RAMP_ANGLE; // Torna piatto o scende
        
        // Calcoliamo la lunghezza "reale" per coprire la diagonale se è una rampa, 
        // ma per semplicità low-poly usiamo blocchi che si compenetrano leggermente.
        const segmentLen = BLOCK_SIZE + 0.5; // +0.5 per evitare gap visivi (z-fighting fix)
        
        const localRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), slope);
        const offset = new THREE.Vector3(0, 0, -BLOCK_SIZE/2);
        offset.applyQuaternion(localRot); // Sposta il centro in base alla pendenza

        // Pavimento
        addSegment(offset, localRot, new THREE.Vector3(BLOCK_SIZE, 0.5, segmentLen));

        // Muri (solo se non è start/finish per estetica pulita, o sempre)
        const wallH = WALL_HEIGHT;
        const wallOffL = new THREE.Vector3(-BLOCK_SIZE/2 + 0.5, wallH/2, -BLOCK_SIZE/2).applyQuaternion(localRot);
        const wallOffR = new THREE.Vector3(BLOCK_SIZE/2 - 0.5, wallH/2, -BLOCK_SIZE/2).applyQuaternion(localRot);
        
        addSegment(wallOffL, localRot, new THREE.Vector3(1, wallH, segmentLen), true);
        addSegment(wallOffR, localRot, new THREE.Vector3(1, wallH, segmentLen), true);
        
        // Checkpoint / Finish Line Visuals
        if(type === MODULES.FINISH || type === MODULES.CHECKPOINT) {
            const archGeo = new THREE.TorusGeometry(10, 1, 16, 32, Math.PI);
            const archMat = new THREE.MeshStandardMaterial({ color: type === MODULES.FINISH ? 0x00ff00 : 0xffff00 });
            const arch = new THREE.Mesh(archGeo, archMat);
            arch.position.set(0, 0, -BLOCK_SIZE/2);
            arch.scale.z = 0.5;
            container.add(arch);
            
            // Logica body flag
            if(type === MODULES.FINISH) body.isFinish = true;
            if(type === MODULES.CHECKPOINT) body.isCheckpoint = true;
        }
        if(isTurbo) body.isTurbo = true;

    } 
    // 2. CURVE (Geometria Segmentata per aderenza perfetta Fisica-Grafica)
    else if (type === MODULES.TURN_LEFT || type === MODULES.TURN_RIGHT) {
        const isLeft = type === MODULES.TURN_LEFT;
        const segments = 10; // Numero di segmenti per fare 90 gradi
        const angleStep = (Math.PI / 2) / segments;
        const radius = BLOCK_SIZE; // Raggio curva uguale alla griglia
        
        // Il centro di rotazione. 
        // Se vado dritto (-Z) e giro a sinistra (-X), il centro è a (-Radius, 0, 0).
        // Se giro a destra (+X), il centro è a (+Radius, 0, 0).
        const centerX = isLeft ? -radius : radius;
        
        for(let i=0; i<segments; i++) {
            // Angolo corrente e prossimo per interpolare bene (o usiamo box tangenti)
            const theta = i * angleStep;
            
            // Calcolo posizione locale lungo l'arco
            // Formula rotazione punto (0,0) attorno a (centerX, 0)
            // Start: (0,0,0). End desiderato: (+/- Radius, 0, -Radius)
            
            // Logica Semplificata: Coordinate polari rispetto al centro di curvatura
            // Angolo parte da 0 (sull'asse X locale rispetto al centro) a 90.
            const currentAngle = isLeft ? -theta : (Math.PI + theta); 
            // Aspetta, semplifichiamo:
            // Usiamo step progressivi.
            
            const alpha = theta + angleStep/2; // Angolo al centro del segmento
            
            // Coordinate rispetto all'inizio del blocco (0,0,0)
            // Dx = R * (1 - cos(alpha)) * sign
            // Dz = -R * sin(alpha)
            
            const dx = radius * (1 - Math.cos(alpha)) * (isLeft ? -1 : 1);
            const dz = -radius * Math.sin(alpha);
            
            const segPos = new THREE.Vector3(dx, 0, dz);
            
            // Rotazione del segmento: Deve seguire la tangente
            const rotY = alpha * (isLeft ? 1 : -1); 
            const segRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), rotY);
            
            // Dimensione segmento (Arc Length approx)
            // Corda = 2*R*sin(step/2).
            const segLen = (2 * radius * Math.sin(angleStep/2)) + 0.2; // +0.2 overlap
            
            // Pavimento
            addSegment(segPos, segRot, new THREE.Vector3(BLOCK_SIZE, 0.5, segLen));
            
            // Muri (Offset relativo al centro del segmento rotato)
            const wLeft = new THREE.Vector3(-BLOCK_SIZE/2 + 0.5, WALL_HEIGHT/2, 0).applyQuaternion(segRot).add(segPos);
            const wRight = new THREE.Vector3(BLOCK_SIZE/2 - 0.5, WALL_HEIGHT/2, 0).applyQuaternion(segRot).add(segPos);
            
            addSegment(wLeft, segRot, new THREE.Vector3(1, WALL_HEIGHT, segLen), true);
            addSegment(wRight, segRot, new THREE.Vector3(1, WALL_HEIGHT, segLen), true);
        }
    }

    world.addBody(body);
    trackBodies.push(body);
}

function generateTrack(matPhysics, matTurbo) {
    // Pulizia
    trackMeshes.forEach(m => scene.remove(m));
    trackBodies.forEach(b => world.removeBody(b));
    trackMeshes.length = 0;
    trackBodies.length = 0;

    const trackLength = 40;
    
    // Cursore: Posizione e Rotazione attuali (Connettore USCITA del blocco precedente)
    let cursor = {
        pos: new THREE.Vector3(0, 0, 0),
        quat: new THREE.Quaternion(),
        pitchIndex: 0 // 0 = piano, 1 = salita, -1 = discesa (non usato qui ma logico)
    };
    
    // Griglia occupazione approssimativa
    const occupied = new Set();
    const markOccupied = (pos) => occupied.add(`${Math.round(pos.x/10)},${Math.round(pos.z/10)}`);
    markOccupied(cursor.pos);

    // Creiamo lo Start
    createBlock(MODULES.START, cursor.pos.x, cursor.pos.y, cursor.pos.z, cursor.quat, matPhysics, matTurbo);
    // Avanziamo il cursore manualmente per lo start (è un dritto)
    cursor.pos.add(new THREE.Vector3(0, 0, -BLOCK_SIZE).applyQuaternion(cursor.quat));
    
    // Stato Pendenza corrente (in gradi discreti o unità)
    let currentSlope = 0; // 0 = Piano. 1 = Verso l'alto.
    
    for (let i = 0; i < trackLength; i++) {
        const possibleMoves = [];
        
        // Definiamo le regole di uscita per ogni pezzo
        // Offset locale per raggiungere l'inizio del prossimo blocco
        
        // REGOLE DI PENDENZA:
        // Se Slope != 0 (siamo su rampa o in alto inclinati), NON possiamo curvare.
        // Dobbiamo usare STRAIGHT (mantiene pendenza) o RAMP (cambia pendenza).
        
        const canTurn = (currentSlope === 0);
        
        // 1. STRAIGHT
        possibleMoves.push({ 
            type: MODULES.STRAIGHT, 
            weight: 5,
            nextSlope: currentSlope, // Mantiene la pendenza attuale
            calcOffset: () => new THREE.Vector3(0, 0, -BLOCK_SIZE),
            calcRot: () => new THREE.Quaternion() // Nessuna rotazione aggiuntiva
        });

        // 2. RAMPE
        // Se siamo piani, possiamo salire o scendere
        if (currentSlope === 0) {
            possibleMoves.push({ 
                type: MODULES.RAMP_UP, weight: 2, nextSlope: 1,
                calcOffset: () => new THREE.Vector3(0, RAMP_HEIGHT, -BLOCK_SIZE).applyAxisAngle(new THREE.Vector3(1,0,0), -RAMP_ANGLE), // Trucco geometrico
                // La rampa ruota l'intero sistema di coordinate locale verso l'alto
                calcRot: () => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), -RAMP_ANGLE)
            });
            // RAMP_DOWN disabilitato se siamo a terra (y < 5)
            if(cursor.pos.y > 5) {
                possibleMoves.push({ 
                    type: MODULES.RAMP_DOWN, weight: 2, nextSlope: -1,
                    calcOffset: () => new THREE.Vector3(0, -RAMP_HEIGHT, -BLOCK_SIZE), // Semplificazione
                    calcRot: () => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), RAMP_ANGLE)
                });
            }
        } 
        // Se stiamo salendo (Slope 1), possiamo tornare piani con RAMP_DOWN (che qui agisce da raddrizzatore)
        else if (currentSlope === 1) {
             possibleMoves.push({ 
                type: MODULES.RAMP_DOWN, weight: 10, nextSlope: 0, // Obbligatorio o quasi appiattirsi
                calcOffset: () => new THREE.Vector3(0, 0, -BLOCK_SIZE), // Esci dritto relativo al blocco inclinato
                calcRot: () => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), RAMP_ANGLE) // Annulla la salita
            });
        }
        // Se stiamo scendendo (Slope -1), appiattiamo con RAMP_UP
        else if (currentSlope === -1) {
             possibleMoves.push({ 
                type: MODULES.RAMP_UP, weight: 10, nextSlope: 0,
                calcOffset: () => new THREE.Vector3(0, 0, -BLOCK_SIZE),
                calcRot: () => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), -RAMP_ANGLE)
            });
        }

        // 3. CURVE (Solo se piani)
        if (canTurn) {
            possibleMoves.push({ 
                type: MODULES.TURN_LEFT, weight: 3, nextSlope: 0,
                calcOffset: () => new THREE.Vector3(-BLOCK_SIZE, 0, -BLOCK_SIZE),
                calcRot: () => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), Math.PI/2)
            });
            possibleMoves.push({ 
                type: MODULES.TURN_RIGHT, weight: 3, nextSlope: 0,
                calcOffset: () => new THREE.Vector3(BLOCK_SIZE, 0, -BLOCK_SIZE),
                calcRot: () => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), -Math.PI/2)
            });
        }
        
        // TURBO (raro, solo dritto e piano)
        if(canTurn && Math.random() > 0.8) {
             possibleMoves.push({ 
                type: MODULES.TURBO, weight: 2, nextSlope: 0,
                calcOffset: () => new THREE.Vector3(0, 0, -BLOCK_SIZE),
                calcRot: () => new THREE.Quaternion()
            });
        }

        // --- SELEZIONE MOSSA ---
        // Filtriamo mosse che collidono (molto grezzo)
        const validMoves = possibleMoves.filter(m => {
            const testOff = m.calcOffset().applyQuaternion(cursor.quat);
            const testPos = cursor.pos.clone().add(testOff);
            return !occupied.has(`${Math.round(testPos.x/10)},${Math.round(testPos.z/10)}`);
        });

        const available = validMoves.length > 0 ? validMoves : possibleMoves; // Fallback se bloccati
        
        // Scegli a caso pesato
        let totalW = available.reduce((s, m) => s + m.weight, 0);
        let r = Math.random() * totalW;
        let move = available.find(m => (r -= m.weight) < 0) || available[0];
        
        // Override Checkpoint ogni tot blocchi
        if(i > 0 && i % 10 === 0 && currentSlope === 0) move.type = MODULES.CHECKPOINT;
        if(i === trackLength - 1) move.type = MODULES.FINISH;

        // --- APPLICAZIONE ---
        // 1. Crea il blocco alla posizione corrente del cursore
        createBlock(move.type, cursor.pos.x, cursor.pos.y, cursor.pos.z, cursor.quat, matPhysics, matTurbo);
        
        markOccupied(cursor.pos);

        // 2. Calcola dove finisce questo blocco (nuovo cursore)
        const localOffset = move.calcOffset();
        const localRot = move.calcRot();
        
        // Posizione Globale = Pos + (Offset ruotato secondo l'orientamento attuale)
        const globalOffset = localOffset.clone().applyQuaternion(cursor.quat);
        cursor.pos.add(globalOffset);
        
        // Rotazione Globale = Rotazione Attuale * Rotazione Locale
        cursor.quat.multiply(localRot);
        cursor.quat.normalize();
        
        currentSlope = move.nextSlope;
    }

    // Reset Checkpoint sistema
    lastCheckpointPosition.set(0, 4, -10); 
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
