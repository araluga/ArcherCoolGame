// Error catching for debugging (console-only, no blocking alerts)
window.onerror = function(msg, url, line, col, error) {
    console.error("Game Error: ", msg, "at", url, ":", line);
};

if (typeof Matter === 'undefined') {
    console.error("Matter.js failed to load. Check that matter.min.js is in the game folder.");
}

// Matter.js Module aliases
const { Engine, Render, Runner, Bodies, Body, Composite, Constraint, Vector, Events } = Matter;

// Web Audio API Context
let audioCtx = null;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
}

// Sound Synthesizers
function playSound(type) {
    if (!audioCtx) return;
    try {
        const now = audioCtx.currentTime;
        if (type === 'bow_pull') {
            // Low friction clicky string sound
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(100, now);
            osc.frequency.exponentialRampToValueAtTime(300, now + 0.4);
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now);
            osc.stop(now + 0.45);
        } else if (type === 'bow_release') {
            // Quick snap / whoosh
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(400, now);
            osc.frequency.exponentialRampToValueAtTime(80, now + 0.15);
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now);
            osc.stop(now + 0.2);
        } else if (type === 'hit_flesh') {
            // Crunch/thud
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(150, now);
            osc.frequency.linearRampToValueAtTime(40, now + 0.1);
            gain.gain.setValueAtTime(0.4, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now);
            osc.stop(now + 0.2);
        } else if (type === 'hit_platform') {
            // Wood/rock clack
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(350, now);
            osc.frequency.exponentialRampToValueAtTime(120, now + 0.08);
            gain.gain.setValueAtTime(0.25, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now);
            osc.stop(now + 0.1);
        }
    } catch (e) {
        console.warn('Audio play failed:', e);
    }
}

// Game Settings & State
const CONFIG = {
    gravity: 0.8,
    arrowSpeedMult: 0.14,
    ragdollInertiaScale: 5, // Extra inertia for satisfying heavy feel
    aiShootInterval: 3000,
};

const SHOP_HATS = [
    { id: 'none', name: 'Без шляпы', emoji: '🧑', price: 0 },
    { id: 'hood', name: 'Капюшон', emoji: '👤', price: 50 },
    { id: 'cowboy', name: 'Ковбойская', emoji: '🤠', price: 80 },
    { id: 'crown', name: 'Корона', emoji: '👑', price: 150 },
    { id: 'tophat', name: 'Цилиндр', emoji: '🎩', price: 100 },
    { id: 'viking', name: 'Шлем викинга', emoji: '🪖', price: 120 }
];

const SHOP_SKINS = [
    { id: '#3b82f6', name: 'Кибер Синий', color: '#3b82f6', price: 0 },
    { id: '#10b981', name: 'Изумрудный', color: '#10b981', price: 40 },
    { id: '#fbbf24', name: 'Золотой', color: '#fbbf24', price: 120 },
    { id: '#8b5cf6', name: 'Фиолетовый', color: '#8b5cf6', price: 70 },
    { id: '#f43f5e', name: 'Багровый', color: '#f43f5e', price: 90 }
];

let game = {
    engine: null,
    runner: null,
    canvas: null,
    ctx: null,
    player: null,
    enemy: null,
    arrows: [],
    particles: [],
    wind: { x: 0, y: 0 },
    windTimer: 0,
    gameState: 'start', // start, playing, gameover
    activeTurn: 'player', // player, ai
    selectedModes: [],    // Array of selected event indices
    eventEffects: [],     // Array of active event effects (e.g. 'shields', 'low_gravity')
    aiming: {
        active: false,
        startPos: { x: 0, y: 0 },
        currentPos: { x: 0, y: 0 },
    },
    aiAiming: {
        active: false,
        angle: 0,
        pullDist: 0,
        targetAngle: 0,
        targetPullDist: 0
    },
    scores: {
        player: 0,
        enemy: 0
    },
    cam: {
        x: 0,
        y: 0,
        targetX: 0,
        targetY: 0,
        zoom: 1,
        targetZoom: 1
    },
    platforms: [],
    selectedPlatformType: 'default',
    killStreak: 0,   // consecutive enemies defeated without dying
    customization: {
        gold: 0,
        equippedHat: 'none',
        equippedSkin: '#3b82f6',
        ownedHats: ['none'],
        ownedSkins: ['#3b82f6']
    }
};

function saveShopData() {
    localStorage.setItem('apex_archer_shop', JSON.stringify(game.customization));
    updateGoldUI();
}

function loadShopData() {
    try {
        const saved = localStorage.getItem('apex_archer_shop');
        if (saved) {
            const data = JSON.parse(saved);
            if (data) {
                game.customization = {
                    gold: typeof data.gold === 'number' ? data.gold : 0,
                    equippedHat: data.equippedHat || 'none',
                    equippedSkin: data.equippedSkin || '#3b82f6',
                    ownedHats: Array.isArray(data.ownedHats) ? data.ownedHats : ['none'],
                    ownedSkins: Array.isArray(data.ownedSkins) ? data.ownedSkins : ['#3b82f6']
                };
            }
        }
    } catch (e) {
        console.error("Failed to load shop data:", e);
    }
    updateGoldUI();
}

function updateGoldUI() {
    const goldHud = document.getElementById('gold-value-hud');
    if (goldHud) {
        goldHud.innerText = game.customization.gold;
    }
}


// High-performance Particle static pool configuration
const MAX_PARTICLES = 300;
const PARTICLE_POOL = Array.from({ length: MAX_PARTICLES }, () => ({
    active: false,
    x: 0, y: 0, vx: 0, vy: 0, life: 0, decay: 0, size: 0, color: ''
}));

function createExplosion(x, y, color, count = 10, speed = 5) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const s = (0.2 + Math.random() * 0.8) * speed;
        
        // Find inactive particle or hijack the oldest one to prevent memory allocations
        let p = null;
        for (let j = 0; j < PARTICLE_POOL.length; j++) {
            if (!PARTICLE_POOL[j].active) {
                p = PARTICLE_POOL[j];
                break;
            }
        }
        if (!p) {
            // Pool is full, reuse first random one
            p = PARTICLE_POOL[Math.floor(Math.random() * MAX_PARTICLES)];
        }
        
        p.active = true;
        p.x = x;
        p.y = y;
        p.vx = Math.cos(angle) * s;
        p.vy = Math.sin(angle) * s;
        p.life = 1.0;
        p.decay = 0.015 + Math.random() * 0.02;
        p.size = 2 + Math.random() * 4;
        p.color = color;
    }
}

// Create skeletal Ragdoll
function createRagdoll(x, y, isEnemy = false) {
    const scale = 1.0;
    const group = Body.nextGroup(true);
    
    // Check if Big Heads event is active
    const isBigHead = game.eventEffects.includes('big_heads');
    const headRadius = isBigHead ? 25 * scale : 12 * scale;
    const headYOffset = isBigHead ? -75 * scale : -65 * scale;

    // Body parts with tailored physical attributes
    const parts = {
        head: Bodies.circle(x, y + headYOffset, headRadius, { 
            collisionFilter: { group: group }, 
            density: isBigHead ? 0.0006 : 0.0018, // reduce density to prevent neck breaking
            label: isEnemy ? 'enemy_head' : 'player_head',
            render: { fillStyle: '#fda4af' } // Rosy head
        }),
        torso: Bodies.rectangle(x, y - 25 * scale, 18 * scale, 45 * scale, { 
            collisionFilter: { group: group }, 
            density: 0.0018,
            chamfer: { radius: 5 },
            label: isEnemy ? 'enemy_body' : 'player_body',
            render: { fillStyle: isEnemy ? '#f43f5e' : (game.customization ? game.customization.equippedSkin : '#3b82f6') }
        }),
        pelvis: Bodies.rectangle(x, y + 10 * scale, 16 * scale, 15 * scale, { 
            collisionFilter: { group: group }, 
            density: 0.0018,
            label: isEnemy ? 'enemy_limb' : 'player_limb',
            render: { fillStyle: '#475569' }
        }),
        
        // Arms
        upperArmL: Bodies.rectangle(x - 15 * scale, y - 35 * scale, 8 * scale, 24 * scale, { collisionFilter: { group: group }, density: 0.0015, label: isEnemy ? 'enemy_limb' : 'player_limb' }),
        upperArmR: Bodies.rectangle(x + 15 * scale, y - 35 * scale, 8 * scale, 24 * scale, { collisionFilter: { group: group }, density: 0.0015, label: isEnemy ? 'enemy_limb' : 'player_limb' }),
        lowerArmL: Bodies.rectangle(x - 15 * scale, y - 15 * scale, 6 * scale, 22 * scale, { collisionFilter: { group: group }, density: 0.0015, label: isEnemy ? 'enemy_limb' : 'player_limb' }),
        lowerArmR: Bodies.rectangle(x + 15 * scale, y - 15 * scale, 6 * scale, 22 * scale, { collisionFilter: { group: group }, density: 0.0015, label: isEnemy ? 'enemy_limb' : 'player_limb' }),

        // Legs
        upperLegL: Bodies.rectangle(x - 8 * scale, y + 25 * scale, 9 * scale, 30 * scale, { collisionFilter: { group: group }, density: 0.002, label: isEnemy ? 'enemy_limb' : 'player_limb' }),
        upperLegR: Bodies.rectangle(x + 8 * scale, y + 25 * scale, 9 * scale, 30 * scale, { collisionFilter: { group: group }, density: 0.002, label: isEnemy ? 'enemy_limb' : 'player_limb' }),
        lowerLegL: Bodies.rectangle(x - 8 * scale, y + 55 * scale, 7 * scale, 28 * scale, { collisionFilter: { group: group }, density: 0.002, label: isEnemy ? 'enemy_limb' : 'player_limb' }),
        lowerLegR: Bodies.rectangle(x + 8 * scale, y + 55 * scale, 7 * scale, 28 * scale, { collisionFilter: { group: group }, density: 0.002, label: isEnemy ? 'enemy_limb' : 'player_limb' }),
    };

    // Styling arm/leg colors
    const limbColor = isEnemy ? '#e11d48' : (game.customization ? game.customization.equippedSkin : '#2563eb');
    Object.keys(parts).forEach(key => {
        if (key.includes('Arm') || key.includes('Leg')) {
            parts[key].render.fillStyle = limbColor;
        }
    });

    // Explicitly set realistic masses for Active Ragdoll physics
    Body.setMass(parts.torso, 5.0 * scale);
    Body.setMass(parts.pelvis, 2.0 * scale);
    Body.setMass(parts.head, (isBigHead ? 3.0 : 1.0) * scale);
    Body.setMass(parts.upperArmL, 0.5 * scale);
    Body.setMass(parts.upperArmR, 0.5 * scale);
    Body.setMass(parts.lowerArmL, 0.4 * scale);
    Body.setMass(parts.lowerArmR, 0.4 * scale);
    Body.setMass(parts.upperLegL, 0.8 * scale);
    Body.setMass(parts.upperLegR, 0.8 * scale);
    Body.setMass(parts.lowerLegL, 0.6 * scale);
    Body.setMass(parts.lowerLegR, 0.6 * scale);

    // Apply inertia scale to all parts to make them rotate cleanly
    Object.values(parts).forEach(part => {
        Body.setInertia(part, part.inertia * CONFIG.ragdollInertiaScale);
    });

    // Connecting bones with constraints representing joints
    const joints = [
        // Head to torso
        Constraint.create({ bodyA: parts.head, pointA: { x: 0, y: headRadius }, bodyB: parts.torso, pointB: { x: 0, y: -22 * scale }, stiffness: 0.8, length: 1, render: { visible: false } }),
        
        // Torso to Pelvis
        Constraint.create({ bodyA: parts.torso, pointA: { x: 0, y: 22 * scale }, bodyB: parts.pelvis, pointB: { x: 0, y: -8 * scale }, stiffness: 0.7, length: 1, render: { visible: false } }),

        // Arms (Shoulders)
        Constraint.create({ bodyA: parts.torso, pointA: { x: -9 * scale, y: -18 * scale }, bodyB: parts.upperArmL, pointB: { x: 0, y: -10 * scale }, stiffness: 0.6, length: 1, render: { visible: false } }),
        Constraint.create({ bodyA: parts.torso, pointA: { x: 9 * scale, y: -18 * scale }, bodyB: parts.upperArmR, pointB: { x: 0, y: -10 * scale }, stiffness: 0.6, length: 1, render: { visible: false } }),

        // Elbows
        Constraint.create({ bodyA: parts.upperArmL, pointA: { x: 0, y: 10 * scale }, bodyB: parts.lowerArmL, pointB: { x: 0, y: -9 * scale }, stiffness: 0.6, length: 1, render: { visible: false } }),
        Constraint.create({ bodyA: parts.upperArmR, pointA: { x: 0, y: 10 * scale }, bodyB: parts.lowerArmR, pointB: { x: 0, y: -9 * scale }, stiffness: 0.6, length: 1, render: { visible: false } }),

        // Hips
        Constraint.create({ bodyA: parts.pelvis, pointA: { x: -6 * scale, y: 6 * scale }, bodyB: parts.upperLegL, pointB: { x: 0, y: -13 * scale }, stiffness: 0.6, length: 1, render: { visible: false } }),
        Constraint.create({ bodyA: parts.pelvis, pointA: { x: 6 * scale, y: 6 * scale }, bodyB: parts.upperLegR, pointB: { x: 0, y: -13 * scale }, stiffness: 0.6, length: 1, render: { visible: false } }),

        // Knees
        Constraint.create({ bodyA: parts.upperLegL, pointA: { x: 0, y: 13 * scale }, bodyB: parts.lowerLegL, pointB: { x: 0, y: -12 * scale }, stiffness: 0.6, length: 1, render: { visible: false } }),
        Constraint.create({ bodyA: parts.upperLegR, pointA: { x: 0, y: 13 * scale }, bodyB: parts.lowerLegR, pointB: { x: 0, y: -12 * scale }, stiffness: 0.6, length: 1, render: { visible: false } }),
    ];

    // Standing pose helper constraint (elastic muscle constraint to keep upright until hit)
    const spineUpright = Constraint.create({
        bodyA: parts.head,
        bodyB: parts.pelvis,
        stiffness: 0.08,
        length: (isBigHead ? 92 : 80) * scale,
        render: { visible: false }
    });

    const composite = Composite.create();
    Object.values(parts).forEach(part => Composite.add(composite, part));
    joints.forEach(joint => Composite.add(composite, joint));
    Composite.add(composite, spineUpright);

    const isGiantHp = game.eventEffects.includes('giant_hp');
    const baseMaxHp = 130;
    const maxHp = isGiantHp ? baseMaxHp * 3 : baseMaxHp;

    return {
        composite: composite,
        parts: parts,
        spineUpright: spineUpright,
        hp: maxHp,
        maxHp: maxHp,
        isDead: false,
        x: x,
        y: y
    };
}

