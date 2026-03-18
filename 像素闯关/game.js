const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d", { alpha: false });

const hudLeft = document.getElementById("hudLeft");
const hudRight = document.getElementById("hudRight");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlayTitle");
const overlayBody = document.getElementById("overlayBody");
const btnStart = document.getElementById("btnStart");
const btnContinue = document.getElementById("btnContinue");
const btnRestart = document.getElementById("btnRestart");

/** @typedef {{x:number,y:number,w:number,h:number}} Rect */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

function rectIntersects(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function rectSweepResolve(mover, vx, vy, solids) {
  // 简单的 axis-by-axis sweep：先走 X 再走 Y
  mover.x += vx;
  for (const s of solids) {
    if (!rectIntersects(mover, s)) continue;
    if (vx > 0) mover.x = s.x - mover.w;
    else if (vx < 0) mover.x = s.x + s.w;
    vx = 0;
  }

  mover.y += vy;
  let grounded = false;
  for (const s of solids) {
    if (!rectIntersects(mover, s)) continue;
    if (vy > 0) {
      mover.y = s.y - mover.h;
      grounded = true;
    } else if (vy < 0) {
      mover.y = s.y + s.h;
    }
    vy = 0;
  }
  return { vx, vy, grounded };
}

function drawRoundRect(ctx2, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx2.beginPath();
  ctx2.moveTo(x + rr, y);
  ctx2.arcTo(x + w, y, x + w, y + h, rr);
  ctx2.arcTo(x + w, y + h, x, y + h, rr);
  ctx2.arcTo(x, y + h, x, y, rr);
  ctx2.arcTo(x, y, x + w, y, rr);
  ctx2.closePath();
}

function colorMix(a, b, t) {
  // a/b: [r,g,b]
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];
}

function rgb(c) {
  return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}

const KEY = {
  LEFT: "ArrowLeft",
  RIGHT: "ArrowRight",
  UP: "ArrowUp",
  SPACE: " ",
  Z: "z",
  R: "r",
  ESC: "Escape",
};

const input = {
  down: new Set(),
  pressed: new Set(),
  released: new Set(),
  focus: true,
};

function onKeyDown(e) {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (!input.down.has(k)) input.pressed.add(k);
  input.down.add(k);
  if (
    k === KEY.LEFT ||
    k === KEY.RIGHT ||
    k === KEY.UP ||
    k === KEY.SPACE ||
    k === KEY.Z
  ) {
    e.preventDefault();
  }
}
function onKeyUp(e) {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  input.down.delete(k);
  input.released.add(k);
}
window.addEventListener("keydown", onKeyDown, { passive: false });
window.addEventListener("keyup", onKeyUp);
window.addEventListener("blur", () => (input.focus = false));
window.addEventListener("focus", () => (input.focus = true));

function keyDown(k) {
  return input.down.has(k);
}
function keyPressed(k) {
  return input.pressed.has(k);
}

const WORLD = {
  gravity: 2100,
  tile: 48,
};

const COLORS = {
  skyTop: [18, 22, 55],
  skyBot: [7, 9, 20],
  ground: [76, 118, 88],
  dirt: [57, 80, 66],
  stone: [98, 109, 130],
  coin: [253, 224, 71],
  player: [125, 211, 252],
  enemy: [248, 113, 113],
  flag: [167, 139, 250],
};

