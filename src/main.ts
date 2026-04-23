import "./style.css";

type UnitType = "enemy" | "chest";

type Unit = {
  id: string;
  type: UnitType;
  x: number;
  y: number;
  r: number;
  power: number;
  gain: number;
  alive: boolean;
  color: string;
};

type Player = {
  id: "player";
  x: number;
  y: number;
  r: number;
  power: number;
  color: string;
  targetId: string | null;
  attackTimer: number;
  damageTimer: number;
};

type FloatingText = {
  text: string;
  x: number;
  y: number;
  ttl: number;
  color: string;
};

type GameState = {
  player: Player;
  units: Unit[];
  gameOver: boolean;
  won: boolean;
  width: number;
  height: number;
};

const CLICKTHROUGH_URL = "https://example.com";
const UNIT_RADIUS = 30;
const MOVE_SPEED = 195;

function mustGet<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return node;
}

const app = mustGet<HTMLDivElement>("#app");
app.innerHTML = `
  <div class="frame" id="frame">
    <canvas id="game" aria-label="Playable ads demo"></canvas>
    <div class="hud">
      <div class="chip" id="playerPowerChip">Сила: 0</div>
      <div class="chip" id="objectiveChip">Цель: очистить уровень</div>
    </div>
    <div class="toolbar">
      <button class="btn" id="soundBtn" type="button">Звук: ON</button>
    </div>
    <div class="overlay" id="overlay">
      <div class="card">
        <h2 id="overlayTitle">Победа!</h2>
        <p id="overlayText">Уровень очищен. Готов начать реальный бой?</p>
        <div class="cta-row">
          <button class="btn btn-primary" id="ctaBtn" type="button">Install</button>
          <button class="btn" id="replayBtn" type="button">Replay</button>
        </div>
      </div>
    </div>
  </div>
`;

const frame = mustGet<HTMLDivElement>("#frame");
const canvas = mustGet<HTMLCanvasElement>("#game");
const overlay = mustGet<HTMLDivElement>("#overlay");
const overlayTitle = mustGet<HTMLHeadingElement>("#overlayTitle");
const overlayText = mustGet<HTMLParagraphElement>("#overlayText");
const playerPowerChip = mustGet<HTMLDivElement>("#playerPowerChip");
const objectiveChip = mustGet<HTMLDivElement>("#objectiveChip");
const ctaBtn = mustGet<HTMLButtonElement>("#ctaBtn");
const replayBtn = mustGet<HTMLButtonElement>("#replayBtn");
const soundBtn = mustGet<HTMLButtonElement>("#soundBtn");

const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

let dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
let width = 0;
let height = 0;
let running = true;
let soundEnabled = true;
let lastTime = performance.now();
let selectedId: string | null = null;
let pulseAt = 0;
let hitFlashUntil = 0;
let powerGainText: FloatingText | null = null;
let autoPaused = false;

const state: GameState = {
  player: {
    id: "player",
    x: 0,
    y: 0,
    r: UNIT_RADIUS + 4,
    power: 6,
    color: "#76f7ff",
    targetId: null,
    attackTimer: 0,
    damageTimer: 0
  },
  units: [],
  gameOver: false,
  won: false,
  width: 1,
  height: 1
};

function logEvent(event: string, payload: Record<string, unknown> = {}): void {
  console.log("[analytics]", event, payload);
}

function updateHud(): void {
  playerPowerChip.textContent = "Сила: " + state.player.power;
  const enemiesLeft = state.units.filter((u) => u.type === "enemy" && u.alive).length;
  objectiveChip.textContent = enemiesLeft > 0 ? "Врагов осталось: " + enemiesLeft : "Уровень очищен";
}

function hideOverlay(): void {
  overlay.classList.remove("show");
}

function showOverlay(win: boolean): void {
  overlay.classList.add("show");
  overlayTitle.textContent = win ? "Победа!" : "Попробуй снова";
  overlayText.textContent = win
    ? "Ты зачистил уровень и собрал силу. Готов к следующему челленджу?"
    : "Нужен другой порядок действий. Нажми Replay и перепройди уровень.";
}