// Event system configurations
const EVENTS = [
    { name: "ОБЫЧНЫЙ РАУНД", desc: "Стандартные условия боя", effect: null, apply: () => { game.engine.gravity.y = 0.8; } },
    { name: "НИЗКАЯ ГРАВИТАЦИЯ", desc: "Стрелы летят дальше, рэгдоллы парят!", effect: "low_gravity", apply: () => { game.engine.gravity.y = 0.18; } },
    { name: "ШТОРМОВОЙ ВЕТЕР", desc: "Ураганный ветер сбивает стрелы с курса!", effect: "strong_wind", apply: () => { game.engine.gravity.y = 0.8; } },
    { name: "ВЗРЫВНЫЕ СТРЕЛЫ", desc: "Попадание стрелы вызывает мощный взрыв!", effect: "explosive", apply: () => { game.engine.gravity.y = 0.8; } },
    { name: "ХРУПКИЕ КОСТИ", desc: "Двойной урон от любого попадания!", effect: "double_damage", apply: () => { game.engine.gravity.y = 0.8; } },
    { name: "БОЛЬШИЕ ГОЛОВЫ", desc: "Лучники с огромными головами! Легче попасть!", effect: "big_heads", apply: () => { game.engine.gravity.y = 0.8; } },
    { name: "РИКОШЕТ", desc: "Стрелы трижды отскакивают от платформ!", effect: "bouncy_arrows", apply: () => { game.engine.gravity.y = 0.8; } },
    { name: "ТЯЖЕЛЫЕ БАЛЛИСТЫ", desc: "Стрелы весят в 10 раз больше и сбивают с ног!", effect: "heavy_arrows", apply: () => { game.engine.gravity.y = 0.8; } },
    { name: "ЭНЕРГЕТИЧЕСКИЙ ЩИТ", desc: "У каждого лучника есть щит, отбивающий стрелы!", effect: "shields", apply: () => { game.engine.gravity.y = 0.8; } },
    { name: "ТЕЛЕПОРТ-ХАОС", desc: "При ранении стрелок телепортируется на платформе!", effect: "teleport_on_hit", apply: () => { game.engine.gravity.y = 0.8; } },
    { name: "ДВОЙНОЙ ЗАЛП", desc: "Каждый выстрел выпускает две стрелы веером!", effect: "double_shot", apply: () => { game.engine.gravity.y = 0.8; } },
    { name: "РЕАКТИВНАЯ ОТДАЧА", desc: "Колоссальный импульс отдачи от каждого выстрела!", effect: "recoil", apply: () => { game.engine.gravity.y = 0.8; } },
    { name: "ЗЕМЛЕТРЯСЕНИЕ", desc: "Платформы постоянно двигаются и раскачиваются!", effect: "earthquake", apply: () => { game.engine.gravity.y = 0.8; } },
    { name: "НАДУВНЫЕ ЧЕЛОВЕЧКИ", desc: "Стрелы раздувают части тела! 3x размер — лопнешь!", effect: "inflatable", apply: () => { game.engine.gravity.y = 0.8; } },
    { name: "ЛЕДЯНОЙ ШТОРМ", desc: "Стрелы замораживают конечности, отключая мускулы!", effect: "ice_freeze", apply: () => { game.engine.gravity.y = 0.8; } },
    { name: "БОГАТЫРСКОЕ ЗДОРОВЬЕ", desc: "Запас здоровья увеличен в 3 раза (600 ХП)!", effect: "giant_hp", apply: () => { game.engine.gravity.y = 0.8; } }
];

function applySelectedEvents(indices) {
    if (!Array.isArray(indices) || indices.length === 0) {
        indices = [0]; // default to normal round
    }

    game.eventEffects = [];
    game.engine.gravity.y = 0.8; // reset default gravity

    const names = [];
    indices.forEach(idx => {
        const ev = EVENTS[idx];
        if (ev) {
            if (ev.effect) game.eventEffects.push(ev.effect);
            ev.apply();
            names.push(ev.name);
        }
    });

    // Adjust wind depending on settings or storm event
    const windSettings = document.getElementById('select-wind') ? document.getElementById('select-wind').value : 'normal';
    if (windSettings === 'none') {
        game.wind.x = 0;
    } else if (windSettings === 'storm' || game.eventEffects.includes('strong_wind')) {
        game.wind.x = (Math.random() * 9.0 - 4.5);
    } else {
        game.wind.x = (Math.random() * 3.0 - 1.5);
    }

    if (indices.length === 1 && indices[0] === 0) {
        document.getElementById('event-name').innerText = "ОБЫЧНЫЙ РАУНД";
        document.getElementById('event-desc').innerText = "Стандартные условия боя";
    } else if (indices.length === 1) {
        const ev = EVENTS[indices[0]];
        if (ev) {
            document.getElementById('event-name').innerText = ev.name;
            document.getElementById('event-desc').innerText = ev.desc;
        }
    } else {
        document.getElementById('event-name').innerText = names.join(" + ");
        document.getElementById('event-desc').innerText = "Мульти-режимный бой!";
    }

    // Update UI wind values
    const speed = (Math.abs(game.wind.x) * 4).toFixed(1);
    document.getElementById('wind-value').innerText = `${speed} м/с`;
    const angle = game.wind.x >= 0 ? 0 : 180;
    document.getElementById('wind-arrow').style.transform = `rotate(${angle}deg)`;

    // Spawn characters again to dynamically apply Big Heads or other size properties
    if (game.platforms && game.platforms.length > 0) {
        spawnCharacters();
    }
}

function selectRandomEvents() {
    const maxRandomSetting = document.getElementById('select-max-random-events') 
        ? parseInt(document.getElementById('select-max-random-events').value, 10) 
        : 3;
    
    // Choose a random number of events up to the selected maximum (at least 1)
    const count = Math.max(1, Math.min(Math.floor(Math.random() * maxRandomSetting) + 1, EVENTS.length - 1));
    const indices = [];
    
    // Generate pool of indices (excluding 0, which is normal round)
    const pool = [];
    for (let i = 1; i < EVENTS.length; i++) {
        pool.push(i);
    }
    
    // Shuffle pool
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    
    for (let i = 0; i < count; i++) {
        indices.push(pool[i]);
    }
    
    applySelectedEvents(indices);
}

// Trigger physical blast wave for explosive event
function triggerExplosion(x, y, radius, forceMagnitude) {
    createExplosion(x, y, '#f97316', 35, 9); 
    createExplosion(x, y, '#e11d48', 20, 5); 

    // Procedural explosion sound
    if (audioCtx) {
        playSound('hit_flesh');
        try {
            const now = audioCtx.currentTime;
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(120, now);
            osc.frequency.exponentialRampToValueAtTime(10, now + 0.6);
            gain.gain.setValueAtTime(0.7, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now);
            osc.stop(now + 0.65);
        } catch (e) {}
    }

    const bodies = Composite.allBodies(game.engine.world);
    bodies.forEach(body => {
        if (body.isStatic) return;

        const distVec = Vector.sub(body.position, { x, y });
        const distance = Vector.magnitude(distVec);

        if (distance < radius) {
            const forceDir = Vector.normalise(distVec);
            const dropoff = 1 - (distance / radius);
            const force = Vector.mult(forceDir, forceMagnitude * dropoff * body.mass * 0.0035);
            Body.applyForce(body, body.position, force);
        }
    });
}

// Initialise the game
function initGame() {
    game.canvas = document.getElementById('gameCanvas');
    game.ctx = game.canvas.getContext('2d');
    
    // Set matching dimensions
    game.canvas.width = window.innerWidth;
    game.canvas.height = window.innerHeight;

    // Matter.js Engine setup with Sleeping enabled
    game.engine = Engine.create({
        enableSleeping: true,
        gravity: { y: CONFIG.gravity, scale: 0.001 }
    });

    // Create World Platforms
    generatePlatforms();

    // Pre-allocate Arrow Pool
    initArrowPool();

    // Spawn Player and Enemy
    spawnCharacters();

    // Set initial Camera focus
    game.cam.x = game.player.parts.torso.position.x;
    game.cam.y = game.player.parts.torso.position.y - 100;
    game.cam.targetX = game.cam.x;
    game.cam.targetY = game.cam.y;

    // Set Wind and Events
    selectRandomEvents();

    // Dynamic scale event listener
    window.addEventListener('resize', onWindowResize);

    // Control Listeners
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    window.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);

    // Hook collision logic
    Events.on(game.engine, 'collisionStart', handleCollisions);

    // Start game tick loop
    requestAnimationFrame(updateGame);
}

// Touch controls adapter
function onTouchStart(e) {
    if (game.gameState !== 'playing') return;
    if (e.target.tagName !== 'BUTTON' && !e.target.closest('.wind-indicator') && !e.target.closest('.scores-container')) {
        e.preventDefault();
        if (e.touches.length > 0) onMouseDown(e.touches[0]);
    }
}

function onTouchMove(e) {
    if (game.gameState !== 'playing') return;
    if (e.touches.length > 0) {
        onMouseMove(e.touches[0]);
    }
}

function onTouchEnd(e) {
    onMouseUp(e);
}