function makeLevel1() {
  // 用 tile 单位写关卡，最后在构建时换算成像素
  // 约 140 格宽（~6720px），够镜头滚动
  const solids = [];
  const coins = [];
  const enemies = [];
  const hazards = [];

  const T = WORLD.tile;
  const W = 140;
  const groundY = 10; // tile 行

  // 地面：分段 + 坑
  const groundSegments = [
    [0, 18],
    [22, 48],
    [52, 80],
    [84, 112],
    [116, W],
  ];

  for (const [sx, ex] of groundSegments) {
    solids.push({
      x: sx * T,
      y: groundY * T,
      w: (ex - sx) * T,
      h: 3 * T,
    });
  }

  // 平台
  const platforms = [
    [10, 8, 3],
    [14, 7, 2],
    [28, 8, 5],
    [36, 7, 3],
    [44, 6, 3],
    [60, 8, 4],
    [68, 7, 3],
    [92, 8, 6],
    [100, 7, 3],
    [124, 8, 4],
  ];
  for (const [tx, ty, tw] of platforms) {
    solids.push({ x: tx * T, y: ty * T, w: tw * T, h: 0.55 * T });
  }

  // 危险：尖刺（用 hazard rect 表示）
  const spikes = [
    [19, groundY - 0.2, 3],
    [49, groundY - 0.2, 3],
    [81, groundY - 0.2, 3],
    [113, groundY - 0.2, 3],
  ];
  for (const [tx, ty, tw] of spikes) {
    hazards.push({ x: tx * T, y: ty * T, w: tw * T, h: 0.55 * T });
  }

  // 金币：引导路线
  const coinLines = [
    [6, 9, 3],
    [12, 6, 2],
    [26, 6, 6],
    [58, 6, 5],
    [66, 5, 3],
    [90, 6, 8],
    [122, 6, 5],
  ];
  for (const [tx, ty, count] of coinLines) {
    for (let i = 0; i < count; i++) {
      coins.push({
        x: (tx + i) * T + T * 0.22,
        y: ty * T + T * 0.18,
        w: T * 0.56,
        h: T * 0.56,
        taken: false,
      });
    }
  }

  // 敌人：左右巡逻
  const enemyDefs = [
    { x: 24 * T, y: (groundY - 1) * T, minX: 22 * T, maxX: 30 * T },
    { x: 55 * T, y: (groundY - 1) * T, minX: 52 * T, maxX: 62 * T },
    { x: 86 * T, y: (groundY - 1) * T, minX: 84 * T, maxX: 96 * T },
    { x: 118 * T, y: (groundY - 1) * T, minX: 116 * T, maxX: 130 * T },
  ];
  for (const d of enemyDefs) {
    enemies.push({
      x: d.x,
      y: d.y,
      w: T * 0.8,
      h: T * 0.8,
      vx: 110,
      vy: 0,
      dir: 1,
      minX: d.minX,
      maxX: d.maxX,
      alive: true,
      hurtT: 0,
    });
  }

  // 终点旗帜
  const flag = { x: (W - 6) * T, y: (groundY - 3.2) * T, w: T * 0.8, h: T * 3.2 };

  const playerSpawn = { x: 2.2 * T, y: (groundY - 2.5) * T };

  const bounds = { w: W * T, h: 14 * T };
  return { solids, coins, enemies, hazards, flag, playerSpawn, bounds, name: "1-1 起步平原" };
}

const game = {
  state: "play", // menu | play | pause | dead | win
  t: 0,
  dt: 0,
  levelIndex: 0,
  levels: [makeLevel1()],
  score: 0,
  coins: 0,
  lives: 3,
  invulnT: 0,
  camX: 0,
  camY: 0,
  shakeT: 0,
};

const player = {
  x: 0,
  y: 0,
  w: 32,
  h: 42,
  vx: 0,
  vy: 0,
  grounded: false,
  facing: 1,
  coyote: 0,
  jumpBuffer: 0,
  dashT: 0,
  dashCd: 0,
};

function resetLevel(keepStats = true) {
  const L = game.levels[game.levelIndex];
  player.x = L.playerSpawn.x;
  player.y = L.playerSpawn.y;
  player.vx = 0;
  player.vy = 0;
  player.grounded = false;
  player.coyote = 0;
  player.jumpBuffer = 0;
  player.dashT = 0;
  player.dashCd = 0;

  game.camX = 0;
  game.camY = 0;
  game.invulnT = 0;
  game.shakeT = 0;
  game.state = "play";

  if (!keepStats) {
    game.score = 0;
    game.coins = 0;
    game.lives = 3;
  }

  // 重置可拾取物与敌人
  for (const c of L.coins) c.taken = false;
  for (const e of L.enemies) {
    e.alive = true;
    e.hurtT = 0;
    e.vy = 0;
    e.vx = 110;
    e.dir = 1;
  }
}