function makeLevel(): void {
  state.player = {
    id: "player",
    x: width * 0.5,
    y: height * 0.85,
    r: UNIT_RADIUS + 4,
    power: 6,
    color: "#76f7ff",
    targetId: null,
    attackTimer: 0,
    damageTimer: 0
  };

  state.units = [
    {
      id: "enemy-1",
      type: "enemy",
      x: width * 0.24,
      y: height * 0.6,
      r: UNIT_RADIUS,
      power: 4,
      alive: true,
      color: "#ffb16a",
      gain: 4
    },
    {
      id: "enemy-2",
      type: "enemy",
      x: width * 0.76,
      y: height * 0.52,
      r: UNIT_RADIUS,
      power: 11,
      alive: true,
      color: "#ff8a9b",
      gain: 11
    },
    {
      id: "enemy-3",
      type: "enemy",
      x: width * 0.5,
      y: height * 0.23,
      r: UNIT_RADIUS,
      power: 16,
      alive: true,
      color: "#ff5f73",
      gain: 16
    },
    {
      id: "chest-1",
      type: "chest",
      x: width * 0.52,
      y: height * 0.7,
      r: UNIT_RADIUS + 2,
      power: 3,
      alive: true,
      color: "#ffe38e",
      gain: 3
    }
  ];

  selectedId = null;
  pulseAt = 0;
  hitFlashUntil = 0;
  powerGainText = null;
  state.gameOver = false;
  state.won = false;
  hideOverlay();
  updateHud();
}

function resize(): void {
  const rect = frame.getBoundingClientRect();
  dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  width = Math.floor(rect.width);
  height = Math.floor(rect.height);

  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (state.player && state.units.length) {
    const oldW = state.width || width;
    const oldH = state.height || height;
    const sx = width / oldW;
    const sy = height / oldH;
    state.player.x *= sx;
    state.player.y *= sy;
    state.units.forEach((u) => {
      u.x *= sx;
      u.y *= sy;
    });
  }

  state.width = width;
  state.height = height;
}

function getUnitById(id: string): Unit | null {
  return state.units.find((u) => u.id === id && u.alive) ?? null;
}

function selectTarget(unit: Unit): void {
  if (!unit.alive || state.gameOver) return;
  selectedId = unit.id;
  state.player.targetId = unit.id;
  pulseAt = performance.now();
  logEvent("interaction", { target: unit.id, type: unit.type, targetPower: unit.power });
}