function createPlatform(x, y, isEnemy) {
    const type = game.selectedPlatformType || 'default';
    const strokeStyle = isEnemy ? '#f43f5e' : '#38bdf8';
    
    let platform;
    if (type === 'hills') {
        platform = Bodies.circle(x, y + 110, 130, {
            isStatic: true,
            friction: 0.9,
            label: 'platform',
            render: { fillStyle: '#1e293b', strokeStyle: strokeStyle, lineWidth: 3 }
        });
    } else if (type === 'pillars') {
        platform = Bodies.rectangle(x, y + 140, 90, 180, {
            isStatic: true,
            friction: 0.9,
            label: 'platform',
            render: { fillStyle: '#1e293b', strokeStyle: strokeStyle, lineWidth: 3 }
        });
    } else if (type === 'slanted') {
        platform = Bodies.rectangle(x, y, 260, 40, {
            isStatic: true,
            friction: 0.9,
            label: 'platform',
            render: { fillStyle: '#1e293b', strokeStyle: strokeStyle, lineWidth: 3 }
        });
        Body.setAngle(platform, isEnemy ? -0.25 : 0.25);
    } else if (type === 'floating') {
        platform = Bodies.rectangle(x, y - 60, 140, 25, {
            isStatic: true,
            friction: 0.9,
            label: 'platform',
            render: { fillStyle: '#1e293b', strokeStyle: strokeStyle, lineWidth: 3 }
        });
    } else if (type === 'bumpers') {
        // Floor and mini side bumpers
        const floor = Bodies.rectangle(x, y, 260, 40, { friction: 0.9, render: { fillStyle: '#1e293b', strokeStyle: strokeStyle, lineWidth: 3 } });
        const leftWall = Bodies.rectangle(x - 130, y - 20, 12, 50, { friction: 0.9, render: { fillStyle: '#1e293b', strokeStyle: strokeStyle, lineWidth: 3 } });
        const rightWall = Bodies.rectangle(x + 130, y - 20, 12, 50, { friction: 0.9, render: { fillStyle: '#1e293b', strokeStyle: strokeStyle, lineWidth: 3 } });
        platform = Body.create({
            parts: [floor, leftWall, rightWall],
            isStatic: true,
            label: 'platform'
        });
    } else {
        // default
        platform = Bodies.rectangle(x, y, 260, 40, {
            isStatic: true,
            friction: 0.9,
            label: 'platform',
            render: { fillStyle: '#1e293b', strokeStyle: strokeStyle, lineWidth: 3 }
        });
    }
    return platform;
}

function getPlatformSpawnY(platform) {
    if (!platform) return 0;
    if (platform.circleRadius) {
        return platform.position.y - platform.circleRadius - 70;
    }
    if (platform.parts && platform.parts.length > 1) {
        return platform.parts[1].position.y - 90; // Use floor y coordinate
    }
    return platform.position.y - 90;
}

function selectRandomPlatform() {
    const types = ['default', 'pillars', 'floating', 'bumpers'];
    game.selectedPlatformType = types[Math.floor(Math.random() * types.length)];
    
    // Update the selected UI button state
    document.querySelectorAll('.btn-platform').forEach(btn => {
        if (btn.getAttribute('data-platform-type') === game.selectedPlatformType) {
            btn.classList.add('selected');
        } else {
            btn.classList.remove('selected');
        }
    });
}

// Randomize platforms for the current round
function generatePlatforms() {
    if (game.platforms.length > 0) {
        game.platforms.forEach(p => Composite.remove(game.engine.world, p));
        game.platforms = [];
    }

    const midY = game.canvas.height * 0.65;
    const playerPlatform = createPlatform(250, midY + 120, false);
    const enemyPlatform = createPlatform(game.canvas.width - 250, midY + 180 + (Math.random() * 80 - 40), true);

    game.platforms = [playerPlatform, enemyPlatform];
    Composite.add(game.engine.world, game.platforms);
}

function spawnCharacters() {
    if (game.player) Composite.remove(game.engine.world, game.player.composite);
    if (game.enemy) Composite.remove(game.engine.world, game.enemy.composite);

    game.player = createRagdoll(250, getPlatformSpawnY(game.platforms[0]), false);
    game.enemy = createRagdoll(game.canvas.width - 250, getPlatformSpawnY(game.platforms[1]), true);

    Composite.add(game.engine.world, game.player.composite);
    Composite.add(game.engine.world, game.enemy.composite);

    // Set interactive visual HP bar elements
    document.getElementById('player-hp').style.width = '100%';
    document.getElementById('enemy-hp').style.width = '100%';
}

function changeWind() {
    // Generate new random wind vector
    game.wind.x = (Math.random() * 3.5 - 1.75); // Wind vector
    const speed = (Math.abs(game.wind.x) * 4).toFixed(1);
    
    document.getElementById('wind-value').innerText = `${speed} м/с`;
    const angle = game.wind.x >= 0 ? 0 : 180;
    document.getElementById('wind-arrow').style.transform = `rotate(${angle}deg)`;
    game.windTimer = 10; // resets interval
}

function onWindowResize() {
    game.canvas.width = window.innerWidth;
    game.canvas.height = window.innerHeight;
}

// Shooting Physics Logic
function onMouseDown(e) {
    if (game.gameState !== 'playing' || game.activeTurn !== 'player') return;
    
    // Ignore clicks on buttons and active HUD containers
    if (e.target.tagName === 'BUTTON' || e.target.closest('.wind-indicator') || e.target.closest('.scores-container')) {
        return;
    }
    
    initAudio();
    
    // Transform coordinates from Canvas Space considering camera matrix
    const rect = game.canvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left);
    const mouseY = (e.clientY - rect.top);

    const worldMouse = toWorldSpace(mouseX, mouseY);

    // Pull from the Player Torso pos
    game.aiming.active = true;
    game.aiming.startPos = { x: game.player.parts.torso.position.x, y: game.player.parts.torso.position.y };
    game.aiming.currentPos = { x: worldMouse.x, y: worldMouse.y };

    playSound('bow_pull');
}

function onMouseMove(e) {
    if (!game.aiming.active) return;
    const rect = game.canvas.getBoundingClientRect();
    const worldMouse = toWorldSpace(e.clientX - rect.left, e.clientY - rect.top);
    game.aiming.currentPos = { x: worldMouse.x, y: worldMouse.y };
}

function onMouseUp(e) {
    if (!game.aiming.active) return;
    game.aiming.active = false;

    // Calculate aim force dynamically from the current torso position
    const start = { x: game.player.parts.torso.position.x, y: game.player.parts.torso.position.y };
    const dx = start.x - game.aiming.currentPos.x;
    const dy = start.y - game.aiming.currentPos.y;
    
    // Set caps based on arm capacity (damaged or frozen limbs reduce pull power)
    const capacity = getCharPullCapacity(game.player);
    const distance = Math.min(Math.sqrt(dx * dx + dy * dy), 160 * capacity);
    const angle = Math.atan2(dy, dx);
    const force = distance * CONFIG.arrowSpeedMult;

    if (force > 1.5) {
        if (game.eventEffects.includes('double_shot')) {
            fireArrow(start.x, start.y - 10, angle - 0.08, force, game.player);
            setTimeout(() => {
                if (game.gameState === 'playing' && game.player && !game.player.isDead) {
                    fireArrow(game.player.parts.torso.position.x, game.player.parts.torso.position.y - 15, angle + 0.08, force, game.player);
                }
            }, 80);
        } else {
            fireArrow(start.x, start.y - 10, angle, force, game.player);
        }
        game.activeTurn = 'ai';
        const difficulty = document.getElementById('select-difficulty') ? document.getElementById('select-difficulty').value : 'normal';
        const interval = difficulty === 'hard' ? 2200 : (difficulty === 'easy' ? 3800 : CONFIG.aiShootInterval);
        setTimeout(aiTurn, interval);
    }
}

const ARROW_POOL_SIZE = 80;
const ARROW_POOL = [];

function initArrowPool() {
    ARROW_POOL.length = 0;
    for (let i = 0; i < ARROW_POOL_SIZE; i++) {
        const body = Bodies.rectangle(0, -9999, 30, 4, {
            density: 0.008,
            frictionAir: 0.01,
            label: 'arrow',
            isSensor: true,
            render: { fillStyle: '#f8fafc' }
        });
        body.collisionFilter = { group: -1, mask: 0 };
        Composite.add(game.engine.world, body);
        
        ARROW_POOL.push({
            body: body,
            active: false,
            stuck: false,
            stuckTo: null,
            trail: [],
            owner: null,
            spawnTime: 0,
            returned: false,
            bounces: 0
        });
    }
}

function clearAllArrows() {
    ARROW_POOL.forEach(deactivateArrow);
    game.arrows = [];
}

function deactivateArrow(arrowObj) {
    if (!arrowObj || !arrowObj.active) return;
    arrowObj.active = false;
    arrowObj.stuck = false;
    arrowObj.stuckTo = null;
    
    Body.setPosition(arrowObj.body, { x: 0, y: -9999 });
    Body.setVelocity(arrowObj.body, { x: 0, y: 0 });
    arrowObj.body.isSensor = true;
    arrowObj.body.collisionFilter = { group: -1, mask: 0 };

    const constraints = Composite.allConstraints(game.engine.world);
    constraints.forEach(c => {
        if (c.bodyA === arrowObj.body || c.bodyB === arrowObj.body) {
            Composite.remove(game.engine.world, c);
        }
    });

    const idx = game.arrows.indexOf(arrowObj);
    if (idx !== -1) game.arrows.splice(idx, 1);
}

function cleanupOOB() {
    const maxY = game.canvas.height + 600;
    const minX = -600;
    const maxX = game.canvas.width + 600;
    
    for (let i = game.arrows.length - 1; i >= 0; i--) {
        const arrowObj = game.arrows[i];
        if (arrowObj && arrowObj.active && !arrowObj.stuck) {
            const pos = arrowObj.body.position;
            if (pos.y > maxY || pos.x < minX || pos.x > maxX) {
                deactivateArrow(arrowObj);
            }
        }
    }
}

// Spawns and applies physical velocity to arrows from the pool
function fireArrow(x, y, angle, force, shooterChar) {
    let arrowObj = ARROW_POOL.find(a => !a.active);
    if (!arrowObj) {
        arrowObj = ARROW_POOL.reduce((oldest, current) => {
            if (!oldest || current.spawnTime < oldest.spawnTime) return current;
            return oldest;
        }, null);
        deactivateArrow(arrowObj);
    }

    const isHeavy = game.eventEffects.includes('heavy_arrows');
    const body = arrowObj.body;

    Body.setPosition(body, { x: x + Math.cos(angle) * 35, y: y + Math.sin(angle) * 35 });
    Body.setAngle(body, angle);
    Body.setVelocity(body, {
        x: Math.cos(angle) * force,
        y: Math.sin(angle) * force
    });
    Body.setAngularVelocity(body, 0);

    Body.setDensity(body, isHeavy ? 0.09 : 0.008);
    body.isSensor = false;
    body.render.fillStyle = isHeavy ? '#cbd5e1' : '#f8fafc';

    const group = shooterChar && shooterChar.parts && shooterChar.parts.head ? shooterChar.parts.head.collisionFilter.group : 0;
    body.collisionFilter = { group: group, mask: 0xFFFFFFFF };

    arrowObj.active = true;
    arrowObj.stuck = false;
    arrowObj.stuckTo = null;
    arrowObj.trail = [];
    arrowObj.owner = shooterChar;
    arrowObj.spawnTime = Date.now();
    arrowObj.returned = false;
    arrowObj.bounces = 0;

    if (!game.arrows.includes(arrowObj)) {
        game.arrows.push(arrowObj);
    }

    if (game.eventEffects.includes('recoil') && shooterChar && shooterChar.parts && shooterChar.parts.torso) {
        const torso = shooterChar.parts.torso;
        Body.applyForce(torso, torso.position, {
            x: -Math.cos(angle) * force * 0.001 * torso.mass,
            y: -Math.sin(angle) * force * 0.0008 * torso.mass
        });
    }

    playSound('bow_release');
}

