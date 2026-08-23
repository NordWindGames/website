// Pixel-art storm cloud that drifts across the hero, auto-strikes the CTA
// once it arrives, and keeps charging up further strikes on hover/focus/click.

type Els = {
	root: HTMLElement;
	canvas: HTMLCanvasElement;
	button: HTMLElement;
	jolt: HTMLElement;
};

type RGB = [number, number, number];

type Point = { x: number; y: number; z: number; sh: number; h: number; ph: number };
type Bolt = { main: number[][]; forks: number[][][] };
type Sprite = { z: number; px: number; py: number; d: number; a: number; c: RGB };

// Design-time tunables baked to their defaults (the artifact this was built
// from exposed these as an editable props panel).
const SPEED = 1;
const SPEED_FADE_IN = 1;
const SPEED_APPROACH = 1;
const SPEED_DRIFT = 1;
const DARKEN = true;

class StormCloud {
	root: HTMLElement;
	canvas: HTMLCanvasElement;
	btn: HTMLElement;
	jolt: HTMLElement;

	w = 0;
	h = 0;
	dens = 0.045;
	points: Point[] = [];
	buf: Sprite[] = [];

	start = 0;
	flashAt = 0;
	bolt: Bolt | null = null;
	target: number[] | null = null;
	hover = false;
	charge = 0;
	autoDone = false;
	warned = false;

	cx = 0;
	cy = 0;
	unit = 0;

	raf = 0;
	resize = () => {};
	loop = (_t: number) => {};

	constructor(els: Els) {
		this.root = els.root;
		this.canvas = els.canvas;
		this.btn = els.button;
		this.jolt = els.jolt;
	}

	btnBox() {
		const btn = this.btn;
		const cv = this.canvas;
		const b = btn.getBoundingClientRect();
		const r = cv.getBoundingClientRect();
		return { x: b.left - r.left, y: b.top - r.top, w: b.width, h: b.height };
	}

	// build + arm a strike into the button, from the cloud if it is on screen
	fireBolt(now: number) {
		const w = this.w;
		const h = this.h;
		const box = this.btnBox();
		this.target = box ? [box.x + box.w * 0.5, box.y + 3] : [w * 0.5, h * 0.55];
		const cx = this.cx ?? w * 0.3;
		const cy = this.cy ?? h * 0.2;
		const unit = this.unit || Math.min(w, h) * 0.3;
		const y0 = Math.min(cy + unit * 0.1, this.target[1] - h * 0.22);
		this.bolt = this.makeBolt(cx + (Math.random() - 0.5) * unit * 0.5, y0, this.target[0], this.target[1]);
		this.flashAt = now;
	}

	// jagged pixel channel from the cloud down into the button, with two short forks
	makeBolt(x0: number, y0: number, x1: number, y1: number): Bolt {
		const main: number[][] = [];
		const segs = 13;
		const dx = x1 - x0;
		const dy = y1 - y0;
		const span = Math.hypot(dx, dy);
		const nx = -dy / (span || 1);
		const ny = dx / (span || 1);
		for (let i = 0; i <= segs; i++) {
			const t = i / segs;
			const edge = Math.sin(t * Math.PI);
			const off = (Math.random() - 0.5) * span * 0.22 * edge;
			main.push([x0 + dx * t + nx * off, y0 + dy * t + ny * off]);
		}
		main[segs] = [x1, y1];
		const forks: number[][][] = [];
		for (const at of [0.42, 0.68]) {
			const k = Math.round(at * segs);
			const p = main[k];
			const fl = span * (0.13 + Math.random() * 0.12);
			const dir = Math.random() < 0.5 ? -1 : 1;
			const f: number[][] = [p];
			let px = p[0];
			let py = p[1];
			for (let j = 1; j <= 3; j++) {
				px += (dx / span) * fl * 0.45 + nx * dir * fl * 0.4 * (Math.random() * 0.8 + 0.4);
				py += (dy / span) * fl * 0.45 + ny * dir * fl * 0.4 * (Math.random() * 0.8 + 0.4);
				f.push([px, py]);
			}
			forks.push(f);
		}
		return { main, forks };
	}

	drawBoltPath(ctx: CanvasRenderingContext2D, pts: number[][], bs: number, col: RGB, a: number) {
		ctx.fillStyle = this.rgb(col, a);
		for (let i = 0; i < pts.length - 1; i++) {
			const [ax, ay] = pts[i];
			const [bx, by] = pts[i + 1];
			const len = Math.hypot(bx - ax, by - ay);
			const n = Math.max(1, Math.ceil(len / (bs * 0.62)));
			for (let j = 0; j <= n; j++) {
				const t = j / n;
				const x = Math.round((ax + (bx - ax) * t) / bs) * bs;
				const y = Math.round((ay + (by - ay) * t) / bs) * bs;
				ctx.fillRect(x, y, bs, bs);
			}
		}
	}