resetLevel(false);

function showOverlay(title, body, showContinue) {
  overlayTitle.textContent = title;
  overlayBody.innerHTML = body;
  btnStart.style.display = "none";
  btnContinue.style.display = showContinue ? "inline-flex" : "none";
  btnRestart.style.display = "inline-flex";
  overlay.classList.remove("hidden");
}
function hideOverlay() {
  overlay.classList.add("hidden");
}

function showMenu() {
  game.state = "menu";
  overlayTitle.textContent = "开始游戏";
  overlayBody.innerHTML =
    "欢迎来到像素冒险闯关！<br/>" +
    "目标：收集金币、躲开陷阱、踩怪，到右侧旗帜通关。<br/><br/>" +
    "操作：<b>←/→</b> 移动，<b>↑/Space</b> 跳跃，<b>Z</b> 冲刺。";
  btnStart.style.display = "inline-flex";
  btnContinue.style.display = "none";
  btnRestart.style.display = "none";
  overlay.classList.remove("hidden");
}

function startGame() {
  hideOverlay();
  game.state = "play";
}

btnStart.addEventListener("click", () => {
  startGame();
});

btnContinue.addEventListener("click", () => {
  hideOverlay();
  // 死亡弹窗的“继续”应该重生，而不是原地恢复
  if (game.state === "dead") {
    if (game.lives > 0) resetLevel(true);
    else resetLevel(false);
  } else {
    game.state = "play";
  }
});
btnRestart.addEventListener("click", () => {
  hideOverlay();
  resetLevel(false);
});

// 页面加载后先进入初始界面
showMenu();

function pauseGame() {
  if (game.state !== "play") return;
  game.state = "pause";
  showOverlay(
    "暂停",
    "按 <b>Esc</b> 或点击“继续”返回游戏。<br/>提示：跳到敌人头上可以消灭它。",
    true
  );
}

function winGame() {
  game.state = "win";
  showOverlay(
    "通关！",
    `本关得分：<b>${game.score}</b><br/>金币：<b>${game.coins}</b><br/>按 <b>R</b> 或点击“重开”再来一次。`,
    false
  );
}

function die() {
  if (game.state !== "play") return;
  game.lives -= 1;
  game.shakeT = 0.35;
  if (game.lives <= 0) {
    game.state = "dead";
    showOverlay(
      "游戏结束",
      `你的最终得分：<b>${game.score}</b><br/>按 <b>R</b> 或点击“重开”重新挑战。`,
      false
    );
  } else {
    game.state = "dead";
    showOverlay(
      "失误！",
      `剩余生命：<b>${game.lives}</b><br/>按 <b>继续</b> 重生。`,
      true
    );
  }
}

function applyDamage() {
  if (game.invulnT > 0) return;
  game.invulnT = 1.0;
  game.shakeT = 0.22;
  // 击退
  player.vy = -520;
  player.vx = -player.facing * 220;
  die();
}

