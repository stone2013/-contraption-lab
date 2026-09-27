/*
 * 造啥都行 / Contraption Lab — compact circle-versus-OBB physics.
 * This demo simulates one moving ball and fixed construction parts.
 * Units: logical canvas pixels and seconds; gravity is game-tuned.
 * Active springs and fans inject energy intentionally.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LabPhysics = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const W = 1000, H = 620, DT = 1 / 240, G = 960, R = 17;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const clone = x => JSON.parse(JSON.stringify(x));
  const DEG = Math.PI / 180;
  function part(type, x, y, angle = 0, extra = {}) {
    return Object.assign({ id: 'part-' + Math.random().toString(36).slice(2, 10), type, x, y, angle,
      length: type === 'plank' ? 240 : type === 'spring' ? 88 : 52,
      power: type === 'spring' ? 850 : 1600 }, extra);
  }
  function dimensions(p) {
    return p.type === 'plank' ? [p.length, 18] : p.type === 'spring' ? [88, 26] : [52, 70];
  }
  function rect(x, y, w, h, a = 0, extra = {}) { return Object.assign({ x, y, w, h, a }, extra); }
  function partRect(p) {
    const [w, h] = dimensions(p);
    return rect(p.x, p.y, w, h, p.angle, { type: p.type, part: p, bounce: .10 });
  }
  function goalRects(g) {
    // Open-topped receptacle. y is the inside-facing top of its floor.
    return [rect(g.x, g.y + 8, 128, 16, 0, { type: 'goal', bounce: .10 }),
      rect(g.x - 64, g.y - 34, 12, 84, 0, { type: 'goal', bounce: .26 }),
      rect(g.x + 64, g.y - 34, 12, 84, 0, { type: 'goal', bounce: .26 })];
  }
  function localPoint(x, y, p) {
    const c = Math.cos(p.a ?? p.angle ?? 0), s = Math.sin(p.a ?? p.angle ?? 0);
    return { x: (x - p.x) * c + (y - p.y) * s, y: -(x - p.x) * s + (y - p.y) * c };
  }
  function hitPart(x, y, p, margin = 9) {
    const q = localPoint(x, y, p), [w, h] = dimensions(p);
    return Math.abs(q.x) <= w / 2 + margin && Math.abs(q.y) <= h / 2 + margin;
  }
  function contact(ball, box) {
    const c = Math.cos(box.a), s = Math.sin(box.a), q = localPoint(ball.x, ball.y, box);
    const px = clamp(q.x, -box.w / 2, box.w / 2), py = clamp(q.y, -box.h / 2, box.h / 2);
    let nx = q.x - px, ny = q.y - py, d2 = nx * nx + ny * ny, penetration;
    if (d2 >= ball.r * ball.r) return null;
    if (d2 > 1e-12) {
      const d = Math.sqrt(d2); nx /= d; ny /= d; penetration = ball.r - d;
    } else {
      const dx = box.w / 2 - Math.abs(q.x), dy = box.h / 2 - Math.abs(q.y);
      if (dx < dy) { nx = q.x >= 0 ? 1 : -1; ny = 0; penetration = ball.r + dx; }
      else { nx = 0; ny = q.y >= 0 ? 1 : -1; penetration = ball.r + dy; }
    }
    return { nx: nx * c - ny * s, ny: nx * s + ny * c, penetration };
  }
  function create(level, items) {
    return { level: clone(level), items: clone(items), ball: { x: level.start.x, y: level.start.y,
      vx: level.start.vx || 0, vy: 0, r: R, rotation: 0, omega: 0 },
      colliders: [...level.terrain.map(t => rect(t.x, t.y, t.w, t.h, t.a || 0, { type: 'terrain', bounce: .16 })),
        ...goalRects(level.goal), ...items.map(partRect)],
      time: 0, steps: 0, state: 'running', goalHold: 0, idle: 0, reason: '', events: [],
      cooldowns: Object.create(null), path: [], impacts: 0, maxSpeed: 0 };
  }
  function step(sim, dt = DT) {
    if (sim.state !== 'running') return sim;
    const b = sim.ball; sim.time += dt; sim.steps++; sim.events = [];
    b.vy += G * dt;
    for (const p of sim.items) {
      if (p.type !== 'fan') continue;
      const q = localPoint(b.x, b.y, p), range = 470, half = 75;
      if (q.x > 18 && q.x < range && Math.abs(q.y) < half) {
        const falloff = (1 - .30 * q.x / range) * (1 - .4 * (q.y / half) ** 2);
        b.vx += Math.cos(p.angle) * p.power * falloff * dt;
        b.vy += Math.sin(p.angle) * p.power * falloff * dt;
      }
    }
    const drag = Math.exp(-.018 * dt); b.vx *= drag; b.vy *= drag;
    const speed = Math.hypot(b.vx, b.vy);
    if (speed > 1900) { b.vx *= 1900 / speed; b.vy *= 1900 / speed; }
    b.x += b.vx * dt; b.y += b.vy * dt; b.rotation += b.omega * dt;
    for (let iter = 0; iter < 3; iter++) {
      for (const box of sim.colliders) {
        const col = contact(b, box); if (!col) continue;
        const { nx, ny, penetration } = col;
        b.x += nx * (penetration + .001); b.y += ny * (penetration + .001);
        const vn = b.vx * nx + b.vy * ny;
        let sprung = false;
        if (box.type === 'spring') {
          const p = box.part, sx = Math.sin(p.angle), sy = -Math.cos(p.angle);
          if (nx * sx + ny * sy > .65 && vn < -12 && sim.time - (sim.cooldowns[p.id] ?? -10) > .16) {
            const tangent = b.vx * Math.cos(p.angle) + b.vy * Math.sin(p.angle);
            b.vx = tangent * .5 * Math.cos(p.angle) + sx * p.power;
            b.vy = tangent * .5 * Math.sin(p.angle) + sy * p.power;
            sim.cooldowns[p.id] = sim.time;
            sim.events.push({ type: 'spring', x: b.x, y: b.y, power: p.power, id: p.id });
            sprung = true;
          }
        }
        if (!sprung && vn < 0) {
          const e = Math.abs(vn) < 42 ? 0 : box.bounce;
          b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny;
          const tx = -ny, ty = nx;
          const tangent = b.vx * tx + b.vy * ty;
          const resistance = Math.min(Math.abs(tangent), 17 * dt);
          b.vx -= Math.sign(tangent) * resistance * tx;
          b.vy -= Math.sign(tangent) * resistance * ty;
          b.omega = tangent / b.r;
          if (iter === 0 && -vn > 90) {
            sim.impacts++;
            sim.events.push({ type: 'impact', x: b.x - nx * b.r, y: b.y - ny * b.r, speed: -vn });
          }
        }
      }
    }
    sim.maxSpeed = Math.max(sim.maxSpeed, Math.hypot(b.vx, b.vy));
    if (sim.steps % 4 === 0) { sim.path.push({ x: b.x, y: b.y }); if (sim.path.length > 1500) sim.path.shift(); }
    const g = sim.level.goal;
    const inGoal = b.x > g.x - 45 && b.x < g.x + 45 && b.y > g.y - 66 && b.y < g.y - 10;
    sim.goalHold = inGoal && Math.hypot(b.vx, b.vy) < 150 ? sim.goalHold + dt : 0;
    if (sim.goalHold >= .5) { sim.state = 'won'; sim.events.push({ type: 'win', x: b.x, y: b.y }); }
    else if (b.y > H + 65 || b.x < -80 || b.x > W + 80) {
      sim.state = 'lost'; sim.reason = '小球溜走了。给它一条新的路线？';
    } else if (sim.time > 28) { sim.state = 'lost'; sim.reason = '这次没能抵达。换个角度，再试一次。'; }
    else {
      sim.idle = Math.hypot(b.vx, b.vy) < 5 ? sim.idle + dt : 0;
      if (sim.idle > 3.5) { sim.state = 'lost'; sim.reason = '小球停住了。加一点坡度，或者借一阵风。'; }
    }
    return sim;
  }
  function run(level, items, seconds = 30) {
    const sim = create(level, items);
    while (sim.state === 'running' && sim.time < seconds) step(sim);
    return sim;
  }
  return { W, H, DT, G, R, DEG, clamp, clone, part, dimensions, rect, partRect, goalRects,
    localPoint, hitPart, contact, create, step, run };
});