function pointerToLocal(event: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function onPointerDown(event: PointerEvent): void {
  if (state.gameOver) return;
  const point = pointerToLocal(event);

  let picked: Unit | null = null;
  for (const unit of state.units) {
    if (!unit.alive) continue;
    const dx = unit.x - point.x;
    const dy = unit.y - point.y;
    if (Math.hypot(dx, dy) <= unit.r + 10) {
      picked = unit;
      break;
    }
  }

  if (picked) selectTarget(picked);
}

function clampToBounds(obj: { x: number; y: number; r: number }): void {
  const margin = obj.r + 4;
  obj.x = Math.max(margin, Math.min(width - margin, obj.x));
  obj.y = Math.max(margin + 30, Math.min(height - margin, obj.y));
}

function vibrate(pattern: number | number[]): void {
  if (!soundEnabled) return;
  if (navigator.vibrate) navigator.vibrate(pattern);
}

function resolveContact(target: Unit): void {
  if (!target.alive) return;

  if (target.type === "chest") {
    target.alive = false;
    state.player.power += target.gain;
    powerGainText = {
      text: "+" + target.gain,
      x: target.x,
      y: target.y,
      ttl: 800,
      color: "#ffd76b"
    };
    state.player.attackTimer = 0.35;
    vibrate(20);
    updateHud();
    return;
  }

  state.player.attackTimer = 0.25;
  if (state.player.power >= target.power) {
    target.alive = false;
    state.player.power += target.gain;
    powerGainText = {
      text: "+" + target.gain,
      x: target.x,
      y: target.y,
      ttl: 900,
      color: "#88ffbd"
    };
    vibrate(15);
  } else {
    state.player.damageTimer = 0.35;
    hitFlashUntil = performance.now() + 220;
    vibrate([20, 20, 20]);
  }
  updateHud();
}

function update(dt: number): void {
  if (!running || state.gameOver) return;

  const player = state.player;
  player.attackTimer = Math.max(0, player.attackTimer - dt);
  player.damageTimer = Math.max(0, player.damageTimer - dt);

  const target = player.targetId ? getUnitById(player.targetId) : null;
  if (!target) {
    player.targetId = null;
    selectedId = null;
  } else {
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const dist = Math.hypot(dx, dy);
    const reach = player.r + target.r + 2;

    if (dist <= reach) {
      resolveContact(target);
      player.targetId = null;
      selectedId = null;
    } else {
      const step = MOVE_SPEED * dt;
      player.x += (dx / dist) * Math.min(step, dist);
      player.y += (dy / dist) * Math.min(step, dist);
      clampToBounds(player);
    }
  }

  if (powerGainText) {
    powerGainText.ttl -= dt * 1000;
    powerGainText.y -= dt * 26;
    if (powerGainText.ttl <= 0) powerGainText = null;
  }

  const enemiesLeft = state.units.some((u) => u.type === "enemy" && u.alive);
  if (!enemiesLeft && !state.gameOver) {
    state.gameOver = true;
    state.won = true;
    showOverlay(true);
  }
}

function drawCircleUnit(unit: { x: number; y: number; r: number; power: number; type?: UnitType; color: string }, isSelected: boolean): void {
  const pulse = isSelected ? 1 + 0.07 * Math.sin((performance.now() - pulseAt) * 0.02) : 1;
  const rr = unit.r * pulse;
  const grad = ctx.createRadialGradient(unit.x - rr * 0.4, unit.y - rr * 0.5, rr * 0.2, unit.x, unit.y, rr);
  grad.addColorStop(0, "rgba(255,255,255,0.28)");
  grad.addColorStop(1, unit.color);

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(unit.x, unit.y, rr, 0, Math.PI * 2);
  ctx.fill();

  if (isSelected) {
    ctx.strokeStyle = "#e9ff8a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(unit.x, unit.y, rr + 7, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = "#0e1120";
  ctx.font = "700 19px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = unit.type === "chest" ? "+" + unit.power : String(unit.power);
  ctx.fillText(label, unit.x, unit.y);
}

function drawPathLine(from: { x: number; y: number }, to: { x: number; y: number; r: number }): void {
  ctx.strokeStyle = "rgba(255, 249, 140, 0.95)";
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);

  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const arrowX = to.x - Math.cos(angle) * (to.r + 10);
  const arrowY = to.y - Math.sin(angle) * (to.r + 10);

  ctx.fillStyle = "rgba(255, 249, 140, 0.95)";
  ctx.beginPath();
  ctx.moveTo(arrowX, arrowY);
  ctx.lineTo(arrowX - Math.cos(angle - 0.45) * 11, arrowY - Math.sin(angle - 0.45) * 11);
  ctx.lineTo(arrowX - Math.cos(angle + 0.45) * 11, arrowY - Math.sin(angle + 0.45) * 11);
  ctx.closePath();
  ctx.fill();
}

function draw(): void {
  ctx.clearRect(0, 0, width, height);

  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "#284f86");
  bg.addColorStop(0.6, "#1b3359");
  bg.addColorStop(1, "#142440");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 18;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(width * 0.52, height * 0.9);
  ctx.lineTo(width * 0.45, height * 0.68);
  ctx.lineTo(width * 0.62, height * 0.45);
  ctx.lineTo(width * 0.5, height * 0.2);
  ctx.stroke();

  const target = state.player.targetId ? getUnitById(state.player.targetId) : null;
  if (target) drawPathLine(state.player, target);

  state.units.forEach((unit) => {
    if (unit.alive) {
      drawCircleUnit(unit, unit.id === selectedId);
    }
  });

  const p = state.player;
  const scale = 1 + (p.attackTimer > 0 ? 0.12 * Math.sin(performance.now() * 0.06) : 0);
  const color = p.damageTimer > 0 ? "#ff9aa8" : p.color;
  drawCircleUnit({ ...p, r: p.r * scale, color }, false);

  if (powerGainText) {
    ctx.fillStyle = powerGainText.color;
    ctx.font = "700 24px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(powerGainText.text, powerGainText.x, powerGainText.y);
  }

  if (hitFlashUntil > performance.now()) {
    ctx.fillStyle = "rgba(255, 79, 97, 0.18)";
    ctx.fillRect(0, 0, width, height);
  }
}

function loop(now: number): void {
  const dt = Math.min(0.04, (now - lastTime) / 1000);
  lastTime = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

function pauseGame(): void {
  if (!running) return;
  running = false;
}

function resumeGame(): void {
  if (running) return;
  running = true;
  lastTime = performance.now();
}

function init(): void {
  resize();
  makeLevel();
  logEvent("start", { creative: "yonote-playable-test-vite-ts" });
  requestAnimationFrame(loop);
}

canvas.addEventListener("pointerdown", onPointerDown, { passive: true });
window.addEventListener("resize", resize);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    autoPaused = true;
    pauseGame();
  } else if (autoPaused) {
    autoPaused = false;
    resumeGame();
  }
});

window.addEventListener("blur", () => {
  autoPaused = true;
  pauseGame();
});

window.addEventListener("focus", () => {
  if (autoPaused) {
    autoPaused = false;
    resumeGame();
  }
});

soundBtn.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  soundBtn.textContent = "Звук: " + (soundEnabled ? "ON" : "OFF");
});

replayBtn.addEventListener("click", () => {
  makeLevel();
  logEvent("interaction", { action: "replay" });
});

ctaBtn.addEventListener("click", () => {
  logEvent("cta_click", { url: CLICKTHROUGH_URL });
  window.open(CLICKTHROUGH_URL, "_blank");
});

init();
