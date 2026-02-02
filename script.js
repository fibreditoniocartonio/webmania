import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// --- CONFIGURAZIONE GLOBALE ---
const CONFIG = {
    stepFrequency: 60,
    gravity: -20, // Gravità arcade (più pesante)
    chassisWidth: 1.8,
    chassisHeight: 0.6,
    chassisLength: 4,
    mass: 150,
    engineForce: 1000, // Accelerazione
    brakeForce: 20,
    maxSteerVal: 0.5,
};

// --- STATO DEL GIOCO ---
let scene, camera, renderer, world;
let vehicle;
let lastCheckpointPosition = new CANNON.Vec3(0, 2, 0);
let lastCheckpointQuaternion = new CANNON.Quaternion();
let timerStart = 0;
let bestTime = Infinity;
let isRacing = false;
let keys = { w: false, a: false, s: false, d: false, space: false };
const trackMeshes = [];
const trackBodies = [];

// Elementi UI
const uiTimer = document.getElementById('timer');
const uiBest = document.getElementById('best-time');
const uiMsg = document.getElementById('message');

// --- INIT ---
function init() {
    // 1. Setup Three.js
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Cielo azzurro
    scene.fog = new THREE.Fog(0x87CEEB, 20, 150);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    renderer = new THREE.WebGLRenderer({ antialias: true }); // Antialias per low poly pulito
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true; // Ombre semplici
    document.getElementById('game-container').appendChild(renderer.domElement);

    // Luci
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;
    dirLight.shadow.camera.left = -50;
    dirLight.shadow.camera.right = 50;
    dirLight.shadow.camera.top = 50;
    dirLight.shadow.camera.bottom = -50;
    scene.add(dirLight);

    // 2. Setup Cannon.js (Fisica)
    world = new CANNON.World();
    world.gravity.set(0, CONFIG.gravity, 0);
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.defaultContactMaterial.friction = 0.01; // Basso attrito globale, gestito dalle ruote

    // Materiale per il terreno vs ruote
    const groundMat = new CANNON.Material();
    const wheelMat = new CANNON.Material();
    const wheelGroundContact = new CANNON.ContactMaterial(wheelMat, groundMat, {
        friction: 0.3,
        restitution: 0,
        contactEquationStiffness: 1000
    });
    world.addContactMaterial(wheelGroundContact);

    // 3. Input Listeners
    setupInputs();

    // 4. Genera Pista e Auto
    generateTrack();
    createCar(wheelMat);

    // 5. Loop
    requestAnimationFrame(animate);

    // UI Listener
    document.getElementById('gen-btn').addEventListener('click', () => {
        resetTrack(true);
    });
}

// --- SISTEMA AUTO (Car Controller) ---
let chassisMesh, speedoCanvas, speedoCtx, speedoTexture;

