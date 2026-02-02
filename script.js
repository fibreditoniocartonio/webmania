import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// --- CONFIGURAZIONE GLOBALE ---
const CONFIG = {
    stepFrequency: 60,
    gravity: -20,
    chassisWidth: 1.8,
    chassisHeight: 0.6,
    chassisLength: 4,
    mass: 150,
    engineForce: 1500, // Potenziato un po'
    brakeForce: 50,
    maxSteerVal: 0.4,
};

// --- VARIABILI GLOBALI ---
let scene, camera, renderer, world;
let vehicle, chassisMesh;
let chassisBody; // Riferimento diretto al corpo fisico
let lastCheckpointPosition = new CANNON.Vec3(0, 5, 0); // Più in alto per sicurezza
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
        const wheelMat = new CANNON.Material('wheel');
        const wheelGroundContact = new CANNON.ContactMaterial(wheelMat, groundMat, {
            friction: 0.3,
            restitution: 0,
            contactEquationStiffness: 1000
        });
        world.addContactMaterial(wheelGroundContact);

        // 3. Setup Gioco
        setupInputs();
        generateTrack(groundMat);
        createCar(wheelMat);

        // Avvia loop
        timerStart = performance.now();
        animate();

        // UI Listener
        document.getElementById('gen-btn').addEventListener('click', () => resetTrack(true));
        
        console.log("Gioco Inizializzato Correttamente");

    } catch (e) {
        console.error(e);
        document.getElementById('error-log').style.display = 'block';
        document.getElementById('error-log').innerText = "Errore Init: " + e.message;
    }
}

// --- GENERATORE MODULARE PISTA ---
const MODULES = { STRAIGHT: 'straight', TURN_LEFT: 'left', TURN_RIGHT: 'right', CHECKPOINT: 'checkpoint' };
const BLOCK_SIZE = 10;

function createBlock(type, x, y, z, rotationIndex, matPhysics) {
    const container = new THREE.Object3D();
    container.position.set(x, y, z);
    
    // Ruota il contenitore in base alla direzione
    // 0 = Nord (-Z), 1 = Ovest (-X), 2 = Sud (+Z), 3 = Est (+X)
    container.rotation.y = rotationIndex * (Math.PI / 2);

    let geo, mat, shape;
    const roadColor = 0x555555;

    // Semplifichiamo: tutti i blocchi sono piatti per ora per garantire che funzionino
    geo = new THREE.BoxGeometry(BLOCK_SIZE, 1, BLOCK_SIZE);
    mat = new THREE.MeshStandardMaterial({ color: roadColor });
    shape = new CANNON.Box(new CANNON.Vec3(BLOCK_SIZE/2, 0.5, BLOCK_SIZE/2));

    // Aggiunte visive per capire i tipi
    if (type === MODULES.CHECKPOINT) mat = new THREE.MeshStandardMaterial({ color: 0x0000AA }); // Blu scuro
    if (type === MODULES.TURN_LEFT) mat = new THREE.MeshStandardMaterial({ color: 0xAA5555 }); // Rossiccio

    // Mesh Grafica
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    container.add(mesh);
    scene.add(container);
    trackMeshes.push(container);

    // Corpo Fisico
    const body = new CANNON.Body({ mass: 0, material: matPhysics }); // 0 mass = statico
    body.addShape(shape);
    body.position.copy(container.position);
    body.quaternion.copy(container.quaternion);
    
    // Checkpoint logic
    if (type === MODULES.CHECKPOINT) {
        body.isCheckpoint = true; // Tag personalizzato
        // Arco visivo
        const arch = new THREE.Mesh(new THREE.BoxGeometry(BLOCK_SIZE, 0.5, 1), new THREE.MeshBasicMaterial({color: 0x00ff00}));
        arch.position.set(0, 3, 0);
        container.add(arch);
    }

    world.addBody(body);
    trackBodies.push(body);
}

