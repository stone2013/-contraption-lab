/* 造啥都行 — presentation, editor, persistence and game loop. No network access required. */
(() => {
  'use strict';
  const P = window.LabPhysics, LEVELS = window.LabLevels;
  if (!P || !LEVELS) { document.body.textContent = '游戏文件不完整，请重新解压全部文件，或打开单文件版。'; return; }
  const $ = id => document.getElementById(id);
  const canvas = $('board'), wrap = $('board-wrap'), ctx = canvas.getContext('2d');
  if (!ctx) { $('toast').hidden = false; $('toast').textContent = '当前浏览器无法使用 Canvas，请换一个浏览器打开。'; return; }
  const NAMES = { plank: '木板', spring: '弹簧', fan: '风扇' };
  const KEY = 'contraption-lab-v1';
  const compactQuery = window.matchMedia('(max-width:760px), (pointer:coarse) and (max-width:1100px)');
  const compact = () => compactQuery.matches;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let storage = { drafts: {}, wins: {}, level: 0 }, storageOK = true;
  try {
    const loaded = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (loaded && typeof loaded === 'object') {
      storage.drafts = loaded.drafts && typeof loaded.drafts === 'object' ? loaded.drafts : {};
      storage.wins = loaded.wins && typeof loaded.wins === 'object' ? loaded.wins : {};
      storage.level = Number.isInteger(loaded.level) ? P.clamp(loaded.level, 0, LEVELS.length - 1) : 0;
    }
  } catch (_) { storageOK = false; }
  let levelIndex = storage.level, items = [], mode = 'edit', sim = null, usedExample = false;
  let selectedId = null, activeTool = null, ghost = null, past = [], future = [], previousPath = [];
  let pointer = { x: 500, y: 330, inside: false }, drag = null, cardDrag = null, rangeBefore = null;
  let showGrid = true, showPath = true, playbackSpeed = 1, accumulator = 0, lastFrame = 0;
  let effects = [], toastTimer = 0, muted = true, audio = null, lastSoundTime = -10;
  let view = { w: 1000, h: 620, scale: 1, ox: 0, oy: 0, dpr: 1 }, initialized = false;
  const camera = { zoom: 1, cx: P.W / 2, cy: P.H / 2 };
  const pointers = new Map();
  let pinch = null, gestureConsumed = false, needsRender = true, clockPaint = 0;
  let rotationTimer = null, rotationHeld = false;
  const level = () => LEVELS[levelIndex];
  const editing = () => mode === 'edit';
  const snapshot = () => ({ items: P.clone(items), example: usedExample });
  const selected = () => activeTool ? ghost : items.find(p => p.id === selectedId) || null;
  const normalize = a => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;

  function sanitizeParts(data) {
    if (!Array.isArray(data) || data.length > level().budget) return null;
    const out = [], ids = new Set();
    for (const p of data) {
      if (!p || !NAMES[p.type] || ![p.x, p.y, p.angle, p.length, p.power].every(Number.isFinite)) return null;
      const id = typeof p.id === 'string' && p.id.length < 80 && !ids.has(p.id) ? p.id : P.part(p.type, 0, 0).id;
      ids.add(id);
      const q = { id, type: p.type, x: P.clamp(p.x, 0, P.W), y: P.clamp(p.y, 0, P.H), angle: normalize(p.angle),
        length: P.clamp(p.length, 140, 340), power: P.clamp(p.power, p.type === 'spring' ? 450 : 400, p.type === 'spring' ? 1050 : 2400) };
      // Non-plank lengths are defined by their type, not by the range control.
      if (q.type !== 'plank') q.length = q.type === 'spring' ? 88 : 52;
      out.push(q);
    }
    return out;
  }
  function save() {
    storage.drafts[level().id] = { parts: P.clone(items), example: usedExample };
    storage.level = levelIndex;
    try { localStorage.setItem(KEY, JSON.stringify(storage)); storageOK = true; }
    catch (_) { storageOK = false; }
    $('save-status').innerHTML = '<span></span>' + (storageOK ? '布局已自动保存在本机' : '临时布局 · 当前浏览器未允许本地保存');
  }
  function toast(message, duration = 2500) {
    clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, duration);
  }
  function pushHistory(before) {
    if (JSON.stringify(before) === JSON.stringify(snapshot())) return;
    past.push(before); if (past.length > 60) past.shift(); future = [];
  }
  function mutate(fn, message) {
    if (!editing()) return;
    const before = snapshot(); fn(); usedExample = false; pushHistory(before); save(); updateUI();
    if (message) toast(message);
  }
  function undo(redo = false) {
    if (!editing()) return;
    const from = redo ? future : past, to = redo ? past : future;
    if (!from.length) return;
    to.push(snapshot()); const restored = from.pop(); items = P.clone(restored.items); usedExample = restored.example;
    selectedId = null; activeTool = ghost = null; save(); updateUI();
  }
  function loadLevel(index) {
    cancelInteractions();
    if (initialized) save();
    resetCamera();
    levelIndex = P.clamp(index, 0, LEVELS.length - 1);
    const draft = storage.drafts[level().id], validated = draft ? sanitizeParts(draft.parts) : null;
    items = validated || P.clone(level().initial); usedExample = !!(validated && draft.example);
    mode = 'edit'; sim = null; selectedId = null; activeTool = ghost = null; drag = cardDrag = null;
    past = []; future = []; previousPath = []; effects = []; accumulator = 0; lastFrame = 0;
    $('result-card').hidden = true; $('toast').hidden = true; clearTimeout(toastTimer);
    initialized = true; save(); updateUI();
  }
  function loadExample() {
    if (!editing()) return;
    const before = snapshot(); items = P.clone(level().example); usedExample = true;
    pushHistory(before); selectedId = null; activeTool = ghost = null; previousPath = [];
    resetCamera(); save(); updateUI(); toast('示例就位，点「开始实验」试一试。可撤销恢复原布局。', 2700);
  }
  function clampPart(p) {
    const [w, h] = P.dimensions(p), c = Math.abs(Math.cos(p.angle)), s = Math.abs(Math.sin(p.angle));
    const hw = (w * c + h * s) / 2, hh = (w * s + h * c) / 2;
    p.x = P.clamp(p.x, hw + 8, P.W - hw - 8);
    p.y = P.clamp(p.y, hh + 62, P.H - hh - 24);
    return p;
  }
  function chooseTool(type) {
    if (!editing()) { toast('先返回编辑，再调整你的发明。'); return; }
    if (activeTool === type) { activeTool = ghost = null; updateUI(); return; }
    if (items.length >= level().budget) { toast('零件数量已满。可以删掉一个，或者撤销上一步。'); return; }
    activeTool = type; selectedId = null;
    ghost = P.part(type, pointer.inside ? pointer.x : 500, pointer.inside ? pointer.y : 320,
      (type === 'plank' ? 18 : type === 'spring' ? 25 : 0) * P.DEG);
    clampPart(ghost); updateUI();
  }
  function placeTool(point) {
    if (!editing() || !activeTool || !point.inside || items.length >= level().budget) return;
    const p = clampPart({ ...ghost, id: P.part(activeTool, 0, 0).id, x: point.x, y: point.y });
    mutate(() => { items.push(p); selectedId = p.id; activeTool = ghost = null; });
    canvas.focus({ preventScroll: true });
  }
  function rotateSelected(degrees) {
    if (!editing()) return;
    const p = selected(); if (!p) return;
    if (activeTool) { p.angle = normalize(p.angle + degrees * P.DEG); clampPart(p); updateInspector(); return; }
    mutate(() => { p.angle = normalize(p.angle + degrees * P.DEG); clampPart(p); });
  }
  function deleteSelected() {
    if (activeTool) { activeTool = ghost = null; updateUI(); return; }
    if (!selectedId) return;
    mutate(() => { items = items.filter(p => p.id !== selectedId); selectedId = null; });
  }
  function start() {
    if (mode === 'running' || mode === 'paused') return;
    if (sim && sim.path.length) previousPath = sim.path.slice();
    cancelInteractions();
    activeTool = ghost = null; drag = cardDrag = null; if (compact()) resetCamera(); sim = P.create(level(), items);
    mode = 'running'; effects = []; accumulator = 0; lastFrame = 0; lastSoundTime = -10;
    $('result-card').hidden = true; $('toast').hidden = true;
    resumeAudio(); updateUI(); tone(330, .05, .025);
  }
  function returnToEdit() {
    cancelInteractions();
    if (document.body.classList.contains('focus-mode')) setFocus(false);
    if (sim && sim.path.length) previousPath = sim.path.slice();
    sim = null; mode = 'edit'; effects = []; accumulator = 0; drag = cardDrag = null;
    $('result-card').hidden = true; updateUI();
  }
  function togglePause() {
    if (mode !== 'running' && mode !== 'paused') return;
    mode = mode === 'running' ? 'paused' : 'running'; accumulator = 0; lastFrame = 0; updateUI();
  }
  function toggleSpeed() {
    playbackSpeed = playbackSpeed === 1 ? .5 : 1;
    $('speed-btn').textContent = playbackSpeed === 1 ? '1×' : '0.5×';
    $('speed-btn').setAttribute('aria-label', playbackSpeed === 1 ? '当前为正常速度，点击切换半速慢放' : '当前为半速慢放，点击切换正常速度');
  }
  function finish() {
    if (!sim || (sim.state !== 'won' && sim.state !== 'lost') || mode === sim.state) return;
    mode = sim.state; accumulator = 0;
    const won = mode === 'won', result = $('result-card');
    result.classList.toggle('lost', !won);
    $('result-icon').innerHTML = icon(won ? 'check' : 'reset');
    $('result-eyebrow').textContent = won ? 'DELIVERY COMPLETE' : 'A GOOD EXPERIMENT, ANYWAY';
    $('result-title').textContent = won ? (usedExample ? '原来这样也行！' : '这也能行！') : '差一点，再来。';
    $('result-desc').textContent = won ? `${sim.time.toFixed(2)} 秒 · ${items.length} 个零件${usedExample ? ' · 示例验证成功' : ' · 成功投递'}` : sim.reason;
    $('result-edit').textContent = won ? '继续改造' : '调整机关';
    $('result-next').innerHTML = won ? (levelIndex < LEVELS.length - 1 ? '下一关 ' : '回到第一关 ') + icon('arrow') : '再试一次 ' + icon('play');
    result.hidden = false;
    if (won) {
      const old = storage.wins[level().id];
      if (!old || sim.time < old.time) storage.wins[level().id] = { time: sim.time, parts: items.length };
      save(); celebrate(); tone(523, .11, .04, 0); tone(659, .11, .04, .10); tone(784, .22, .04, .20);
    }
    updateUI();
  }
  function updateInspector() {
    needsRender = true;
    const p = selected();
    $('deselect-btn').hidden = !p;
    $('deselect-btn').disabled = !editing();
    $('selection-empty').hidden = !!p; $('selection-controls').hidden = !p;
    $('inspector-caption').textContent = p ? NAMES[p.type] + (activeTool ? ' · 待放置' : ' · 已选中') : (storageOK ? '未选中' : '未选中 · 临时会话');
    $('inspector-title').textContent = p ? '零件设置' : '操作指南';
    if (!p) return;
    $('angle-value').textContent = Math.round(p.angle / P.DEG) + '°';
    const slider = $('property-slider');
    if (p.type === 'plank') {
      $('property-label').textContent = '木板长度'; slider.min = 140; slider.max = 340; slider.step = 10;
      slider.value = p.length; $('property-value').textContent = Math.round(p.length);
      $('property-tip').textContent = '长一点，也许刚好接得住。';
    } else if (p.type === 'spring') {
      $('property-label').textContent = '弹射力度'; slider.min = 450; slider.max = 1050; slider.step = 25;
      slider.value = p.power; $('property-value').textContent = Math.round(p.power);
      $('property-tip').textContent = '沿箭头弹射，角度和力度都很重要。';
    } else {
      $('property-label').textContent = '风力大小'; slider.min = 400; slider.max = 2400; slider.step = 100;
      slider.value = p.power; $('property-value').textContent = (p.power / 1000).toFixed(1) + '×';
      $('property-tip').textContent = '箭头所指，是气流前进的方向。';
    }
    ['rotate-left', 'rotate-right', 'delete-btn', 'property-slider'].forEach(id => $(id).disabled = !editing());
  }
  function updateUI() {
    needsRender = true;
    const l = level();
    document.body.dataset.mode = mode;
    $('chapter-label').textContent = `实验 ${String(levelIndex + 1).padStart(2, '0')} / ${l.tag}`;
    $('level-title').textContent = l.title; $('level-desc').textContent = l.description;
    $('hint-text').textContent = l.hint; $('stage-label').textContent = '试验台 ' + String(levelIndex + 1).padStart(2, '0');
    document.querySelectorAll('.level-tab').forEach((el, i) => {
      el.classList.toggle('active', i === levelIndex); el.setAttribute('aria-current', i === levelIndex ? 'step' : 'false');
      el.querySelector('.tab-done').hidden = !storage.wins[LEVELS[i].id];
    });
    $('status-pill').className = 'status-pill ' + mode;
    $('status-text').textContent = { edit: '编辑中', running: '实验中', paused: '已暂停', won: '成功抵达', lost: '再试一次' }[mode];
    wrap.dataset.mode = mode; $('part-count').textContent = items.length;
    document.querySelector('.part-count>span').textContent = ' / ' + l.budget;
    document.querySelectorAll('.part-card').forEach(el => {
      const active = el.dataset.tool === activeTool;
      el.classList.toggle('active', active); el.setAttribute('aria-pressed', String(active)); el.disabled = !editing();
    });
    $('undo-btn').disabled = !editing() || !past.length; $('redo-btn').disabled = !editing() || !future.length;
    $('clear-btn').disabled = !editing() || !items.length; $('example-btn').disabled = !editing();
    $('play-btn').disabled = !compact() && (mode === 'running' || mode === 'paused');
    $('play-btn').querySelector('span').textContent = mode === 'running' ? (compact() ? '暂停实验' : '实验进行中') : mode === 'paused' ? (compact() ? '继续实验' : '实验已暂停') : mode === 'edit' ? '开始实验' : '再跑一次';
    $('play-btn').querySelector('use').setAttribute('href', compact() && mode === 'running' ? '#i-pause' : '#i-play');
    $('mobile-example-btn').disabled = !editing(); $('mobile-clear-btn').disabled = !editing() || !items.length;
    if (activeTool) wrap.dataset.tool = activeTool; else delete wrap.dataset.tool;
    $('placement-banner').textContent = compact() ? '点画布放置 ' + (NAMES[activeTool] || '') + ' · 再点零件可取消' : '点击放置 · Q / E 旋转 · Esc 取消';
    const turn = compact() ? 5 : 15;
    $('rotate-left').querySelector('span').textContent = turn + '°';
    $('rotate-right').querySelector('span').textContent = turn + '°';
    $('rotate-left').setAttribute('aria-label', `逆时针旋转 ${turn} 度，长按连续旋转`);
    $('rotate-right').setAttribute('aria-label', `顺时针旋转 ${turn} 度，长按连续旋转`);
    $('pause-btn').disabled = mode !== 'running' && mode !== 'paused';
    $('pause-btn').innerHTML = icon(mode === 'paused' ? 'play' : 'pause');
    $('pause-btn').setAttribute('aria-label', mode === 'paused' ? '继续实验' : '暂停实验');
    $('edit-btn').disabled = editing(); $('placement-banner').hidden = !activeTool;
    updateClock();
    canvas.style.cursor = activeTool ? 'crosshair' : editing() ? 'grab' : 'default';
    updateInspector();
  }

  // A camera independent of physics: neither zoom nor orientation changes the world.
  function updateClock() {
    const text = sim ? sim.time.toFixed(2) : '0.00';
    $('time-value').innerHTML = text + '<span>s</span>';
    $('mobile-time').textContent = text + 's';
  }
  function syncCamera() {
    const base = Math.min(view.w / P.W, view.h / P.H);
    if (!base) return;
    view.scale = base * camera.zoom;
    const halfW = view.w / (2 * view.scale), halfH = view.h / (2 * view.scale);
    camera.cx = halfW >= P.W / 2 ? P.W / 2 : P.clamp(camera.cx, halfW, P.W - halfW);
    camera.cy = halfH >= P.H / 2 ? P.H / 2 : P.clamp(camera.cy, halfH, P.H - halfH);
    view.ox = view.w / 2 - camera.cx * view.scale;
    view.oy = view.h / 2 - camera.cy * view.scale;
    $('zoom-value').textContent = camera.zoom <= 1.015 ? '全景' : camera.zoom.toFixed(1) + '×';
    $('zoom-out').disabled = camera.zoom <= 1.01;
    $('zoom-in').disabled = camera.zoom >= 3.49;
    $('zoom-fit').setAttribute('aria-label', '查看完整试验台，当前放大 ' + camera.zoom.toFixed(1) + ' 倍');
    needsRender = true;
  }
  function resetCamera() { camera.zoom = 1; camera.cx = P.W / 2; camera.cy = P.H / 2; syncCamera(); }
  function zoomBy(factor) {
    const target = selected() || (sim ? sim.ball : null);
    camera.zoom = P.clamp(camera.zoom * factor, 1, 3.5);
    if (target) { camera.cx = target.x; camera.cy = target.y; }
    syncCamera();
  }
  function localClient(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function worldPoint(e) {
    const p = localClient(e), x = (p.x - view.ox) / view.scale, y = (p.y - view.oy) / view.scale;
    return { x, y, inside: x >= 0 && x <= P.W && y >= 0 && y <= P.H && p.x >= 0 && p.x <= view.w && p.y >= 0 && p.y <= view.h };
  }
  function knobPoint(p) {
    const reach = P.dimensions(p)[0] / 2 + 28 / view.scale;
    return { x: p.x + Math.cos(p.angle) * reach, y: p.y + Math.sin(p.angle) * reach };
  }
  function nearestPart(point, touch) {
    let best = null, distance = Infinity;
    // A minimum 44px touch corridor; choose the closest actual shape at overlaps.
    for (const p of [...items].reverse()) {
      const q = P.localPoint(point.x, point.y, p), [w, h] = P.dimensions(p);
      const d = Math.hypot(Math.max(0, Math.abs(q.x) - w / 2), Math.max(0, Math.abs(q.y) - h / 2));
      if (d <= (touch ? 22 : 8) / view.scale && d < distance) { best = p; distance = d; }
    }
    return best;
  }
  function rollbackDrag() {
    if (drag && drag.before) { items = P.clone(drag.before.items); usedExample = drag.before.example; }
    drag = null; needsRender = true;
  }
  function cancelInteractions() {
    rollbackDrag();
    if (rangeBefore) { items = P.clone(rangeBefore.items); usedExample = rangeBefore.example; rangeBefore = null; }
    for (const id of pointers.keys()) { try { if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id); } catch (_) {} }
    pointers.clear(); pinch = null; gestureConsumed = false; cardDrag = null;
    stopRotation();
  }
  function beginPinch() {
    rollbackDrag(); gestureConsumed = true;
    const [a, b] = [...pointers.values()], x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
    pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom: camera.zoom,
      wx: (x - view.ox) / view.scale, wy: (y - view.oy) / view.scale };
    updateInspector();
  }
  function movePinch() {
    if (!pinch || pointers.size < 2) return;
    const [a, b] = [...pointers.values()], x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
    camera.zoom = P.clamp(pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance, 1, 3.5);
    const scale = Math.min(view.w / P.W, view.h / P.H) * camera.zoom;
    camera.cx = pinch.wx + (view.w / 2 - x) / scale;
    camera.cy = pinch.wy + (view.h / 2 - y) / scale;
    syncCamera();
  }
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 || $('help-dialog').open) return;
    e.preventDefault(); canvas.focus({ preventScroll: true });
    pointers.set(e.pointerId, localClient(e));
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    if (pointers.size >= 2) { beginPinch(); return; }
    if (gestureConsumed) return;
    pointer = worldPoint(e);
    const screen = localClient(e), touch = e.pointerType === 'touch';
    if (editing() && activeTool && pointer.inside) {
      ghost.x = pointer.x; ghost.y = pointer.y; clampPart(ghost);
      drag = { type: 'place', pointerId: e.pointerId, touch }; needsRender = true; return;
    }
    if (editing() && pointer.inside) {
      const current = selected();
      if (current) {
        const k = knobPoint(current);
        if (Math.hypot(pointer.x - k.x, pointer.y - k.y) < (touch ? 22 : 14) / view.scale) {
          drag = { type: 'rotate', id: current.id, before: snapshot(), pointerId: e.pointerId, touch }; return;
        }
      }
      const found = nearestPart(pointer, touch);
      selectedId = found ? found.id : null;
      if (found) {
        drag = { type: 'move', id: found.id, dx: pointer.x - found.x, dy: pointer.y - found.y, before: snapshot(), pointerId: e.pointerId, touch };
        updateUI(); return;
      }
    }
    drag = { type: 'pan', pointerId: e.pointerId, x: screen.x, y: screen.y, cx: camera.cx, cy: camera.cy };
    updateUI();
  });
  canvas.addEventListener('pointermove', e => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, localClient(e));
    if (pointers.size >= 2) { movePinch(); return; }
    if (gestureConsumed) return;
    pointer = worldPoint(e);
    if (drag && drag.pointerId !== e.pointerId) return;
    if (drag && drag.type === 'pan') {
      const q = localClient(e);
      camera.cx = drag.cx - (q.x - drag.x) / view.scale; camera.cy = drag.cy - (q.y - drag.y) / view.scale;
      syncCamera(); return;
    }
    if (!editing()) return;
    if (activeTool && ghost) { ghost.x = pointer.x; ghost.y = pointer.y; clampPart(ghost); needsRender = true; }
    if (drag && drag.type !== 'place') {
      const p = items.find(x => x.id === drag.id); if (!p) return;
      if (drag.type === 'move') {
        p.x = pointer.x - drag.dx; p.y = pointer.y - drag.dy;
        if (e.shiftKey) { p.x = Math.round(p.x / 10) * 10; p.y = Math.round(p.y / 10) * 10; }
      } else {
        const quantum = (e.shiftKey ? 15 : 5) * P.DEG;
        p.angle = normalize(Math.round(Math.atan2(pointer.y - p.y, pointer.x - p.x) / quantum) * quantum);
      }
      clampPart(p); canvas.style.cursor = drag.type === 'move' ? 'grabbing' : 'crosshair'; updateInspector();
    } else if (!activeTool) canvas.style.cursor = nearestPart(pointer, false) ? 'grab' : 'default';
  });
  function endPointer(e, cancelled = false) {
    pointers.delete(e.pointerId);
    if (gestureConsumed) {
      if (pointers.size < 2) pinch = null;
      if (!pointers.size) gestureConsumed = false;
    } else if (drag && drag.pointerId === e.pointerId) {
      const ended = drag; drag = null;
      if (cancelled && ended.before) { items = P.clone(ended.before.items); usedExample = ended.before.example; }
      else if (!cancelled && ended.type === 'place') placeTool(worldPoint(e));
      else if (!cancelled && ended.before) {
        if (JSON.stringify(ended.before.items) !== JSON.stringify(items)) usedExample = false;
        pushHistory(ended.before); save();
      }
    }
    try { if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    updateUI();
  }
  canvas.addEventListener('pointerup', e => endPointer(e));
  canvas.addEventListener('pointercancel', e => endPointer(e, true));
  canvas.addEventListener('lostpointercapture', e => { if (pointers.has(e.pointerId)) endPointer(e, true); });
  canvas.addEventListener('pointerleave', () => { if (!drag) pointer.inside = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) return;
    if (!editing() || !selected()) return;
    e.preventDefault(); rotateSelected(e.deltaY > 0 ? 5 : -5);
  }, { passive: false });
  document.querySelectorAll('.part-card').forEach(card => {
    card.addEventListener('pointerdown', e => {
      if (!editing() || e.button !== 0 || cardDrag) return;
      e.preventDefault(); chooseTool(card.dataset.tool);
      if (!activeTool) return;
      cardDrag = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false, touch: e.pointerType === 'touch' };
      card.setPointerCapture(e.pointerId);
    });
    card.addEventListener('click', e => { if (e.detail === 0 && !e.pointerType) chooseTool(card.dataset.tool); });
    card.addEventListener('pointercancel', () => { cardDrag = null; needsRender = true; });
    card.addEventListener('contextmenu', e => e.preventDefault());
  });
  window.addEventListener('pointermove', e => {
    if (!cardDrag || cardDrag.pointerId !== e.pointerId || !ghost) return;
    cardDrag.moved ||= Math.hypot(e.clientX - cardDrag.x, e.clientY - cardDrag.y) > 7;
    pointer = worldPoint(e);
    if (pointer.inside) { ghost.x = pointer.x; ghost.y = pointer.y; clampPart(ghost); needsRender = true; }
  });
  window.addEventListener('pointerup', e => {
    if (!cardDrag || cardDrag.pointerId !== e.pointerId) return;
    if (cardDrag.moved) placeTool(worldPoint(e));
    cardDrag = null; needsRender = true;
  });
  function setFocus(enabled) {
    document.body.classList.toggle('focus-mode', enabled && compact());
    $('focus-btn').setAttribute('aria-pressed', String(enabled && compact()));
    $('focus-btn').setAttribute('aria-label', enabled && compact() ? '退出专注视图' : '进入专注视图');
    $('focus-btn').innerHTML = icon(enabled && compact() ? 'close' : 'expand');
    requestAnimationFrame(resize);
  }
  function syncLayout() {
    const toolbar = document.querySelector('.play-toolbar');
    if (compact()) document.querySelector('.app').insertBefore(toolbar, document.querySelector('.footer'));
    else { document.querySelector('.lab-panel').appendChild(toolbar); setFocus(false); }
    closeMenu();
    if (initialized) { cancelInteractions(); updateUI(); requestAnimationFrame(resize); }
  }
  function closeMenu() { $('more-menu').hidden = true; $('more-btn').setAttribute('aria-expanded', 'false'); }
  $('focus-btn').onclick = () => setFocus(!document.body.classList.contains('focus-mode'));
  $('more-btn').onclick = () => { const open = $('more-menu').hidden; $('more-menu').hidden = !open; $('more-btn').setAttribute('aria-expanded', String(open)); };
  document.addEventListener('click', e => { if (!e.target.closest('#more-menu') && !e.target.closest('#more-btn')) closeMenu(); });
  $('mobile-example-btn').onclick = loadExample;
  $('mobile-grid-btn').onclick = () => { $('grid-btn').onclick(); };
  $('mobile-path-btn').onclick = () => { $('path-btn').onclick(); };
  $('mobile-clear-btn').onclick = () => { $('clear-btn').click(); closeMenu(); };
  $('deselect-btn').onclick = () => { if (!editing()) return; activeTool = ghost = null; selectedId = null; updateUI(); };
  $('zoom-in').onclick = () => zoomBy(1.4);
  $('zoom-out').onclick = () => zoomBy(1 / 1.4);
  $('zoom-fit').onclick = resetCamera;
  compactQuery.addEventListener('change', syncLayout);
  window.addEventListener('blur', () => { cancelInteractions(); updateUI(); });

  const tabs = $('level-tabs');
  LEVELS.forEach((l, i) => {
    const b = document.createElement('button'); b.className = 'level-tab'; b.type = 'button';
    b.innerHTML = `<span class="tab-num">0${i + 1}</span><span>${l.name}</span><span class="tab-done" hidden>✓</span>`;
    b.setAttribute('aria-label', `第 ${i + 1} 关：${l.name}`); b.onclick = () => loadLevel(i); tabs.appendChild(b);
  });
  $('home-link').onclick = e => { e.preventDefault(); loadLevel(0); };
  $('play-btn').onclick = () => { if (compact() && (mode === 'running' || mode === 'paused')) togglePause(); else start(); }; $('pause-btn').onclick = togglePause; $('edit-btn').onclick = returnToEdit;
  $('speed-btn').onclick = toggleSpeed; $('undo-btn').onclick = () => undo(); $('redo-btn').onclick = () => undo(true);
  $('clear-btn').onclick = () => mutate(() => { items = []; selectedId = null; activeTool = ghost = null; }, '零件已清空。可以用撤销找回来。');
  // A hold is one undoable operation, not dozens of tiny history entries.
  let rotationBefore = null, rotationPointer = null;
  function stopRotation() {
    clearTimeout(rotationTimer); rotationTimer = null;
    if (rotationBefore) {
      if (JSON.stringify(rotationBefore.items) !== JSON.stringify(items)) usedExample = false;
      pushHistory(rotationBefore); rotationBefore = null; save();
    }
    rotationPointer = null;
  }
  function holdTurn(sign) {
    const p = selected(); if (!editing() || !p) return;
    p.angle = normalize(p.angle + sign * (compact() ? 5 : 15) * P.DEG); clampPart(p); updateInspector();
  }
  [['rotate-left', -1], ['rotate-right', 1]].forEach(([id, sign]) => {
    const button = $(id);
    button.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !editing() || !selected()) return;
      e.preventDefault(); stopRotation(); rotationHeld = true;
      rotationPointer = e.pointerId; if (!activeTool) rotationBefore = snapshot();
      button.setPointerCapture(e.pointerId); holdTurn(sign);
      const repeat = () => { holdTurn(sign); rotationTimer = setTimeout(repeat, 95); };
      rotationTimer = setTimeout(repeat, 380);
    });
    const end = e => { if (rotationPointer !== e.pointerId) return; stopRotation(); updateUI(); };
    button.addEventListener('pointerup', end); button.addEventListener('pointercancel', end); button.addEventListener('lostpointercapture', end);
    button.addEventListener('contextmenu', e => e.preventDefault());
    button.onclick = e => { if (e.detail === 0 && !e.pointerType) rotateSelected(sign * (compact() ? 5 : 15)); rotationHeld = false; };
  });
  $('delete-btn').onclick = deleteSelected; $('example-btn').onclick = loadExample;
  $('grid-btn').onclick = () => { showGrid = !showGrid; $('grid-btn').setAttribute('aria-pressed', String(showGrid)); $('mobile-grid-btn').setAttribute('aria-pressed', String(showGrid)); $('mobile-grid-btn').querySelector('span').textContent = showGrid ? '开' : '关'; needsRender = true; };
  $('path-btn').onclick = () => { showPath = !showPath; $('path-btn').setAttribute('aria-pressed', String(showPath)); $('mobile-path-btn').setAttribute('aria-pressed', String(showPath)); $('mobile-path-btn').querySelector('span').textContent = showPath ? '开' : '关'; needsRender = true; };
  $('result-edit').onclick = returnToEdit;
  $('result-next').onclick = () => { if (mode === 'won') loadLevel((levelIndex + 1) % LEVELS.length); else start(); };
  $('property-slider').addEventListener('pointerdown', () => { if (editing() && !activeTool) rangeBefore = snapshot(); });
  $('property-slider').addEventListener('input', e => {
    const p = selected(); if (!editing() || !p) return;
    if (!activeTool && !rangeBefore) rangeBefore = snapshot();
    if (p.type === 'plank') p.length = Number(e.target.value); else p.power = Number(e.target.value);
    clampPart(p); updateInspector();
  });
  function commitRange() {
    if (!rangeBefore) return;
    if (JSON.stringify(rangeBefore.items) !== JSON.stringify(items)) usedExample = false;
    pushHistory(rangeBefore); rangeBefore = null; save(); updateUI();
  }
  $('property-slider').addEventListener('change', commitRange);
  $('property-slider').addEventListener('pointerup', commitRange);
  $('property-slider').addEventListener('pointercancel', commitRange);
  const dialog = $('help-dialog');
  $('help-btn').onclick = () => { if (mode === 'running') togglePause(); dialog.showModal(); };
  $('close-help').onclick = $('help-start').onclick = () => dialog.close();
  dialog.addEventListener('click', e => { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); });
  window.addEventListener('keydown', e => {
    if (dialog.open) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(e.shiftKey); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); undo(true); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); if (e.repeat) return; if (mode === 'running' || mode === 'paused') togglePause(); else start(); }
    else if (k === 'r') { e.preventDefault(); returnToEdit(); }
    else if (k === 'q') { e.preventDefault(); rotateSelected(e.shiftKey ? -5 : -15); }
    else if (k === 'e') { e.preventDefault(); rotateSelected(e.shiftKey ? 5 : 15); }
    else if (k === 'delete' || k === 'backspace') { if (selected()) { e.preventDefault(); deleteSelected(); } }
    else if (['1', '2', '3'].includes(k)) chooseTool(['plank', 'spring', 'fan'][Number(k) - 1]);
    else if (k === 'escape') { closeMenu(); setFocus(false); activeTool = ghost = null; selectedId = null; updateUI(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelInteractions(); if (mode === 'running') togglePause(); save(); } lastFrame = 0; needsRender = true; });

  // Tiny, optional synthesized sound effects. No external audio assets.
  function resumeAudio() {
    if (muted) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) throw new Error('Audio unavailable');
      audio ||= new Audio(); if (audio.state === 'suspended') audio.resume().catch(() => {});
    } catch (_) { muted = true; toast('当前浏览器未允许音效，游戏仍可正常运行。'); updateSoundButton(); }
  }
  function updateSoundButton() {
    $('sound-btn').innerHTML = icon(muted ? 'mute' : 'sound');
    $('sound-btn').setAttribute('aria-pressed', String(!muted));
    $('sound-btn').setAttribute('aria-label', muted ? '开启音效' : '关闭音效');
    $('sound-btn').title = muted ? '开启音效' : '关闭音效';
  }
  function tone(freq, duration = .07, volume = .03, delay = 0) {
    if (muted || !audio || audio.state !== 'running') return;
    const t = audio.currentTime + delay, oscillator = audio.createOscillator(), gain = audio.createGain();
    oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(.001, t); gain.gain.linearRampToValueAtTime(volume, t + .006); gain.gain.exponentialRampToValueAtTime(.001, t + duration);
    oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(t); oscillator.stop(t + duration + .015);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  $('sound-btn').onclick = () => { muted = !muted; if (!muted) { resumeAudio(); tone(440, .1); } updateSoundButton(); };

  // Canvas illustration. Geometry below is also the exact editable collision layout.
  function rr(x, y, w, h, r = 4) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
  function label(text, x, y, fill = '#6b7e56', bg = '#edf2e3') {
    ctx.save(); ctx.font = '600 11px "PingFang SC","Microsoft YaHei",sans-serif';
    const w = ctx.measureText(text).width + 24;
    rr(x - w / 2, y - 12, w, 25, 6); ctx.fillStyle = bg; ctx.fill(); ctx.strokeStyle = '#d8e2ca'; ctx.lineWidth = 1; ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = fill; ctx.fillText(text, x, y + 1); ctx.restore();
  }
  function arrow(x1, y1, x2, y2, size = 6) {
    const a = Math.atan2(y2 - y1, x2 - x1); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.moveTo(x2 - Math.cos(a - .55) * size, y2 - Math.sin(a - .55) * size); ctx.lineTo(x2, y2);
    ctx.lineTo(x2 - Math.cos(a + .55) * size, y2 - Math.sin(a + .55) * size); ctx.stroke();
  }
  function drawBackground() {
    ctx.fillStyle = '#f6f8ee'; ctx.fillRect(0, 0, P.W, P.H);
    if (showGrid) {
      ctx.fillStyle = '#dce4d1';
      for (let x = 12; x < P.W; x += 24) for (let y = 12; y < P.H; y += 24) { ctx.beginPath(); ctx.arc(x, y, .9, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.strokeStyle = '#c9d5bb'; ctx.lineWidth = 1;
    [[25, 53], [975, 53], [25, 598], [975, 598]].forEach(([x, y]) => { ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y); ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5); ctx.stroke(); });
    ctx.save();
    const x = 254, y = 574, w = 492;
    rr(x, y, w, 35, 7); ctx.fillStyle = '#f3ecd9'; ctx.fill(); ctx.clip();
    ctx.strokeStyle = '#e8dbbc'; ctx.lineWidth = 7;
    for (let i = x - 40; i < x + w + 50; i += 23) { ctx.beginPath(); ctx.moveTo(i, y + 35); ctx.lineTo(i + 35, y); ctx.stroke(); }
    ctx.restore();
    ctx.save(); ctx.fillStyle = '#f8f5e9'; rr(413, 580, 174, 23, 5); ctx.fill();
    ctx.textAlign = 'center'; ctx.fillStyle = '#b49e76'; ctx.font = '10px "PingFang SC","Microsoft YaHei",sans-serif'; ctx.fillText('↓   下面什么也接不住', 500, 595); ctx.restore();
    for (const t of level().terrain) {
      ctx.save(); ctx.translate(t.x, t.y); ctx.rotate(t.a || 0);
      rr(-t.w / 2 + 2, -t.h / 2 + 5, t.w, t.h, 5); ctx.fillStyle = '#d8e0cb'; ctx.fill();
      rr(-t.w / 2, -t.h / 2, t.w, t.h, 5); ctx.fillStyle = '#dfe6d1'; ctx.fill(); ctx.strokeStyle = '#b1c19e'; ctx.lineWidth = 1.3; ctx.stroke();
      ctx.save(); ctx.clip(); ctx.strokeStyle = '#cfdabd'; ctx.lineWidth = 1;
      for (let i = -t.w / 2 - t.h; i < t.w / 2 + t.h; i += 18) { ctx.beginPath(); ctx.moveTo(i, t.h / 2); ctx.lineTo(i + t.h, -t.h / 2); ctx.stroke(); }
      ctx.fillStyle = '#c3d3b0'; ctx.fillRect(-t.w / 2, -t.h / 2, t.w, 8); ctx.restore();
      ctx.fillStyle = '#879b72'; ctx.textAlign = 'center'; ctx.font = '9px "PingFang SC","Microsoft YaHei",sans-serif'; ctx.fillText(t.w < 100 ? '固定障碍' : '固定地形', 0, Math.min(15, t.h / 2 - 12));
      ctx.restore();
    }
    if (editing() && items.length <= 1 && !activeTool) {
      ctx.save(); ctx.translate(levelIndex === 2 ? 481 : 520, 350); ctx.rotate(levelIndex === 2 ? -.18 : .18);
      ctx.strokeStyle = '#c3d0b5'; ctx.lineWidth = 1.3; ctx.setLineDash([5, 6]); rr(-100, -9, 200, 18, 5); ctx.stroke();
      ctx.restore(); ctx.save(); ctx.font = '11px "PingFang SC","Microsoft YaHei",sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#a4b095';
      ctx.fillText('再加点东西？', levelIndex === 2 ? 481 : 520, 399); ctx.restore();
    }
  }
  function drawGoal() {
    const g = level().goal;
    ctx.save();
    rr(g.x - 58, g.y - 76, 116, 80, 7); ctx.fillStyle = '#e4edceaa'; ctx.fill();
    ctx.setLineDash([4, 5]); ctx.strokeStyle = '#a9bf87'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(g.x - 55, g.y - 73); ctx.lineTo(g.x + 55, g.y - 73); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(g.x, g.y - 38, 19, 0, Math.PI * 2); ctx.fillStyle = '#d2e2b5'; ctx.fill();
    ctx.strokeStyle = '#8ca961'; ctx.lineWidth = 2.3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(g.x - 8, g.y - 38); ctx.lineTo(g.x - 2, g.y - 32); ctx.lineTo(g.x + 9, g.y - 44); ctx.stroke();
    for (const r of P.goalRects(g)) { rr(r.x - r.w / 2, r.y - r.h / 2, r.w, r.h, 4); ctx.fillStyle = '#a6bf82'; ctx.fill(); ctx.strokeStyle = '#78945b'; ctx.lineWidth = 1.4; ctx.stroke(); }
    label('终 点', g.x, g.y - 109, '#668048', '#e8f0d7');
    ctx.strokeStyle = '#899f6d'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(g.x + 85, g.y + 7); ctx.lineTo(g.x + 85, g.y - 100); ctx.stroke();
    rr(g.x + 85, g.y - 98, 31, 24, 2); ctx.fillStyle = '#e0eabc'; ctx.fill();
    ctx.save(); ctx.clip(); ctx.fillStyle = '#9db77c';
    for (let x = 0; x < 4; x++) for (let y = 0; y < 3; y++) if ((x + y) % 2 === 0) ctx.fillRect(g.x + 85 + x * 8, g.y - 98 + y * 8, 8, 8);
    ctx.restore();
    if (sim && sim.goalHold > 0) { ctx.beginPath(); ctx.arc(g.x, g.y - 38, 23, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, sim.goalHold / .5)); ctx.strokeStyle = '#769b49'; ctx.lineWidth = 3; ctx.stroke(); }
    ctx.restore();
  }
  function drawStart() {
    const s = level().start;
    ctx.save(); ctx.setLineDash([3, 5]); ctx.lineWidth = 1.1; ctx.strokeStyle = '#d2c4a7';
    ctx.beginPath(); ctx.arc(s.x, s.y, 29, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]); ctx.strokeStyle = '#cdbb97'; ctx.lineWidth = 1; arrow(s.x, s.y - 42, s.x, s.y - 32, 4);
    label('起 点', s.x, s.y - 61, '#a28355', '#f5ecd9');
    if (editing()) { ctx.font = '9px "PingFang SC","Microsoft YaHei",sans-serif'; ctx.fillStyle = '#b2a588'; ctx.textAlign = 'center'; ctx.fillText('准备好就出发', s.x, s.y + 48); }
    else { ctx.beginPath(); ctx.arc(s.x, s.y, 12, 0, Math.PI * 2); ctx.strokeStyle = '#dddbc8'; ctx.setLineDash([2, 4]); ctx.stroke(); }
    ctx.restore();
  }
  function drawWind(p, time, selectedNow) {
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
    const g = ctx.createLinearGradient(26, 0, 470, 0); g.addColorStop(0, '#b7cb922d'); g.addColorStop(1, '#b7cb9200');
    ctx.fillStyle = g; ctx.fillRect(26, -75, 444, 150);
    if (selectedNow) { ctx.strokeStyle = '#a5bd8590'; ctx.lineWidth = 1; ctx.setLineDash([5, 8]); ctx.strokeRect(26, -75, 444, 150); ctx.setLineDash([]); }
    ctx.lineWidth = 1.3; ctx.strokeStyle = '#a7be8170'; ctx.lineCap = 'round';
    for (let i = 0; i < 13; i++) {
      const x = 37 + ((time * 105 + i * 93.7) % 400), y = (i % 5 - 2) * 27;
      arrow(x, y, x + 20, y, 4);
    }
    ctx.restore();
  }
  function drawPart(p, opacity = 1) {
    ctx.save(); ctx.globalAlpha *= opacity; ctx.translate(p.x, p.y); ctx.rotate(p.angle);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = 1.4;
    if (p.type === 'plank') {
      const w = p.length;
      rr(-w / 2, -6, w, 19, 4); ctx.fillStyle = '#b88c56'; ctx.fill();
      rr(-w / 2, -9, w, 18, 4); ctx.fillStyle = '#e3be85'; ctx.fill(); ctx.strokeStyle = '#b08a56'; ctx.stroke();
      ctx.strokeStyle = '#c69d64'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-w / 2 + 30, -3); ctx.lineTo(-w / 2 + w * .47, -3);
      ctx.moveTo(-w * .17, 3); ctx.lineTo(w * .3, 3); ctx.moveTo(w * .31, -2); ctx.lineTo(w / 2 - 29, -2); ctx.stroke();
      [-w / 2 + 13, w / 2 - 13].forEach(x => { ctx.beginPath(); ctx.arc(x, 0, 2.5, 0, Math.PI * 2); ctx.fillStyle = '#947145'; ctx.fill(); ctx.strokeStyle = '#eacf9e'; ctx.lineWidth = .9; ctx.beginPath(); ctx.moveTo(x - 1, -1); ctx.lineTo(x + 1, 1); ctx.stroke(); });
    } else if (p.type === 'spring') {
      let compression = 0;
      if (sim && sim.cooldowns[p.id] != null) compression = Math.max(0, 1 - (sim.time - sim.cooldowns[p.id]) / .2) * 5;
      rr(-37, 9, 74, 8, 3); ctx.fillStyle = '#ba9b80'; ctx.fill(); ctx.strokeStyle = '#9b8068'; ctx.stroke();
      ctx.strokeStyle = '#c57a51'; ctx.lineWidth = 2.8;
      ctx.beginPath(); ctx.moveTo(-27, -5 + compression); ctx.lineTo(27, -1 + compression); ctx.lineTo(-27, 3 + compression / 2); ctx.lineTo(27, 7); ctx.lineTo(-27, 11); ctx.stroke();
      rr(-44, -13 + compression, 88, 8, 3); ctx.fillStyle = '#eea078'; ctx.fill(); ctx.strokeStyle = '#b97751'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#b97751'; [-34, 34].forEach(x => { ctx.beginPath(); ctx.arc(x, -9 + compression, 1.7, 0, Math.PI * 2); ctx.fill(); });
      ctx.strokeStyle = '#cb9979'; ctx.lineWidth = 1.7; arrow(0, -24, 0, -47, 7);
    } else {
      rr(-25, -32, 52, 70, 11); ctx.fillStyle = '#78936b'; ctx.fill();
      rr(-26, -35, 52, 70, 11); ctx.fillStyle = '#c3d4b8'; ctx.fill(); ctx.strokeStyle = '#819a70'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 21, 0, Math.PI * 2); ctx.fillStyle = '#eff3e5'; ctx.fill(); ctx.strokeStyle = '#92a780'; ctx.stroke();
      ctx.save(); ctx.rotate((sim ? sim.time : 0) * 14 + .5);
      ctx.fillStyle = '#91ad7e';
      for (let i = 0; i < 3; i++) { ctx.rotate(Math.PI * 2 / 3); ctx.beginPath(); ctx.moveTo(-2, -2); ctx.bezierCurveTo(-24, -16, 1, -27, 4, -13); ctx.quadraticCurveTo(6, -6, 2, 1); ctx.fill(); }
      ctx.restore(); ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, Math.PI * 2); ctx.fillStyle = '#698558'; ctx.fill();
      ctx.strokeStyle = '#8b9e76'; ctx.lineWidth = 1.2;
      [-29, 29].forEach(y => { ctx.beginPath(); ctx.moveTo(-9, y); ctx.lineTo(9, y); ctx.stroke(); });
      ctx.strokeStyle = '#8fab6c'; ctx.lineWidth = 1.6; arrow(36, 0, 62, 0, 7);
    }
    ctx.restore();
  }
  function drawSelection(p, isGhost = false) {
    const [w, h] = P.dimensions(p), px = 1 / view.scale;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
    ctx.strokeStyle = isGhost ? '#9caa88' : '#759357'; ctx.lineWidth = 1.3 * px; ctx.setLineDash([3 * px, 3 * px]);
    rr(-w / 2 - 4 * px, -h / 2 - 4 * px, w + 8 * px, h + 8 * px, 5 * px); ctx.stroke(); ctx.setLineDash([]);
    if (!isGhost) {
      const kx = w / 2 + 28 * px;
      ctx.beginPath(); ctx.moveTo(w / 2 + 4 * px, 0); ctx.lineTo(kx - 12 * px, 0); ctx.stroke();
      ctx.beginPath(); ctx.arc(kx, 0, 12 * px, 0, Math.PI * 2); ctx.fillStyle = '#fcfff6'; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(kx, 0, 5 * px, -.5, 4.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(kx - 4 * px, -5 * px); ctx.lineTo(kx + px, -5 * px); ctx.lineTo(kx, 0); ctx.stroke();
    }
    ctx.restore();
  }
  function drawBall(b) {
    ctx.save(); ctx.translate(b.x, b.y);
    ctx.beginPath(); ctx.ellipse(3, 6, b.r, b.r * .95, 0, 0, Math.PI * 2); ctx.fillStyle = '#c17c5020'; ctx.fill();
    ctx.rotate(b.rotation || 0); ctx.beginPath(); ctx.arc(0, 0, b.r, 0, Math.PI * 2); ctx.fillStyle = '#ed9670'; ctx.fill(); ctx.strokeStyle = '#bd714d'; ctx.lineWidth = 1.7; ctx.stroke();
    ctx.beginPath(); ctx.arc(-5, -7, 5, 0, Math.PI * 2); ctx.fillStyle = '#ffd5ac80'; ctx.fill();
    ctx.fillStyle = '#80533e'; [-5, 5].forEach(x => { ctx.beginPath(); ctx.arc(x, -1, 1.45, 0, Math.PI * 2); ctx.fill(); });
    ctx.strokeStyle = '#9e6548'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(0, 2, 4, .15, Math.PI - .15); ctx.stroke(); ctx.restore();
  }
  function drawPath(path, previous = false) {
    if (!path || path.length < 2) return;
    ctx.save(); ctx.strokeStyle = previous ? '#bac6af90' : '#c7967390'; ctx.lineWidth = previous ? 1.6 : 1.8; ctx.setLineDash(previous ? [2, 7] : [2, 5]); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i += 2) ctx.lineTo(path[i].x, path[i].y);
    ctx.stroke(); ctx.restore();
  }
  function emitImpact(event) {
    if (reducedMotion) return;
    for (let i = 0; i < 5; i++) effects.push({ x: event.x, y: event.y, vx: (Math.random() - .5) * 70, vy: -30 - Math.random() * 55, age: 0, life: .28 + Math.random() * .15, color: event.type === 'spring' ? '#d48b64' : '#bea782', size: 2, kind: 'dust' });
  }
  function celebrate() {
    if (reducedMotion) return;
    const g = level().goal, colors = ['#e7a46f', '#a8c375', '#7f9e66', '#d5c57a', '#b5cbaa'];
    for (let i = 0; i < 60; i++) effects.push({ x: g.x, y: g.y - 45, vx: (Math.random() - .5) * 420, vy: -130 - Math.random() * 350, age: 0, life: 1.5 + Math.random() * 1.4, color: colors[i % colors.length], size: 3 + Math.random() * 3, rotation: Math.random() * 6, kind: 'confetti' });
  }
  function updateEffects(dt) {
    effects = effects.filter(p => p.age < p.life);
    for (const p of effects) { p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.kind === 'confetti' ? 380 : 140) * dt; }
  }
  function drawEffects() {
    for (const p of effects) { ctx.save(); ctx.globalAlpha = Math.min(1, (p.life - p.age) * 4); ctx.translate(p.x, p.y); ctx.rotate((p.rotation || 0) + p.age * 3); ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.kind === 'confetti' ? p.size * .55 : p.size); ctx.restore(); }
  }
  function render() {
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0); ctx.clearRect(0, 0, view.w, view.h);
    ctx.fillStyle = '#f6f8ee'; ctx.fillRect(0, 0, view.w, view.h);
    ctx.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale, view.dpr * view.ox, view.dpr * view.oy);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, P.W, P.H); ctx.clip();
    drawBackground();
    for (const p of items) if (p.type === 'fan') drawWind(p, sim ? sim.time : 0, p.id === selectedId && editing());
    if (activeTool === 'fan' && ghost) drawWind(ghost, 0, true);
    if (showPath) { drawPath(previousPath, true); if (sim) drawPath(sim.path); }
    drawGoal(); drawStart();
    for (const p of items) drawPart(p);
    if (editing() && !activeTool && selected()) drawSelection(selected());
    if (editing() && ghost) { drawPart(ghost, .55); drawSelection(ghost, true); }
    drawBall(sim ? sim.ball : { ...level().start, r: P.R, rotation: 0 });
    drawEffects();
    if (mode === 'paused') {
      ctx.save(); ctx.fillStyle = '#f6f8ee77'; ctx.fillRect(0, 0, P.W, P.H); label(compact() ? '已暂停 · 点下方继续' : '已暂停 · 空格继续', P.W / 2, 72, '#688070', '#f9fcf1'); ctx.restore();
    }
    ctx.restore();
    drawMagnifier();
  }
  function drawMagnifier() {
    const show = editing() && ((drag && drag.touch && ['move', 'place', 'rotate'].includes(drag.type)) || (cardDrag && cardDrag.touch && cardDrag.moved && pointer.inside));
    if (!show || view.w < 180 || view.h < 160) return;
    const sx = pointer.x * view.scale + view.ox, sy = pointer.y * view.scale + view.oy;
    const radius = 43, sample = 24;
    let dx = P.clamp(sx, radius + 8, view.w - radius - 8);
    const dy = P.clamp(sy > 135 ? sy - 98 : sy + 98, radius + 8, view.h - radius - 8);
    if (dy - radius < 62 && dx + radius > view.w - 152) dx = Math.max(radius + 8, view.w - 160 - radius);
    // Do not cover the finger target if the viewport is too short for a lens.
    if (Math.hypot(dx - sx, dy - sy) < radius + sample + 5) return;
    const x0 = P.clamp(sx - sample, 0, Math.max(0, view.w - sample * 2));
    const y0 = P.clamp(sy - sample, 0, Math.max(0, view.h - sample * 2));
    ctx.save(); ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.beginPath(); ctx.arc(dx, dy, radius, 0, Math.PI * 2); ctx.save(); ctx.clip();
    ctx.fillStyle = '#fffef9'; ctx.fillRect(dx - radius, dy - radius, radius * 2, radius * 2);
    ctx.drawImage(canvas, x0 * view.dpr, y0 * view.dpr, sample * 2 * view.dpr, sample * 2 * view.dpr, dx - radius, dy - radius, radius * 2, radius * 2);
    ctx.restore(); ctx.lineWidth = 3; ctx.strokeStyle = '#fffef9'; ctx.stroke();
    ctx.beginPath(); ctx.arc(dx, dy, radius + 1.5, 0, Math.PI * 2); ctx.strokeStyle = '#698754'; ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = '#315d4980'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(dx - 5, dy); ctx.lineTo(dx + 5, dy); ctx.moveTo(dx, dy - 5); ctx.lineTo(dx, dy + 5); ctx.stroke();
    ctx.restore();
  }
  function resize() {
    const r = wrap.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const changed = Math.abs(view.w - r.width) > .5 || Math.abs(view.h - r.height) > .5;
    if (changed && (drag || pointers.size || cardDrag)) { cancelInteractions(); if (initialized) updateUI(); }
    view.w = r.width; view.h = r.height; view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.round(r.width * view.dpr), ch = Math.round(r.height * view.dpr);
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    syncCamera(); render(); needsRender = false;
  }
  function physicsTick() {
    if (!sim || mode !== 'running') return;
    P.step(sim);
    for (const e of sim.events) {
      if (e.type === 'impact' || e.type === 'spring') {
        emitImpact(e);
        if (sim.time - lastSoundTime > .09) { tone(e.type === 'spring' ? 490 : Math.min(470, 160 + e.speed * .25), e.type === 'spring' ? .13 : .045, .02); lastSoundTime = sim.time; }
      }
    }
    if (sim.state !== 'running') finish();
  }
  function frame(timestamp) {
    const dt = lastFrame ? Math.min((timestamp - lastFrame) / 1000, .06) : 0; lastFrame = timestamp;
    if (mode === 'running') {
      accumulator += dt * playbackSpeed;
      let n = 0;
      while (accumulator >= P.DT && mode === 'running' && n++ < 20) { accumulator -= P.DT; physicsTick(); }
      if (n >= 20) accumulator = 0;
      if (sim && timestamp - clockPaint > 90) { updateClock(); clockPaint = timestamp; }
    }
    const hadEffects = effects.length > 0; updateEffects(dt);
    if (needsRender || mode === 'running' || hadEffects) { render(); needsRender = false; }
    requestAnimationFrame(frame);
  }
  syncLayout(); loadLevel(levelIndex); resize(); new ResizeObserver(resize).observe(wrap); requestAnimationFrame(frame);
  // Optional, local-only test hooks. No hooks are exposed during ordinary play.
  if (location.hash === '#test' || window.__LAB_ENABLE_TEST__ === true) window.__LAB_TEST__ = {
    state: () => ({ mode, levelIndex, items: P.clone(items), selectedId, activeTool, past: past.length, future: future.length,
      sim: sim ? { state: sim.state, time: sim.time, ball: { ...sim.ball }, pathLength: sim.path.length } : null, previousPathLength: previousPath.length, storageOK, usedExample, view: { ...view }, camera: { ...camera }, compact: compact(), activePointers: pointers.size, dragType: drag?.type || null, focus: document.body.classList.contains('focus-mode') }),
    loadLevel, loadExample, start, returnToEdit, undo, chooseTool, rotateSelected, resetCamera, zoomBy,
    advance: seconds => { const count = Math.ceil(seconds / P.DT); for (let i = 0; i < count && mode === 'running'; i++) physicsTick(); render(); return mode; }
  };
})();