function createCar(wheelMaterial) {
    // Telaio Fisica
    const chassisShape = new CANNON.Box(new CANNON.Vec3(CONFIG.chassisWidth/2, CONFIG.chassisHeight/2, CONFIG.chassisLength/2));
    const chassisBody = new CANNON.Body({ mass: CONFIG.mass });
    chassisBody.addShape(chassisShape);
    chassisBody.position.set(0, 4, 0);
    chassisBody.angularDamping = 0.5; // Stabilità aerea
    world.addBody(chassisBody);

    // Telaio Grafica (Low Poly Style)
    const geo = new THREE.BoxGeometry(CONFIG.chassisWidth, CONFIG.chassisHeight, CONFIG.chassisLength);
    const mat = new THREE.MeshStandardMaterial({ color: 0xff3333 }); // Rosso
    chassisMesh = new THREE.Mesh(geo, mat);
    chassisMesh.castShadow = true;
    scene.add(chassisMesh);

    // --- LA CHICCA: Tachimetro sul retro ---
    // Creiamo una texture canvas dinamica
    speedoCanvas = document.createElement('canvas');
    speedoCanvas.width = 128;
    speedoCanvas.height = 64;
    speedoCtx = speedoCanvas.getContext('2d');
    speedoTexture = new THREE.CanvasTexture(speedoCanvas);
    
    // Creiamo un piano per il retro della macchina
    const speedoPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 0.5),
        new THREE.MeshBasicMaterial({ map: speedoTexture, transparent: true })
    );
    speedoPlane.position.set(0, 0, CONFIG.chassisLength/2 + 0.01); // Appena dietro
    speedoPlane.rotation.y = Math.PI; // Ruotato verso la camera
    chassisMesh.add(speedoPlane);

    // Veicolo Raycast
    vehicle = new CANNON.RaycastVehicle({
        chassisBody: chassisBody,
        indexRightAxis: 0, // x
        indexUpAxis: 1,    // y
        indexForwardAxis: 2 // z
    });

    const options = {
        radius: 0.4,
        directionLocal: new CANNON.Vec3(0, -1, 0),
        suspensionStiffness: 30,
        suspensionRestLength: 0.3,
        frictionSlip: 2.0, // Grip arcade
        dampingRelaxation: 2.3,
        dampingCompression: 4.4,
        maxSuspensionForce: 100000,
        rollInfluence: 0.01,
        axleLocal: new CANNON.Vec3(-1, 0, 0),
        chassisConnectionPointLocal: new CANNON.Vec3(1, 1, 0),
        maxSuspensionTravel: 0.3,
        customSlidingRotationalSpeed: -30,
        useCustomSlidingRotationalSpeed: true
    };

    // Aggiungi ruote
    // Fronte Sinistra
    options.chassisConnectionPointLocal.set(CONFIG.chassisWidth/2 - 0.2, -CONFIG.chassisHeight/2, CONFIG.chassisLength/2 - 0.5);
    vehicle.addWheel(options);
    // Fronte Destra
    options.chassisConnectionPointLocal.set(-CONFIG.chassisWidth/2 + 0.2, -CONFIG.chassisHeight/2, CONFIG.chassisLength/2 - 0.5);
    vehicle.addWheel(options);
    // Retro Sinistra
    options.chassisConnectionPointLocal.set(CONFIG.chassisWidth/2 - 0.2, -CONFIG.chassisHeight/2, -CONFIG.chassisLength/2 + 0.5);
    vehicle.addWheel(options);
    // Retro Destra
    options.chassisConnectionPointLocal.set(-CONFIG.chassisWidth/2 + 0.2, -CONFIG.chassisHeight/2, -CONFIG.chassisLength/2 + 0.5);
    vehicle.addWheel(options);

    vehicle.addToWorld(world);

    // Grafica Ruote
    const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.4, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMatVis = new THREE.MeshStandardMaterial({ color: 0x333333 });
    
    vehicle.wheelInfos.forEach((wheel) => {
        const cylinder = new THREE.Mesh(wheelGeo, wheelMatVis);
        cylinder.castShadow = true;
        scene.add(cylinder);
        wheel.mesh = cylinder; // Colleghiamo mesh alla ruota fisica
    });
}

// --- GENERATORE MODULARE DI PISTE ---
const BLOCK_SIZE = 10;
const MODULES = {
    STRAIGHT: 'straight',
    TURN_LEFT: 'left',
    TURN_RIGHT: 'right',
    RAMP_UP: 'ramp_up',
    RAMP_DOWN: 'ramp_down', // Non implementato per semplicità, ma predisposto
    CHECKPOINT: 'checkpoint'
};