	buildCloud(step: number): Point[] {
		this.dens = step;
		// metaball field, NOT a union of spheres: overlapping lobes melt into one silhouette,
		// a hard flat base gives the cumulus anvil, and noise breaks every circular arc
		const blobs = [
			{ c: [-0.86, -0.06, 0.02], r: [0.44, 0.24, 0.34], w: 0.9 },
			{ c: [-0.5, 0.04, -0.06], r: [0.52, 0.3, 0.4], w: 1.05 },
			{ c: [-0.12, 0.02, 0.08], r: [0.6, 0.34, 0.46], w: 1.1 },
			{ c: [0.3, -0.02, -0.04], r: [0.54, 0.3, 0.42], w: 1.0 },
			{ c: [0.74, -0.05, 0.04], r: [0.44, 0.25, 0.34], w: 0.9 },
			{ c: [-0.34, 0.26, 0.0], r: [0.38, 0.26, 0.3], w: 0.8 },
			{ c: [0.06, 0.34, -0.04], r: [0.42, 0.3, 0.32], w: 0.85 },
			{ c: [0.44, 0.24, 0.06], r: [0.32, 0.22, 0.26], w: 0.7 },
			{ c: [-0.08, 0.5, 0.02], r: [0.3, 0.22, 0.24], w: 0.6 },
		];
		const wob = (x: number, y: number, z: number) =>
			0.075 * Math.sin(x * 5.3 + z * 2.1) * Math.cos(y * 6.7 - x * 1.7) +
			0.055 * Math.sin(y * 8.1 + z * 4.3) * Math.cos(x * 7.9 + y * 2.3) +
			0.035 * Math.sin(x * 13.1 - y * 9.7 + z * 6.1);
		const base = -0.3;
		const pts: Point[] = [];
		const occ = new Set<string>();
		const key = (i: number, j: number, k: number) => i + ',' + j + ',' + k;
		const nx = Math.round(2.8 / step);
		const ny = Math.round(1.5 / step);
		const nz = Math.round(1.4 / step);
		const shade: { i: number; j: number; k: number; x: number; y: number; z: number; sh: number }[] = [];
		for (let i = 0; i <= nx; i++) {
			for (let j = 0; j <= ny; j++) {
				for (let k = 0; k <= nz; k++) {
					const x = -1.4 + i * step;
					const y = -0.7 + j * step;
					const z = -0.7 + k * step;
					let fld = 0;
					for (const b of blobs) {
						const dx = (x - b.c[0]) / b.r[0];
						const dy = (y - b.c[1]) / b.r[1];
						const dz = (z - b.c[2]) / b.r[2];
						const q2 = dx * dx + dy * dy + dz * dz;
						if (q2 < 1) {
							const m = 1 - q2;
							fld += b.w * m * m;
						}
					}
					// flat, slightly ragged underside — a cumulus base, never a sphere bottom
					const bcut = base + 0.05 * Math.sin(x * 4.1 + z * 3.3) + 0.03 * Math.sin(x * 9.7 - z * 7.1);
					if (y < bcut) continue;
					const thr = 0.42 + wob(x, y, z);
					if (fld < thr) continue;
					occ.add(key(i, j, k));
					const depth = Math.min(1, (fld - thr) / 0.5);
					shade.push({ i, j, k, x, y, z, sh: Math.max(0, 1 - depth) });
				}
			}
		}
		// keep only the shell: interior voxels are never visible once the body is opaque
		for (const v of shade) {
			const inner =
				occ.has(key(v.i + 2, v.j, v.k)) &&
				occ.has(key(v.i - 2, v.j, v.k)) &&
				occ.has(key(v.i, v.j + 2, v.k)) &&
				occ.has(key(v.i, v.j - 2, v.k)) &&
				occ.has(key(v.i, v.j, v.k + 2)) &&
				occ.has(key(v.i, v.j, v.k - 2));
			if (inner) continue;
			pts.push({ x: v.x, y: v.y, z: v.z, sh: v.sh, h: Math.random(), ph: Math.random() * Math.PI * 2 });
		}
		return pts;
	}

