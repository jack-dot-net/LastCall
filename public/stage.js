// 3D Stage — Three.js scene for the game table.
// Real-time visualization that mirrors game state.

(function (global) {
  let scene, camera, renderer, canvas;
  let table, floor;
  let centerGroup;
  let playerSeats = new Map(); // playerId -> { group, ...userData }
  let centerDisplayMesh = null;
  let lastState = null;
  let frameId = null;
  let clockStart = 0;
  let lastResize = 0;
  let parentEl = null;
  let running = false;
  let revealMeshes = [];
  let shotEffectMeshes = [];

  const TABLE_RADIUS = 5;
  const SEAT_RADIUS = 5.7;
  const CARDFRONT_RADIUS = 3.4;
  const CENTER_HEIGHT = 0.4;

  const PIP_LAYOUTS = {
    1: [[1, 1]],
    2: [[0, 0], [2, 2]],
    3: [[0, 0], [1, 1], [2, 2]],
    4: [[0, 0], [0, 2], [2, 0], [2, 2]],
    5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
    6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]],
  };
  const SUIT_GLYPHS = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const LIARS_GLYPHS = { King: '♛', Queen: '♕', Ace: '♠', Joker: '★' };

  function initStage(canvasEl) {
    if (!global.THREE) {
      console.warn('THREE.js not loaded — 3D stage disabled.');
      return false;
    }
    if (scene) return true; // already initialized
    canvas = canvasEl;
    parentEl = canvas.parentElement;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0604);
    scene.fog = new THREE.Fog(0x0a0604, 12, 25);

    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
    camera.position.set(0, 9, 11);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputEncoding = THREE.sRGBEncoding;

    addLighting();
    addFloor();
    addTable();

    centerGroup = new THREE.Group();
    centerGroup.position.set(0, CENTER_HEIGHT, 0);
    scene.add(centerGroup);

    clockStart = performance.now();
    onResize();
    window.addEventListener('resize', onResize);
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => onResize());
      ro.observe(parentEl);
    }

    running = true;
    startLoop();
    return true;
  }

  function addLighting() {
    const ambient = new THREE.AmbientLight(0x3a2018, 0.5);
    scene.add(ambient);

    const overhead = new THREE.SpotLight(0xffd896, 1.6, 26, Math.PI / 4.4, 0.55, 1.2);
    overhead.position.set(0, 9, 0.6);
    const ot = new THREE.Object3D();
    ot.position.set(0, 0, 0);
    scene.add(ot);
    overhead.target = ot;
    scene.add(overhead);

    const fill = new THREE.PointLight(0xff5530, 0.4, 22);
    fill.position.set(-6, 2, -4);
    scene.add(fill);

    const fill2 = new THREE.PointLight(0xffaa55, 0.25, 22);
    fill2.position.set(6, 2, -4);
    scene.add(fill2);
  }

  function addFloor() {
    const geo = new THREE.CircleGeometry(16, 48);
    const mat = new THREE.MeshStandardMaterial({ color: 0x140906, roughness: 1, metalness: 0 });
    floor = new THREE.Mesh(geo, mat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.3;
    scene.add(floor);
  }

  function addTable() {
    const topGeo = new THREE.CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS, 0.35, 64);
    const topTex = makeTableTopTexture();
    const topMat = new THREE.MeshStandardMaterial({ map: topTex, roughness: 0.55, metalness: 0.08 });
    const sideMat = new THREE.MeshStandardMaterial({ color: 0x2d1810, roughness: 0.9 });
    table = new THREE.Mesh(topGeo, [sideMat, topMat, topMat]);
    table.position.y = -0.1;
    scene.add(table);

    // Brass rim
    const rimGeo = new THREE.TorusGeometry(TABLE_RADIUS - 0.05, 0.06, 8, 64);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xc89456, roughness: 0.3, metalness: 0.8, emissive: 0x3a2010, emissiveIntensity: 0.2 });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.08;
    scene.add(rim);

    // Inner felt circle
    const feltGeo = new THREE.CircleGeometry(TABLE_RADIUS - 0.5, 64);
    const feltMat = new THREE.MeshStandardMaterial({ color: 0x4a2418, roughness: 0.95 });
    const felt = new THREE.Mesh(feltGeo, feltMat);
    felt.rotation.x = -Math.PI / 2;
    felt.position.y = 0.081;
    scene.add(felt);
  }

  function makeTableTopTexture() {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(256, 256, 60, 256, 256, 256);
    g.addColorStop(0, '#5a2818');
    g.addColorStop(0.7, '#3a1808');
    g.addColorStop(1, '#1a0e08');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    // Wood grain streaks
    for (let i = 0; i < 60; i++) {
      ctx.strokeStyle = `rgba(${80 + Math.random() * 40}, ${40 + Math.random() * 20}, ${20 + Math.random() * 10}, ${0.06 + Math.random() * 0.08})`;
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      const y = Math.random() * 512;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(170, y + (Math.random() - 0.5) * 40, 340, y + (Math.random() - 0.5) * 40, 512, y + (Math.random() - 0.5) * 60);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  // ----------------------------------------------------------------
  // Text & sprite helpers
  // ----------------------------------------------------------------

  function drawTextOnCanvas(ctx, text, x, y, opts) {
    ctx.font = opts.font || 'bold 40px Georgia';
    ctx.textAlign = opts.align || 'center';
    ctx.textBaseline = opts.baseline || 'middle';
    if (opts.stroke) {
      ctx.strokeStyle = opts.stroke;
      ctx.lineWidth = opts.strokeWidth || 4;
      ctx.strokeText(text, x, y);
    }
    ctx.fillStyle = opts.color || '#e8d4a0';
    ctx.fillText(text, x, y);
  }

  function makeSpriteCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function makeTextSprite(text, opts = {}) {
    const w = opts.canvasW || 512;
    const h = opts.canvasH || 128;
    const c = makeSpriteCanvas(w, h);
    const ctx = c.getContext('2d');
    drawTextOnCanvas(ctx, text, w / 2, h / 2, opts);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.userData.canvas = c;
    sprite.userData.ctx = ctx;
    sprite.userData.w = w;
    sprite.userData.h = h;
    sprite.scale.set(opts.scaleX || 2, opts.scaleY || 0.5, 1);
    return sprite;
  }

  function updateSpriteText(sprite, text, opts = {}) {
    const { canvas: c, ctx, w, h } = sprite.userData;
    ctx.clearRect(0, 0, w, h);
    drawTextOnCanvas(ctx, text, w / 2, h / 2, opts);
    sprite.material.map.needsUpdate = true;
  }

  // ----------------------------------------------------------------
  // Player seats
  // ----------------------------------------------------------------

  function makeSeat(player, isMe) {
    const group = new THREE.Group();

    // Plinth (small wooden block at seat position)
    const plinthGeo = new THREE.BoxGeometry(1.2, 0.7, 0.5);
    const plinthMat = new THREE.MeshStandardMaterial({ color: 0x4a2818, roughness: 0.85, metalness: 0.05 });
    const plinth = new THREE.Mesh(plinthGeo, plinthMat);
    plinth.position.y = 0.35;
    group.add(plinth);

    // Brass nameplate on plinth (front face)
    const plateGeo = new THREE.PlaneGeometry(1.0, 0.25);
    const plateTex = makeNameplateTexture(player.name, isMe);
    const plateMat = new THREE.MeshStandardMaterial({ map: plateTex, emissive: 0x3a2010, emissiveIntensity: 0.3, roughness: 0.4, metalness: 0.5 });
    const plate = new THREE.Mesh(plateGeo, plateMat);
    plate.position.y = 0.45;
    plate.position.z = 0.26;
    group.add(plate);
    group.userData.plateTex = plateTex;

    // Floating name+count sprite high above
    const nameSprite = makeTextSprite(player.name, {
      color: isMe ? '#ffd700' : '#e8d4a0',
      font: 'bold 64px Georgia',
      stroke: 'rgba(0,0,0,0.7)',
      strokeWidth: 6,
    });
    nameSprite.position.set(0, 2.1, 0);
    nameSprite.scale.set(2.4, 0.6, 1);
    group.add(nameSprite);
    group.userData.nameSprite = nameSprite;

    const countSprite = makeTextSprite('🂠 × 0', {
      color: '#c89456',
      font: 'bold 48px Georgia',
      stroke: 'rgba(0,0,0,0.7)',
      strokeWidth: 4,
    });
    countSprite.position.set(0, 1.55, 0);
    countSprite.scale.set(1.6, 0.42, 1);
    group.add(countSprite);
    group.userData.countSprite = countSprite;

    // Chambers (6 dots floating just below count)
    const chamberGroup = new THREE.Group();
    chamberGroup.position.set(0, 1.15, 0);
    const chamberDots = [];
    for (let i = 0; i < 6; i++) {
      const geo = new THREE.SphereGeometry(0.07, 12, 12);
      const mat = new THREE.MeshStandardMaterial({ color: 0xc89456, emissive: 0x2a1505, emissiveIntensity: 0.4, roughness: 0.45, metalness: 0.6 });
      const sphere = new THREE.Mesh(geo, mat);
      sphere.position.x = (i - 2.5) * 0.18;
      chamberGroup.add(sphere);
      chamberDots.push(sphere);
    }
    group.add(chamberGroup);
    group.userData.chamberDots = chamberDots;

    // Highlight ring on table in front of player (current-turn indicator)
    const ringGeo = new THREE.RingGeometry(0.55, 0.78, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffd700,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.085, -0.4);
    group.add(ring);
    group.userData.highlightRing = ring;

    // Card/dice stack in front of player (visual count)
    const stackGroup = new THREE.Group();
    stackGroup.position.set(0, 0.09, -1.6);
    group.add(stackGroup);
    group.userData.stackGroup = stackGroup;
    group.userData.stackMeshes = [];

    group.userData.isMe = isMe;
    return group;
  }

  function makeNameplateTexture(name, isMe) {
    const c = makeSpriteCanvas(512, 128);
    const ctx = c.getContext('2d');
    // Brass gradient bg
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, '#dba66a');
    g.addColorStop(0.5, '#a47840');
    g.addColorStop(1, '#754e22');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 128);
    // Beveled edges
    ctx.strokeStyle = '#3a2010';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 506, 122);
    ctx.strokeStyle = 'rgba(255,230,180,0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, 496, 112);
    drawTextOnCanvas(ctx, name, 256, 64, {
      font: 'bold 64px Georgia',
      color: isMe ? '#fff7d6' : '#241408',
      stroke: 'rgba(0,0,0,0.5)',
      strokeWidth: 2,
    });
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  function positionSeat(group, idx, total) {
    // idx 0 = viewer, placed at +z (near camera). Others go clockwise around.
    const angle = -(idx / total) * Math.PI * 2 + Math.PI / 2;
    group.position.x = Math.cos(angle) * SEAT_RADIUS;
    group.position.z = Math.sin(angle) * SEAT_RADIUS;
    group.position.y = 0;
    group.lookAt(0, group.position.y, 0);
    group.userData.angle = angle;
  }

  // ----------------------------------------------------------------
  // Card/dice stack meshes per player
  // ----------------------------------------------------------------

  let _cardBackTex = null;
  function getCardBackTexture() {
    if (_cardBackTex) return _cardBackTex;
    const c = makeSpriteCanvas(128, 192);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#5a1818';
    ctx.fillRect(0, 0, 128, 192);
    ctx.strokeStyle = '#c89456';
    ctx.lineWidth = 5;
    ctx.strokeRect(6, 6, 116, 180);
    ctx.fillStyle = '#c89456';
    ctx.font = 'bold 56px Georgia';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('♛', 64, 100);
    _cardBackTex = new THREE.CanvasTexture(c);
    _cardBackTex.encoding = THREE.sRGBEncoding;
    return _cardBackTex;
  }

  function makeCardBackMesh() {
    const geo = new THREE.PlaneGeometry(0.55, 0.78);
    const mat = new THREE.MeshStandardMaterial({ map: getCardBackTexture(), roughness: 0.6, metalness: 0.05 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  let _diceFaceTextures = null;
  function getDiceFaceTextures() {
    if (_diceFaceTextures) return _diceFaceTextures;
    _diceFaceTextures = {};
    for (let f = 1; f <= 6; f++) {
      const c = makeSpriteCanvas(128, 128);
      const ctx = c.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, 0, 128);
      g.addColorStop(0, '#fefaee');
      g.addColorStop(1, '#d4c4a4');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = '#5a3a18';
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, 124, 124);
      ctx.fillStyle = '#1a0e08';
      for (const [r, col] of PIP_LAYOUTS[f]) {
        const x = (col + 0.5) * (128 / 3);
        const y = (r + 0.5) * (128 / 3);
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, Math.PI * 2);
        ctx.fill();
      }
      const tex = new THREE.CanvasTexture(c);
      tex.encoding = THREE.sRGBEncoding;
      _diceFaceTextures[f] = tex;
    }
    return _diceFaceTextures;
  }

  function makeDieMesh(face) {
    const size = 0.42;
    const geo = new THREE.BoxGeometry(size, size, size);
    const faces = getDiceFaceTextures();
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z
    // We'll assign faces 1-6 to these
    const faceMap = [3, 4, 1, 6, 2, 5];
    const mats = faceMap.map(f => new THREE.MeshStandardMaterial({ map: faces[f], roughness: 0.4, metalness: 0.05 }));
    const mesh = new THREE.Mesh(geo, mats);
    // Set rotation so face=`face` is on top (+y)
    const rot = topFaceRotation(face);
    mesh.rotation.set(rot.x, rot.y, rot.z);
    return mesh;
  }

  function topFaceRotation(face) {
    // Rotations to make a given pip-face be on top (+y)
    switch (face) {
      case 1: return { x: 0, y: 0, z: 0 };
      case 6: return { x: Math.PI, y: 0, z: 0 };
      case 2: return { x: -Math.PI / 2, y: 0, z: 0 };
      case 5: return { x: Math.PI / 2, y: 0, z: 0 };
      case 3: return { x: 0, y: 0, z: -Math.PI / 2 };
      case 4: return { x: 0, y: 0, z: Math.PI / 2 };
    }
    return { x: 0, y: 0, z: 0 };
  }

  function syncStack(seat, mode, count) {
    const stackGroup = seat.userData.stackGroup;
    const existing = seat.userData.stackMeshes;
    // Clear current
    for (const m of existing) {
      stackGroup.remove(m);
      disposeMesh(m);
    }
    existing.length = 0;
    if (count <= 0) return;

    if (mode === 'dice') {
      // Render dice in a row (face-down random)
      const spacing = 0.48;
      const startX = -((count - 1) * spacing) / 2;
      for (let i = 0; i < count; i++) {
        const die = makeDieMesh(1 + ((i * 3) % 6));
        die.position.set(startX + i * spacing, 0.21, 0);
        // Rotate slightly so they look hidden / random
        die.rotation.y = (i * 0.7) % (Math.PI * 2);
        stackGroup.add(die);
        existing.push(die);
      }
    } else {
      // Cards: render fanned cardbacks
      const spacing = 0.18;
      const startX = -((count - 1) * spacing) / 2;
      for (let i = 0; i < count; i++) {
        const c = makeCardBackMesh();
        c.position.set(startX + i * spacing, 0.005 + i * 0.005, 0);
        c.rotation.z = (i - (count - 1) / 2) * 0.05;
        stackGroup.add(c);
        existing.push(c);
      }
    }
  }

  // ----------------------------------------------------------------
  // Center display
  // ----------------------------------------------------------------

  function clearCenter() {
    while (centerGroup.children.length) {
      const c = centerGroup.children.pop();
      disposeMesh(c);
    }
    centerDisplayMesh = null;
  }

  function syncCenter(state) {
    clearCenter();
    if (state.gameMode === 'cards') {
      // Big floating table-card glyph
      if (state.tableCard) {
        const sprite = makeTextSprite(state.tableCard.toUpperCase(), {
          color: '#ffd700',
          font: 'bold 96px Georgia',
          stroke: '#000',
          strokeWidth: 8,
        });
        sprite.scale.set(3.2, 0.85, 1);
        sprite.position.set(0, 1.4, 0);
        centerGroup.add(sprite);
      }
      // Pile of face-down cards
      if (state.lastPlayedCount > 0) {
        const pile = new THREE.Group();
        for (let i = 0; i < Math.min(state.lastPlayedCount, 6); i++) {
          const card = makeCardBackMesh();
          card.position.set((i - state.lastPlayedCount / 2) * 0.12, 0.01 + i * 0.02, 0.3);
          card.rotation.z = (Math.random() - 0.5) * 0.4;
          pile.add(card);
        }
        centerGroup.add(pile);
      }
    } else if (state.gameMode === 'dice') {
      // Floating bid display
      if (state.lastBid) {
        const label = makeTextSprite(`${state.lastBid.qty} ×`, {
          color: '#ffd700',
          font: 'bold 96px Georgia',
          stroke: '#000',
          strokeWidth: 8,
        });
        label.scale.set(2.4, 0.65, 1);
        label.position.set(-0.9, 1.4, 0);
        centerGroup.add(label);
        // Floating die showing bid face
        const die = makeDieMesh(state.lastBid.face);
        die.position.set(0.9, 1.45, 0);
        die.scale.set(2.2, 2.2, 2.2);
        die.rotation.y = Math.PI / 6;
        centerGroup.add(die);
        die.userData.spin = true;
        // Wild marker
        if (state.lastBid.face === 1) {
          const wild = makeTextSprite('WILD', {
            color: '#ffd700',
            font: 'bold 36px Georgia',
            stroke: '#000',
            strokeWidth: 4,
          });
          wild.scale.set(0.85, 0.25, 1);
          wild.position.set(0.9, 2.4, 0);
          centerGroup.add(wild);
        }
      } else {
        const label = makeTextSprite('— place a bid —', {
          color: '#c89456',
          font: 'italic 48px Georgia',
          stroke: '#000',
          strokeWidth: 3,
        });
        label.scale.set(2.8, 0.6, 1);
        label.position.set(0, 1.3, 0);
        centerGroup.add(label);
      }
    } else if (state.gameMode === 'poker') {
      if (state.lastDeclaration) {
        const txt = formatDeclarationText(state.lastDeclaration);
        const sprite = makeTextSprite(txt, {
          color: '#ffd700',
          font: 'bold 56px Georgia',
          stroke: '#000',
          strokeWidth: 6,
        });
        sprite.scale.set(4.5, 0.7, 1);
        sprite.position.set(0, 1.4, 0);
        centerGroup.add(sprite);
      } else {
        const label = makeTextSprite('— declare a hand —', {
          color: '#c89456',
          font: 'italic 48px Georgia',
          stroke: '#000',
          strokeWidth: 3,
        });
        label.scale.set(2.8, 0.6, 1);
        label.position.set(0, 1.3, 0);
        centerGroup.add(label);
      }
    }
  }

  function formatDeclarationText(d) {
    const rn = (r) => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' })[r] || String(r);
    switch (d.type) {
      case 'pair': return `Pair of ${rn(d.rank)}s`;
      case 'twopair': return `Two pair, ${rn(d.rank)}s`;
      case 'three': return `Three ${rn(d.rank)}s`;
      case 'straight': return `Straight to ${rn(d.rank)}`;
      case 'flush': return 'Flush';
      case 'fullhouse': return `Full house, ${rn(d.rank)}s full`;
      case 'quads': return `Four ${rn(d.rank)}s`;
      case 'straightflush': return 'Straight flush';
    }
    return '?';
  }

  // ----------------------------------------------------------------
  // Player sync
  // ----------------------------------------------------------------

  function syncPlayers(state) {
    const presentIds = new Set(state.players.map(p => p.id));
    // Remove dropped players
    for (const [id, seat] of playerSeats.entries()) {
      if (!presentIds.has(id)) {
        scene.remove(seat);
        disposeGroup(seat);
        playerSeats.delete(id);
      }
    }
    // Add/update each
    const total = state.players.length;
    // Sort viewer to position index 0 (south, near camera)
    let viewerIdx = state.players.findIndex(p => p.id === state.yourId);
    if (viewerIdx < 0) viewerIdx = 0;
    state.players.forEach((player, idx) => {
      let seat = playerSeats.get(player.id);
      if (!seat) {
        seat = makeSeat(player, player.id === state.yourId);
        scene.add(seat);
        playerSeats.set(player.id, seat);
      }
      // Rotate index so viewer is at angle 0 (south, bottom of screen, near camera)
      const displayIdx = (idx - viewerIdx + total) % total;
      positionSeat(seat, displayIdx, total);

      // Update count
      const count = (state.gameMode === 'dice') ? player.diceCount : player.handSize;
      const icon = (state.gameMode === 'dice') ? '🎲' : '🂠';
      updateSpriteText(seat.userData.countSprite, `${icon} × ${count}`, {
        color: '#c89456',
        font: 'bold 48px Georgia',
        stroke: 'rgba(0,0,0,0.7)',
        strokeWidth: 4,
      });

      // Chambers
      seat.userData.chamberDots.forEach((dot, i) => {
        const fired = i < player.shotsFired;
        dot.material.color.set(fired ? 0x8b1a1a : 0xc89456);
        dot.material.emissive.set(fired ? 0x300 : 0x2a1505);
      });

      // Stack
      syncStack(seat, state.gameMode, count);

      // Highlight current player
      const isCurrent = (idx === state.currentPlayerIdx && player.alive);
      const ring = seat.userData.highlightRing;
      ring.material.opacity = isCurrent ? 0.65 : 0;

      // Dead = dim everything
      const dead = !player.alive;
      seat.children.forEach(child => {
        if (child.material && 'opacity' in child.material) {
          child.material.transparent = true;
          if (child === ring) return;
          child.material.opacity = dead ? 0.25 : 1;
        }
      });
      seat.userData.nameSprite.material.opacity = dead ? 0.3 : 1;
      seat.userData.countSprite.material.opacity = dead ? 0.3 : 1;
      seat.userData.dead = dead;
    });
  }

  // ----------------------------------------------------------------
  // Render loop
  // ----------------------------------------------------------------

  function onResize() {
    if (!canvas || !parentEl) return;
    const now = performance.now();
    if (now - lastResize < 50) return;
    lastResize = now;
    const w = parentEl.clientWidth;
    const h = parentEl.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function startLoop() {
    if (frameId) cancelAnimationFrame(frameId);
    function tick() {
      if (!running) { frameId = null; return; }
      frameId = requestAnimationFrame(tick);
      const t = (performance.now() - clockStart) / 1000;
      // Slow ambient camera drift
      camera.position.x = Math.sin(t * 0.07) * 0.6;
      camera.position.y = 9 + Math.sin(t * 0.05) * 0.15;
      camera.position.z = 11 + Math.cos(t * 0.07) * 0.4;
      camera.lookAt(0, 0.4, 0);

      // Pulse highlight rings
      const pulse = 0.6 + 0.15 * Math.sin(t * 4);
      for (const seat of playerSeats.values()) {
        const ring = seat.userData.highlightRing;
        if (ring.material.opacity > 0) {
          ring.material.opacity = pulse;
          ring.scale.setScalar(1 + 0.06 * Math.sin(t * 4));
        }
      }

      // Spin center die if present
      if (centerGroup && centerGroup.children) {
        for (const child of centerGroup.children) {
          if (child.userData && child.userData.spin) {
            child.rotation.y += 0.01;
          }
        }
      }

      // Reveal mesh animations
      for (const m of revealMeshes) {
        m.userData.lifetime -= 0.016;
        if (m.userData.spin) m.rotation.y += 0.02;
        if (m.userData.lifetime <= 0) {
          scene.remove(m);
          disposeMesh(m);
        }
      }
      revealMeshes = revealMeshes.filter(m => m.userData.lifetime > 0);

      // Shot effect
      for (const m of shotEffectMeshes) {
        m.userData.lifetime -= 0.016;
        if (m.userData.spin) m.rotation.y += 0.15;
        if (m.material && m.material.opacity !== undefined) {
          m.material.opacity = Math.max(0, m.userData.lifetime / m.userData.maxLife);
        }
        if (m.userData.lifetime <= 0) {
          scene.remove(m);
          disposeMesh(m);
        }
      }
      shotEffectMeshes = shotEffectMeshes.filter(m => m.userData.lifetime > 0);

      renderer.render(scene, camera);
    }
    tick();
  }

  function stop() {
    running = false;
    if (frameId) cancelAnimationFrame(frameId);
    frameId = null;
  }
  function resume() {
    if (running) return;
    running = true;
    startLoop();
  }

  // ----------------------------------------------------------------
  // Reveal / Shot dramatic effects (lightweight)
  // ----------------------------------------------------------------

  function revealAnimation(data) {
    if (!scene) return;
    // Flash overlay of the relevant cards/dice in the center
    if (data.mode === 'dice' && data.allDice) {
      // Render each player's dice tray briefly around center
      const cnt = data.allDice.length;
      data.allDice.forEach((pdata, i) => {
        const angle = (i / cnt) * Math.PI * 2 - Math.PI / 2;
        const r = 1.8;
        const cx = Math.cos(angle) * r;
        const cz = Math.sin(angle) * r;
        pdata.dice.forEach((d, di) => {
          const die = makeDieMesh(d);
          die.scale.setScalar(1.4);
          die.position.set(cx + (di - 2) * 0.25, 1.3, cz);
          die.userData.lifetime = 3.0;
          die.userData.maxLife = 3.0;
          die.userData.spin = false;
          scene.add(die);
          revealMeshes.push(die);
        });
      });
    } else if (data.mode === 'cards' && data.cards) {
      const cnt = data.cards.length;
      data.cards.forEach((c, i) => {
        const sprite = makeLiarsCardSprite(c);
        sprite.position.set((i - (cnt - 1) / 2) * 0.8, 1.7, 0);
        sprite.userData.lifetime = 2.5;
        sprite.userData.maxLife = 2.5;
        scene.add(sprite);
        revealMeshes.push(sprite);
      });
    } else if (data.mode === 'poker' && data.allHands) {
      const cnt = data.allHands.length;
      data.allHands.forEach((pdata, i) => {
        const angle = (i / cnt) * Math.PI * 2 - Math.PI / 2;
        const r = 1.8;
        const cx = Math.cos(angle) * r;
        const cz = Math.sin(angle) * r;
        pdata.hand.forEach((card, ci) => {
          const sprite = makePokerCardSprite(card);
          sprite.position.set(cx + (ci - 2) * 0.35, 1.4, cz);
          sprite.userData.lifetime = 3.2;
          sprite.userData.maxLife = 3.2;
          scene.add(sprite);
          revealMeshes.push(sprite);
        });
      });
    }
  }

  function makeLiarsCardSprite(name) {
    const c = makeSpriteCanvas(128, 192);
    const ctx = c.getContext('2d');
    const bg = name === 'Joker' ? '#5a1818' : '#f4e8d0';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 128, 192);
    ctx.strokeStyle = '#5a3a18';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 120, 184);
    const color = name === 'Joker' ? '#e8d4a0' : '#241408';
    ctx.fillStyle = color;
    ctx.font = 'bold 22px Georgia';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name.toUpperCase(), 64, 30);
    ctx.font = 'bold 64px Georgia';
    ctx.fillText(LIARS_GLYPHS[name] || '?', 64, 110);
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(0.7, 1.05, 1);
    return sp;
  }

  function makePokerCardSprite(card) {
    const c = makeSpriteCanvas(128, 192);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f4e8d0';
    ctx.fillRect(0, 0, 128, 192);
    ctx.strokeStyle = '#241408';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 120, 184);
    const red = (card.suit === 'H' || card.suit === 'D');
    ctx.fillStyle = red ? '#b00' : '#111';
    const rankStr = ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' })[card.rank] || String(card.rank);
    const suitChar = SUIT_GLYPHS[card.suit] || '?';
    ctx.font = 'bold 26px Georgia';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(rankStr, 10, 8);
    ctx.fillText(suitChar, 10, 36);
    ctx.font = 'bold 78px Georgia';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(suitChar, 64, 100);
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(0.6, 0.9, 1);
    return sp;
  }

  function shotAnimation(data) {
    if (!scene) return;
    // Position a revolver mesh in front of the loser, fire effect
    const seat = playerSeats.get(data.playerId);
    if (!seat) return;
    const px = seat.position.x;
    const pz = seat.position.z;
    // Direction toward center
    const dirX = -px;
    const dirZ = -pz;
    const len = Math.hypot(dirX, dirZ) || 1;
    const offX = dirX / len * 1.4;
    const offZ = dirZ / len * 1.4;

    // Revolver: a small cylinder + barrel
    const revolver = new THREE.Group();
    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.28, 16),
      new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.85, roughness: 0.25, transparent: true, opacity: 1 })
    );
    cyl.rotation.x = Math.PI / 2;
    revolver.add(cyl);
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.45, 12),
      new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.9, roughness: 0.2, transparent: true, opacity: 1 })
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0, 0.32);
    revolver.add(barrel);
    revolver.position.set(px + offX * 0.4, 0.7, pz + offZ * 0.4);
    revolver.lookAt(0, 0.7, 0);
    revolver.userData.lifetime = 1.8;
    revolver.userData.maxLife = 1.8;
    revolver.userData.spin = false;
    scene.add(revolver);
    shotEffectMeshes.push(cyl); // for opacity fade
    shotEffectMeshes.push(barrel);
    cyl.userData.lifetime = 1.8; cyl.userData.maxLife = 1.8;
    barrel.userData.lifetime = 1.8; barrel.userData.maxLife = 1.8;
    // Add a flash if BANG
    if (data.died) {
      const flashGeo = new THREE.SphereGeometry(0.6, 16, 16);
      const flashMat = new THREE.MeshBasicMaterial({ color: 0xff8030, transparent: true, opacity: 1 });
      const flash = new THREE.Mesh(flashGeo, flashMat);
      flash.position.set(px + offX * 0.7, 0.9, pz + offZ * 0.7);
      flash.userData.lifetime = 0.6;
      flash.userData.maxLife = 0.6;
      flash.userData.spin = false;
      scene.add(flash);
      shotEffectMeshes.push(flash);
    }
  }

  // ----------------------------------------------------------------
  // Disposal helpers
  // ----------------------------------------------------------------

  function disposeMesh(m) {
    if (!m) return;
    if (m.geometry) m.geometry.dispose();
    if (m.material) {
      if (Array.isArray(m.material)) m.material.forEach(mat => disposeMat(mat));
      else disposeMat(m.material);
    }
    if (m.children && m.children.length) {
      for (const c of m.children.slice()) {
        m.remove(c);
        disposeMesh(c);
      }
    }
  }
  function disposeMat(mat) {
    if (!mat) return;
    if (mat.map) mat.map.dispose();
    mat.dispose();
  }
  function disposeGroup(g) {
    disposeMesh(g);
  }

  // ----------------------------------------------------------------
  // Public API
  // ----------------------------------------------------------------

  global.Stage = {
    init: initStage,
    update(state) {
      if (!scene) return;
      lastState = state;
      syncPlayers(state);
      syncCenter(state);
    },
    reveal: revealAnimation,
    shot: shotAnimation,
    resume,
    pause: stop,
    isReady: () => !!scene,
  };
})(window);