function createBlock(type, x, y, z, rotationIndex) {
    let shape, geo, color, trigger = false;
    const half = BLOCK_SIZE / 2;
    const thickness = 1;
    
    // Materiali condivisi per performance
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x555555 });
    const borderMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
    const checkMat = new THREE.MeshStandardMaterial({ color: 0x0000ff, transparent: true, opacity: 0.3 });

    const container = new THREE.Object3D();
    container.position.set(x, y, z);
    container.rotation.y = rotationIndex * (Math.PI / 2);

    // Logica di costruzione del blocco
    if (type === MODULES.STRAIGHT || type === MODULES.CHECKPOINT) {
        // Strada dritta
        const physBox = new CANNON.Box(new CANNON.Vec3(BLOCK_SIZE/2, thickness/2, BLOCK_SIZE/2));
        shape = physBox;
        geo = new THREE.BoxGeometry(BLOCK_SIZE, thickness, BLOCK_SIZE);
        color = roadMat;
        
        if (type === MODULES.CHECKPOINT) {
            trigger = true;
            // Aggiungi arco visivo
            const arch = new THREE.Mesh(new THREE.BoxGeometry(BLOCK_SIZE, 5, 1), checkMat);
            arch.position.y = 2.5;
            container.add(arch);
        }
    } else if (type === MODULES.TURN_LEFT) {
        // Curva semplice (approssimata con un box per ora per fisica veloce)
        // Per una curva vera servirebbe Trimesh, ma usiamo un box ruotato leggermente o un pavimento pieno
        // Per semplicità "Low Poly", facciamo una strada normale ma la logica del generatore ruota il prossimo pezzo
        const physBox = new CANNON.Box(new CANNON.Vec3(BLOCK_SIZE/2, thickness/2, BLOCK_SIZE/2));
        shape = physBox;
        geo = new THREE.BoxGeometry(BLOCK_SIZE, thickness, BLOCK_SIZE);
        color = roadMat;
        
        // Muri visivi per indicare la curva
        const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 2, BLOCK_SIZE), new THREE.MeshStandardMaterial({color: 0xff0000}));
        wall.position.set(BLOCK_SIZE/2 - 0.5, 1, 0);
        container.add(wall);
    } else if (type === MODULES.RAMP_UP) {
        // Rampa
        // Fisica: Box ruotato
        const angle = Math.PI / 6; // 30 gradi
        const rampLen = BLOCK_SIZE / Math.cos(angle);
        const physBox = new CANNON.Box(new CANNON.Vec3(BLOCK_SIZE/2, thickness/2, rampLen/2));
        shape = physBox;
        geo = new THREE.BoxGeometry(BLOCK_SIZE, thickness, rampLen);
        color = roadMat;
        
        // Aggiustamenti locali
        container.rotation.x = -angle; 
        // Nota: Le rampe complicate richiedono calcoli offset Y precisi nel generatore
    }

    // Creazione corpo fisico statico
    if (shape) {
        const body = new CANNON.Body({ mass: 0 }); // Statico
        body.addShape(shape);
        // Sincronizza pos/rot
        body.position.copy(container.position);
        body.quaternion.copy(container.quaternion);
        
        // Se è un checkpoint, lo impostiamo come sensore (collisionResponse = false)
        if (trigger) {
           body.collisionResponse = false; 
           body.isCheckpoint = true;
        }

        world.addBody(body);
        trackBodies.push(body);
    }

    // Mesh grafica principale
    if (geo) {
        const mesh = new THREE.Mesh(geo, color);
        mesh.receiveShadow = true;
        container.add(mesh);
    }

    scene.add(container);
    trackMeshes.push(container);
}