	mount() {
		this.dens = 0.045;
		this.points = this.buildCloud(this.dens);
		this.resize = () => {
			const c = this.canvas;
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			this.w = c.clientWidth || c.parentElement?.clientWidth || window.innerWidth;
			this.h = c.clientHeight || c.parentElement?.clientHeight || window.innerHeight;
			c.width = Math.max(1, Math.round(this.w * dpr));
			c.height = Math.max(1, Math.round(this.h * dpr));
			c.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
		};
		this.resize();
		window.addEventListener('resize', this.resize);
		this.start = performance.now();
		this.loop = (t: number) => {
			try {
				const c = this.canvas;
				if (!this.w || this.w !== c.clientWidth) this.resize();
				this.draw(t);
			} catch (e) {
				if (!this.warned) {
					this.warned = true;
					console.warn('cloud draw error', e);
				}
			} finally {
				this.raf = requestAnimationFrame(this.loop);
			}
		};
		this.raf = requestAnimationFrame(this.loop);

		this.btn.addEventListener('pointerenter', () => {
			this.hover = true;
		});
		this.btn.addEventListener('pointerleave', () => {
			this.hover = false;
		});
		this.btn.addEventListener('focus', () => {
			this.hover = true;
		});
		this.btn.addEventListener('blur', () => {
			this.hover = false;
		});
		this.btn.addEventListener('click', () => {
			this.fireBolt(performance.now());
		});
	}

	lerp(a: number, b: number, t: number) {
		return a + (b - a) * t;
	}
	mix(c1: RGB, c2: RGB, t: number): RGB {
		return [
			Math.round(this.lerp(c1[0], c2[0], t)),
			Math.round(this.lerp(c1[1], c2[1], t)),
			Math.round(this.lerp(c1[2], c2[2], t)),
		];
	}
	rgb(c: RGB, a: number) {
		return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
	}
	smooth(e0: number, e1: number, x: number) {
		const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
		return t * t * (3 - 2 * t);
	}

	draw(now: number) {
		const c = this.canvas;
		if (!this.w) return;
		const ctx = c.getContext('2d');
		if (!ctx) return;
		const w = this.w;
		const h = this.h;
		// per-phase durations (ms) — each phase has its own speed multiplier
		const dIn = 2200 / (SPEED * SPEED_FADE_IN);
		const dFast = 1850 / (SPEED * SPEED_APPROACH);
		const dSlow = 3350 / (SPEED * SPEED_DRIFT);
		const el = Math.max(0, now - this.start - 500 / SPEED);
		let raw: number;
		if (el < dIn) raw = 0.3 * (el / dIn);
		else if (el < dIn + dFast) raw = 0.3 + 0.25 * ((el - dIn) / dFast);
		else raw = Math.min(1, 0.55 + 0.45 * ((el - dIn - dFast) / dSlow));
		const darken = DARKEN ? this.smooth(0.18, 0.6, raw) : 0;

		const top = this.mix([248, 250, 253], [30, 39, 50], darken);
		const bot = this.mix([199, 212, 227], [16, 22, 30], darken);
		// dark mode gets a deeper, cooler ramp: night-blue crown -> ink base, plus glow + vignette
		const mid = this.mix(this.mix(top, bot, 0.5), [26, 38, 58], darken * 0.75);
		const g = ctx.createLinearGradient(w * 0.18, -h * 0.1, w * 0.05, h * 1.05);
		g.addColorStop(0, this.rgb(this.mix(top, [42, 56, 78], darken * 0.6), 1));
		g.addColorStop(0.52, this.rgb(mid, 1));
		g.addColorStop(1, this.rgb(this.mix(bot, [10, 14, 22], darken * 0.8), 1));
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, w, h);
		if (darken > 0.01) {
			const gr = Math.max(w, h) * 0.95;
			const sky = ctx.createRadialGradient(w * 0.24, -h * 0.12, 0, w * 0.24, -h * 0.12, gr);
			sky.addColorStop(0, 'rgba(96,128,178,' + (0.2 * darken).toFixed(3) + ')');
			sky.addColorStop(0.55, 'rgba(52,72,104,' + (0.08 * darken).toFixed(3) + ')');
			sky.addColorStop(1, 'rgba(52,72,104,0)');
			ctx.fillStyle = sky;
			ctx.fillRect(0, 0, w, h);
			const vig = ctx.createRadialGradient(
				w * 0.5,
				h * 0.46,
				Math.min(w, h) * 0.25,
				w * 0.5,
				h * 0.5,
				Math.max(w, h) * 0.82,
			);
			vig.addColorStop(0, 'rgba(6,9,15,0)');
			vig.addColorStop(1, 'rgba(6,9,15,' + (0.52 * darken).toFixed(3) + ')');
			ctx.fillStyle = vig;
			ctx.fillRect(0, 0, w, h);
		}