function update(dt) {
  game.dt = dt;
  game.t += dt;

  if (game.state === "menu") {
    if (keyPressed("Enter") || keyPressed(KEY.SPACE)) startGame();
    if (keyPressed(KEY.R)) {
      resetLevel(false);
      showMenu();
    }
    input.pressed.clear();
    input.released.clear();
    return;
  }

  if (keyPressed(KEY.ESC)) {
    if (game.state === "play") pauseGame();
    else if (game.state === "pause") {
      hideOverlay();
      game.state = "play";
    }
  }

  if (keyPressed(KEY.R)) {
    hideOverlay();
    resetLevel(false);
  }

  if (game.state !== "play") {
    input.pressed.clear();
    input.released.clear();
    return;
  }

  const L = game.levels[game.levelIndex];

  game.invulnT = Math.max(0, game.invulnT - dt);
  game.shakeT = Math.max(0, game.shakeT - dt);

  player.jumpBuffer = Math.max(0, player.jumpBuffer - dt);
  if (keyPressed(KEY.UP) || keyPressed(KEY.SPACE)) player.jumpBuffer = 0.12;

  const wish =
    (keyDown(KEY.RIGHT) ? 1 : 0) + (keyDown(KEY.LEFT) ? -1 : 0);
  if (wish !== 0) player.facing = wish;

  const accel = player.grounded ? 5200 : 3400;
  const maxSpeed = keyDown(KEY.Z) ? 330 : 260;
  const friction = player.grounded ? 3400 : 850;

  // dash：短促冲刺（空中也可），有冷却
  player.dashCd = Math.max(0, player.dashCd - dt);
  if (keyPressed(KEY.Z) && player.dashCd <= 0) {
    player.dashT = 0.14;
    player.dashCd = 0.45;
    game.shakeT = Math.max(game.shakeT, 0.08);
  }
  player.dashT = Math.max(0, player.dashT - dt);

  if (player.dashT > 0) {
    player.vx = player.facing * 520;
    player.vy *= 0.55;
  } else if (wish !== 0) {
    player.vx += wish * accel * dt;
    player.vx = clamp(player.vx, -maxSpeed, maxSpeed);
  } else {
    // friction to zero
    const s = Math.sign(player.vx);
    const v = Math.abs(player.vx);
    const nv = Math.max(0, v - friction * dt);
    player.vx = nv * s;
  }

  // coyote time
  if (player.grounded) player.coyote = 0.1;
  else player.coyote = Math.max(0, player.coyote - dt);

  // jump
  if (player.jumpBuffer > 0 && player.coyote > 0) {
    player.jumpBuffer = 0;
    player.coyote = 0;
    player.vy = -720;
    player.grounded = false;
  }

  // variable jump height
  const jumpHeld = keyDown(KEY.UP) || keyDown(KEY.SPACE);
  if (!jumpHeld && player.vy < 0) {
    player.vy += 1900 * dt;
  }

  // gravity
  player.vy += WORLD.gravity * dt;
  player.vy = Math.min(player.vy, 1400);

  // integrate + collide
  const mover = { x: player.x, y: player.y, w: player.w, h: player.h };
  const res = rectSweepResolve(mover, player.vx * dt, player.vy * dt, L.solids);
  player.x = mover.x;
  player.y = mover.y;
  player.vx = res.vx / dt;
  player.vy = res.vy / dt;
  player.grounded = res.grounded;

  // world bounds / fall
  if (player.y > L.bounds.h + 200) {
    applyDamage();
  }
  player.x = clamp(player.x, 0, L.bounds.w - player.w);

  // coins
  for (const c of L.coins) {
    if (c.taken) continue;
    if (rectIntersects(player, c)) {
      c.taken = true;
      game.coins += 1;
      game.score += 100;
    }
  }

  // hazards
  for (const h of L.hazards) {
    if (rectIntersects(player, h)) {
      applyDamage();
      break;
    }
  }

  // enemies
  for (const e of L.enemies) {
    if (!e.alive) continue;
    e.hurtT = Math.max(0, e.hurtT - dt);

    // patrol
    e.vy += WORLD.gravity * dt;
    e.vy = Math.min(e.vy, 1400);

    e.x += e.dir * e.vx * dt;
    if (e.x < e.minX) {
      e.x = e.minX;
      e.dir = 1;
    } else if (e.x + e.w > e.maxX) {
      e.x = e.maxX - e.w;
      e.dir = -1;
    }

    // collide with solids vertically (stay on platforms/ground)
    const em = { x: e.x, y: e.y, w: e.w, h: e.h };
    const er = rectSweepResolve(em, 0, e.vy * dt, L.solids);
    e.x = em.x;
    e.y = em.y;
    e.vy = er.vy / dt;

    if (rectIntersects(player, e)) {
      const playerBottom = player.y + player.h;
      const enemyTop = e.y;
      const stomp = player.vy > 0 && playerBottom - enemyTop < 18;
      if (stomp) {
        e.alive = false;
        game.score += 250;
        player.vy = -520;
        game.shakeT = Math.max(game.shakeT, 0.12);
      } else {
        applyDamage();
        break;
      }
    }
  }

  // flag win
  if (rectIntersects(player, L.flag)) {
    winGame();
  }

  // camera follow (smooth)
  const viewW = canvas.width;
  const viewH = canvas.height;
  const targetX = clamp(
    player.x + player.w / 2 - viewW / 2,
    0,
    L.bounds.w - viewW
  );
  const targetY = clamp(
    player.y + player.h / 2 - viewH * 0.6,
    0,
    L.bounds.h - viewH
  );
  game.camX = lerp(game.camX, targetX, 1 - Math.pow(0.0008, dt * 60));
  game.camY = lerp(game.camY, targetY, 1 - Math.pow(0.001, dt * 60));

  input.pressed.clear();
  input.released.clear();
}

