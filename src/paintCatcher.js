/*
 * Paint Catcher — the little game that fills the wait while the model draws.
 *
 * A bucket at the bottom, drops of paint falling from the top, and a picture
 * that fills in behind them: every drop caught is flung onto the paper as a
 * splat, so a long wait leaves a painting of its own behind. Nothing here can
 * be lost — a missed drop just splashes on the floor — because the player is
 * four and the point is to make ninety seconds feel like ten.
 *
 * It is deliberately framework-free: React owns the two canvas elements and the
 * chrome around them, this owns every pixel inside and the loop that moves them.
 * The only thing that crosses back is `onEvent`, which fires on a catch or a
 * miss so the HUD can show a score.
 */

const PALETTE = [
  "#ff5c8a",
  "#ff8a3d",
  "#ffd23f",
  "#4fd06a",
  "#3fb6ff",
  "#a06bff",
  "#ff5ad1",
];

const STAR_COLOR = "#ffcf2e";
const STAR_POINTS = 5;

const BASE_FALL = 3.4; // seconds a drop takes to reach the floor, at the start
const FAST_FALL = 1.9; // …and once the game has warmed up
const BASE_GAP = 950; // ms between drops, at the start
const FAST_GAP = 430; // …and once the game has warmed up
const RAMP = 75; // seconds it takes to work all the way up to the fast end
const STAR_CHANCE = 0.09; // how often a drop is a five-point star instead
const STEER_SPEED = 720; // px/s when the arrow keys are doing the steering
const MAX_STEP = 0.05; // s — a backgrounded tab must not teleport the drops

/*
 * A finger is not a mouse.
 *
 * On a phone the hand steering the bucket sits on the glass, so a bucket at the
 * bottom edge is a bucket underneath a palm: the player cannot see the thing
 * they are aiming. So on a touch screen the bucket rides well up from the
 * bottom, leaving a strip below it to drag in, and it is wider and given more
 * time — a small screen held in two hands is harder than a mouse on a desk.
 */
const TOUCH_REST = 0.17; // of the height, kept clear below the bucket
const TOUCH_REST_MIN = 48; // px, never less than a fingertip
const TOUCH_REST_MAX = 120; // px, never so much that the paper feels short
const TOUCH_REST_SHARE = 0.25; // …and never a quarter of a short, sideways screen
const TOUCH_SLOWER = 1.25; // longer to fall, on a screen you play with a thumb

/*
 * The strips of glass down the left and right edges belong to the phone, not to
 * us: Android's gesture navigation reads a swipe that starts within about 24 px
 * of either side as Back, and on a Samsung the right-hand strip is an edge
 * panel as well. A drop that lands in there asks the player to put a finger
 * somewhere that quietly leaves the app — mid-generation, with the picture not
 * yet saved — so on a touch screen no drop is ever dealt into those strips.
 */