function generateTrack(matPhysics) {
    trackMeshes.forEach(m => scene.remove(m));
    trackBodies.forEach(b => world.removeBody(b));
    trackMeshes.length = 0;
    trackBodies.length = 0;

    let x = 0, y = -1, z = 0; // Pista leggermente sotto lo 0
    let dir = 0; // 0: -Z, 1: -X, 2: +Z, 3: +X

    // Piattaforma Start
    createBlock(MODULES.STRAIGHT, x, y, z, 0, matPhysics);
    createBlock(MODULES.STRAIGHT, x, y, z - BLOCK_SIZE, 0, matPhysics);
    z -= BLOCK_SIZE;

    const length = 30;
    for(let i=0; i<length; i++) {
        const r = Math.random();
        let type = MODULES.STRAIGHT;

        // Logica semplice per generare curve
        if (i > 2 && i % 8 === 0) type = MODULES.CHECKPOINT;
        else if (r < 0.2) type = MODULES.TURN_LEFT;
        else if (r < 0.4) type = MODULES.TURN_RIGHT;

        // Calcola posizione successiva PRIMA di piazzare, basandoci sulla direzione CORRENTE
        switch(dir) {
            case 0: z -= BLOCK_SIZE; break;
            case 1: x -= BLOCK_SIZE; break;
            case 2: z += BLOCK_SIZE; break;
            case 3: x += BLOCK_SIZE; break;
        }

        // Aggiorna direzione se abbiamo curvato
        if (type === MODULES.TURN_LEFT) dir = (dir + 1) % 4;
        if (type === MODULES.TURN_RIGHT) dir = (dir + 3) % 4; // +3 è come -1 (destra relativa)

        createBlock(type, x, y, z, 0, matPhysics);
    }
    
    // Imposta respawn
    lastCheckpointPosition.set(0, 2, 0);
    lastCheckpointQuaternion.set(0, 0, 0, 1);
    isRacing = true;
}

// --- CREAZIONE AUTO ---
let speedoCtx, speedoTexture;

function createCar(wheelMat) {
    // 1. Telaio
    const chassisShape = new CANNON.Box(new CANNON.Vec3(CONFIG.chassisWidth/2, CONFIG.chassisHeight/2, CONFIG.chassisLength/2));
    chassisBody = new CANNON.Body({ mass: CONFIG.mass });
    chassisBody.addShape(chassisShape);
    chassisBody.position.set(0, 4, 0); // Spawn in alto
    chassisBody.angularDamping = 0.5;
    world.addBody(chassisBody);

    // Mesh
    const geo = new THREE.BoxGeometry(CONFIG.chassisWidth, CONFIG.chassisHeight, CONFIG.chassisLength);
    const mat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    chassisMesh = new THREE.Mesh(geo, mat);
    scene.add(chassisMesh);

    // Tachimetro
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 64;
    speedoCtx = canvas.getContext('2d');
    speedoTexture = new THREE.CanvasTexture(canvas);
    const speedoPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.5), new THREE.MeshBasicMaterial({ map: speedoTexture }));
    speedoPlane.rotation.y = Math.PI;
    speedoPlane.position.set(0, 0, CONFIG.chassisLength/2 + 0.01);
    chassisMesh.add(speedoPlane);

    // 2. Veicolo
    vehicle = new CANNON.RaycastVehicle({
        chassisBody: chassisBody,
        indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2
    });

    const options = {
        radius: 0.4,
        directionLocal: new CANNON.Vec3(0, -1, 0),
        suspensionStiffness: 30,
        suspensionRestLength: 0.3,
        frictionSlip: 1.4,
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

    // Aggiungi 4 ruote
    const w = CONFIG.chassisWidth / 2;
    const h = -CONFIG.chassisHeight / 2;
    const l = CONFIG.chassisLength / 2 - 0.5;

    // FL, FR (Fronte - Indici 0 e 1 per lo sterzo)
    options.chassisConnectionPointLocal.set(w - 0.2, h, -l);
    vehicle.addWheel(options);
    options.chassisConnectionPointLocal.set(-w + 0.2, h, -l);
    vehicle.addWheel(options);
    // RL, RR (Retro - Indici 2 e 3 per la trazione)
    options.chassisConnectionPointLocal.set(w - 0.2, h, l);
    vehicle.addWheel(options);
    options.chassisConnectionPointLocal.set(-w + 0.2, h, l);
    vehicle.addWheel(options);

    vehicle.addToWorld(world);

    // Mesh Ruote
    const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.4, 12);
    wheelGeo.rotateZ(Math.PI/2);
    const wheelMatVis = new THREE.MeshStandardMaterial({ color: 0x222222 });

    vehicle.wheelInfos.forEach(w => {
        const mesh = new THREE.Mesh(wheelGeo, wheelMatVis);
        scene.add(mesh);
        w.mesh = mesh;
    });
}