// AI Bowmaster Shoot Decision Logic
function aiTurn() {
    if (game.gameState !== 'playing' || game.enemy.isDead) return;

    const ex = game.enemy.parts.torso.position.x;
    const ey = game.enemy.parts.torso.position.y;
    const px = game.player.parts.torso.position.x;
    const py = game.player.parts.torso.position.y;

    // Calculate target angles
    const dx = px - ex;
    const dy = py - ey - 20; // Aim slightly higher
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Difficulty settings integration
    const difficulty = document.getElementById('select-difficulty') ? document.getElementById('select-difficulty').value : 'normal';
    
    // Wind compensation depending on difficulty
    let windInfluence = 0;
    if (difficulty === 'normal') {
        windInfluence = game.wind.x * (distance * 0.035);
    } else if (difficulty === 'hard') {
        windInfluence = game.wind.x * (distance * 0.046); // superior wind compensation
    }

    const baseAngle = Math.atan2(dy - 70 - (distance * 0.1), dx - windInfluence);
    
    let inaccuracyRange = 0.045; // normal
    let aimDelay = 1200;
    if (difficulty === 'easy') {
        inaccuracyRange = 0.09;
        aimDelay = 2000;
    } else if (difficulty === 'hard') {
        inaccuracyRange = 0.008; // extremely precise
        aimDelay = 700;
    }

    const inaccuracy = (Math.random() * inaccuracyRange - inaccuracyRange / 2);
    const finalAngle = baseAngle + inaccuracy;
    const capacity = getCharPullCapacity(game.enemy);
    const finalForce = (11.5 + (distance * 0.0125) + (Math.random() * 1.5 - 0.75)) * capacity;

    // Initialize AI Aiming properties
    game.aiAiming.active = true;
    game.aiAiming.pullDist = 0;
    game.aiAiming.targetPullDist = Math.min(finalForce * 1.8, 26 * capacity);
    game.aiAiming.angle = Math.atan2(py - ey, px - ex); // start pointing straight at player
    game.aiAiming.targetAngle = finalAngle;

    playSound('bow_pull');

    // Fire after aimDelay of visual bow drawing
    setTimeout(() => {
        if (game.enemy.isDead || game.gameState !== 'playing') {
            game.aiAiming.active = false;
            return;
        }

        if (game.eventEffects.includes('double_shot')) {
            fireArrow(game.enemy.parts.torso.position.x, game.enemy.parts.torso.position.y - 10, game.aiAiming.angle - 0.08, finalForce, game.enemy);
            setTimeout(() => {
                if (game.enemy && !game.enemy.isDead && game.gameState === 'playing') {
                    fireArrow(game.enemy.parts.torso.position.x, game.enemy.parts.torso.position.y - 10, game.aiAiming.angle + 0.08, finalForce, game.enemy);
                }
            }, 80);
        } else {
            fireArrow(game.enemy.parts.torso.position.x, game.enemy.parts.torso.position.y - 10, game.aiAiming.angle, finalForce, game.enemy);
        }
        
        game.aiAiming.active = false;
        game.activeTurn = 'player';
    }, aimDelay);
}

// Animate AI aiming pull over time
function updateAiAiming() {
    if (!game.aiAiming.active) return;
    
    // Lerp pull distance and angle
    game.aiAiming.pullDist += (game.aiAiming.targetPullDist - game.aiAiming.pullDist) * 0.08;
    
    // Lerp angle (handle modular arithmetic wrap gently)
    let diff = game.aiAiming.targetAngle - game.aiAiming.angle;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    game.aiAiming.angle += diff * 0.12;
}

// Sever joint constraints of a hit limb with a specific probability
function dismemberLimb(char, targetBody, arrowSpeed) {
    // Only tear arm or leg segments, not head or torso
    if (!targetBody.label || !targetBody.label.includes('limb')) return;

    // Retrieve settings dismemberment base probability (0%, 15%, 50%, 100%)
    const dismemberSetting = document.getElementById('select-dismember') ? parseFloat(document.getElementById('select-dismember').value) : 15;
    const baseChance = dismemberSetting / 100.0;
    
    // Scales with arrow speed (baseline speed 15)
    const speedRatio = arrowSpeed / 15.0;
    const finalChance = baseChance * speedRatio;

    if (Math.random() < finalChance) {
        // Retrieve constraints from the character's composite specifically
        const constraints = Composite.allConstraints(char.composite);
        let severed = false;

        constraints.forEach(c => {
            if (c.bodyA === targetBody || c.bodyB === targetBody) {
                Composite.remove(char.composite, c);
                severed = true;
            }
        });

        if (severed) {
            // Change collision filter so the severed limb collides with everything (including the character)
            targetBody.collisionFilter = { group: 0, mask: 0xFFFFFFFF };
            
            // Heavy blood explosion
            createExplosion(targetBody.position.x, targetBody.position.y, '#991b1b', 32, 6.5);
            createExplosion(targetBody.position.x, targetBody.position.y, '#f43f5e', 15, 4.5);
            playSound('hit_flesh');
        }
    }
}

// Convert screen space pixel coordinate coordinates to physical World Space
function toWorldSpace(sx, sy) {
    return {
        x: (sx - game.canvas.width / 2) / game.cam.zoom + game.cam.x,
        y: (sy - game.canvas.height / 2) / game.cam.zoom + game.cam.y
    };
}

// Handle dynamic arrow flight orientations and physics impacts
function processArrows() {
    for (let i = game.arrows.length - 1; i >= 0; i--) {
        const arrow = game.arrows[i];
        
        if (!arrow.stuck) {
            // Apply Wind force representation
            Body.applyForce(arrow.body, arrow.body.position, {
                x: game.wind.x * 0.0001,
                y: 0
            });



            // Energy Shield Deflection check
            if (game.eventEffects.includes('shields')) {
                const checkDeflect = (char, isFacingRight) => {
                    if (char.isDead) return false;
                    const torso = char.parts.torso;
                    const shieldX = torso.position.x + (isFacingRight ? 35 : -35);
                    const shieldY = torso.position.y - 5;
                    const distVec = Vector.sub(arrow.body.position, { x: shieldX, y: shieldY });
                    const dist = Vector.magnitude(distVec);
                    if (dist < 32) {
                        // Deflect arrow back!
                        Body.setVelocity(arrow.body, {
                            x: (isFacingRight ? -1 : 1) * (10 + Math.random() * 5),
                            y: -Math.abs(arrow.body.velocity.y) * 0.8 - 4
                        });
                        const vel = arrow.body.velocity;
                        Body.setAngle(arrow.body, Math.atan2(vel.y, vel.x));
                        createExplosion(shieldX, shieldY, '#38bdf8', 12, 6);
                        playSound('hit_platform');
                        return true;
                    }
                    return false;
                };

                if ((arrow.owner !== game.player && checkDeflect(game.player, true)) || 
                    (arrow.owner !== game.enemy && checkDeflect(game.enemy, false))) {
                    continue;
                }
            }

            // Dynamically rotate arrow to follow physical velocity vector
            const vel = arrow.body.velocity;
            if (Math.abs(vel.x) > 0.5 || Math.abs(vel.y) > 0.5) {
                const angle = Math.atan2(vel.y, vel.x);
                Body.setAngle(arrow.body, angle);
            }

            // Save arrow tail positions for spark glow trails
            arrow.trail.push({ x: arrow.body.position.x, y: arrow.body.position.y });
            if (arrow.trail.length > 8) arrow.trail.shift();
        }
    }
}

// Handle Matter.js physics contact points & target damage calculations
function handleCollisions(event) {
    const pairs = event.pairs;

    for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        let arrowBody = null;
        let targetBody = null;

        if (pair.bodyA.label === 'arrow') {
            arrowBody = pair.bodyA;
            targetBody = pair.bodyB;
        } else if (pair.bodyB.label === 'arrow') {
            arrowBody = pair.bodyB;
            targetBody = pair.bodyA;
        }

        if (arrowBody) {
            const arrowObj = game.arrows.find(a => a.body === arrowBody);
            if (arrowObj && !arrowObj.stuck) {
                arrowObj.stuck = true;
                arrowObj.stuckTo = targetBody;

                const arrowSpeed = Vector.magnitude(arrowBody.velocity);
                const speedMultiplier = Math.max(0.3, arrowSpeed / 15.0); // Baseline velocity threshold (15.0)
                const eventMultiplier = game.eventEffects.includes('double_damage') ? 2.0 : 1.0;
                const finalDamageMult = speedMultiplier * eventMultiplier;

                const contactForce = Vector.mult(arrowBody.velocity, arrowBody.mass * 0.45);

                // Handle Explosive Event impact blast
                if (game.eventEffects.includes('explosive')) {
                    const blastX = arrowBody.position.x;
                    const blastY = arrowBody.position.y;
                    triggerExplosion(blastX, blastY, 150, 3.2);

                    // Deal blast damage to player and enemy based on distance
                    const distToPlayer = Vector.magnitude(Vector.sub(game.player.parts.torso.position, { x: blastX, y: blastY }));
                    const distToEnemy = Vector.magnitude(Vector.sub(game.enemy.parts.torso.position, { x: blastX, y: blastY }));

                    if (distToPlayer < 130) {
                        const dmg = Math.round(75 * (1 - distToPlayer / 130) * eventMultiplier);
                        damageCharacter(game.player, dmg, false);
                    }
                    if (distToEnemy < 130) {
                        const dmg = Math.round(75 * (1 - distToEnemy / 130) * eventMultiplier);
                        damageCharacter(game.enemy, dmg, true);
                    }
                }

                if (targetBody.label && (targetBody.label.includes('head') || targetBody.label.includes('body') || targetBody.label.includes('limb'))) {
                    const isEnemy = targetBody.label.includes('enemy');
                    const char = isEnemy ? game.enemy : game.player;

                    if (game.eventEffects.includes('inflatable')) {
                        // Inflatable mode: scale the body part, pop character if it gets too large
                        targetBody.currentScale = (targetBody.currentScale || 1.0) * 1.35;
                        Body.scale(targetBody, 1.35, 1.35);
                        createExplosion(arrowBody.position.x, arrowBody.position.y, isEnemy ? '#f43f5e' : '#3b82f6', 10, 3.5);
                        playSound('hit_flesh');
                        
                        if (targetBody.currentScale >= 2.6) {
                            // POP!
                            createExplosion(targetBody.position.x, targetBody.position.y, '#ef4444', 38, 7.5);
                            playSound('hit_flesh');
                            damageCharacter(char, 100, isEnemy);
                        }
                    } else if (game.eventEffects.includes('ice_freeze')) {
                        // Ice freeze mode: freeze parts solid and limp them
                        targetBody.render.fillStyle = '#93c5fd';
                        targetBody.isPartFrozen = true;
                        targetBody.partFreezeTimer = 180; // 3 seconds
                        Body.setMass(targetBody, targetBody.mass * 1.5);
                        createExplosion(arrowBody.position.x, arrowBody.position.y, '#60a5fa', 12, 4);
                        playSound('hit_platform');
                        if (targetBody.label.includes('head')) {
                            char.isFrozen = true;
                            char.freezeTimer = 110; // Frozen for ~1.8s
                        }
                        const baseDmg = targetBody.label.includes('head') ? 45 : (targetBody.label.includes('body') ? 25 : 12);
                        damageCharacter(char, Math.round(baseDmg * finalDamageMult), isEnemy);
                    } else {
                        // Original damage logic
                        if (targetBody.label.includes('head')) {
                            damageCharacter(char, Math.round(100 * finalDamageMult), isEnemy);
                            createExplosion(arrowBody.position.x, arrowBody.position.y, '#f43f5e', 22, 7);
                            playSound('hit_flesh');
                        } else if (targetBody.label.includes('body')) {
                            damageCharacter(char, Math.round(45 * finalDamageMult), isEnemy);
                            createExplosion(arrowBody.position.x, arrowBody.position.y, '#e11d48', 14, 4);
                            playSound('hit_flesh');
                        } else if (targetBody.label.includes('limb')) {
                            damageCharacter(char, Math.round(20 * finalDamageMult), isEnemy);
                            createExplosion(arrowBody.position.x, arrowBody.position.y, '#e11d48', 8, 3);
                            playSound('hit_flesh');
                            dismemberLimb(char, targetBody, arrowSpeed);
                        }
                    }
                } else {
                    // Platform or ground hit
                    createExplosion(arrowBody.position.x, arrowBody.position.y, '#f8fafc', 6, 2.5);
                    playSound('hit_platform');

                    // If Bouncy Arrows event is active, bounce off platforms up to 3 times
                    if (game.eventEffects.includes('bouncy_arrows') && targetBody.label === 'platform') {
                        if (!arrowObj.bounces) arrowObj.bounces = 0;
                        if (arrowObj.bounces < 3) {
                            arrowObj.bounces++;
                            Body.setVelocity(arrowBody, {
                                x: arrowBody.velocity.x * 0.85,
                                y: -Math.abs(arrowBody.velocity.y) * 0.75
                            });
                            // Let the arrow fly freely again
                            arrowObj.stuck = false;
                            arrowObj.stuckTo = null;
                            return; 
                        }
                    }
                }

                // If it was a teleport mode hit, clean up and remove the arrow immediately to prevent stretching constraints
                if (game.eventEffects.includes('teleport_on_hit') && targetBody.label && (targetBody.label.includes('head') || targetBody.label.includes('body') || targetBody.label.includes('limb'))) {
                    Composite.remove(game.engine.world, arrowBody);
                    const arrowIdx = game.arrows.findIndex(a => a.body === arrowBody);
                    if (arrowIdx !== -1) game.arrows.splice(arrowIdx, 1);
                    return;
                }

                // Apply physics impulse directly to the hit limb for dramatic local inertia reaction
                const impulseForce = {
                    x: arrowBody.velocity.x * arrowBody.mass * 0.12,
                    y: arrowBody.velocity.y * arrowBody.mass * 0.12
                };
                Body.applyForce(targetBody, arrowBody.position, impulseForce);

                // Disable arrow collisions with the world, but let it stay physically simulated
                arrowBody.collisionFilter = { group: targetBody.collisionFilter.group || -1, mask: 0 };

                // Create a dual-constraint (weld joint) to prevent rotation/spinning
                const relativeOffsetTip = Vector.sub(arrowBody.position, targetBody.position);
                const stickConstraint1 = Constraint.create({
                    bodyA: targetBody,
                    pointA: relativeOffsetTip,
                    bodyB: arrowBody,
                    pointB: { x: -12, y: 0 }, // Near the tip
                    stiffness: 1.0,
                    length: 0,
                    render: { visible: false }
                });

                // Calculate tail offset based on current arrow angle to anchor the tail
                const arrowAngle = arrowBody.angle;
                const tailLocal = { x: 12, y: 0 };
                const tailWorld = {
                    x: arrowBody.position.x + Math.cos(arrowAngle) * 24,
                    y: arrowBody.position.y + Math.sin(arrowAngle) * 24
                };
                const relativeOffsetTail = Vector.sub(tailWorld, targetBody.position);

                const stickConstraint2 = Constraint.create({
                    bodyA: targetBody,
                    pointA: relativeOffsetTail,
                    bodyB: arrowBody,
                    pointB: tailLocal, // Near the tail
                    stiffness: 1.0,
                    length: 0,
                    render: { visible: false }
                });

                Composite.add(game.engine.world, [stickConstraint1, stickConstraint2]);
            }
        }
    }
}