function generateTrack() {
    // Pulisci vecchia pista
    trackMeshes.forEach(m => scene.remove(m));
    trackBodies.forEach(b => world.removeBody(b));
    trackMeshes.length = 0;
    trackBodies.length = 0;

    let x = 0, y = 0, z = 0;
    let dir = 0; // 0: -Z (avanti), 1: -X (sinistra), 2: +Z (indietro), 3: +X (destra)
    
    // Piattaforma di partenza
    createBlock(MODULES.STRAIGHT, 0, -1, 0, 0);
    // Imposta checkpoint iniziale
    lastCheckpointPosition.set(0, 2, 0);
    lastCheckpointQuaternion.set(0, 0, 0, 1);

    // Algoritmo semplice "Snake"
    const length = 20 + Math.floor(Math.random() * 20); // 20-40 pezzi
    
    // Spostiamo il cursore al primo blocco davanti
    z -= BLOCK_SIZE;

    for (let i = 0; i < length; i++) {
        const rand = Math.random();
        let type = MODULES.STRAIGHT;

        // Logica checkpoint ogni 5 blocchi
        if (i > 0 && i % 8 === 0) type = MODULES.CHECKPOINT;
        
        // Logica curve (non se siamo su un checkpoint)
        else if (rand < 0.2) {
            type = MODULES.TURN_LEFT;
            dir = (dir + 1) % 4;
        } else if (rand < 0.4) {
            type = MODULES.TURN_LEFT; // Graficamente uguale, logica gestita da 'dir'
            dir = (dir - 1 + 4) % 4;
        }
        
        createBlock(type, x, y, z, 0); // RotationIndex 0 perché ruotiamo logicamente le coordinate sotto

        // Calcola prossima posizione basata su DIR
        switch(dir) {
            case 0: z -= BLOCK_SIZE; break; // Nord
            case 1: x -= BLOCK_SIZE; break; // Ovest
            case 2: z += BLOCK_SIZE; break; // Sud
            case 3: x += BLOCK_SIZE; break; // Est
        }
    }

    // Blocco finale
    createBlock(MODULES.CHECKPOINT, x, y, z, 0); // Finish line (usa checkpoint logic per ora)
    
    // Reset timer
    timerStart = performance.now();
    isRacing = true;
}

// --- LOGICA DI GIOCO ---
function updateSpeedometer() {
    if(!vehicle) return;
    
    // Calcola velocità km/h (cannon units approx meters)
    const speed = vehicle.chassisBody.velocity.length() * 3.6;
    const speedInt = Math.floor(speed);

    // Disegna su canvas
    speedoCtx.fillStyle = '#000000';
    speedoCtx.fillRect(0, 0, 128, 64);
    
    speedoCtx.fillStyle = speedInt > 100 ? '#ff0000' : '#00ff00';
    speedoCtx.font = 'bold 40px Arial';
    speedoCtx.textAlign = 'center';
    speedoCtx.textBaseline = 'middle';
    speedoCtx.fillText(speedInt.toString(), 64, 32);

    // Aggiorna texture Three.js
    speedoTexture.needsUpdate = true;
}

function checkCheckpoints() {
    // Controllo collisioni manuale semplice
    const carPos = vehicle.chassisBody.position;
    
    trackBodies.forEach(b => {
        if (b.isCheckpoint) {
            // Distanza semplice
            const dx = Math.abs(b.position.x - carPos.x);
            const dz = Math.abs(b.position.z - carPos.z);
            
            // Se siamo dentro il blocco (approssimativamente)
            if (dx < BLOCK_SIZE/2 && dz < BLOCK_SIZE/2) {
                // È un checkpoint nuovo? (semplificazione: prendiamo sempre l'ultimo toccato come valido)
                // In un gioco completo servirebbe un sistema di indici (CP 1, CP 2...)
                if (Math.abs(lastCheckpointPosition.x - b.position.x) > 1 || Math.abs(lastCheckpointPosition.z - b.position.z) > 1) {
                    lastCheckpointPosition.copy(b.position);
                    lastCheckpointPosition.y += 2;
                    lastCheckpointQuaternion.copy(vehicle.chassisBody.quaternion);
                    showMessage("CHECKPOINT!");
                }
            }
        }
    });
}

function showMessage(text) {
    uiMsg.innerText = text;
    uiMsg.style.display = 'block';
    setTimeout(() => { uiMsg.style.display = 'none'; }, 1000);
}

function resetTrack(generateNew = false) {
    if (generateNew) {
        generateTrack();
    }
    respawn(true);
    timerStart = performance.now();
}