		// hover charge ramps in/out smoothly and drives the "charging up" button state
		this.charge += ((this.hover ? 1 : 0) - this.charge) * 0.14;
		const ch = this.charge < 0.005 ? 0 : this.charge;

		const root = this.root;
		const fg = this.mix([22, 32, 43], [233, 240, 249], darken);
		const muted = this.mix([93, 107, 125], [143, 160, 181], darken);
		const inv = this.rgb(this.mix([250, 252, 255], [12, 17, 24], darken), 1);
		root.style.setProperty('--fg', this.rgb(fg, 1));
		root.style.setProperty('--muted', this.rgb(muted, 1));
		root.style.setProperty('--line', this.rgb(fg, 0.24));
		root.style.setProperty('--btnbg', darken > 0.5 ? 'rgba(16,22,30,0.5)' : 'rgba(255,255,255,0.5)');
		root.style.setProperty('--btnfg', inv);
		if (this.flashAt) {
			const dt = now - this.flashAt;
			// discharge -> arc stutter -> cooling filament -> steady amber breathing
			const hit = Math.exp(-dt / 120); // white-hot overcharge
			const arc =
				dt < 620
					? Math.exp(-dt / 210) * (0.5 * Math.sin(dt / 17) + 0.3 * Math.sin(dt / 41) + 0.2 * Math.sin(dt / 7.3))
					: 0;
			const cool = Math.exp(-dt / 1100); // filament cooling down
			const pulse = 0.5 + 0.5 * Math.sin(dt / 700);
			// surge > 1 = overdriven, < 0 = brief brown-out dip between arcs
			const surge = Math.min(1.15, hit * 1.25 + arc);
			const lum = Math.max(0, surge);
			const dip = Math.max(0, -surge);
			const base = this.mix([242, 194, 48], [196, 148, 32], dip * 0.9);
			const bg = this.mix(this.mix(base, [255, 253, 240], Math.min(1, lum)), [255, 246, 205], 0.35 * ch);
			root.style.setProperty('--gamelift', (-3.5 * ch).toFixed(2) + 'px');
			root.style.setProperty('--gamebg', this.rgb(bg, 1));
			root.style.setProperty('--gamefg', this.rgb(this.mix([22, 32, 43], [64, 40, 0], 0.4 * cool), 1));
			root.style.setProperty(
				'--gameborder',
				this.rgb(this.mix([255, 224, 130], [255, 255, 255], Math.min(1, lum * 1.3)), 1),
			);
			const halo = 16 + 30 * pulse + 170 * lum + 40 * cool + 55 * ch;
			root.style.setProperty(
				'--gameshadow',
				[
					'inset 0 0 ' + Math.round(6 + 26 * lum) + 'px rgba(255,255,255,' + (0.25 + 0.6 * lum).toFixed(3) + ')',
					'inset 0 -2px 0 rgba(146,96,0,' + (0.35 * (1 - lum)).toFixed(3) + ')',
					'0 0 ' + Math.round(2 + 70 * lum) + 'px rgba(255,255,255,' + (0.9 * lum).toFixed(3) + ')',
					'0 0 ' + Math.round(halo * 0.45) + 'px rgba(255,214,110,' + (0.32 + 0.14 * pulse + 0.4 * lum).toFixed(3) + ')',
					'0 0 ' + Math.round(halo) + 'px rgba(242,168,32,' + (0.2 + 0.1 * pulse + 0.3 * lum).toFixed(3) + ')',
					'0 0 ' + Math.round(halo * 2.1) + 'px rgba(242,168,32,' + (0.1 + 0.16 * lum).toFixed(3) + ')',
					'0 12px 34px rgba(120,74,0,0.3)',
				].join(', '),
			);
			const j = hit * hit;
			const s = 1 + 0.055 * hit + 0.012 * Math.max(0, arc);
			const st = this.jolt.style;
			st.transform =
				'translate3d(' + (Math.sin(dt / 8.5) * 5 * j).toFixed(2) + 'px,' + (Math.cos(dt / 6.5) * 4 * j).toFixed(2) + 'px,0) scale(' + s.toFixed(4) + ')';
			st.filter = 'brightness(' + (1 + 0.5 * lum).toFixed(3) + ') saturate(' + (1 + 0.35 * cool - 0.5 * lum).toFixed(3) + ')';
			st.textShadow = '0 0 ' + Math.round(4 + 18 * lum) + 'px rgba(255,255,255,' + (0.25 + 0.55 * lum).toFixed(3) + ')';
		} else {
			const st = this.jolt.style;
			st.transform = 'translate3d(0,0,0)';
			st.filter = 'none';
			st.textShadow = 'none';
			// idle -> hover: the button "charges up". amber creeps in, border goes white-hot,
			// the halo breathes faster the fuller the charge, and the plate lifts + jitters.
			const crack = ch * (0.55 + 0.45 * Math.abs(Math.sin(now / 63) * Math.sin(now / 121)));
			const bgc = this.mix(fg, [92, 68, 12], ch * 0.85);
			root.style.setProperty('--gamebg', this.rgb(this.mix(bgc, [242, 194, 48], 0.16 * crack), 1));
			root.style.setProperty(
				'--gamefg',
				this.rgb(this.mix(this.mix([250, 252, 255], [12, 17, 24], darken), [255, 236, 170], ch), 1),
			);
			root.style.setProperty('--gameborder', this.rgb(this.mix(fg, [255, 232, 150], Math.min(1, ch * 1.2)), 1));
			root.style.setProperty('--gamelift', (-3.5 * ch).toFixed(2) + 'px');
			if (ch < 0.01) {
				root.style.setProperty('--gameshadow', 'none');
			} else {
				const halo = 10 + 46 * ch + 22 * crack;
				root.style.setProperty(
					'--gameshadow',
					[
						'inset 0 0 ' + Math.round(4 + 16 * crack) + 'px rgba(255,214,110,' + (0.18 * ch + 0.22 * crack).toFixed(3) + ')',
						'0 0 ' + Math.round(halo * 0.4) + 'px rgba(255,224,130,' + (0.3 * ch + 0.2 * crack).toFixed(3) + ')',
						'0 0 ' + Math.round(halo) + 'px rgba(242,168,32,' + (0.22 * ch).toFixed(3) + ')',
						'0 0 ' + Math.round(halo * 2) + 'px rgba(242,168,32,' + (0.12 * ch).toFixed(3) + ')',
						'0 10px 26px rgba(20,26,36,' + (0.22 * ch).toFixed(3) + ')',
					].join(', '),
				);
			}
			st.transform = 'translate3d(' + (Math.sin(now / 47) * 0.9 * ch * ch).toFixed(2) + 'px,' + (Math.cos(now / 39) * 0.7 * ch * ch).toFixed(2) + 'px,0)';
			st.filter = ch > 0.01 ? 'brightness(' + (1 + 0.1 * crack).toFixed(3) + ')' : 'none';
			st.textShadow = ch > 0.01 ? '0 0 ' + Math.round(6 + 12 * crack) + 'px rgba(255,224,130,' + (0.35 * ch).toFixed(3) + ')' : 'none';
		}