// Deducts health and checks for gameover states
function damageCharacter(char, amount, isEnemy) {
    if (char.isDead) return;

    char.hp = Math.max(0, char.hp - amount);

    const hpBarId = isEnemy ? 'enemy-hp' : 'player-hp';
    const pct = (char.hp / char.maxHp) * 100;
    document.getElementById(hpBarId).style.width = `${pct}%`;

    // Teleport-chaos mode
    if (game.eventEffects.includes('teleport_on_hit') && char.hp > 0) {
        clearStuckArrows(char);
        const platform = isEnemy ? game.platforms[1] : game.platforms[0];
        if (platform) {
            const torso = char.parts.torso;
            const targetX = platform.position.x + (Math.random() * 160 - 80);
            const targetY = getPlatformSpawnY(platform);
            const dx = targetX - torso.position.x;
            const dy = targetY - torso.position.y;
            Object.values(char.parts).forEach(part => {
                Body.setPosition(part, { x: part.position.x + dx, y: part.position.y + dy });
                Body.setVelocity(part, { x: 0, y: 0 });
                Body.setAngularVelocity(part, 0);
            });
            createExplosion(targetX, targetY, '#a855f7', 15, 4); // Magic purple teleport sparks
        }
    }

    if (char.hp <= 0) {
        char.isDead = true;
        // Break standing constraints, making ragdoll loose and fall over
        if (char.spineUpright) {
            Composite.remove(char.composite, char.spineUpright);
        }
        
        // If the enemy is already dead, ignore the player's subsequent death to preserve victory
        if (!isEnemy && game.enemy && game.enemy.isDead) {
            return;
        }
        
        setTimeout(() => triggerGameOver(isEnemy ? 'player' : 'enemy'), 2000);
    }
}

// Clears all arrows and constraints stuck to a specific character's body
function clearStuckArrows(char) {
    if (!char) return;
    const charParts = Object.values(char.parts);
    
    // Remove Matter constraints connecting any body part of this character to any arrow
    const constraints = Composite.allConstraints(game.engine.world);
    constraints.forEach(c => {
        if ((c.bodyA && charParts.includes(c.bodyA) && c.bodyB.label === 'arrow') || 
            (c.bodyB && charParts.includes(c.bodyB) && c.bodyA.label === 'arrow')) {
            Composite.remove(game.engine.world, c);
        }
    });

    // Deactivate the arrows via pool
    for (let i = game.arrows.length - 1; i >= 0; i--) {
        const arrow = game.arrows[i];
        if (arrow.stuckTo && charParts.includes(arrow.stuckTo)) {
            deactivateArrow(arrow);
        }
    }
}

// Teleport player ragdoll back to their platform (fixes low-gravity drift)
function respawnPlayerOnPlatform() {
    if (!game.player || !game.platforms[0]) return;
    
    // Clear any stuck arrows before teleporting
    clearStuckArrows(game.player);

    const targetX = game.platforms[0].position.x;
    const targetY = getPlatformSpawnY(game.platforms[0]);
    const torso = game.player.parts.torso;
    const dx = targetX - torso.position.x;
    const dy = targetY - torso.position.y;

    Object.values(game.player.parts).forEach(part => {
        Body.setPosition(part, { x: part.position.x + dx, y: part.position.y + dy });
        Body.setVelocity(part, { x: 0, y: 0 });
        Body.setAngularVelocity(part, 0);
        Body.setAngle(part, 0);
    });

    // Restore upright constraint if it was removed
    if (game.player.spineUpright && !game.player.isDead) {
        try { Composite.add(game.player.composite, game.player.spineUpright); } catch(e) {}
    }
    game.player.isDead = false;
}

// Spawn a fresh enemy (without touching player HP)
function spawnNewEnemy() {
    // Kill off old enemy
    if (game.enemy) Composite.remove(game.engine.world, game.enemy.composite);

    // Clear all arrows via pool
    clearAllArrows();
    game.particles = [];

    // Randomise enemy platform position (fresh layout)
    if (game.platforms[1]) Composite.remove(game.engine.world, game.platforms[1]);
    const midY = game.canvas.height * 0.65;
    const enemyPlatform = createPlatform(game.canvas.width - 250, midY + 180 + (Math.random() * 80 - 40), true);
    game.platforms[1] = enemyPlatform;
    Composite.add(game.engine.world, enemyPlatform);

    // Spawn new enemy ragdoll
    game.enemy = createRagdoll(game.canvas.width - 250, getPlatformSpawnY(game.platforms[1]), true);
    Composite.add(game.engine.world, game.enemy.composite);
    document.getElementById('enemy-hp').style.width = '100%';
}

// Finish round logic — only shows defeat screen when PLAYER dies
function triggerGameOver(winner) {
    if (winner === 'player') {
        // ── PLAYER WON: continuous fight ─────────────────────────────────────
        game.killStreak++;
        game.scores.player++;
        document.getElementById('player-score').innerText = game.scores.player;

        // Reward gold and save
        game.customization.gold += 15;
        saveShopData();

        // Brief flash of victory text in event banner
        document.getElementById('event-name').innerText = '✦ ПОБЕДА! +15 ЗОЛОТА ✦';
        document.getElementById('event-desc').innerText = `Серия побед: ${game.killStreak} | Золото: 🪙${game.customization.gold}`;

        setTimeout(() => {
            if (game.gameState !== 'playing') return;

            // Choose mode: fixed if manually selected, otherwise random
            if (game.selectedModes && game.selectedModes.length > 0 && game.selectedModes[0] !== 0) {
                // Reset player position to platform (critical for low-gravity)
                respawnPlayerOnPlatform();

                // Spawn fresh enemy
                spawnNewEnemy();

                applySelectedEvents(game.selectedModes);
            } else {
                selectRandomEvents();
                selectRandomPlatform();
                generatePlatforms();
                spawnCharacters();
            }

            game.activeTurn = 'player';
            game.aiAiming.active = false;
            game.aiming.active = false;
        }, 1800);

    } else {
        // ── PLAYER LOST ───────────────────────────────────────────────────────
        const streak = game.killStreak;
        game.killStreak = 0;
        game.scores.enemy++;
        document.getElementById('enemy-score').innerText = game.scores.enemy;
        game.gameState = 'gameover';
        document.getElementById('ui-overlay').classList.remove('playing');

        const screen   = document.getElementById('screen-gameover');
        const title    = document.getElementById('gameover-title');
        const subtitle = document.getElementById('gameover-subtitle');
        const streakEl = document.getElementById('kill-streak-display');
        title.innerText = 'ПОРАЖЕНИЕ!';
        title.style.color = '#f43f5e';
        subtitle.innerText = 'Вражеский стрелок оказался быстрее.';
        streakEl.innerText = streak > 0
            ? `Серия побед этой сессии: ${streak} 🏹`
            : '';
        screen.classList.add('active');
    }
}

// Restart after defeat — resets everything and begins fresh
function restartRound() {
    document.getElementById('screen-gameover').classList.remove('active');
    document.getElementById('ui-overlay').classList.add('playing');

    // Clear arrows
    const constraints = Composite.allConstraints(game.engine.world);
    constraints.forEach(c => {
        if ((c.bodyA && c.bodyA.label === 'arrow') || (c.bodyB && c.bodyB.label === 'arrow')) {
            Composite.remove(game.engine.world, c);
        }
    });
    game.arrows.forEach(a => Composite.remove(game.engine.world, a.body));
    game.arrows = [];
    game.particles = [];
    game.killStreak = 0;

    if (game.selectedModes && game.selectedModes.length > 0 && game.selectedModes[0] !== 0) {
        applySelectedEvents(game.selectedModes);
    } else {
        selectRandomEvents();
        selectRandomPlatform();
    }

    generatePlatforms();
    spawnCharacters();

    game.gameState = 'playing';
    game.activeTurn = 'player';
    game.aiAiming.active = false;
    game.aiming.active = false;
}

function isLimbConnected(char, limb) {
    if (!char || !limb) return false;
    const constraints = Composite.allConstraints(char.composite);
    return constraints.some(c => (c.bodyA === limb && c.bodyB === char.parts.torso) || (c.bodyB === limb && c.bodyA === char.parts.torso));
}

function getCharPullCapacity(char) {
    if (!char || char.isDead) return 0;
    const isEnemy = (char === game.enemy);
    const armHolding = isEnemy ? char.parts.upperArmL : char.parts.upperArmR;
    const armPulling = isEnemy ? char.parts.upperArmR : char.parts.upperArmL;
    
    const holdConnected = isLimbConnected(char, armHolding);
    const pullConnected = isLimbConnected(char, armPulling);
    
    const holdFrozen = armHolding.isPartFrozen || char.isFrozen;
    const pullFrozen = armPulling.isPartFrozen || char.isFrozen;
    
    if (!holdConnected || !pullConnected) {
        return 0.60; // 60% capacity (increased for better action!) when an arm is dismembered
    }
    if (holdFrozen || pullFrozen) {
        return 0.80; // 80% capacity (increased for better action!) when an arm is frozen
    }
    return 1.0;
}