const TOUCH_EDGE = 0.08; // of the width, left clear at each side
const TOUCH_EDGE_MIN = 28; // px — comfortably outside the system's own strip

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function rand(a, b) {
  return a + Math.random() * (b - a);
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * A blob of paint on the paper: one fat centre, a ring of smaller blobs and a
 * few flecks thrown clear of it. Randomised enough that no two look alike.
 */
function splat(g, x, y, color, scale, alpha) {
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = color;

  g.beginPath();
  g.arc(x, y, 13 * scale, 0, Math.PI * 2);
  g.fill();

  const blobs = 5 + Math.floor(Math.random() * 4);
  for (let i = 0; i < blobs; i++) {
    const angle = rand(0, Math.PI * 2);
    const dist = rand(8, 26) * scale;
    g.beginPath();
    g.arc(
      x + Math.cos(angle) * dist,
      y + Math.sin(angle) * dist,
      rand(3, 9) * scale,
      0,
      Math.PI * 2
    );
    g.fill();
  }

  for (let i = 0; i < 4; i++) {
    const angle = rand(0, Math.PI * 2);
    const dist = rand(26, 48) * scale;
    g.beginPath();
    g.arc(
      x + Math.cos(angle) * dist,
      y + Math.sin(angle) * dist,
      rand(1.2, 3) * scale,
      0,
      Math.PI * 2
    );
    g.fill();
  }

  g.restore();
}

function starPath(g, x, y, outer) {
  const inner = outer * 0.45;
  g.beginPath();
  for (let i = 0; i < STAR_POINTS * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / STAR_POINTS - Math.PI / 2;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
}

function drawDrop(g, d) {
  if (d.kind === "star") {
    g.save();
    g.translate(d.x, d.y);
    g.rotate(d.spin);
    g.fillStyle = STAR_COLOR;
    starPath(g, 0, 0, d.r * 1.7);
    g.fill();
    g.fillStyle = "#fff6d0";
    starPath(g, 0, 0, d.r * 0.8);
    g.fill();
    g.restore();
    return;
  }

  g.fillStyle = d.color;
  g.beginPath();
  g.moveTo(d.x, d.y - d.r * 2.2);
  g.lineTo(d.x - d.r * 0.8, d.y + d.r * 0.3);
  g.lineTo(d.x + d.r * 0.8, d.y + d.r * 0.3);
  g.closePath();
  g.fill();

  g.beginPath();
  g.arc(d.x, d.y, d.r, 0, Math.PI * 2);
  g.fill();

  g.globalAlpha = 0.55;
  g.fillStyle = "#fff";
  g.beginPath();
  g.arc(d.x - d.r * 0.32, d.y - d.r * 0.34, d.r * 0.26, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
}

/** The bucket the player steers: a handle, a white pail, paint sloshing in it. */
function drawBucket(g, c) {
  const half = c.w / 2;

  g.strokeStyle = "#8a7663";
  g.lineWidth = 3;
  g.beginPath();
  g.arc(c.x, c.y, half * 0.72, Math.PI, 0);
  g.stroke();

  g.fillStyle = "#fdfdff";
  g.beginPath();
  g.moveTo(c.x - half, c.y);
  g.lineTo(c.x + half, c.y);
  g.lineTo(c.x + half * 0.72, c.y + c.h);
  g.lineTo(c.x - half * 0.72, c.y + c.h);
  g.closePath();
  g.fill();
  g.strokeStyle = "#cfcfda";
  g.lineWidth = 2;
  g.stroke();

  g.fillStyle = c.tint;
  g.beginPath();
  g.ellipse(c.x, c.y + 3, half * 0.9, 6, 0, 0, Math.PI * 2);
  g.fill();
}

/**
 * @param layers  {paper, sprites} – two stacked canvases of the same size. The
 *   paper keeps the painting and is only touched when a drop lands; the sprite
 *   layer is cleared and redrawn every frame. Two elements rather than one is
 *   what keeps a phone at sixty: the browser composites them, so the painting
 *   is never re-blitted through canvas 2D on the way to the screen.
 * @param options {onEvent}
 */
export function createPaintCatcher({ paper, sprites }, options = {}) {
  const onEvent = options.onEvent ?? (() => {});
  const calm =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const ctx = sprites.getContext("2d");
  const paintCtx = paper.getContext("2d");

  // Coarse pointer means fingers, whatever the window's width says.
  const touch =
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(pointer: coarse)").matches;

  let width = 1;
  let height = 1;
  let dpr = 1;

  const catcher = { x: 0, y: 0, w: 90, h: 30, tint: PALETTE[0] };
  const drops = [];
  const sparks = [];

  let score = 0;
  let combo = 0;
  let elapsed = 0;
  let spawnIn = 500;
  let raf = null;
  let last = 0;
  let running = false;
  let destroyed = false;
  let pointerX = null;
  let steer = 0;

  /**
   * Re-fit to the element's box, keeping the painting so far.
   *
   * Resizing a canvas clears it, so the paper is copied out and drawn back
   * stretched — imperfect, and much kinder than throwing away what the player
   * has painted.
   */
  function fit() {
    const rect = sprites.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    // Hidden (display:none) while the player has it put away: leave the paper
    // and everything on it exactly as it was rather than squeezing it into a
    // box with no size.
    if (w < 8 || h < 8) return;
    if (w === width && h === height && ratio === dpr) return;

    let kept = null;
    if (width > 1 && height > 1) {
      kept = document.createElement("canvas");
      kept.width = paper.width;
      kept.height = paper.height;
      kept.getContext("2d").drawImage(paper, 0, 0);
    }

    width = w;
    height = h;
    dpr = ratio;

    for (const layer of [paper, sprites]) {
      layer.width = Math.round(width * dpr);
      layer.height = Math.round(height * dpr);
    }
    paintCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (kept) paintCtx.drawImage(kept, 0, 0, width, height);

    catcher.w = touch
      ? Math.max(96, Math.min(170, width * 0.26))
      : Math.max(72, Math.min(150, width * 0.17));
    catcher.h = Math.max(26, Math.min(38, height * 0.06));
    // The strip of glass below the bucket that the steering hand rests on.
    // Turned sideways there is much less height to give away, so it is capped
    // as a share of the stage as well.
    const rest = touch
      ? Math.min(
          Math.max(TOUCH_REST_MIN, Math.min(TOUCH_REST_MAX, height * TOUCH_REST)),
          height * TOUCH_REST_SHARE
        )
      : 16;
    catcher.y = height - catcher.h - rest;
    catcher.x = Math.min(
      Math.max(catcher.x || width / 2, catcher.w / 2 + 4),
      width - catcher.w / 2 - 4
    );

    // A drop mid-fall on a canvas that just got narrower must not be stranded
    // outside it.
    for (const d of drops) {
      d.x = Math.min(Math.max(d.x, d.r + 4), width - d.r - 4);
    }
  }

  function spawn() {
    const progress = Math.min(1, elapsed / RAMP);
    const star = Math.random() < STAR_CHANCE;
    const r = star ? 11 : rand(9, 14);
    const fall =
      lerp(BASE_FALL, FAST_FALL, progress) *
      (calm ? 1.35 : 1) *
      (touch ? TOUCH_SLOWER : 1);
    const edge = touch ? Math.max(TOUCH_EDGE_MIN, width * TOUCH_EDGE) : 10;
    drops.push({
      x: rand(r + edge, Math.max(r + edge + 1, width - r - edge)),
      y: -r * 2,
      r,
      vy: (height + r * 4) / fall,
      color: star ? STAR_COLOR : pick(PALETTE),
      kind: star ? "star" : "paint",
      spin: 0,
    });
  }

  function burst(x, y, color, count) {
    if (calm) return;
    for (let i = 0; i < count; i++) {
      const angle = rand(-Math.PI * 0.9, -Math.PI * 0.1);
      const speed = rand(90, 260);
      sparks.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: rand(0.4, 0.9),
        age: 0,
        r: rand(2, 5),
        color,
      });
    }
  }

  function step(dt) {
    elapsed += dt;

    spawnIn -= dt * 1000;
    if (spawnIn <= 0) {
      spawn();
      const progress = Math.min(1, elapsed / RAMP);
      spawnIn = lerp(BASE_GAP, FAST_GAP, progress) * rand(0.75, 1.3);
    }

    if (steer !== 0) {
      catcher.x += steer * STEER_SPEED * dt;
      pointerX = null; // the keyboard has taken over from the mouse
    } else if (pointerX !== null) {
      catcher.x += (pointerX - catcher.x) * Math.min(1, dt * 22);
    }
    catcher.x = Math.min(
      Math.max(catcher.x, catcher.w / 2 + 4),
      width - catcher.w / 2 - 4
    );

    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.y += d.vy * dt;
      if (d.kind === "star") d.spin += dt * 2.4;

      const inBand =
        d.y + d.r >= catcher.y && d.y - d.r <= catcher.y + catcher.h * 0.9;
      // A shade wider than the bucket looks, never narrower: a four-year-old
      // who can see the drop land in it and is told they missed is done
      // playing.
      if (inBand && Math.abs(d.x - catcher.x) <= catcher.w * 0.5 + d.r * 0.6) {
        drops.splice(i, 1);
        score += d.kind === "star" ? 5 : 1;
        combo += 1;
        catcher.tint = d.kind === "star" ? STAR_COLOR : d.color;
        // The caught paint lands on the paper, not in the bucket: this is the
        // picture the player is making while the model makes the other one.
        splat(
          paintCtx,
          rand(width * 0.08, width * 0.92),
          rand(height * 0.12, height * 0.66),
          d.color,
          d.kind === "star" ? rand(1.3, 2) : rand(0.8, 1.5),
          0.9
        );
        burst(d.x, catcher.y, d.color, d.kind === "star" ? 22 : 12);
        onEvent({ type: "catch", kind: d.kind, score, combo });
        continue;
      }

      if (d.y - d.r > height) {
        drops.splice(i, 1);
        combo = 0;
        // A miss costs nothing but a puddle on the floor.
        splat(paintCtx, d.x, height - 4, d.color, 0.45, 0.3);
        onEvent({ type: "miss", kind: d.kind, score, combo });
      }
    }

    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.age += dt;
      if (s.age >= s.life) {
        sparks.splice(i, 1);
        continue;
      }
      s.vy += 620 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    for (const d of drops) drawDrop(ctx, d);

    for (const s of sparks) {
      ctx.globalAlpha = Math.max(0, 1 - s.age / s.life);
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    drawBucket(ctx, catcher);
  }

  function frame(now) {
    if (!running || destroyed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(MAX_STEP, (now - last) / 1000);
    last = now;
    step(dt);
    draw();
  }

  const observer =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          fit();
          if (!running) draw();
        });
  observer?.observe(sprites);
  fit();
  draw();

  return {
    /** Run the loop. Idempotent — a second call is not a second loop. */
    resume() {
      if (running || destroyed) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    /** Freeze where it is: a hidden tab, a dialog, a finished wait. */
    pause() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = null;
    },
    getScore() {
      return score;
    },
    setPointer(x) {
      pointerX = x;
    },
    clearPointer() {
      pointerX = null;
    },
    /** -1, 0 or 1 — which way the arrow keys are pushing the bucket. */
    setSteer(direction) {
      steer = direction;
    },
    destroy() {
      destroyed = true;
      running = false;
      if (raf) cancelAnimationFrame(raf);
      observer?.disconnect();
    },
  };
}