		// ONE continuous flight path: catmull-rom through waypoints, traversed by a single
		// eased clock -> never stops at the button, no velocity kinks between phases
		const ss = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
		// ease in from standstill, hold a long near-constant glide, ease out only at the very end
		const pathT =
			raw < 0.16
				? ss(raw / 0.16) * 0.16
				: raw > 0.9
					? 0.9 + (1 - Math.pow(1 - (raw - 0.9) / 0.1, 2)) * 0.1
					: raw;
		const wps = [
			[0.95, 0.9],
			[0.9, 0.84],
			[0.85, 0.76],
			[0.74, 0.62],
			[0.5, 0.5],
			[0.32, 0.485],
			[0.14, 0.46],
			[-0.02, 0.45],
		];
		const szs = [0.04, 0.07, 0.13, 0.3, 0.72, 0.88, 1.0, 1.06];
		const cr = (p0: number, p1: number, p2: number, p3: number, t: number) => {
			const t2 = t * t;
			const t3 = t2 * t;
			return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
		};
		const segs = wps.length - 3;
		const fs = Math.min(segs - 0.0001, pathT * segs);
		const i0 = Math.floor(fs);
		const lt = fs - i0;
		const at = (k: number) => wps[Math.max(0, Math.min(wps.length - 1, k))];
		let cx = cr(at(i0)[0], at(i0 + 1)[0], at(i0 + 2)[0], at(i0 + 3)[0], lt) * w;
		let cy = cr(at(i0)[1], at(i0 + 1)[1], at(i0 + 2)[1], at(i0 + 3)[1], lt) * h;
		const sq = (k: number) => szs[Math.max(0, Math.min(szs.length - 1, k))];
		const sz = cr(sq(i0), sq(i0 + 1), sq(i0 + 2), sq(i0 + 3), lt);
		// slow vertical sway keeps the cloud alive even when it barely translates
		cy -= h * 0.022 * Math.sin(pathT * Math.PI * 2.1 + 0.4);
		const unit = Math.min(w, h) * 0.42 * sz;
		this.cx = cx;
		this.cy = cy;
		this.unit = unit;
		if (!this.autoDone && pathT >= 0.6) {
			this.autoDone = true;
			this.fireBolt(now);
		}
		const flash = this.flashAt ? Math.exp(-(now - this.flashAt) / 260) : 0;
		const f = 3.4;
		const spin = (now - this.start) / 9000 + (1 - raw) * 1.1;
		const sin = Math.sin(spin);
		const cos = Math.cos(spin);
		// tile size follows the projected voxel spacing so the solid body has no gaps
		const step = Math.max(2, Math.round(this.dens * unit * 1.12));
		const dot = Math.max(2, Math.round(step * 0.5));
		// storm cloud: bright crown, heavy slate underbelly, plus an internal lightning flicker
		const bolt = (() => {
			const p = (now / 1000) % 5.4;
			if (p > 0.34) return 0;
			const k = Math.exp(-p * 9) * (0.35 + 0.65 * Math.abs(Math.sin(p * 47)));
			return Math.min(1, k);
		})();
		const pal: RGB[] = (
			[
				[250, 252, 255],
				[230, 237, 247],
				[208, 218, 233],
				[184, 196, 214],
				[158, 171, 192],
				[131, 145, 168],
				[104, 118, 142],
				[78, 91, 114],
				[56, 67, 88],
				[38, 47, 64],
			] as RGB[]
		).map((c, idx) => {
			// flicker lights the underside bands most, as if the bolt sits inside the cloud
			const glow = bolt * (0.14 + 0.13 * idx);
			return this.mix(this.mix(c, [255, 255, 255], flash * 0.7), [214, 226, 255], glow);
		});
		const appear = this.smooth(0.01, 0.26, raw);
		const settled = this.smooth(0.85, 1, raw);