// Stabilize ragdolls to stand upright (muscle simulation using PD torque controllers)
function keepUpright(char) {
    if (char.isDead) return;
    
    // Ice freeze effect: make frozen character go limp and skip muscles
    if (char.isFrozen) {
        if (char.freezeTimer > 0) {
            char.freezeTimer--;
        } else {
            char.isFrozen = false;
            // Restore visual color when thawing
            const isEnemy = char === game.enemy;
            const customColor = isEnemy ? '#f43f5e' : (game.customization ? game.customization.equippedSkin : '#3b82f6');
            char.parts.torso.render.fillStyle = customColor;
            char.parts.head.render.fillStyle = '#fda4af';
            Object.keys(char.parts).forEach(key => {
                if (key.includes('Arm') || key.includes('Leg')) {
                    char.parts[key].render.fillStyle = isEnemy ? '#e11d48' : customColor;
                }
            });
        }
        return;
    }

    const enforceLimit = (child, parent, minDeg, maxDeg) => {
        if (!child || !parent) return;
        let rel = child.angle - parent.angle;
        while (rel < -Math.PI) rel += Math.PI * 2;
        while (rel > Math.PI) rel -= Math.PI * 2;
        const minRad = minDeg * Math.PI / 180;
        const maxRad = maxDeg * Math.PI / 180;
        if (rel < minRad) {
            Body.setAngle(child, parent.angle + minRad);
            Body.setAngularVelocity(child, parent.angularVelocity);
        } else if (rel > maxRad) {
            Body.setAngle(child, parent.angle + maxRad);
            Body.setAngularVelocity(child, parent.angularVelocity);
        }
    };

    // Torso stability via PD controller
    const torso = char.parts.torso;
    const Kp_torso = 0.05 * torso.inertia;
    const Kd_torso = 0.04 * torso.inertia;
    let diff_torso = torso.angle - 0;
    while (diff_torso < -Math.PI) diff_torso += Math.PI * 2;
    while (diff_torso > Math.PI) diff_torso -= Math.PI * 2;
    torso.torque += -Kp_torso * diff_torso - Kd_torso * torso.angularVelocity;

    // Pelvis stability via PD controller
    const pelvis = char.parts.pelvis;
    if (pelvis) {
        const Kp_pelvis = 0.05 * pelvis.inertia;
        const Kd_pelvis = 0.04 * pelvis.inertia;
        let diff_pelvis = pelvis.angle - 0;
        while (diff_pelvis < -Math.PI) diff_pelvis += Math.PI * 2;
        while (diff_pelvis > Math.PI) diff_pelvis -= Math.PI * 2;
        pelvis.torque += -Kp_pelvis * diff_pelvis - Kd_pelvis * pelvis.angularVelocity;
    }

    // Head stability via PD controller
    const head = char.parts.head;
    const Kp_head = 0.03 * head.inertia;
    const Kd_head = 0.02 * head.inertia;
    let diff_head = head.angle - torso.angle;
    while (diff_head < -Math.PI) diff_head += Math.PI * 2;
    while (diff_head > Math.PI) diff_head -= Math.PI * 2;
    head.torque += -Kp_head * diff_head - Kd_head * head.angularVelocity;

    // Joint Limits enforcement
    enforceLimit(head, torso, -30, 30);
    enforceLimit(char.parts.lowerLegL, char.parts.upperLegL, -120, 0);
    enforceLimit(char.parts.lowerLegR, char.parts.upperLegR, -120, 0);
    enforceLimit(char.parts.lowerArmL, char.parts.upperArmL, 0, 140);
    enforceLimit(char.parts.lowerArmR, char.parts.upperArmR, -140, 0);

    // Keep legs straight under gravity using PD springs (weak motor/spring)
    const legs = [
        { child: char.parts.upperLegL, parent: pelvis, target: 0 },
        { child: char.parts.upperLegR, parent: pelvis, target: 0 },
        { child: char.parts.lowerLegL, parent: char.parts.upperLegL, target: 0 },
        { child: char.parts.lowerLegR, parent: char.parts.upperLegR, target: 0 }
    ];
    legs.forEach(leg => {
        if (!leg.child || !leg.parent) return;
        let diff = leg.child.angle - leg.parent.angle - leg.target;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        const torque = -0.015 * leg.child.inertia * diff - 0.01 * leg.child.inertia * (leg.child.angularVelocity - leg.parent.angularVelocity);
        leg.child.torque += torque;
    });

    // Arm muscle controls & visual bow string drawing
    let isAiming = false;
    let aimAngle = 0;
    
    if (char === game.player && game.aiming.active) {
        isAiming = true;
        const dx = game.aiming.startPos.x - game.aiming.currentPos.x;
        const dy = game.aiming.startPos.y - game.aiming.currentPos.y;
        aimAngle = Math.atan2(dy, dx);
    } else if (char === game.enemy && game.aiAiming.active) {
        isAiming = true;
        aimAngle = game.aiAiming.angle;
    }

    const isEnemy = (char === game.enemy);
    const armHolding = isEnemy ? char.parts.upperArmL : char.parts.upperArmR;
    const forearmHolding = isEnemy ? char.parts.lowerArmL : char.parts.lowerArmR;
    const armPulling = isEnemy ? char.parts.upperArmR : char.parts.upperArmL;
    const forearmPulling = isEnemy ? char.parts.lowerArmR : char.parts.lowerArmL;

    const controlLimb = (limb, targetAngle, stiffness, damping = 0.015) => {
        if (!limb) return;
        if (limb.isPartFrozen) {
            if (!limb.partFreezeTimer) limb.partFreezeTimer = 180;
            if (limb.partFreezeTimer > 0) {
                limb.partFreezeTimer--;
            } else {
                limb.isPartFrozen = false;
                const customColor = isEnemy ? '#f43f5e' : (game.customization ? game.customization.equippedSkin : '#3b82f6');
                limb.render.fillStyle = isEnemy ? '#e11d48' : customColor;
            }
            return;
        }
        if (isLimbConnected(char, limb)) {
            let diff = limb.angle - targetAngle;
            while (diff < -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;
            const torque = -stiffness * limb.inertia * diff - damping * limb.inertia * limb.angularVelocity;
            limb.torque += torque;
        }
    };

    if (isAiming) {
        let pullDist = 0;
        if (char === game.player && game.aiming.active) {
            const dx = game.aiming.startPos.x - game.aiming.currentPos.x;
            const dy = game.aiming.startPos.y - game.aiming.currentPos.y;
            const capacity = getCharPullCapacity(game.player);
            pullDist = Math.min(Math.sqrt(dx*dx + dy*dy), 160 * capacity) * 0.18;
        } else if (char === game.enemy && game.aiAiming.active) {
            pullDist = game.aiAiming.pullDist;
        }
        const pullRatio = Math.min(pullDist / 28.8, 1.0);

        // Holding arm (stretches straight to hold the bow firmly)
        controlLimb(armHolding, aimAngle, 0.04);
        controlLimb(forearmHolding, aimAngle, 0.04);

        // Pulling arm (elbow bends backwards/upwards, forearm folds to pull the string)
        const sideSign = isEnemy ? -1 : 1;
        const targetUpperPull = aimAngle + Math.PI - 0.55 * sideSign * pullRatio;
        const targetLowerPull = aimAngle + Math.PI + 1.25 * sideSign * pullRatio;

        controlLimb(armPulling, targetUpperPull, 0.035);
        controlLimb(forearmPulling, targetLowerPull, 0.035);
    } else {
        // Relaxed arms hanging down - weak spring / motor
        controlLimb(armHolding, isEnemy ? 0.6 : -0.6, 0.01, 0.01);
        controlLimb(forearmHolding, isEnemy ? 0.3 : -0.3, 0.01, 0.01);
        controlLimb(armPulling, isEnemy ? -0.6 : 0.6, 0.01, 0.01);
        controlLimb(forearmPulling, isEnemy ? -0.3 : 0.3, 0.01, 0.01);
    }

    // Gentle upward pull force to simulate leg muscles holding the body weight
    Body.applyForce(torso, torso.position, { x: 0, y: -0.0018 * torso.mass });
}

// Draw a beautiful interactive bow for characters
function drawBow(ctx, char, isEnemy) {
    if (char.isDead) return;

    ctx.save();
    
    const tx = char.parts.torso.position.x;
    const ty = char.parts.torso.position.y - 5;
    
    let angle = isEnemy ? Math.PI : 0;
    let pullDist = 0;
    
    if (!isEnemy && game.aiming.active) {
        const dx = game.aiming.startPos.x - game.aiming.currentPos.x;
        const dy = game.aiming.startPos.y - game.aiming.currentPos.y;
        angle = Math.atan2(dy, dx);
        const capacity = getCharPullCapacity(game.player);
        pullDist = Math.min(Math.sqrt(dx*dx + dy*dy), 160 * capacity) * 0.18; // Pull amount scaled by capacity
    } else if (isEnemy && game.aiAiming.active) {
        angle = game.aiAiming.angle;
        pullDist = game.aiAiming.pullDist;
    } else if (isEnemy) {
        // Face player
        const px = game.player.parts.torso.position.x;
        const py = game.player.parts.torso.position.y;
        angle = Math.atan2(py - ty, px - tx);
    } else {
        // Player idle, face enemy
        const ex = game.enemy.parts.torso.position.x;
        const ey = game.enemy.parts.torso.position.y;
        angle = Math.atan2(ey - ty, ex - tx);
    }
    
    ctx.translate(tx, ty);
    ctx.rotate(angle);
    
    // Draw Bow limbs
    ctx.strokeStyle = isEnemy ? '#f43f5e' : '#38bdf8';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 8;
    ctx.shadowColor = isEnemy ? 'rgba(244, 63, 94, 0.7)' : 'rgba(56, 189, 248, 0.7)';
    
    ctx.beginPath();
    ctx.arc(12, 0, 24, -Math.PI / 2.5, Math.PI / 2.5);
    ctx.stroke();
    
    // Draw Bow String
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.6)';
    ctx.lineWidth = 1;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    
    const upperTip = { x: 12 + 24 * Math.cos(-Math.PI / 2.5), y: 24 * Math.sin(-Math.PI / 2.5) };
    const lowerTip = { x: 12 + 24 * Math.cos(Math.PI / 2.5), y: 24 * Math.sin(Math.PI / 2.5) };
    
    ctx.moveTo(upperTip.x, upperTip.y);
    if (pullDist > 0) {
        ctx.lineTo(12 - pullDist, 0);
        ctx.lineTo(lowerTip.x, lowerTip.y);
    } else {
        ctx.lineTo(lowerTip.x, lowerTip.y);
    }
    ctx.stroke();

    // Draw loading arrow when pulling/aiming
    if (pullDist > 0) {
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(12 - pullDist, 0);
        ctx.lineTo(12 + 20, 0);
        ctx.stroke();
    }
    
    ctx.restore();
}