function render() {
  const L = game.levels[game.levelIndex];
  const w = canvas.width;
  const h = canvas.height;

  // camera shake
  let sx = 0,
    sy = 0;
  if (game.shakeT > 0) {
    const p = game.shakeT / 0.35;
    const a = 6 * p;
    sx = (Math.random() * 2 - 1) * a;
    sy = (Math.random() * 2 - 1) * a;
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // sky gradient
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, rgb(COLORS.skyTop));
  g.addColorStop(1, rgb(COLORS.skyBot));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const camX = Math.floor(game.camX + sx);
  const camY = Math.floor(game.camY + sy);

  ctx.save();
  ctx.translate(-camX, -camY);

  // parallax hills
  drawHills(L.bounds.w, L.bounds.h, camX, camY);

  // solids
  for (const s of L.solids) {
    drawBlock(s.x, s.y, s.w, s.h);
  }

  // hazards (spikes)
  for (const hz of L.hazards) {
    drawSpikes(hz.x, hz.y, hz.w, hz.h);
  }

  // coins
  for (const c of L.coins) {
    if (c.taken) continue;
    drawCoin(c.x, c.y, c.w, c.h);
  }

  // enemies
  for (const e of L.enemies) {
    if (!e.alive) continue;
    drawEnemy(e);
  }

  // flag
  drawFlag(L.flag.x, L.flag.y, L.flag.w, L.flag.h);

  // player
  drawPlayer();

  ctx.restore();

  // vignette
  drawVignette(w, h);

  // HUD
  const inv = game.invulnT > 0 ? "受伤无敌" : "正常";
  hudLeft.innerHTML = `关卡：<b>${L.name}</b>　分数：<b>${game.score}</b>　金币：<b>${game.coins}</b>`;
  hudRight.innerHTML = `生命：<b>${game.lives}</b>　状态：<b>${inv}</b>`;
}

function drawHills(worldW, worldH, camX, camY) {
  const baseY = 9.2 * WORLD.tile;
  const layers = [
    { k: 0.18, c1: [19, 64, 81], c2: [8, 34, 48] },
    { k: 0.28, c1: [26, 88, 83], c2: [14, 54, 54] },
  ];
  for (let i = 0; i < layers.length; i++) {
    const Lr = layers[i];
    const px = camX * Lr.k;
    const grad = ctx.createLinearGradient(px, baseY - 260, px, baseY + 260);
    grad.addColorStop(0, rgb(Lr.c1));
    grad.addColorStop(1, rgb(Lr.c2));
    ctx.fillStyle = grad;
    ctx.beginPath();
    const amp = 52 + i * 18;
    const freq = 0.006 + i * 0.0012;
    const y0 = baseY + i * 46;
    ctx.moveTo(-200, worldH + 300);
    for (let x = -200; x <= worldW + 200; x += 40) {
      const y = y0 + Math.sin((x + px) * freq) * amp;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(worldW + 200, worldH + 300);
    ctx.closePath();
    ctx.fill();
  }
}

function drawBlock(x, y, w, h) {
  const top = COLORS.ground;
  const bot = COLORS.dirt;
  const grad = ctx.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, rgb(top));
  grad.addColorStop(1, rgb(bot));
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(255,255,255,.08)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
}