		// sparse speck while flying in; solid pixel-art body from the flash on
		const fullK = this.smooth(0.5, 0.68, raw);
		const drift = this.smooth(0.58, 0.95, raw);
		const solid = fullK;

		// --- volumetric swarm pass: flow-field churn, painter's-order depth sort, lambert shading
		const T = now / 1000;
		const buf = this.buf;
		let n = 0;
		const LX = 0.46;
		const LY = 0.74;
		const LZ = -0.49;

		for (const pt of this.points) {
			// while sparse a few pixels drop out; the solid body keeps only soft edge nibbles
			const holeWave = 0.5 + 0.5 * Math.sin(pt.h * 37.1 + now / (2600 - 900 * drift) + pt.ph);
			const thresh = this.lerp(0.42, 1.3, solid) - 0.16 * (1 - solid) * holeWave;
			if (pt.h > thresh) continue;
			// soft nibbles only along the silhouette edge, never pinholes in the body
			if (solid > 0.9 && pt.sh < 0.12 && pt.h > 0.55 + 0.45 * holeWave) continue;

			const breathe = 1 + 0.045 * drift * Math.sin(T / 2.3 + pt.h * 6.1);
			// slow rolling deformation keeps the silhouette alive without dissolving it
			const amp = this.lerp(0.09, 0.006, solid);
			const fx = Math.sin(pt.y * 1.9 + T * 0.33 + pt.ph) * Math.cos(pt.z * 1.6 - T * 0.24);
			const fy = Math.sin(pt.z * 2.1 - T * 0.28 + pt.ph * 0.7) * Math.cos(pt.x * 1.4 + T * 0.22);
			const fz = Math.sin(pt.x * 1.7 + T * 0.26) * Math.cos(pt.y * 2.0 + T * 0.3 + pt.ph);
			const bx = pt.x * breathe + fx * amp;
			const by = pt.y * breathe + fy * amp * 0.7;
			const bz = pt.z * breathe + fz * amp;
			const x = bx * cos + bz * sin;
			const z = -bx * sin + bz * cos;
			const zc = z + f;
			if (zc < 0.6) continue;
			const s = f / zc;
			// quantize relative to the centre so the whole cloud glides instead of pixels popping one by one
			const px = Math.round(cx) + Math.round((x * s * unit) / step) * step;
			const py = Math.round(cy) - Math.round((by * s * unit) / step) * step;
			if (px < -30 || px > w + 30 || py < -30 || py > h + 30) continue;

			// lambert + top-down term, then flat quantized bands -> pixel-sprite shading
			const len = Math.hypot(x, by, z) || 1;
			const lam = Math.max(0, (x * LX + by * LY + z * LZ) / len);
			const shell = this.smooth(0.3, 0.95, pt.sh);
			const height = Math.min(1, Math.max(0, (by + 0.55) / 1.25));
			// steeper top-to-bottom falloff -> anvil-lit crown over a dark base
			let light = 0.02 + 0.42 * Math.pow(lam, 0.85) * (0.35 + 0.65 * shell) + 0.7 * Math.pow(height, 1.45);
			// extra depth cues, faded in with the solid body
			const aoDepth = this.smooth(-0.15, 0.75, z); // rear voxels sit in shadow
			const cavity = 1 - this.smooth(0.05, 0.6, pt.sh); // recessed pockets darken
			const rim = Math.pow(Math.max(0, -z), 1.6) * shell; // front-facing edges catch light
			const grain = (Math.sin(pt.h * 91.3 + pt.ph * 3.1) + Math.sin(pt.h * 37.7 - pt.ph)) * 0.5; // stable per-pixel dither
			const puff = Math.sin(pt.x * 5.3 + pt.ph) * Math.cos(pt.y * 6.1 - pt.ph * 0.6) * Math.cos(pt.z * 4.7); // billow lobes
			light += solid * (-0.2 * aoDepth - 0.16 * cavity + 0.14 * rim + 0.055 * grain + 0.075 * puff);
			light = Math.min(1, Math.max(0, light));
			const band = Math.min(pal.length - 1, Math.max(0, Math.floor((1 - light) * pal.length)));
			const tone = pal[band];
			const sparse = (0.34 + 0.66 * light) * (0.3 + 0.7 * this.smooth(0.62, 1.45, s));
			const a = Math.min(1, this.lerp(sparse, 1, solid) * appear * this.lerp(1, 0.94, settled));
			if (a < 0.02) continue;
			// solid body draws full tiles (hard pixel edges); the sparse speck keeps gaps
			const d = Math.max(1, Math.round(this.lerp(dot, step * (0.86 + 0.3 * s), solid))) + (flash > 0.4 ? 1 : 0);
			let e = buf[n];
			if (!e) {
				e = buf[n] = { z: 0, px: 0, py: 0, d: 0, a: 0, c: [0, 0, 0] };
			}
			e.z = z;
			e.px = px;
			e.py = py;
			e.d = d;
			e.a = a;
			e.c = tone;
			n++;
		}