// Canvas Drawing Overlay
function drawOverlay() {
    const ctx = game.ctx;

    // Apply Camera transforms
    ctx.save();
    ctx.translate(game.canvas.width / 2, game.canvas.height / 2);
    ctx.scale(game.cam.zoom, game.cam.zoom);
    ctx.translate(-game.cam.x, -game.cam.y);

    // Draw background elements (wind particles)
    drawWindParticles(ctx);

    // Draw Aiming Line
    if (game.aiming.active) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 6]);

        const start = { x: game.player.parts.torso.position.x, y: game.player.parts.torso.position.y };
        const current = game.aiming.currentPos;
        
        // Calculate flight trajectory points
        const dx = start.x - current.x;
        const dy = start.y - current.y;
        const capacity = getCharPullCapacity(game.player);
        const distance = Math.min(Math.sqrt(dx * dx + dy * dy), 160 * capacity);
        const angle = Math.atan2(dy, dx);
        const force = distance * CONFIG.arrowSpeedMult;

        let tx = start.x;
        let ty = start.y;
        let vx = Math.cos(angle) * force;
        let vy = Math.sin(angle) * force;

        // Draw parabolic projection path
        ctx.moveTo(tx, ty);
        for (let t = 0; t < 25; t++) {
            // Apply wind simulation in projection
            vx += game.wind.x * 0.08;
            vy += CONFIG.gravity * 0.15;
            tx += vx * 0.6;
            ty += vy * 0.6;
            ctx.lineTo(tx, ty);
        }
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Draw custom arrow trails & details
    game.arrows.forEach(arrow => {
        if (arrow.trail.length > 1) {
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
            ctx.lineWidth = 3;
            ctx.moveTo(arrow.trail[0].x, arrow.trail[0].y);
            for (let k = 1; k < arrow.trail.length; k++) {
                ctx.lineTo(arrow.trail[k].x, arrow.trail[k].y);
            }
            ctx.stroke();
        }
    });

    // Draw custom Particles from high-performance static pool (Blood / Impact Sparks)
    for (let i = 0; i < PARTICLE_POOL.length; i++) {
        const p = PARTICLE_POOL[i];
        if (p.active) {
            ctx.fillStyle = p.color;
            ctx.globalAlpha = p.life;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.globalAlpha = 1.0;

    // Draw Energy Shield visual arcs if shield mode is active
    if (game.eventEffects.includes('shields')) {
        const drawShieldArc = (char, isFacingRight) => {
            if (char.isDead) return;
            const torso = char.parts.torso;
            const shieldX = torso.position.x + (isFacingRight ? 35 : -35);
            const shieldY = torso.position.y - 5;
            
            ctx.save();
            ctx.strokeStyle = isFacingRight ? 'rgba(56, 189, 248, 0.85)' : 'rgba(244, 63, 94, 0.85)';
            ctx.lineWidth = 4;
            ctx.shadowBlur = 12;
            ctx.shadowColor = isFacingRight ? 'rgba(56, 189, 248, 0.9)' : 'rgba(244, 63, 94, 0.9)';
            ctx.beginPath();
            
            const startAngle = isFacingRight ? -Math.PI/2 : Math.PI/2;
            const endAngle = isFacingRight ? Math.PI/2 : 3*Math.PI/2;
            ctx.arc(shieldX, shieldY, 25, startAngle, endAngle);
            ctx.stroke();
            ctx.restore();
        };
        drawShieldArc(game.player, true);
        drawShieldArc(game.enemy, false);
    }

    ctx.restore();
}

// Background Wind visualization
let windParticlesList = [];
function drawWindParticles(ctx) {
    if (windParticlesList.length < 35) {
        windParticlesList.push({
            x: Math.random() * game.canvas.width * 2 - game.canvas.width,
            y: Math.random() * game.canvas.height,
            length: 15 + Math.random() * 30,
            speed: 2 + Math.random() * 4
        });
    }

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1.5;
    for (let i = windParticlesList.length - 1; i >= 0; i--) {
        const wp = windParticlesList[i];
        wp.x += (wp.speed + game.wind.x * 5);
        if (wp.x > game.canvas.width + 200 || wp.x < -200) {
            wp.x = game.wind.x >= 0 ? -150 : game.canvas.width + 150;
            wp.y = Math.random() * game.canvas.height;
        }

        ctx.beginPath();
        ctx.moveTo(wp.x, wp.y);
        ctx.lineTo(wp.x + wp.length * (game.wind.x >= 0 ? 1 : -1), wp.y);
        ctx.stroke();
    }
}

// Dynamic screen boundary constraints for active characters
function clampToScreen(char) {
    if (char.isDead) return;

    const minX = 30;
    const maxX = game.canvas.width - 30;
    const minY = 30;

    Object.values(char.parts).forEach(part => {
        let px = part.position.x;
        let py = part.position.y;
        let vx = part.velocity.x;
        let vy = part.velocity.y;
        let changed = false;

        if (px < minX) {
            px = minX;
            vx = Math.abs(vx) * 0.4;
            changed = true;
        }
        if (px > maxX) {
            px = maxX;
            vx = -Math.abs(vx) * 0.4;
            changed = true;
        }
        if (py < minY) {
            py = minY;
            vy = Math.abs(vy) * 0.4; // Bounce downwards
            changed = true;
        }

        if (changed) {
            Body.setPosition(part, { x: px, y: py });
            Body.setVelocity(part, { x: vx, y: vy });
        }
    });
}

let lastTime = 0;
let accumulator = 0;
const fixedTimeStep = 16.666;

// Main game loop
function updateGame(timestamp) {
    if (!lastTime) lastTime = timestamp;
    let dt = timestamp - lastTime;
    lastTime = timestamp;

    // Cap dt to prevent spiral of death during heavy lag spikes
    if (dt > 100) dt = 16.666;

    accumulator += dt;
    while (accumulator >= fixedTimeStep) {
        Engine.update(game.engine, fixedTimeStep);
        accumulator -= fixedTimeStep;
    }

    // Process arrow physics & trails
    processArrows();

    // Process AI aiming animations
    updateAiAiming();

    // OOB Cleanup
    cleanupOOB();

    // Earthquake / Unstable Ground Event
    if (game.eventEffects.includes('earthquake') && game.platforms[0] && game.platforms[1]) {
        const time = Date.now() * 0.0022;
        const playerPlat = game.platforms[0];
        const enemyPlat = game.platforms[1];
        
        if (playerPlat.baseY === undefined) playerPlat.baseY = playerPlat.position.y;
        if (enemyPlat.baseY === undefined) enemyPlat.baseY = enemyPlat.position.y;
        
        const py = playerPlat.baseY + Math.sin(time) * 40;
        const ey = enemyPlat.baseY + Math.cos(time) * 40;
        const pAngle = Math.sin(time * 0.5) * 0.16;
        const eAngle = Math.cos(time * 0.5) * 0.16;
        
        Body.setPosition(playerPlat, { x: playerPlat.position.x, y: py });
        Body.setAngle(playerPlat, pAngle);
        
        Body.setPosition(enemyPlat, { x: enemyPlat.position.x, y: ey });
        Body.setAngle(enemyPlat, eAngle);
    }

    // Stabilize characters so they stand upright
    if (game.player) {
        keepUpright(game.player);
        clampToScreen(game.player);
    }
    if (game.enemy) {
        keepUpright(game.enemy);
        clampToScreen(game.enemy);
    }

    // Process active particles in-place from our static pool (no GC garbage creation)
    for (let i = 0; i < PARTICLE_POOL.length; i++) {
        const p = PARTICLE_POOL[i];
        if (p.active) {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.08; // Small gravity on particles
            p.life -= p.decay;
            if (p.life <= 0) {
                p.active = false;
            }
        }
    }

    // Camera follow calculations (always center between player and enemy)
    if (game.player && game.enemy) {
        const px = game.player.parts.torso.position.x;
        const py = game.player.parts.torso.position.y;
        const ex = game.enemy.parts.torso.position.x;
        const ey = game.enemy.parts.torso.position.y;

        game.cam.targetX = (px + ex) / 2;
        game.cam.targetY = (py + ey) / 2 - 80;
        game.cam.targetZoom = 1.0;
    }

    // Camera lerp updates
    game.cam.x += (game.cam.targetX - game.cam.x) * 0.08;
    game.cam.y += (game.cam.targetY - game.cam.y) * 0.08;
    game.cam.zoom += (game.cam.targetZoom - game.cam.zoom) * 0.08;

    // Check boundary falls (falling off platforms)
    checkFallout(game.player, false);
    checkFallout(game.enemy, true);

    // Matter.js Render fallback updates (updating manual canvas overlay)
    game.ctx.clearRect(0, 0, game.canvas.width, game.canvas.height);

    // Draw custom overlay
    drawOverlay();

    // Draw default Matter bodies
    drawMatterBodies();

    // Draw Bows
    if (game.player && game.enemy) {
        const ctx = game.ctx;
        ctx.save();
        ctx.translate(game.canvas.width / 2, game.canvas.height / 2);
        ctx.scale(game.cam.zoom, game.cam.zoom);
        ctx.translate(-game.cam.x, -game.cam.y);
        
        drawBow(ctx, game.player, false);
        drawBow(ctx, game.enemy, true);
        
        ctx.restore();
    }

    requestAnimationFrame(updateGame);
}

// Fall detection boundary
function checkFallout(char, isEnemy) {
    if (char.isDead) return;
    if (char.parts.torso.position.y > game.canvas.height + 150) {
        damageCharacter(char, 100, isEnemy);
    }
}

function drawHat(ctx, x, y, angle, radius, type) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.translate(0, -radius * 0.9);
    ctx.shadowBlur = 4;
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    
    if (type === 'hood') {
        ctx.fillStyle = game.customization.equippedSkin;
        ctx.beginPath();
        ctx.arc(0, radius * 0.4, radius * 1.2, Math.PI, 0);
        ctx.lineTo(radius * 0.8, radius * 1.5);
        ctx.lineTo(-radius * 0.8, radius * 1.5);
        ctx.closePath();
        ctx.fill();
    } else if (type === 'cowboy') {
        ctx.fillStyle = '#78350f';
        ctx.fillRect(-radius * 1.7, -2, radius * 3.4, 4);
        ctx.beginPath();
        ctx.moveTo(-radius * 0.9, -2);
        ctx.lineTo(-radius * 0.9, -15);
        ctx.lineTo(-radius * 0.4, -18);
        ctx.lineTo(radius * 0.4, -18);
        ctx.lineTo(radius * 0.9, -15);
        ctx.lineTo(radius * 0.9, -2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(-radius * 0.9, -5, radius * 1.8, 3);
    } else if (type === 'crown') {
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.moveTo(-radius * 1.1, 0);
        ctx.lineTo(-radius * 1.1, -12);
        ctx.lineTo(-radius * 0.6, -5);
        ctx.lineTo(0, -15);
        ctx.lineTo(radius * 0.6, -5);
        ctx.lineTo(radius * 1.1, -12);
        ctx.lineTo(radius * 1.1, 0);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(0, -15, 2, 0, Math.PI*2);
        ctx.arc(-radius*1.1, -12, 2, 0, Math.PI*2);
        ctx.arc(radius*1.1, -12, 2, 0, Math.PI*2);
        ctx.fill();
    } else if (type === 'tophat') {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(-radius * 1.5, -2, radius * 3.0, 4);
        ctx.fillRect(-radius * 0.8, -22, radius * 1.6, 20);
        ctx.fillStyle = '#8b5cf6';
        ctx.fillRect(-radius * 0.8, -6, radius * 1.6, 4);
    } else if (type === 'viking') {
        ctx.fillStyle = '#64748b';
        ctx.beginPath();
        ctx.arc(0, 0, radius * 1.1, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(-2, -radius * 1.1, 4, radius * 1.1);
        ctx.fillStyle = '#f1f5f9';
        ctx.beginPath();
        ctx.moveTo(-radius * 0.9, -radius * 0.3);
        ctx.quadraticCurveTo(-radius * 1.6, -radius * 0.6, -radius * 1.7, -radius * 1.3);
        ctx.quadraticCurveTo(-radius * 1.2, -radius * 1.0, -radius * 0.7, -radius * 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(radius * 0.9, -radius * 0.3);
        ctx.quadraticCurveTo(radius * 1.6, -radius * 0.6, radius * 1.7, -radius * 1.3);
        ctx.quadraticCurveTo(radius * 1.2, -radius * 1.0, radius * 0.7, -radius * 0.6);
        ctx.closePath();
        ctx.fill();
    }
    
    ctx.restore();
}

function getBodyPartKey(body) {
    if (game.player && game.player.parts) {
        for (const [key, b] of Object.entries(game.player.parts)) {
            if (b === body) return { char: game.player, key, isEnemy: false };
        }
    }
    if (game.enemy && game.enemy.parts) {
        for (const [key, b] of Object.entries(game.enemy.parts)) {
            if (b === body) return { char: game.enemy, key, isEnemy: true };
        }
    }
    return null;
}

function getBodyDrawPriority(body) {
    if (body.label === 'platform') return 10;
    if (body.label === 'arrow') return 90;
    
    const info = getBodyPartKey(body);
    if (!info) return 50;
    
    const key = info.key;
    const isEnemy = info.isEnemy;
    
    // Player faces right: L is front, R is rear
    // Enemy faces left: R is front, L is rear
    const isRearArm = isEnemy ? (key === 'upperArmL' || key === 'lowerArmL') : (key === 'upperArmR' || key === 'lowerArmR');
    const isFrontArm = isEnemy ? (key === 'upperArmR' || key === 'lowerArmR') : (key === 'upperArmL' || key === 'lowerArmL');
    const isRearLeg = isEnemy ? (key === 'upperLegR' || key === 'lowerLegR') : (key === 'upperLegL' || key === 'lowerLegL');
    const isFrontLeg = isEnemy ? (key === 'upperLegL' || key === 'lowerLegL') : (key === 'upperLegR' || key === 'lowerLegR');
    
    if (isRearArm) return 20;
    if (isRearLeg) return 25;
    if (key === 'pelvis') return 30;
    if (key === 'torso') return 40;
    if (isFrontLeg) return 45;
    if (key === 'head') return 60;
    if (isFrontArm) return 70;
    
    return 50;
}

// Manual custom renderer representing Matter.js body parts beautifully
function drawMatterBodies() {
    const ctx = game.ctx;
    ctx.save();
    ctx.translate(game.canvas.width / 2, game.canvas.height / 2);
    ctx.scale(game.cam.zoom, game.cam.zoom);
    ctx.translate(-game.cam.x, -game.cam.y);

    const bodies = Composite.allBodies(game.engine.world);
    
    // Sort bodies by draw priority so rear limbs don't clip inside/over the body torso
    bodies.sort((a, b) => getBodyDrawPriority(a) - getBodyDrawPriority(b));

    bodies.forEach(body => {
        // Skip arrows and wind particles manually custom rendering
        if (body.label === 'arrow') {
            ctx.fillStyle = '#cbd5e1';
            ctx.beginPath();
            const vertices = body.vertices;
            ctx.moveTo(vertices[0].x, vertices[0].y);
            for (let i = 1; i < vertices.length; i++) {
                ctx.lineTo(vertices[i].x, vertices[i].y);
            }
            ctx.closePath();
            ctx.fill();
            return;
        }

        if (body.label === 'platform') {
            // Support drawing compound platform parts separately
            const partsToDraw = body.parts.length > 1 ? body.parts.slice(1) : [body];
            partsToDraw.forEach(part => {
                ctx.fillStyle = part.render.fillStyle || body.render.fillStyle || '#1e293b';
                ctx.strokeStyle = part.render.strokeStyle || body.render.strokeStyle || strokeStyle;
                ctx.lineWidth = part.render.lineWidth || body.render.lineWidth || 3;
                ctx.beginPath();
                const vertices = part.vertices;
                ctx.moveTo(vertices[0].x, vertices[0].y);
                for (let i = 1; i < vertices.length; i++) {
                    ctx.lineTo(vertices[i].x, vertices[i].y);
                }
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            });
            return;
        }

        // Draw character body part
        if (body.render && body.render.fillStyle) {
            ctx.fillStyle = body.render.fillStyle;
            ctx.beginPath();
            
            if (body.circleRadius) {
                // Circle body parts (head)
                ctx.arc(body.position.x, body.position.y, body.circleRadius, 0, Math.PI * 2);
                ctx.fill();
                
                // Draw equipped hat if player head
                if (body.label === 'player_head' && game.customization && game.customization.equippedHat !== 'none') {
                    drawHat(ctx, body.position.x, body.position.y, body.angle, body.circleRadius, game.customization.equippedHat);
                }
            } else {
                // Polygonal parts
                const vertices = body.vertices;
                ctx.moveTo(vertices[0].x, vertices[0].y);
                for (let i = 1; i < vertices.length; i++) {
                    ctx.lineTo(vertices[i].x, vertices[i].y);
                }
                ctx.closePath();
                ctx.fill();
            }
        }
    });

    ctx.restore();
}

// ── Start / Menu helpers ─────────────────────────────────────────────────────

function startGame() {
    initAudio();
    document.getElementById('screen-start').classList.remove('active');
    document.getElementById('ui-overlay').classList.add('playing');
    game.gameState = 'playing';
    game.activeTurn = 'player'; // Reset turn to player on startup
}

function showMenuPanel(panelId) {
    document.querySelectorAll('.menu-subscreen').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(panelId);
    if (target) target.classList.add('active');
}

// Return to main menu from anywhere (ESC or manual)
function returnToMenu() {
    // Stop all active aiming / AI timers
    game.aiming.active = false;
    game.aiAiming.active = false;
    game.gameState = 'start';
    game.activeTurn = 'player'; // Reset active turn
    game.selectedModes = [];
    game.eventEffects = [];
    game.killStreak = 0;

    // Reset scores
    game.scores.player = 0;
    game.scores.enemy = 0;
    document.getElementById('player-score').innerText = '0';
    document.getElementById('enemy-score').innerText = '0';

    // Clear streak display
    const streakEl = document.getElementById('kill-streak-display');
    if (streakEl) streakEl.innerText = '';

    // Hide gameover / show start screen
    document.getElementById('screen-gameover').classList.remove('active');
    document.getElementById('ui-overlay').classList.remove('playing');
    document.getElementById('screen-start').classList.add('active');
    showMenuPanel('menu-main');
    document.querySelectorAll('.btn-mode').forEach(b => b.classList.remove('selected'));

    // Rebuild world fresh for the next session
    generatePlatforms();
    spawnCharacters();
    selectRandomEvents();
}

// ── ESC key → return to menu ──────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        returnToMenu();
    }
});