function drawSpikes(x, y, w, h) {
  ctx.save();
  ctx.translate(x, y);
  const n = Math.max(3, Math.floor(w / 18));
  const step = w / n;
  ctx.fillStyle = "rgba(248,113,113,.95)";
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x0 = i * step;
    ctx.moveTo(x0, h);
    ctx.lineTo(x0 + step / 2, 0);
    ctx.lineTo(x0 + step, h);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawCoin(x, y, w, h) {
  const t = (game.t * 3.1) % TAU;
  const sx = 0.35 + 0.65 * Math.abs(Math.sin(t));
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.scale(sx, 1);
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.5, h * 0.5, 0, 0, TAU);
  ctx.fillStyle = "rgba(253,224,71,.95)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,.18)";
  ctx.stroke();
  ctx.restore();
}

function drawEnemy(e) {
  const x = e.x,
    y = e.y,
    w = e.w,
    h = e.h;
  const pulse = 0.08 * Math.sin(game.t * 10 + x * 0.01);
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(248,113,113,.95)";
  drawRoundRect(ctx, 0, 0, w, h, 12);
  ctx.fill();
  // eyes
  ctx.fillStyle = "rgba(0,0,0,.45)";
  ctx.beginPath();
  ctx.arc(w * 0.33, h * 0.38, 3.5 + pulse, 0, TAU);
  ctx.arc(w * 0.67, h * 0.38, 3.5 + pulse, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawFlag(x, y, w, h) {
  // pole
  ctx.fillStyle = "rgba(255,255,255,.7)";
  ctx.fillRect(x + w * 0.42, y, w * 0.16, h);
  // cloth
  const wave = Math.sin(game.t * 5) * 4;
  ctx.fillStyle = "rgba(167,139,250,.92)";
  ctx.beginPath();
  ctx.moveTo(x + w * 0.5, y + 8);
  ctx.lineTo(x + w * 0.5 + 40 + wave, y + 16);
  ctx.lineTo(x + w * 0.5, y + 32);
  ctx.closePath();
  ctx.fill();
  // base
  ctx.fillStyle = "rgba(0,0,0,.22)";
  ctx.fillRect(x + w * 0.33, y + h, w * 0.34, 10);
}

function drawPlayer() {
  const blink = (Math.sin(game.t * 2.3) + 1) * 0.5;
  const inv = game.invulnT > 0;
  const flash = inv ? (Math.sin(game.t * 28) > 0 ? 0.65 : 1) : 1;

  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.globalAlpha = flash;

  // body
  ctx.fillStyle = "rgba(125,211,252,.95)";
  drawRoundRect(ctx, 0, 0, player.w, player.h, 12);
  ctx.fill();

  // face direction
  const fx = player.facing > 0 ? 1 : -1;
  ctx.translate(player.w / 2, player.h / 2);
  ctx.scale(fx, 1);
  ctx.translate(-player.w / 2, -player.h / 2);

  // visor / eye
  ctx.fillStyle = "rgba(0,0,0,.35)";
  drawRoundRect(ctx, player.w * 0.18, player.h * 0.22, player.w * 0.64, player.h * 0.34, 10);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,.85)";
  ctx.beginPath();
  ctx.ellipse(
    player.w * 0.62,
    player.h * 0.36,
    6,
    4.2 * (0.45 + 0.55 * blink),
    0,
    0,
    TAU
  );
  ctx.fill();

  ctx.restore();
}

function drawVignette(w, h) {
  const g = ctx.createRadialGradient(w * 0.5, h * 0.45, 10, w * 0.5, h * 0.5, Math.max(w, h) * 0.65);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,.32)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

let last = performance.now();
function frame(now) {
  const rawDt = (now - last) / 1000;
  last = now;
  const dt = clamp(rawDt, 0, 1 / 20);

  // 如果窗口失焦，避免“长 dt”造成穿透
  if (!input.focus) {
    input.pressed.clear();
    input.released.clear();
    last = now;
  } else {
    update(dt);
  }
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