		const list = buf.slice(0, n).sort((p, q) => q.z - p.z);
		for (const e of list) {
			ctx.fillStyle = this.rgb(e.c, e.a);
			ctx.fillRect(e.px, e.py, e.d, e.d);
		}

		if (flash > 0.01) {
			const r = unit * 2.1;
			const bloom = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
			bloom.addColorStop(0, 'rgba(255,255,255,' + 0.55 * flash + ')');
			bloom.addColorStop(0.45, 'rgba(226,238,252,' + 0.2 * flash + ')');
			bloom.addColorStop(1, 'rgba(226,238,252,0)');
			ctx.fillStyle = bloom;
			ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
		}

		// the strike itself: pixel channel from the cloud into the button + impact bloom
		if (this.bolt && this.flashAt) {
			const dt = now - this.flashAt;
			const bs = Math.max(3, Math.round(step * 0.9));
			// two-stroke flicker: main hit, brief re-strike
			const life =
				dt < 90
					? 1
					: dt < 240
						? 1 - (dt - 90) / 150
						: dt > 300 && dt < 430
							? 0.6 * (1 - (dt - 300) / 130)
							: 0;
			if (life > 0.02) {
				const jit = 1 + 0.25 * Math.sin(dt / 11);
				ctx.save();
				ctx.globalCompositeOperation = 'lighter';
				this.drawBoltPath(ctx, this.bolt.main, bs * 2.2, [140, 170, 235], 0.22 * life * jit);
				this.drawBoltPath(ctx, this.bolt.main, bs * 1.4, [214, 230, 255], 0.5 * life);
				for (const fk of this.bolt.forks) this.drawBoltPath(ctx, fk, bs, [226, 238, 255], 0.55 * life);
				ctx.restore();
				this.drawBoltPath(ctx, this.bolt.main, bs, [255, 255, 255], Math.min(1, life * 1.4));
			}
			const hit = Math.exp(-dt / 200);
			if (hit > 0.01 && this.target) {
				const [tx, ty] = this.target;
				const rr = Math.min(w, h) * (0.12 + 0.3 * hit);
				const gl = ctx.createRadialGradient(tx, ty, 0, tx, ty, rr);
				gl.addColorStop(0, 'rgba(255,255,255,' + (0.6 * hit).toFixed(3) + ')');
				gl.addColorStop(0.35, 'rgba(242,194,48,' + (0.34 * hit).toFixed(3) + ')');
				gl.addColorStop(1, 'rgba(242,194,48,0)');
				ctx.fillStyle = gl;
				ctx.fillRect(tx - rr, ty - rr, rr * 2, rr * 2);
				// pixel sparks kicked off the button top
				const sp = Math.max(2, Math.round(bs * 0.7));
				ctx.fillStyle = 'rgba(255,236,170,' + (0.9 * hit).toFixed(3) + ')';
				for (let idx = 0; idx < 14; idx++) {
					const ang = -Math.PI / 2 + (idx / 13 - 0.5) * 2.3;
					const d2 = (1 - hit) * Math.min(w, h) * (0.06 + (0.05 * ((idx * 37) % 11)) / 11);
					ctx.fillRect(Math.round(tx + Math.cos(ang) * d2), Math.round(ty + Math.sin(ang) * d2 * 0.9), sp, sp);
				}
			}
		}