// ── Menu navigation & Globals ─────────────────────────────────────────

let activeShopTab = 'hats'; // hats or skins

window.showMenuPanel = showMenuPanel;
window.startGame = startGame;
window.restartRound = restartRound;
window.returnToMenu = returnToMenu;

window.openShopMenu = function() {
    showMenuPanel('menu-shop');
    renderShopItems();
};

window.switchShopTab = function(tab) {
    activeShopTab = tab;
    if (tab === 'hats') {
        document.getElementById('tab-hats').classList.add('active-tab');
        document.getElementById('tab-skins').classList.remove('active-tab');
    } else {
        document.getElementById('tab-skins').classList.add('active-tab');
        document.getElementById('tab-hats').classList.remove('active-tab');
    }
    renderShopItems();
};

window.startRandomMatch = function() {
    initAudio();
    game.selectedModes = []; // random modes each fight
    selectRandomEvents();
    selectRandomPlatform();
    generatePlatforms();
    spawnCharacters();
    startGame();
};

window.toggleModeSelection = function(btn) {
    initAudio();
    const idxAttr = btn.getAttribute('data-event-idx');
    const idx = parseInt(idxAttr, 10);
    
    // If selecting index 0 (normal), deselect all other events
    if (idx === 0) {
        game.selectedModes = [0];
        document.querySelectorAll('.btn-mode').forEach(b => {
            if (b.getAttribute('data-event-idx') === '0') {
                b.classList.add('selected');
            } else {
                b.classList.remove('selected');
            }
        });
        return;
    }
    
    // If other mode is selected, remove index 0
    const idxZero = game.selectedModes.indexOf(0);
    if (idxZero !== -1) {
        game.selectedModes.splice(idxZero, 1);
        document.querySelectorAll('.btn-mode').forEach(b => {
            if (b.getAttribute('data-event-idx') === '0') b.classList.remove('selected');
        });
    }
    
    const pos = game.selectedModes.indexOf(idx);
    if (pos === -1) {
        game.selectedModes.push(idx);
        btn.classList.add('selected');
    } else {
        game.selectedModes.splice(pos, 1);
        btn.classList.remove('selected');
    }
    
    // If nothing selected, default back to 0
    if (game.selectedModes.length === 0) {
        game.selectedModes = [0];
        document.querySelectorAll('.btn-mode').forEach(b => {
            if (b.getAttribute('data-event-idx') === '0') b.classList.add('selected');
        });
    }
};

window.startCustomMatch = function() {
    initAudio();
    applySelectedEvents(game.selectedModes);
    generatePlatforms();
    spawnCharacters();
    startGame();
};

window.switchModesTab = function(tab) {
    if (tab === 'events') {
        document.getElementById('tab-events-btn').classList.add('active-tab');
        document.getElementById('tab-platforms-btn').classList.remove('active-tab');
        document.getElementById('tab-events-content').style.display = 'block';
        document.getElementById('tab-platforms-content').style.display = 'none';
    } else {
        document.getElementById('tab-platforms-btn').classList.add('active-tab');
        document.getElementById('tab-events-btn').classList.remove('active-tab');
        document.getElementById('tab-platforms-content').style.display = 'block';
        document.getElementById('tab-events-content').style.display = 'none';
    }
};

window.selectPlatformType = function(btn) {
    initAudio();
    const type = btn.getAttribute('data-platform-type');
    game.selectedPlatformType = type;
    
    document.querySelectorAll('.btn-platform').forEach(b => {
        if (b === btn) {
            b.classList.add('selected');
        } else {
            b.classList.remove('selected');
        }
    });
};

function renderShopItems() {
    const container = document.getElementById('shop-items-container');
    if (!container) return;
    container.innerHTML = '';

    if (activeShopTab === 'hats') {
        SHOP_HATS.forEach(item => {
            const card = document.createElement('div');
            card.className = 'shop-card';
            
            const isOwned = game.customization.ownedHats.includes(item.id);
            const isEquipped = game.customization.equippedHat === item.id;
            
            if (isEquipped) card.classList.add('equipped');
            else if (isOwned) card.classList.add('purchased');

            card.innerHTML = `
                <div class="shop-item-preview">${item.emoji}</div>
                <div class="shop-item-name">${item.name}</div>
                ${!isOwned ? `<div class="shop-item-price">🪙${item.price}</div>` : ''}
                <div class="shop-item-status">${isEquipped ? 'Экипирован' : (isOwned ? 'Надеть' : 'Купить')}</div>
            `;

            card.addEventListener('click', () => {
                if (isEquipped) return;
                initAudio();
                if (isOwned) {
                    game.customization.equippedHat = item.id;
                    saveShopData();
                    renderShopItems();
                    spawnCharacters(); // Respawn to apply immediately
                } else {
                    if (game.customization.gold >= item.price) {
                        game.customization.gold -= item.price;
                        game.customization.ownedHats.push(item.id);
                        game.customization.equippedHat = item.id;
                        saveShopData();
                        renderShopItems();
                        spawnCharacters();
                    } else {
                        // Flashes red on gold indicator or warning thud
                        playSound('hit_platform');
                    }
                }
            });

            container.appendChild(card);
        });
    } else {
        SHOP_SKINS.forEach(item => {
            const card = document.createElement('div');
            card.className = 'shop-card';
            
            const isOwned = game.customization.ownedSkins.includes(item.id);
            const isEquipped = game.customization.equippedSkin === item.id;
            
            if (isEquipped) card.classList.add('equipped');
            else if (isOwned) card.classList.add('purchased');

            card.innerHTML = `
                <div class="shop-item-preview" style="background: ${item.color}; border: 2px solid rgba(255,255,255,0.15);"></div>
                <div class="shop-item-name">${item.name}</div>
                ${!isOwned ? `<div class="shop-item-price">🪙${item.price}</div>` : ''}
                <div class="shop-item-status">${isEquipped ? 'Экипирован' : (isOwned ? 'Надеть' : 'Купить')}</div>
            `;

            card.addEventListener('click', () => {
                if (isEquipped) return;
                initAudio();
                if (isOwned) {
                    game.customization.equippedSkin = item.id;
                    saveShopData();
                    renderShopItems();
                    spawnCharacters(); // Respawn to apply immediately
                } else {
                    if (game.customization.gold >= item.price) {
                        game.customization.gold -= item.price;
                        game.customization.ownedSkins.push(item.id);
                        game.customization.equippedSkin = item.id;
                        saveShopData();
                        renderShopItems();
                        spawnCharacters();
                    } else {
                        playSound('hit_platform');
                    }
                }
            });

            container.appendChild(card);
        });
    }
}


// Helper functions for Chrono Loop event mode to capture and restore ragdoll state
function captureCharState(char) {
    if (!char) return null;
    const partsState = {};
    Object.entries(char.parts).forEach(([key, part]) => {
        partsState[key] = {
            x: part.position.x,
            y: part.position.y,
            vx: part.velocity.x,
            vy: part.velocity.y,
            angle: part.angle,
            angularVelocity: part.angularVelocity,
            currentScale: part.currentScale || 1.0,
            fillStyle: part.render.fillStyle
        };
    });
    return {
        hp: char.hp,
        isDead: char.isDead,
        isFrozen: char.isFrozen || false,
        freezeTimer: char.freezeTimer || 0,
        parts: partsState
    };
}

function restoreCharState(char, state) {
    if (!char || !state) return;
    char.hp = state.hp;
    char.isDead = state.isDead;
    char.isFrozen = state.isFrozen;
    char.freezeTimer = state.freezeTimer;
    
    // Update HP UI bars
    const isEnemy = (char === game.enemy);
    const hpBarId = isEnemy ? 'enemy-hp' : 'player-hp';
    const hpBar = document.getElementById(hpBarId);
    if (hpBar) {
        const pct = (char.hp / char.maxHp) * 100;
        hpBar.style.width = `${pct}%`;
    }

    // If character was dead and is now alive, restore the spineUpright constraint
    if (!char.isDead && char.spineUpright) {
        const constraints = Composite.allConstraints(char.composite);
        if (!constraints.includes(char.spineUpright)) {
            try { Composite.add(char.composite, char.spineUpright); } catch(e) {}
        }
    }

    Object.entries(state.parts).forEach(([key, partState]) => {
        const part = char.parts[key];
        if (part) {
            // Restore scale if it was changed (like in inflatable mode)
            const currentScale = part.currentScale || 1.0;
            const targetScale = partState.currentScale || 1.0;
            if (Math.abs(currentScale - targetScale) > 0.01) {
                const factor = targetScale / currentScale;
                Body.scale(part, factor, factor);
                part.currentScale = targetScale;
            }
            Body.setPosition(part, { x: partState.x, y: partState.y });
            Body.setVelocity(part, { x: partState.vx, y: partState.vy });
            Body.setAngle(part, partState.angle);
            Body.setAngularVelocity(part, partState.angularVelocity);
            if (part.render) {
                part.render.fillStyle = partState.fillStyle;
            }
        }
    });
}

// ── Settings helper ───────────────────────────────────────────────────────────
function applySettings() {
    // Settings are read on-demand by aiTurn(), dismemberLimb(), applySelectedEvent()
}


// ── Initialize on load ────────────────────────────────────────────────────────
window.addEventListener('load', () => {
    loadShopData(); // Load saved customization and gold
    initGame();
});