function respawn(fromStart = false) {
    vehicle.chassisBody.velocity.set(0, 0, 0);
    vehicle.chassisBody.angularVelocity.set(0, 0, 0);
    
    if (fromStart) {
        vehicle.chassisBody.position.set(0, 4, 0);
        vehicle.chassisBody.quaternion.set(0, 0, 0, 1);
    } else {
        vehicle.chassisBody.position.copy(lastCheckpointPosition);
        vehicle.chassisBody.quaternion.copy(lastCheckpointQuaternion);
    }
}

// --- INPUT & UPDATE ---
function setupInputs() {
    window.addEventListener('keydown', (e) => {
        switch(e.key) {
            case 'w': case 'ArrowUp': keys.w = true; break;
            case 's': case 'ArrowDown': keys.s = true; break;
            case 'a': case 'ArrowLeft': keys.a = true; break;
            case 'd': case 'ArrowRight': keys.d = true; break;
            case ' ': keys.space = true; break;
            case 'Enter': respawn(); break;
            case 'Delete': case 'Backspace': resetTrack(false); break;
        }
    });
    window.addEventListener('keyup', (e) => {
        switch(e.key) {
            case 'w': case 'ArrowUp': keys.w = false; break;
            case 's': case 'ArrowDown': keys.s = false; break;
            case 'a': case 'ArrowLeft': keys.a = false; break;
            case 'd': case 'ArrowRight': keys.d = false; break;
            case ' ': keys.space = false; break;
        }
    });
    
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

function animate() {
    requestAnimationFrame(animate);

    // Physics Update
    world.step(1 / 60);

    // Vehicle Control Logic
    if (vehicle) {
        // Motore
        let force = 0;
        if (keys.w) force = -CONFIG.engineForce;
        if (keys.s) force = CONFIG.engineForce / 2;
        vehicle.applyEngineForce(force, 2);
        vehicle.applyEngineForce(force, 3);

        // Sterzo
        let steer = 0;
        if (keys.a) steer = CONFIG.maxSteerVal;
        if (keys.d) steer = -CONFIG.maxSteerVal;
        vehicle.setSteeringValue(steer, 0);
        vehicle.setSteeringValue(steer, 1);

        // Freno
        let brake = 0;
        if (keys.space) brake = CONFIG.brakeForce;
        vehicle.setBrake(brake, 0);
        vehicle.setBrake(brake, 1);
        vehicle.setBrake(brake, 2);
        vehicle.setBrake(brake, 3);

        // Update Visuals
        const p = vehicle.chassisBody.position;
        const q = vehicle.chassisBody.quaternion;
        chassisMesh.position.copy(p);
        chassisMesh.quaternion.copy(q);

        // Camera Follow (Soft follow)
        const relativeCameraOffset = new THREE.Vector3(0, 5, 10);
        const cameraOffset = relativeCameraOffset.applyMatrix4(chassisMesh.matrixWorld);
        camera.position.lerp(cameraOffset, 0.1);
        camera.lookAt(p);

        // Ruote Visuali
        for (let i = 0; i < vehicle.wheelInfos.length; i++) {
            vehicle.updateWheelTransform(i);
            const t = vehicle.wheelInfos[i].worldTransform;
            vehicle.wheelInfos[i].mesh.position.copy(t.position);
            vehicle.wheelInfos[i].mesh.quaternion.copy(t.quaternion);
        }

        updateSpeedometer();
        checkCheckpoints();
        
        // Reset se cadi
        if (p.y < -10) respawn();
    }

    // UI Update
    if (isRacing) {
        const now = performance.now();
        const diff = now - timerStart;
        const mins = Math.floor(diff / 60000).toString().padStart(2, '0');
        const secs = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
        const ms = Math.floor(diff % 1000).toString().padStart(3, '0');
        uiTimer.innerText = `${mins}:${secs}.${ms}`;
    }

    renderer.render(scene, camera);
}

init();
