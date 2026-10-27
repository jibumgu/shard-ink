(() => {
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const $ = id => document.getElementById(id);

  const PALETTE_SIZE = 7;
  const WOOD = { top: '#e9c99a', left: '#dcb07a', right: '#9c6a3a', bottom: '#7d4f27' };
  const GRAIN_BANDS = 4;
  const GRAIN_LINES = 26;
  const LEAD = '#140a06';                       // 납선 (유리 사이의 검은 선)
  const RAINBOW = [0, 30, 55, 120, 210, 270, 300];   // 무지개 띠의 색상 (빨강 → 보라)
  const DAY_LEN = 150;                          // 한 바퀴(아침→낮→저녁)에 걸리는 초
  const DAY_NAMES = ['아침', '낮', '저녁', '밤'];

  // 하루 시간대별 하늘·격자·빛 색 (rgb). 순서대로 아침 → 낮 → 저녁 → 밤
  const SKY = [
    { top: [43, 63, 102], bot: [240, 180, 142], grid: [255, 214, 170], glow: [255, 207, 150], stars: 0.5 },   // 아침
    { top: [47, 128, 196], bot: [201, 236, 255], grid: [235, 248, 255], glow: [255, 246, 220], stars: 0.05 }, // 낮
    { top: [58, 29, 82], bot: [224, 88, 58], grid: [255, 170, 110], glow: [255, 140, 80], stars: 0.55 },     // 저녁
    { top: [6, 8, 22], bot: [22, 30, 62], grid: [120, 150, 230], glow: [150, 175, 255], stars: 1.0 },        // 밤
  ];
  const N_DAY = SKY.length;

  let W = 0, H = 0, dpr = 1, unit = 1;
  let S = 1, m = 0, ox = 0, oy = 0;      // S: 유리 판 한 변(px), m: 나무 액자 폭
  let panX = 0, panY = 0;                // 스크롤로 옮긴 작품의 위치 (px)
  let palette = [];                      // 칠교 7색
  let facets = [];                       // 조각: 정규화 좌표(0~1) + 드래그 오프셋(px)
  let grain = [];                        // 나무결 (고정값)
  let t0 = 0;
  let drag = null;                       // 드래그 중인 조각 {f, moved, sx, sy, lx, ly}
  let dayT = 0.02;                       // 하루 시각 (0: 아침, 1/3: 낮, 2/3: 저녁)
  let dayTarget = null;                  // '시간 넘기기'로 이동 중인 목표 시각
  let skyNow = SKY[0];
  let lastDayIdx = -1;
  const mouse = { x: 0, y: 0, inside: false };
  const light = { x: 0, y: 0 };          // 후레쉬 위치 (마우스를 따라 부드럽게 따라감)
  const stars = [], motes = [];
  let last = performance.now();

  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const lerp2 = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  const rgbOf = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const shade = (hex, k) => `rgb(${rgbOf(hex).map(v => clamp(Math.round(v * k), 0, 255)).join(',')})`;
  const rgbStr = c => `${c.map(v => Math.round(v)).join(',')}`;

  function inPoly(x, y, pts) {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }

  // ---------- 랜덤 타일링 ----------
  function gaps(n) {
    const w = Array.from({ length: n }, () => rnd(0.6, 1.4));
    const sum = w.reduce((a, b) => a + b, 0);
    const out = [0];
    for (const v of w) out.push(out[out.length - 1] + v / sum);
    return out;
  }

  function makeTiling() {
    const cols = Math.round(rnd(5, 8)), rows = Math.round(rnd(5, 8));
    const xs = gaps(cols), ys = gaps(rows);
    const P = [];
    for (let j = 0; j <= rows; j++) {
      P.push([]);
      for (let i = 0; i <= cols; i++) {
        let x = xs[i], y = ys[j];
        if (i > 0 && i < cols) x += rnd(-0.25, 0.25) * Math.min(xs[i] - xs[i - 1], xs[i + 1] - xs[i]);
        if (j > 0 && j < rows) y += rnd(-0.25, 0.25) * Math.min(ys[j] - ys[j - 1], ys[j + 1] - ys[j]);
        P[j].push([x, y]);
      }
    }
    const out = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = P[j][i], b = P[j][i + 1], c = P[j + 1][i + 1], d = P[j + 1][i];
        const r = Math.random();
        if (r < 0.4) {
          out.push([a, b, c, d]);
        } else if (r < 0.8) {
          if (Math.random() < 0.5) { out.push([a, b, c], [a, c, d]); }
          else { out.push([a, b, d], [b, c, d]); }
        } else {
          const k = [(a[0] + c[0]) / 2 + rnd(-0.1, 0.1) * (c[0] - a[0]),
                     (a[1] + c[1]) / 2 + rnd(-0.1, 0.1) * (c[1] - a[1])];
          out.push([a, b, k], [b, c, k], [c, d, k], [d, a, k]);
        }
      }
    }
    return out;
  }

  // ---------- 색 ----------
  // 칠교 7색: 색상환을 7등분하고 조금씩 흔든 뒤, 스테인드글라스처럼 채도를 높게 잡음
  function makePalette() {
    const off = rnd(0, 360);
    return Array.from({ length: PALETTE_SIZE }, (_, i) => ({
      h: (off + i * 360 / PALETTE_SIZE + rnd(-14, 14) + 360) % 360,
      s: rnd(55, 90),
      l: rnd(30, 44),
    }));
  }

  // L: 후레쉬 빛을 받는 정도 (0~1). 빛을 받을수록 밝고 선명해짐
  function jewel(f, k, L) {
    const p = palette[f.c];
    const l = clamp(p.l * f.lum * k * (1 + 0.45 * L), 6, 92);
    const s = clamp(p.s * (1 + 0.2 * L), 0, 100);
    return `hsl(${p.h} ${s}% ${l}%)`;
  }

  // 하루 시각에 따른 하늘·격자·빛 색 (세 시간대 사이를 부드럽게 섞음)
  function skyAt(t) {
    const x = ((t % 1) + 1) % 1 * N_DAY;
    const i = Math.floor(x) % N_DAY, f = x - Math.floor(x), k = f * f * (3 - 2 * f);
    const A = SKY[i], B = SKY[(i + 1) % N_DAY];
    const mix = (a, b) => a.map((v, j) => v + (b[j] - v) * k);
    return {
      top: mix(A.top, B.top), bot: mix(A.bot, B.bot), grid: mix(A.grid, B.grid),
      glow: mix(A.glow, B.glow), stars: A.stars + (B.stars - A.stars) * k,
    };
  }

  // ---------- 생성 ----------
  function buildGrain() {
    const out = [];
    for (let b = 0; b < GRAIN_BANDS; b++) {
      out.push(Array.from({ length: GRAIN_LINES }, (_, k) => ({
        v: (k + 0.5) / GRAIN_LINES,
        amp: rnd(0.02, 0.08), freq: rnd(3, 9), ph: rnd(0, 6.28),
        a: rnd(0.05, 0.2), w: rnd(0.5, 1.3),
      })));
    }
    return out;
  }

  // 같은 꼭짓점을 공유하는 조각끼리 이웃으로 연결 (빛이 번지는 길)
  function linkNeighbors() {
    const owners = new Map();
    facets.forEach((f, i) => {
      for (const p of f.pts) {
        if (!owners.has(p)) owners.set(p, []);
        owners.get(p).push(i);
      }
    });
    facets.forEach((f, i) => {
      const set = new Set();
      for (const p of f.pts) for (const j of owners.get(p)) if (j !== i) set.add(j);
      f.nb = [...set];
    });
  }

  // 클릭한 조각에서 이웃으로 빛이 한 칸씩 번져 나감
  function burst(hit, now) {
    const start = facets.indexOf(hit);
    const dist = new Map([[start, 0]]);
    const queue = [start];
    while (queue.length) {
      const i = queue.shift();
      for (const j of facets[i].nb) {
        if (!dist.has(j)) {
          dist.set(j, dist.get(i) + 1);
          queue.push(j);
        }
      }
    }
    for (const [i, d] of dist) facets[i].flashAt = now + d * 110;
  }

  // 빛이 지나간 뒤 천천히 사라지는 밝기 (0~1)
  function flashLevel(f, now) {
    const x = (now - f.flashAt) / 1000;
    if (x < 0) return 0;
    return x < 0.12 ? x / 0.12 : Math.exp(-(x - 0.12) * 3.5);
  }

  function regenerate(now) {
    palette = makePalette();
    facets = makeTiling().map(pts => {
      const cn = [
        pts.reduce((a, [x]) => a + x, 0) / pts.length,
        pts.reduce((a, [, y]) => a + y, 0) / pts.length,
      ];
      return {
        pts,
        cn,                                            // 조각 중심 (정규화)
        c: Math.floor(Math.random() * PALETTE_SIZE),   // 7색 중 하나
        lum: rnd(0.6, 1.3),                             // 조각마다 밝기 랜덤
        ang: rnd(0, Math.PI * 2),
        delay: rnd(0, 600),
        flashAt: -1e9,                                  // 빛이 지나가는 시각
        nb: [],
        ox: 0, oy: 0, vx: 0, vy: 0,                     // 드래그 오프셋과 속도 (px)
        lift: 0,                                        // 들어 올린 정도 (0~1)
      };
    });
    linkNeighbors();
    drag = null;
    t0 = now;
  }

  // ---------- 배치 ----------
  function layout() {
    S = Math.min(W * 0.74, H * 0.7);     // 세로 화면(휴대폰)에서는 가로폭에 맞춤
    m = S * 0.12;
    panX = clamp(panX, -W * 0.4, W * 0.4);
    panY = clamp(panY, -H * 0.4, H * 0.4);
    ox = W / 2 - S / 2 + panX;
    oy = H / 2 - S / 2 + panY;
  }

  // 스크롤(휠, 한 손가락 드래그)로 작품 전체를 옮김
  function panBy(dx, dy) {
    panX += dx;
    panY += dy;
    layout();
  }

  // ---------- 조각 기하 ----------
  const worldPts = f => f.pts.map(([x, y]) => [ox + x * S + f.ox, oy + y * S + f.oy]);
  const centerOf = f => [ox + f.cn[0] * S + f.ox, oy + f.cn[1] * S + f.oy];
  const baseLight = (x, y) => Math.exp(-((x - light.x) ** 2 + (y - light.y) ** 2) / (2 * (S * 0.35) ** 2));

  function facetPath(g, pts) {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
  }

  function facetAt(x, y) {
    for (let i = facets.length - 1; i >= 0; i--) {
      if (inPoly(x, y, worldPts(facets[i]))) return facets[i];
    }
    return null;
  }

  // ---------- 액자 ----------
  function paintFrame(g) {
    const X0 = ox - m, Y0 = oy - m, X1 = ox + S + m, Y1 = oy + S + m;
    const I0x = ox, I0y = oy, I1x = ox + S, I1y = oy + S;

    g.save();
    g.shadowColor = 'rgba(0,0,0,.6)';
    g.shadowBlur = 40;
    g.shadowOffsetX = 6;
    g.shadowOffsetY = 14;
    g.fillStyle = WOOD.bottom;
    g.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
    g.restore();

    // 네 면: 모서리가 45도로 맞물리는 사다리꼴 (빛은 왼쪽 위에서 들어온다고 가정)
    const bands = [
      { q: [[X0, Y0], [X1, Y0], [I1x, I0y], [I0x, I0y]], col: WOOD.top },
      { q: [[X1, Y0], [X1, Y1], [I1x, I1y], [I1x, I0y]], col: WOOD.right },
      { q: [[X1, Y1], [X0, Y1], [I0x, I1y], [I1x, I1y]], col: WOOD.bottom },
      { q: [[X0, Y1], [X0, Y0], [I0x, I0y], [I0x, I1y]], col: WOOD.left },
    ];
    const quadPath = q => {
      g.beginPath();
      q.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
    };
    const quadPoint = (q, u, v) => lerp2(lerp2(q[0], q[1], u), lerp2(q[3], q[2], u), v);

    bands.forEach((b, bi) => {
      const q = b.q;
      const om = lerp2(q[0], q[1], 0.5), im = lerp2(q[3], q[2], 0.5);
      const gr = g.createLinearGradient(om[0], om[1], im[0], im[1]);
      gr.addColorStop(0, shade(b.col, 1.08));
      gr.addColorStop(0.5, b.col);
      gr.addColorStop(1, shade(b.col, 0.86));
      quadPath(q);
      g.fillStyle = gr;
      g.fill();

      g.save();
      quadPath(q);
      g.clip();
      for (const L of grain[bi]) {
        g.strokeStyle = `rgba(80,45,18,${L.a})`;
        g.lineWidth = L.w;
        g.beginPath();
        for (let s = 0; s <= 24; s++) {
          const u = s / 24;
          const p = quadPoint(q, u, L.v + L.amp * Math.sin(u * L.freq + L.ph));
          if (s) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]);
        }
        g.stroke();
      }
      g.restore();
    });

    g.strokeStyle = 'rgba(40,22,8,.75)';
    g.lineWidth = 2;
    g.strokeRect(X0, Y0, X1 - X0, Y1 - Y0);

    // 유리를 감싸는 안쪽 턱
    g.fillStyle = '#24150a';
    g.beginPath();
    g.rect(ox - 6, oy - 6, S + 12, S + 12);
    g.rect(ox, oy, S, S);
    g.fill('evenodd');
    g.strokeStyle = 'rgba(255,236,200,.35)';
    g.lineWidth = 1;
    g.strokeRect(ox - 6.5, oy - 6.5, S + 13, S + 13);
  }

  // ---------- 조각 그리기 ----------
  function paintFacets(g, now) {
    // 들어 올린 조각이 가장 위에 보이도록 정렬
    const order = [...facets].sort((a, b) => Math.hypot(a.ox, a.oy) - Math.hypot(b.ox, b.oy));
    for (const f of order) {
      const k = clamp((now - t0 - f.delay) / 450, 0, 1);
      if (k <= 0) continue;
      const e = easeOut(k);
      const pts = worldPts(f);
      const [cx, cy] = centerOf(f);
      const fl = flashLevel(f, now);
      const L = Math.min(1, baseLight(cx, cy) + 0.9 * fl);   // 빛을 받는 정도
      const dx = Math.cos(f.ang) * S * 0.3, dy = Math.sin(f.ang) * S * 0.3;

      g.save();
      if (f.lift > 0.01) {                 // 들어 올린 조각은 그림자가 생겨 떠 보임
        g.shadowColor = 'rgba(0,0,0,0.55)';
        g.shadowBlur = 24 * unit * f.lift;
        g.shadowOffsetY = 10 * unit * f.lift;
      }
      g.globalAlpha = e;
      const pop = 0.9 + 0.1 * e + 0.035 * fl + 0.04 * f.lift;
      g.translate(cx, cy);
      g.scale(pop, pop);
      g.translate(-cx, -cy);

      // 색유리: 밝은 쪽과 어두운 쪽이 한 방향으로 번짐
      facetPath(g, pts);
      const gr = g.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
      gr.addColorStop(0, jewel(f, 1.12, L));
      gr.addColorStop(1, jewel(f, 0.8, L));
      g.fillStyle = gr;
      g.fill();

      if (L > 0.02) {                      // 빛을 받으면 유리 표면에 흰 반사광이 지나감
        const sh = g.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
        sh.addColorStop(0, 'rgba(255,255,255,0)');
        sh.addColorStop(0.5, `rgba(255,250,235,${0.5 * L})`);
        sh.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = sh;
        g.fill();
      }

      if (L > 0.15) {                      // 빛의 방향으로 무지개 띠가 생김 (프리즘)
        const a2 = Math.atan2(cy - light.y, cx - light.x);
        const len = S * 0.22;
        const rg = g.createLinearGradient(cx - Math.cos(a2) * len, cy - Math.sin(a2) * len,
          cx + Math.cos(a2) * len, cy + Math.sin(a2) * len);
        RAINBOW.forEach((h, i) => rg.addColorStop(i / (RAINBOW.length - 1), `hsla(${h},100%,60%,${0.35 * L})`));
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = rg;
        g.fill();
        g.restore();
      }

      facetPath(g, pts);
      g.strokeStyle = LEAD;                // 납선
      g.lineWidth = Math.max(1.5, 2.6 * unit);
      g.lineJoin = 'round';
      g.stroke();
      g.restore();
    }
  }

  function paintScene(g, now) {
    paintFrame(g);
    paintFacets(g, now);
  }

  // ---------- 배경 ----------
  function drawBackground(t) {
    const top = rgbStr(skyNow.top), bot = rgbStr(skyNow.bot), grid = skyNow.grid;
    const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, `rgb(${top})`);
    g.addColorStop(1, `rgb(${bot})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 움직이는 격자: 천천히 흘러가고 살짝 출렁이며, 마우스 근처에서 밝아짐
    const cell = Math.max(60, Math.min(W, H) / 11);
    const ox2 = (t * 14) % cell, oy2 = (t * 9) % cell;
    const px = (mouse.x - W / 2) * 0.02, py = (mouse.y - H / 2) * 0.02;
    const cols = Math.ceil(W / cell) + 3, rows = Math.ceil(H / cell) + 3;
    const pos = [];
    for (let j = 0; j < rows; j++) {
      const row = [];
      for (let i = 0; i < cols; i++) {
        const wx = Math.sin(t * 0.7 + j * 0.35) * 4 + Math.cos(t * 0.5 + i * 0.4) * 3;
        const wy = Math.cos(t * 0.6 + i * 0.3) * 4 + Math.sin(t * 0.45 + j * 0.5) * 3;
        row.push([-cell + i * cell + ox2 + wx + px, -cell + j * cell + oy2 + wy + py]);
      }
      pos.push(row);
    }
    const glow = (180 * unit) ** 2 * 2;
    const seg = (x0, y0, x1, y1) => {
      const d2 = ((x0 + x1) / 2 - light.x) ** 2 + ((y0 + y1) / 2 - light.y) ** 2;
      ctx.strokeStyle = `rgba(${rgbStr(grid)},${0.1 + 0.4 * Math.exp(-d2 / glow)})`;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    };
    ctx.lineWidth = 1;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const [x, y] = pos[j][i];
        if (i + 1 < cols) seg(x, y, pos[j][i + 1][0], pos[j][i + 1][1]);
        if (j + 1 < rows) seg(x, y, pos[j + 1][i][0], pos[j + 1][i][1]);
      }
    }

    const starK = 0.2 + skyNow.stars * 1.6;          // 저녁·아침엔 별이 더 잘 보임
    const mx = (mouse.x / W - 0.5), my = (mouse.y / H - 0.5);
    for (const s of stars) {
      const x = ((s.x * W - mx * s.z * 30) % W + W) % W;
      const y = ((s.y * H - my * s.z * 30) % H + H) % H;
      const a = (0.25 + 0.6 * s.z) * (0.6 + 0.4 * Math.sin(t * 2 + s.ph)) * starK;
      ctx.fillStyle = `rgba(230,240,255,${a})`;
      ctx.beginPath();
      ctx.arc(x, y, 0.4 + s.z * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const mo of motes) {
      const x = ((mo.x * W - mx * mo.z * 50) % W + W) % W;
      const y = ((mo.y * H - my * mo.z * 50) % H + H) % H;
      const r = mo.r * mo.z * unit;
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(${rgbStr(grid)},0.14)`);
      gr.addColorStop(1, `rgba(${rgbStr(grid)},0)`);
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---------- 후레쉬 ----------
  // 전체 밝기는 그대로 두고, 빛이 닿은 곳에만 빛을 더함 (어둡게 하지 않음)
  function drawFlashlightGlow() {
    const R = S * 0.5;
    const [r, g2, b] = skyNow.glow;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, R);
    g.addColorStop(0, `rgba(${r},${g2},${b},0.16)`);
    g.addColorStop(0.5, `rgba(${r},${g2},${b},0.06)`);
    g.addColorStop(1, `rgba(${r},${g2},${b},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function drawFlashlightHead() {
    if (!mouse.inside) return;
    const u = unit;
    ctx.save();
    ctx.translate(mouse.x, mouse.y);
    ctx.beginPath();
    ctx.arc(0, 0, 9 * u, 0, Math.PI * 2);
    ctx.fillStyle = '#2b2f3a';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,240,210,.85)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 4 * u, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,240,210,.95)';
    ctx.fill();
    ctx.restore();
  }

  function updateTimeButton() {
    const idx = Math.round(dayT * N_DAY) % N_DAY;
    if (idx === lastDayIdx) return;
    lastDayIdx = idx;
    $('time').textContent = `${DAY_NAMES[idx]} · 다음 시간`;
  }

  function render(now, dt) {
    light.x += (mouse.x - light.x) * Math.min(1, dt * 12);
    light.y += (mouse.y - light.y) * Math.min(1, dt * 12);
    drawBackground(now / 1000);
    paintScene(ctx, now);
    drawFlashlightGlow();
    drawFlashlightHead();
    updateTimeButton();
  }

  function update(dt) {
    for (const s of stars) {
      s.x = (s.x + s.vx * dt + 1) % 1;
      s.y = (s.y + s.vy * dt + 1) % 1;
    }
    for (const mo of motes) {
      mo.x = (mo.x + mo.vx * dt + 1) % 1;
      mo.y = (mo.y + mo.vy * dt + 1) % 1;
    }

    // 하루 시각: 천천히 흐르거나, '시간 넘기기'로 다음 시간대까지 이동 (0~1 한 바퀴)
    if (dayTarget !== null) {
      const d = ((dayTarget - dayT) % 1 + 1) % 1;
      if (d < 0.004) { dayT = dayTarget; dayTarget = null; }
      else dayT = (dayT + Math.min(d, dt * 0.35)) % 1;
    } else {
      dayT = (dayT + dt / DAY_LEN) % 1;
    }
    skyNow = skyAt(dayT);

    for (const f of facets) {
      // 드래그 중이 아닌 조각은 스프링처럼 원래 자리로 돌아감
      if (!(drag && drag.f === f && drag.moved)) {
        const k = 60, c = 9;
        f.vx += (-f.ox * k - f.vx * c) * dt;
        f.vy += (-f.oy * k - f.vy * c) * dt;
        f.ox += f.vx * dt;
        f.oy += f.vy * dt;
      }
      const lifting = drag && drag.f === f && drag.moved ? 1 : 0;
      f.lift += (lifting - f.lift) * Math.min(1, dt * 10);
    }
  }

  function frame(now) {
    const dt = clamp((now - last) / 1000, 0, 0.05);   // 첫 프레임 등에서 음수가 되지 않도록
    last = now;
    update(dt);
    render(now, dt);
    requestAnimationFrame(frame);
  }

  // ---------- 입력 ----------
  function setMouse(e) {
    const r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left;
    mouse.y = e.clientY - r.top;
  }
  canvas.addEventListener('pointermove', e => {
    setMouse(e);
    mouse.inside = true;
    if (!drag) return;
    const dx = mouse.x - drag.lx, dy = mouse.y - drag.ly;
    if (!drag.moved && Math.hypot(mouse.x - drag.sx, mouse.y - drag.sy) > 4) drag.moved = true;
    if (drag.moved && drag.f) {          // 조각을 잡고 드래그하면 조각이 마우스를 따라감
      drag.f.ox += dx;
      drag.f.oy += dy;
      drag.f.vx = 0;
      drag.f.vy = 0;
    } else if (drag.moved) {             // 빈 곳을 끌면 작품 전체가 스크롤됨
      panBy(dx, dy);
    }
    drag.lx = mouse.x;
    drag.ly = mouse.y;
  });
  canvas.addEventListener('pointerleave', () => { mouse.inside = false; });
  canvas.addEventListener('pointerdown', e => {
    setMouse(e);
    const hit = facetAt(mouse.x, mouse.y);
    drag = { f: hit, moved: false, sx: mouse.x, sy: mouse.y, lx: mouse.x, ly: mouse.y };
  });
  const endPointer = () => {
    if (drag && drag.f && !drag.moved) burst(drag.f, performance.now());   // 그냥 클릭하면 빛이 번짐
    drag = null;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('wheel', e => {          // 휠이나 트랙패드로 작품을 스크롤
    e.preventDefault();
    const u = e.deltaMode === 1 ? 16 : 1;
    if (e.shiftKey && !e.deltaX) panBy(-e.deltaY * u, 0);
    else panBy(-e.deltaX * u, -e.deltaY * u);
  }, { passive: false });

  // ---------- 준비 ----------
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    unit = Math.min(W, H) / 800;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout();
    if (!mouse.x) {
      mouse.x = light.x = W / 2;
      mouse.y = light.y = H / 2;
    }
  }
  addEventListener('resize', resize);

  function initDust() {
    for (let i = 0; i < 180; i++) {
      stars.push({ x: Math.random(), y: Math.random(), z: 0.2 + Math.random() * 0.8,
        vx: (Math.random() - 0.5) * 0.012, vy: (Math.random() - 0.5) * 0.004, ph: Math.random() * 6.28 });
    }
    for (let i = 0; i < 26; i++) {
      motes.push({ x: Math.random(), y: Math.random(), z: 0.3 + Math.random() * 0.7,
        r: 6 + Math.random() * 12, vx: (Math.random() - 0.5) * 0.006, vy: -0.002 - Math.random() * 0.004 });
    }
  }

  if (matchMedia('(pointer: coarse)').matches) {    // 터치 기기는 안내 문구를 손가락 조작에 맞춤
    $('msg').textContent = '손가락으로 밀면 작품이 움직임 · 조각을 끌면 들어 올림 · 탭하면 빛이 번짐';
  }
  $('regen').onclick = () => regenerate(performance.now());
  $('time').onclick = () => { dayTarget = (Math.floor(dayT * N_DAY) + 1) / N_DAY % 1; };

  resize();
  grain = buildGrain();
  initDust();
  regenerate(performance.now());
  requestAnimationFrame(frame);
})();