// --- LOOP PRINCIPALE ---
function animate() {
    requestAnimationFrame(animate);

    // Fisica Step Fisso
    world.step(1/60);

    if (vehicle && chassisMesh) {
        // Sync Grafica-Fisica
        chassisMesh.position.copy(chassisBody.position);
        chassisMesh.quaternion.copy(chassisBody.quaternion);

        // Controlli
        const force = keys.w ? CONFIG.engineForce : (keys.s ? -CONFIG.engineForce / 2 : 0);
        vehicle.applyEngineForce(force, 2);
        vehicle.applyEngineForce(force, 3);

        const steer = keys.a ? CONFIG.maxSteerVal : (keys.d ? -CONFIG.maxSteerVal : 0);
        vehicle.setSteeringValue(steer, 0);
        vehicle.setSteeringValue(steer, 1);

        const brake = keys.space ? CONFIG.brakeForce : 0;
        vehicle.setBrake(brake, 0);
        vehicle.setBrake(brake, 1);
        vehicle.setBrake(brake, 2);
        vehicle.setBrake(brake, 3);

        // Update Ruote
        for (let i=0; i<vehicle.wheelInfos.length; i++) {
            vehicle.updateWheelTransform(i);
            const t = vehicle.wheelInfos[i].worldTransform;
            vehicle.wheelInfos[i].mesh.position.copy(t.position);
            vehicle.wheelInfos[i].mesh.quaternion.copy(t.quaternion);
        }

        // Camera Follow
        const camOffset = new THREE.Vector3(0, 4, 8);
        camOffset.applyMatrix4(chassisMesh.matrixWorld);
        camera.position.lerp(camOffset, 0.1);
        camera.lookAt(chassisMesh.position);

        // Respawn automatico se cadi
        if (chassisBody.position.y < -10) respawn();
        
        // Tachimetro
        const kmh = Math.floor(chassisBody.velocity.length() * 3.6);
        speedoCtx.fillStyle = 'black';
        speedoCtx.fillRect(0,0,128,64);
        speedoCtx.fillStyle = 'white';
        speedoCtx.font = 'bold 40px Arial';
        speedoCtx.fillText(kmh, 40, 45);
        speedoTexture.needsUpdate = true;
        
        // Check Checkpoints (Semplificato)
        trackBodies.forEach(b => {
            if(b.isCheckpoint) {
                const dx = Math.abs(b.position.x - chassisBody.position.x);
                const dz = Math.abs(b.position.z - chassisBody.position.z);
                if(dx < 5 && dz < 5) {
                    // Update checkpoint
                    if(b.position.distanceTo(lastCheckpointPosition) > 2) {
                        lastCheckpointPosition.copy(b.position);
                        lastCheckpointPosition.y += 2;
                        lastCheckpointQuaternion.copy(chassisBody.quaternion);
                        uiMsg.style.display = 'block';
                        uiMsg.innerText = "CHECKPOINT";
                        setTimeout(() => uiMsg.style.display='none', 1000);
                    }
                }
            }
        });
    }

    // UI Timer
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

function resetTrack(generateNew) {
    if(generateNew) generateTrack(world.defaultContactMaterial); // Hack per riusare materiale
    respawn();
    timerStart = performance.now();
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