		if (ch > 0.02) {
			const since = this.flashAt ? now - this.flashAt : 1e9;
			if (since > 520) this.drawCharge(ctx, now, ch * (since > 1400 ? 1 : (since - 520) / 880), step);
		}
	}

	// pixel sparks crawling the button edge while hovered — the charge before the strike
	drawCharge(ctx: CanvasRenderingContext2D, now: number, ch: number, step: number) {
		const box = this.btnBox();
		if (!box) return;
		const bs = Math.max(2, Math.round(step * 0.75));
		const x0 = box.x - 2;
		const y0 = box.y - 2;
		const bw = box.w + 4;
		const bh = box.h + 4;
		const per = 2 * (bw + bh);
		const at = (t: number): [number, number] => {
			let d = (((t % 1) + 1) % 1) * per;
			if (d < bw) return [x0 + d, y0];
			d -= bw;
			if (d < bh) return [x0 + bw, y0 + d];
			d -= bh;
			if (d < bw) return [x0 + bw - d, y0 + bh];
			d -= bw;
			return [x0, y0 + bh - d];
		};
		ctx.save();
		ctx.globalCompositeOperation = 'lighter';
		const n = 5;
		for (let i = 0; i < n; i++) {
			const dir = i % 2 ? -1 : 1;
			const base = (now / 2400) * dir + i / n;
			for (let k = 0; k < 7; k++) {
				const [px, py] = at(base - dir * k * 0.006);
				const a = ch * (0.85 - k * 0.11) * (0.55 + 0.45 * Math.sin(now / 41 + i * 2.1));
				if (a <= 0.02) continue;
				ctx.fillStyle = 'rgba(255,238,178,' + a.toFixed(3) + ')';
				ctx.fillRect(Math.round(px / bs) * bs, Math.round(py / bs) * bs, bs, bs);
			}
		}
		// short filaments flicking off the top edge, denser as the charge fills
		const flick = Math.floor(3 + 4 * ch);
		for (let i = 0; i < flick; i++) {
			const seed = Math.sin(i * 12.9898 + Math.floor(now / 110) * 78.233);
			const fx = x0 + bw * (0.5 + 0.5 * Math.sin(seed * 43.1));
			const len = (0.4 + 0.6 * Math.abs(seed)) * bh * 0.55 * ch;
			let cxp = fx;
			let cyp = y0;
			ctx.fillStyle = 'rgba(226,238,255,' + (0.5 * ch).toFixed(3) + ')';
			for (let s = 0; s * bs < len; s++) {
				cxp += (seed > 0 ? 1 : -1) * bs * (s % 2 ? 1 : 0);
				cyp -= bs;
				ctx.fillRect(Math.round(cxp / bs) * bs, Math.round(cyp / bs) * bs, bs, bs);
			}
		}
		ctx.restore();
	}
}

export function initStormCloud(els: Els) {
	const cloud = new StormCloud(els);
	cloud.mount();
	return cloud;
}
