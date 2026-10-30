// @refresh reset
import { useEffect, useRef, useState } from "react";
import { WalletButton, watchWallet, getConnectedProvider } from "./wallet-button";
import { AccountPanel } from "./account-auth";
import { BrandMark, SocialLinks } from "./site-frame";
import { formatDrun, rewardOf } from "@/lib/earn";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { sendClaimTransaction } from "@/lib/claim-tx";
import { getLeaderboard, getMyEarn, requestClaim, submitRun } from "@/lib/p2e";
import type { RunPayload } from "@/lib/p2e-check";

const BEST_KEY = "to-the-moon-best";
const BOARD_KEY = "to-the-moon-board";
const NAME_KEY = "to-the-moon-name";

type BoardRow = { name: string; address: string; score: number; time: number };

function loadBoard(): BoardRow[] {
  try {
    const raw = JSON.parse(localStorage.getItem(BOARD_KEY) || "[]") as BoardRow[];
    return raw.filter((row) => row && typeof row.score === "number").sort((a, b) => b.score - a.score);
  } catch {
    return [];
  }
}

function clockTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function shortAddress(address: string) {
  if (!address.startsWith("0x") || address.length < 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

type Phase = "ready" | "run" | "dead";
type Pose = "run" | "rise" | "air" | "land" | "squash";

type Obstacle = {
  x: number;
  kind: "block" | "node" | "wallet" | "chain" | "contract" | "hash" | "miner" | "gas" | "nft" | "dao" | "validator" | "mempool" | "elon-rocket" | "doge-space";
  w: number;
  h: number;
  lift: number;
  alive: boolean;
  near: boolean;
};

type Pickup = { x: number; y: number; kind: "coin" | "bone" | "shield" | "magnet"; alive: boolean; got: boolean };

type Floater = { x: number; y: number; text: string; life: number };

type Dust = { x: number; y: number; vx: number; vy: number; life: number; max: number };

const CHEERS = ["BONE!", "NOM!", "GOOD BOY", "FETCH!"];
const WOWS = ["MUCH WOW", "SO COIN", "VERY FAST", "TO THE MOON"];
const QUIPS = [
  "A block got in the way.",
  "Even good boys trip.",
  "The node was offline.",
  "The contract reverted.",
  "The miner found a block.",
  "Gas fees spiked.",
  "The NFT floor dropped.",
  "The DAO voted no.",
  "The validator slashed.",
  "Stuck in the mempool.",
  "Elon flew past you.",
  "The space doge dodged.",
  "So close to orbit.",
];

const RUN_SRC = Array.from({ length: 18 }, (_, i) => `/sprites/smooth-run-${i + 1}.png?v=9`);
const JUMP_SRC = Array.from({ length: 22 }, (_, i) => `/sprites/smooth-jump-${i + 1}.png?v=8`);
const IDLE_SRC = "/sprites/smooth-idle-1.png?v=1";

const JUMP_V = -620;
const GRAVITY_RISE = 1420;
const GRAVITY_FALL = 1980;
const FAST_CUT = 5600;
const FAST_FALL = 5200;

function loadImage(src: string) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = src;
  return img;
}

function ease(t: number) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

export function MoonRunner() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const jumpRef = useRef<() => void>(() => {});
  const sprintRef = useRef(false);
  const dropRef = useRef(false);
  const [sprintOn, setSprintOn] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [soundOn, setSoundOn] = useState(true);
  const [musicOn, setMusicOn] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const soundOnRef = useRef(true);
  const musicOnRef = useRef(true);
  const audioRef = useRef<{ ctx: AudioContext | null; sfx: GainNode | null } | null>(null);
  const musicRef = useRef<{ gain: GainNode | null; nodes: OscillatorNode[] } | null>(null);
  const [playerName, setPlayerName] = useState("Doge");
  const [board, setBoard] = useState<BoardRow[]>([]);
  const nameRef = useRef("Doge");
  const walletRef = useRef("Not connected");
  const claimAfterConnect = useRef(false);
  const claimRef = useRef<() => void>(() => {});
  const { user } = useCurrentUserState();
  const userIdRef = useRef<string | null>(null);
  userIdRef.current = user?.id ?? null;
  const pendingRunRef = useRef<RunPayload | null>(null);
  const bankRef = useRef<(run: RunPayload) => void>(() => {});
  const [hud, setHud] = useState({
    score: 0,
    dist: 0,
    coins: 0,
    bones: 0,
    best: 0,
    phase: "ready" as Phase,
    pace: 1,
    quip: "",
    drun: 0,
    combo: 0,
  });
  const [earned, setEarned] = useState(0);
  const [payout, setPayout] = useState({ credited: 0, capped: false, waiting: 0 });
  const [claimNote, setClaimNote] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(NAME_KEY);
      if (saved) {
        setPlayerName(saved);
        nameRef.current = saved;
      }
      setBoard(loadBoard());
    } catch {
      /* ignore */
    }
    const onBoard = (event: Event) => setBoard((event as CustomEvent<BoardRow[]>).detail);
    const onRun = (event: Event) => {
      const run = (event as CustomEvent<RunPayload>).detail;
      const amount = rewardOf(run.dist, run.coins, run.bones);
      if (!userIdRef.current) {
        pendingRunRef.current = run;
        setPayout({ credited: 0, capped: false, waiting: amount });
        setClaimNote("Sign in to put this run on the shared board and claim it.");
        return;
      }
      setPayout({ credited: amount, capped: false, waiting: 0 });
      setClaimNote("Checking the run…");
      bankRef.current(run);
    };
    window.addEventListener("moon-board", onBoard);
    window.addEventListener("moon-run", onRun);
    void getLeaderboard()
      .then((rows) => {
        if (rows.length) setBoard(rows);
      })
      .catch(() => {});
    const stop = watchWallet((snap) => {
      const address = snap?.address ?? "Not connected";
      walletRef.current = address;
      if (address.startsWith("0x") && claimAfterConnect.current) {
        claimAfterConnect.current = false;
        claimRef.current();
      }
    });
    return () => {
      window.removeEventListener("moon-board", onBoard);
      window.removeEventListener("moon-run", onRun);
      stop();
    };
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    void getMyEarn()
      .then((earn) => setEarned(earn.balance))
      .catch(() => {});
    const pending = pendingRunRef.current;
    if (!pending) return;
    pendingRunRef.current = null;
    bankRef.current(pending);
  }, [user?.id]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const runImgs = RUN_SRC.map(loadImage);
    const jumpImgs = JUMP_SRC.map(loadImage);
    const idleImg = loadImage(IDLE_SRC);
    const rockImgs = [1, 2, 3, 4].map((i) => loadImage(`/sprites/rock-${i}.png?v=1`));
    const coinImg = loadImage("/sprites/coin.png?v=6");
    const earthImg = loadImage("/sprites/earth.jpg?v=3");

    let best = 0;
    try {
      best = Number(localStorage.getItem(BEST_KEY) || 0) || 0;
    } catch {
      best = 0;
    }

    const view = { w: 960, h: 540 };
    let phase: Phase = "ready";
    let camera = 0;
    let speed = 760;
    let runT = 0;
    let boost = false;
    let score = 0;
    let coins = 0;
    let bones = 0;
    let quip = "";
    let dist = 0;
    let vy = 0;
    let y = view.h * 0.78;
    let grounded = true;
    let coyote = 0;
    let buffer = 0;
    let pose: Pose = "run";
    let shown: Pose = "run";
    let prev: Pose = "run";
    let blend = 1;
    let poseLock = 0;
    let anim = 0;
    let jumpT = 0;
    let spawnAt = 900;
    let lastKind: Obstacle["kind"] | null = null;
    let shake = 0;
    let hudAcc = 0;
    let jumpGate = 0;
    let coach = true;
    let coinStreak = 0;
    let lastPattern = -1;
    let lastGag = -1;
    let wave = 0;
    let clock = 0;
    let nextRocket = 0;
    let rocketFlight = 0.28;
    const stars = Array.from({ length: 78 }, (_, i) => {
      const a = Math.sin(i * 12.9898) * 43758.5453;
      const b = Math.sin(i * 78.233) * 24634.6345;
      const fa = a - Math.floor(a);
      const fb = b - Math.floor(b);
      return {
        x: fa * 960,
        y: fb * 250,
        r: fa > 0.86 ? 1.8 : fa > 0.55 ? 1.25 : 0.7,
        tw: fb * Math.PI * 2,
      };
    });
    let bodySx = 1;
    let bodySy = 1;
    let lean = 0;
    const obstacles: Obstacle[] = Array.from({ length: 14 }, () => ({
      x: 0,
      kind: "block" as const,
      w: 100,
      h: 168,
      lift: 0,
      alive: false,
      near: false,
    }));
    const pickups: Pickup[] = Array.from({ length: 72 }, () => ({
      x: 0,
      y: 0,
      kind: "coin" as const,
      alive: false,
      got: false,
    }));
    const floaters: Floater[] = [];
    const dust: Dust[] = [];
    const pads: { x: number; alive: boolean }[] = Array.from({ length: 6 }, () => ({ x: 0, alive: false }));
    let dustT = 0;
    let tricks = 0;
    let airJumps = 0;
    let shield = false;
    let magnet = 0;
    let grace = 0;

    const ground = () => view.h * 0.78;
    const feetScreen = 210;

    const keys = new Set<string>();

    const audio = { ctx: null as AudioContext | null, sfx: null as GainNode | null };
    const tone = (freq: number, dur: number, type: OscillatorType = "sine", vol = 0.08, delay = 0) => {
      if (!soundOnRef.current) return;
      const ac = audio.ctx;
      const bus = audio.sfx;
      if (!ac || !bus) return;
      if (ac.state === "suspended") void ac.resume();
      const t0 = ac.currentTime + delay;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.001, vol), t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(bus);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
      o.onended = () => {
        o.disconnect();
        g.disconnect();
      };
    };

    const coinSound = (n: number) => {
      const step = n % 12;
      const f = 680 + step * 42;
      tone(f, 0.07, "square", 0.045);
      tone(f * 1.5, 0.16, "sine", 0.12);
    };

    const music = { gain: null as GainNode | null, nodes: [] as OscillatorNode[] };
    audioRef.current = audio;
    musicRef.current = music;
    const startMusic = () => {
      if (!audio.ctx || music.nodes.length) return;
      const ac = audio.ctx;
      music.gain = ac.createGain();
      music.gain.gain.value = musicOnRef.current ? 0.08 : 0;
      music.gain.connect(ac.destination);
      const notes = [220, 277, 330, 220];
      notes.forEach((freq, i) => {
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = "sine";
        o.frequency.value = freq;
        g.gain.value = 0.15;
        o.connect(g);
        g.connect(music.gain!);
        o.start();
        music.nodes.push(o);
      });
    };
    const stopMusic = () => {
      music.nodes.forEach((o) => { try { o.stop(); o.disconnect(); } catch {} });
      music.nodes = [];
      if (music.gain) { try { music.gain.disconnect(); } catch {} music.gain = null; }
    };
    const unlock = () => {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audio.ctx) {
        audio.ctx = new AC({ latencyHint: "interactive" });
        audio.sfx = audio.ctx.createGain();
        audio.sfx.gain.value = soundOnRef.current ? 0.95 : 0;
        audio.sfx.connect(audio.ctx.destination);
      }
      if (audio.ctx.state === "suspended") void audio.ctx.resume();
      if (musicOnRef.current && !music.nodes.length) startMusic();
    };

    const puff = (n: number, power: number) => {
      const gY = ground();
      for (let i = 0; i < n; i++) {
        dust.push({
          x: camera + feetScreen - 18 + Math.random() * 16,
          y: gY - 2,
          vx: -30 - Math.random() * power,
          vy: -20 - Math.random() * 40,
          life: 0.28 + Math.random() * 0.2,
          max: 0.45,
        });
      }
    };

    const reset = () => {
      phase = "run";
      camera = 0;
      speed = 760;
      runT = 0;
      score = 0;
      coins = 0;
      bones = 0;
      quip = "";
      dist = 0;
      vy = 0;
      y = ground();
      grounded = true;
      coyote = 0;
      buffer = 0;
      pose = "run";
      shown = "run";
      prev = "run";
      blend = 1;
      poseLock = 0;
      anim = 0;
      jumpT = 0;
      spawnAt = 1200;
      lastKind = null;
      shake = 0;
      coach = true;
      coinStreak = 0;
      lastPattern = -1;
      lastGag = -1;
      wave = 0;
      bodySx = 1;
      bodySy = 1;
      lean = 0;
      obstacles.forEach((o) => {
        o.alive = false;
        o.near = false;
      });
      pads.forEach((p) => (p.alive = false));
      tricks = 0;
      airJumps = 0;
      shield = false;
      magnet = 0;
      grace = 0;
      pickups.forEach((c) => {
        c.alive = false;
        c.got = false;
      });
      floaters.length = 0;
      dust.length = 0;
      spawnTreats(560, 190);
      spawnAt = 1500;
      wave = 0;
      setHud((h) => ({
        ...h,
        score: 0,
        dist: 0,
        coins: 0,
        bones: 0,
        phase: "run",
        pace: 1,
        quip: "",
        drun: 0,
        combo: 0,
      }));
    };

    const tryJump = () => {
      if (phase !== "run") return;
      if (grounded || coyote > 0) {
        vy = JUMP_V;
        grounded = false;
        airJumps = 1;
        coyote = 0;
        buffer = 0;
        pose = "rise";
        poseLock = 0.08;
        jumpT = 0;
        coach = false;
        tone(620, 0.08, "sine", 0.04);
        tone(880, 0.1, "triangle", 0.03);
      } else if (airJumps < 2) {
        vy = JUMP_V * 0.88;
        airJumps = 2;
        buffer = 0;
        pose = "rise";
        poseLock = 0.08;
        jumpT = 0.2;
        floaters.push({ x: camera + feetScreen, y: y - 80, text: "DOUBLE!", life: 0.55 });
        tone(760, 0.07, "square", 0.04);
        tone(1040, 0.1, "sine", 0.05);
      }
    };

    const requestJump = () => {
      unlock();
      if (phase === "ready" || phase === "dead") {
        reset();
        jumpGate = 0.28;
        return;
      }
      if (jumpGate > 0) return;
      buffer = 0.18;
      tryJump();
    };

    const placePickup = (kind: "coin" | "bone" | "shield" | "magnet", x: number, y: number) => {
      const slot = pickups.find((c) => !c.alive);
      if (!slot) return;
      const gY = ground();
      const yClamped = Math.max(gY - 280, Math.min(gY - 56, y));
      const inside = obstacles.some((o) => {
        if (!o.alive || x <= o.x - 6 || x >= o.x + o.w + 6) return false;
        const top = gY - o.lift - o.h;
        const bottom = gY - o.lift;
        return yClamped > top - 28 && yClamped < bottom + 16;
      });
      if (inside) return;
      slot.kind = kind;
      slot.x = x;
      slot.y = yClamped;
      slot.alive = true;
      slot.got = false;
    };

    const spawnTreats = (x: number, _pace: number) => {
      const gY = ground();
      const road = gY - 58;
      const hop = gY - 148;
      let pick = Math.floor(Math.random() * 4);
      if (pick === lastPattern) pick = (pick + 1) % 4;
      lastPattern = pick;
      const step = 70;
      if (pick === 0) {
        for (let i = 0; i < 8; i++) placePickup("coin", x + i * step, road);
        placePickup("bone", x + 8 * step, road);
      } else if (pick === 1) {
        for (let i = 0; i < 4; i++) placePickup("coin", x + i * step, road);
        for (let i = 0; i < 4; i++) placePickup(i === 2 ? "bone" : "coin", x + (4 + i) * step, hop);
        for (let i = 0; i < 3; i++) placePickup("coin", x + (8 + i) * step, road);
      } else if (pick === 2) {
        const n = 9;
        for (let i = 0; i < n; i++) {
          const t = i / (n - 1);
          const y = road - Math.sin(t * Math.PI) * 100;
          placePickup(i === 4 ? "bone" : "coin", x + i * 64, y);
        }
      } else {
        for (let i = 0; i < 6; i++) {
          placePickup("coin", x + i * 78, road);
          placePickup(i === 3 ? "bone" : "coin", x + i * 78, hop);
        }
      }
    };

    const spawnObstacle = (x: number, force?: Obstacle["kind"], lift = 0) => {
      const slot = obstacles.find((o) => !o.alive);
      if (!slot) return;
      const kinds: Obstacle["kind"][] =
        dist < 80 ? ["block", "node", "wallet", "chain", "miner", "gas"] : ["block", "node", "wallet", "chain", "contract", "hash", "miner", "gas", "nft", "dao", "validator", "mempool", "elon-rocket", "doge-space"];
      let kind = force ?? kinds[Math.floor(Math.random() * kinds.length)];
      if (!force && kind === "hash" && (dist < 140 || lastKind === "hash")) kind = "block";
      if (!force && kind === lastKind) kind = kinds[(kinds.indexOf(kind) + 2) % kinds.length];
      const size = {
          block: [140, 180],
          hash: [150, 110],
          wallet: [130, 140],
          chain: [160, 100],
          contract: [120, 160],
          node: [120, 120],
          miner: [130, 150],
          gas: [100, 90],
          nft: [110, 140],
          dao: [140, 120],
          validator: [120, 160],
          mempool: [150, 80],
          "elon-rocket": [200, 100],
          "doge-space": [140, 140],
      }[kind];
      slot.kind = kind;
      slot.x = x;
      slot.w = size[0];
      slot.h = size[1];
      slot.lift = kind === "contract" ? Math.max(lift, 128) : lift;
      slot.alive = true;
      slot.near = false;
      lastKind = kind;
    };

    const placeGag = (x: number) => {
      const gY = ground();
      const road = gY - 58;
      const hop = gY - 160;
      const pool: Obstacle["kind"][] =
        dist < 90 ? ["block", "node", "wallet", "chain", "miner", "gas"] : ["block", "node", "wallet", "chain", "contract", "miner", "nft", "dao", "validator"];
      if (dist > 220 && Math.random() < 0.25) pool.push("hash");
      let pick = Math.floor(Math.random() * pool.length);
      if (pick === lastGag) pick = (pick + 1) % pool.length;
      lastGag = pick;
      const kind = pool[pick];
      spawnObstacle(x + 420, kind, kind === "contract" ? 180 : 0);
      for (let i = 0; i < 5; i++) placePickup("coin", x + 24 + i * 64, road);
      placePickup("coin", x + 300, hop);
      placePickup("bone", x + 360, gY - (kind === "hash" ? 300 : kind === "block" ? 250 : 200));
      placePickup("coin", x + 470, hop);
      for (let i = 0; i < 3; i++) placePickup("coin", x + 560 + i * 68, road);
    };

    jumpRef.current = requestJump;

    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest("input, textarea");
      if (typing) return;
      if (["Space", "ArrowUp", "ArrowDown", "ArrowRight", "KeyW", "KeyS", "KeyD"].includes(e.code)) e.preventDefault();
      if (e.type === "keydown") unlock();
      if (e.type === "keydown" && !e.repeat) keys.add(e.code);
      if (e.type === "keydown" && (e.code === "KeyP" || e.code === "Escape")) {
        e.preventDefault();
        pausedRef.current = !pausedRef.current;
        setPaused(pausedRef.current);
        return;
      }
      if (e.type === "keydown" && (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW")) requestJump();
      if (e.type === "keyup") keys.delete(e.code);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);

    const onPointer = (e: PointerEvent) => {
      unlock();
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-no-jump]")) return;
      requestJump();
    };
    wrap.addEventListener("pointerdown", onPointer);

    let last = performance.now();
    let acc = 0;
    let raf = 0;
    const step = 1 / 60;
    let lastGood: HTMLImageElement | null = null;
    const blendCanvas = document.createElement("canvas");
    blendCanvas.width = 320;
    blendCanvas.height = 320;
    const blendCtx = blendCanvas.getContext("2d");
    let dropping = false;

    const simulate = (dt: number) => {
      clock += dt;
      boost = sprintRef.current || keys.has("ArrowRight") || keys.has("KeyD");
      dropping =
        phase === "run" && !grounded && (dropRef.current || keys.has("ArrowDown") || keys.has("KeyS"));
      if (jumpGate > 0) jumpGate = Math.max(0, jumpGate - dt);

      if (pose !== shown) {
        prev = shown;
        shown = pose;
        blend = 0;
      }
      blend = Math.min(1, blend + dt * 9);

      const damp = 1 - Math.exp(-16 * dt);
      let targetSx = 1;
      let targetSy = 1;
      let targetLean = phase === "run" && grounded ? 0.01 : phase === "run" && vy < 0 ? -0.04 : phase === "run" ? 0.02 : 0;
      if (dropping) {
        targetLean = 0.18;
        targetSy = 0.9;
        targetSx = 1.08;
      } else if (!grounded) {
        const lift = Math.max(-1, Math.min(1, -vy / 760));
        targetSy = 1 + lift * 0.08;
        targetSx = 1 - lift * 0.05;
      } else if (pose === "squash") {
        targetSy = 0.84;
        targetSx = 1.12;
        targetLean = 0.01;
      }
      bodySx += (targetSx - bodySx) * damp;
      bodySy += (targetSy - bodySy) * damp;
      lean += (targetLean - lean) * damp;

      nextRocket -= dt;
      if (rocketFlight < 0 && nextRocket <= 0) rocketFlight = 0;
      if (rocketFlight >= 0) {
        rocketFlight += dt / 6.5;
        if (rocketFlight >= 1) {
          rocketFlight = -1;
          nextRocket = 7 + Math.random() * 5;
        }
      }

      if (phase !== "run") {
        anim += (dt / 0.75) * runImgs.length;
        for (let i = floaters.length - 1; i >= 0; i--) {
          floaters[i].life -= dt;
          floaters[i].y -= 28 * dt;
          if (floaters[i].life <= 0) floaters.splice(i, 1);
        }
        for (let i = dust.length - 1; i >= 0; i--) {
          dust[i].life -= dt;
          if (dust[i].life <= 0) dust.splice(i, 1);
        }
        return;
      }

      score = Math.floor(dist) + coins * 15 + bones * 30 + tricks * 40;
      const target = Math.min(1040, 760 + dist * 1.8);
      speed += (target - speed) * Math.min(1, dt * 1.1);
      const pace = speed * (boost ? 1.34 : 1);
      camera += pace * dt;
      dist = camera / 46;
      runT += dt;

      if (grounded) coyote = 0.24;
      else coyote = Math.max(0, coyote - dt);
      if (buffer > 0) {
        buffer -= dt;
        tryJump();
      }

      let gravity = vy < 0 ? GRAVITY_RISE : GRAVITY_FALL;
      if (!dropping && Math.abs(vy) < 160) gravity *= 0.48;
      if (dropping) gravity = vy < 80 ? FAST_CUT : FAST_FALL;
      vy = Math.min(dropping ? 1400 : 1040, vy + gravity * dt);
      y += vy * dt;
      const ceiling = 228;
      if (y < ceiling) {
        y = ceiling;
        if (vy < 0) vy = 0;
      }
      const gY = ground();
      if (y >= gY) {
        const wasAir = !grounded;
        const hard = dropping || vy > 760;
        y = gY;
        vy = 0;
        grounded = true;
        airJumps = 0;
        jumpT = 0;
        if (wasAir) {
          pose = "squash";
          poseLock = hard ? 0.04 : 0.03;
          puff(7, 120);
          tone(210, 0.07, "sine", 0.035);
        }
      } else {
        grounded = false;
        jumpT += dt;
      }

      if (poseLock > 0) poseLock -= dt;
      else if (!grounded) {
        if (vy < -220) pose = "rise";
        else if (vy < 240) pose = "air";
        else pose = "land";
      } else if (pose !== "run") {
        pose = "run";
      }

      const gait = 0.75 * (760 / Math.max(280, pace));
      anim += (dt / gait) * runImgs.length;

      if (grounded && pose === "run") {
        dustT -= dt;
        if (dustT <= 0) {
          dustT = boost ? 0.07 : 0.11;
          dust.push({
            x: camera + feetScreen - 26,
            y: gY - 3,
            vx: -50 - Math.random() * 70,
            vy: -8,
            life: 0.32,
            max: 0.32,
          });
        }
      }
      for (let i = dust.length - 1; i >= 0; i--) {
        const p = dust[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        if (p.life <= 0) dust.splice(i, 1);
      }

      if (coinStreak > 0) coinStreak = Math.max(0, coinStreak - dt * 1.4);
      if (magnet > 0) magnet = Math.max(0, magnet - dt);
      if (grace > 0) grace = Math.max(0, grace - dt);
      if (spawnAt < camera + view.w + 60) {
        if (wave % 3 !== 2) spawnTreats(spawnAt, pace);
        else placeGag(spawnAt);
        if (wave > 1 && wave % 4 === 3) {
          const pad = pads.find((p) => !p.alive);
          if (pad) {
            pad.x = spawnAt + 260;
            pad.alive = true;
          }
        }
        if (wave > 2 && wave % 5 === 0) {
          placePickup(wave % 10 === 0 ? "shield" : "magnet", spawnAt + 140, ground() - 150);
        }
        wave += 1;
        spawnAt += Math.max(1680, 1500 + pace * 0.35);
      }

      const px = camera + feetScreen;
      const box = { l: px - 16, r: px + 26, t: y - 46, b: y - 14 };

      for (const o of obstacles) {
        if (!o.alive) continue;
        if (o.x + o.w < camera - 60) {
          o.alive = false;
          continue;
        }
        const ol = o.x + o.w * 0.34;
        const or = o.x + o.w * 0.66;
        const ot = gY - o.lift - o.h * 0.72;
        const ob = gY - o.lift - 8;
        const over = box.l < or && box.r > ol;
        if (phase === "run" && !o.near && !grounded && over && box.b < ot && ot - box.b < 42) {
          o.near = true;
          tricks += 1;
          floaters.push({ x: o.x + o.w * 0.4, y: ot - 16, text: "SO CLOSE!", life: 0.7 });
          tone(780, 0.07, "square", 0.04);
          tone(1040, 0.1, "sine", 0.05);
        }
        if (phase === "run" && grace <= 0 && over && box.t < ob && box.b > ot) {
          if (shield) {
            shield = false;
            grace = 0.75;
            o.alive = false;
            vy = Math.min(vy, -460);
            grounded = false;
            airJumps = 1;
            floaters.push({ x: o.x, y: ot - 20, text: "SHIELD POP", life: 0.7 });
            tone(220, 0.08, "square", 0.05);
            tone(440, 0.12, "sine", 0.06);
            puff(8, 140);
          } else {
          phase = "dead";
          shake = 0.32;
          pose = "squash";
          quip = QUIPS[Math.floor(Math.random() * QUIPS.length)];
          const row: BoardRow = {
            name: nameRef.current.trim() || "Doge",
            address: walletRef.current,
            score,
            time: runT,
          };
          const key = `${row.name}|${row.address}`;
          const rows = loadBoard();
          const prev = rows.find((item) => `${item.name}|${item.address}` === key);
          const bestRow = prev && prev.score >= row.score ? prev : row;
          const ranked = [...rows.filter((item) => `${item.name}|${item.address}` !== key), bestRow]
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);
          try {
            localStorage.setItem(BOARD_KEY, JSON.stringify(ranked));
          } catch {
            /* ignore */
          }
          window.dispatchEvent(new CustomEvent("moon-board", { detail: ranked }));
          window.dispatchEvent(
            new CustomEvent("moon-run", {
              detail: {
                name: nameRef.current.trim() || "Doge",
                dist: Math.floor(dist),
                coins,
                bones,
                tricks,
                score,
                durationMs: Math.max(1, Math.round(runT * 1000)),
              },
            }),
          );
          if (score > best) {
            best = score;
            try {
              localStorage.setItem(BEST_KEY, String(best));
            } catch {
              /* ignore */
            }
          }
          tone(160, 0.22, "triangle", 0.05);
          }
        }
      }

      for (const c of pickups) {
        if (!c.alive || c.got) continue;
        if (c.x < camera - 40) {
          c.alive = false;
          continue;
        }
        const magnetOn = magnet > 0 && c.kind === "coin";
        const headTop = y + 6 - 200 * 0.92;
        const bodyBottom = y - 2;
        const bodyLeft = px - 78;
        const bodyRight = px + 86;
        const aimX = px + 6;
        const aimY = y - 130;
        const dx = c.x - aimX;
        const dy = c.y - aimY;
        const reachX = magnetOn ? 340 : 150;
        const reachY = magnetOn ? 260 : 220;
        if (Math.abs(dx) < reachX && Math.abs(dy) < reachY) {
          const pull = Math.min(1, dt * (magnetOn ? 7 : 24));
          c.x += (aimX - c.x) * pull;
          c.y += (aimY - c.y) * pull;
        }
        const coinR = c.kind === "coin" ? 44 : 50;
        const nearX = Math.max(bodyLeft, Math.min(c.x, bodyRight));
        const nearY = Math.max(headTop, Math.min(c.y, bodyBottom));
        const hx = c.x - nearX;
        const hy = c.y - nearY;
        if (hx * hx + hy * hy <= coinR * coinR) {
          c.got = true;
          c.alive = false;
          if (c.kind === "bone") {
            bones += 1;
            coinStreak = 0;
            tone(523, 0.08, "triangle", 0.08);
            tone(784, 0.16, "sine", 0.11);
            floaters.push({
              x: c.x,
              y: c.y,
              text: CHEERS[Math.floor(Math.random() * CHEERS.length)],
              life: 0.75,
            });
          } else if (c.kind === "shield") {
            shield = true;
            floaters.push({ x: c.x, y: c.y, text: "SHIELD", life: 0.75 });
            tone(660, 0.1, "sine", 0.06);
            tone(990, 0.14, "triangle", 0.05);
          } else if (c.kind === "magnet") {
            magnet = 5.5;
            floaters.push({ x: c.x, y: c.y, text: "MAGNET", life: 0.75 });
            tone(480, 0.08, "square", 0.04);
            tone(720, 0.14, "sine", 0.06);
          } else {
            coins += 1;
            coinStreak += 1;
            coinSound(Math.floor(coinStreak));
            if (coins % 5 === 0) {
              floaters.push({
                x: c.x,
                y: c.y - 18,
                text: coinStreak >= 8 ? "MEGA COMBO" : WOWS[Math.floor(Math.random() * WOWS.length)],
                life: 0.8,
              });
              tone(880, 0.1, "triangle", 0.05);
            }
          }
        }
      }

      for (const pad of pads) {
        if (!pad.alive) continue;
        if (pad.x < camera - 50) {
          pad.alive = false;
          continue;
        }
        if (phase === "run" && grounded && Math.abs(px - pad.x) < 34) {
          pad.alive = false;
          vy = JUMP_V * 1.18;
          grounded = false;
          coyote = 0;
          pose = "rise";
          poseLock = 0.14;
          coins += 2;
          tricks += 1;
          floaters.push({ x: pad.x, y: gY - 90, text: "TO THE MOON!", life: 0.95 });
          tone(520, 0.08, "square", 0.05);
          tone(780, 0.12, "triangle", 0.06);
          tone(1170, 0.2, "sine", 0.08);
          puff(12, 180);
        }
      }

      for (let i = floaters.length - 1; i >= 0; i--) {
        floaters[i].life -= dt;
        floaters[i].y -= 36 * dt;
        if (floaters[i].life <= 0) floaters.splice(i, 1);
      }
    };

    const render = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = Math.max(1, wrap.clientWidth || 640);
      const cssH = Math.max(1, wrap.clientHeight || 360);
      const nextW = Math.floor(cssW * dpr);
      const nextH = Math.floor(cssH * dpr);
      if (canvas.width !== nextW || canvas.height !== nextH) {
        canvas.width = nextW;
        canvas.height = nextH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const scale = Math.min(cssW / view.w, cssH / view.h);
      const ox = (cssW - view.w * scale) / 2;
      const oy = Math.max(0, cssH - view.h * scale);
      ctx.fillStyle = "#071426";
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(scale, scale);

      if (shake > 0) ctx.translate(Math.sin(shake * 48) * shake * 18, 0);

      const sky = ctx.createLinearGradient(0, 0, 0, view.h);
      sky.addColorStop(0, "#071426");
      sky.addColorStop(0.42, "#16345f");
      sky.addColorStop(0.72, "#3d6ea5");
      sky.addColorStop(1, "#f0b56b");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, view.w, view.h);

      for (const star of stars) {
        const tw = 0.45 + Math.abs(Math.sin(clock * 1.4 + star.tw)) * 0.55;
        ctx.globalAlpha = tw;
        ctx.fillStyle = "#fffaf0";
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      const trip = Math.min(1, dist / 280);
      const earthX = 188 - trip * 80;
      const earthY = 196 + trip * 28;
      const earthR = 132 - trip * 78;
      ctx.save();
      ctx.beginPath();
      ctx.arc(earthX, earthY, earthR + 12, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(120, 196, 255, 0.35)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(earthX, earthY, earthR, 0, Math.PI * 2);
      ctx.clip();
      if (earthImg.complete && earthImg.naturalWidth) {
        ctx.drawImage(earthImg, earthX - earthR, earthY - earthR, earthR * 2, earthR * 2);
      } else {
        ctx.fillStyle = "#1a74c4";
        ctx.fillRect(earthX - earthR, earthY - earthR, earthR * 2, earthR * 2);
      }
      ctx.restore();

      const moonX = 760 - trip * 40;
      const moonY = 150 - trip * 16;
      const moonR = 78 + trip * 82;
      const glow = ctx.createRadialGradient(moonX, moonY, moonR * 0.4, moonX, moonY, moonR * 1.85);
      glow.addColorStop(0, "rgba(244, 236, 214, 0.38)");
      glow.addColorStop(1, "rgba(244, 236, 214, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(moonX, moonY, moonR * 1.85, 0, Math.PI * 2);
      ctx.fill();
      const disc = ctx.createRadialGradient(moonX - 28, moonY - 30, 12, moonX, moonY, moonR);
      disc.addColorStop(0, "#f7f1e4");
      disc.addColorStop(0.55, "#e4d8c0");
      disc.addColorStop(1, "#b7ab93");
      ctx.fillStyle = disc;
      ctx.beginPath();
      ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "rgba(92, 84, 70, 0.38)";
      ctx.beginPath();
      ctx.ellipse(moonX - 18, moonY + 8, 46, 34, -0.4, 0, Math.PI * 2);
      ctx.ellipse(moonX + 36, moonY - 22, 28, 18, 0.3, 0, Math.PI * 2);
      ctx.ellipse(moonX - 40, moonY - 36, 22, 16, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(120, 110, 94, 0.55)";
      ctx.lineWidth = 1.5;
      const craters: [number, number, number][] = [
        [-46, 18, 16],
        [20, 34, 12],
        [48, -8, 9],
        [-10, -48, 8],
        [8, 6, 6],
        [-30, 48, 7],
      ];
      for (const [cx, cy, cr] of craters) {
        ctx.beginPath();
        ctx.arc(moonX + cx, moonY + cy, cr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "rgba(90, 82, 68, 0.18)";
        ctx.fill();
      }
      ctx.fillStyle = "rgba(40, 36, 30, 0.08)";
      ctx.beginPath();
      ctx.arc(moonX + 46, moonY + 8, moonR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      if (rocketFlight >= 0) {
        const t = rocketFlight;
        const fade = Math.min(1, t / 0.08) * Math.min(1, (1 - t) / 0.12);
        const px = 70 + t * (view.w - 180);
        const py = 132 + Math.sin(t * Math.PI) * -36;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(px, py);
        ctx.rotate(-0.22);
        const flick = 0.65 + Math.abs(Math.sin(clock * 22)) * 0.55;
        ctx.fillStyle = "#ff7a18";
        ctx.beginPath();
        ctx.moveTo(-16, 28);
        ctx.quadraticCurveTo(0, 28 + 54 * flick, 16, 28);
        ctx.fill();
        ctx.fillStyle = "#ffe08a";
        ctx.beginPath();
        ctx.moveTo(-8, 26);
        ctx.quadraticCurveTo(0, 26 + 28 * flick, 8, 26);
        ctx.fill();
        ctx.fillStyle = "#f4f7fb";
        ctx.beginPath();
        ctx.roundRect(-22, -46, 44, 78, 22);
        ctx.fill();
        ctx.fillStyle = "#e23b3b";
        ctx.beginPath();
        ctx.moveTo(-22, 18);
        ctx.lineTo(-40, 40);
        ctx.lineTo(-10, 24);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(22, 18);
        ctx.lineTo(40, 40);
        ctx.lineTo(10, 24);
        ctx.fill();
        ctx.fillStyle = "#f2c14e";
        ctx.beginPath();
        ctx.moveTo(0, -68);
        ctx.lineTo(16, -28);
        ctx.lineTo(-16, -28);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#9ad7ff";
        ctx.beginPath();
        ctx.arc(0, -8, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#c9864a";
        ctx.beginPath();
        ctx.arc(-12, -16, 6, 0, Math.PI * 2);
        ctx.arc(12, -16, 6, 0, Math.PI * 2);
        ctx.arc(0, -6, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#1b140f";
        ctx.beginPath();
        ctx.arc(-3, -8, 1.3, 0, Math.PI * 2);
        ctx.arc(3, -8, 1.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#1b140f";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(0, -4, 3.2, 0.2, Math.PI - 0.2);
        ctx.stroke();
        const wave = Math.sin(clock * 8);
        ctx.strokeStyle = "#c9864a";
        ctx.lineWidth = 4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(14, 2);
        ctx.quadraticCurveTo(28, -8 + wave * 8, 30, -18 + wave * 10);
        ctx.stroke();
        ctx.restore();
      }

      const gY = ground();
      ctx.fillStyle = "#0c1422";
      ctx.fillRect(0, gY, view.w, view.h - gY);
      ctx.fillStyle = "#152033";
      ctx.fillRect(0, gY + 46, view.w, view.h - gY - 46);
      const grid = (camera * 0.72) % 84;
      ctx.strokeStyle = "rgba(94, 224, 255, 0.16)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 7; i++) {
        const gy = gY + 10 + i * 18;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(view.w, gy);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(245, 196, 81, 0.2)";
      for (let x = -grid; x < view.w; x += 84) {
        ctx.beginPath();
        ctx.moveTo(x, gY);
        ctx.lineTo(x, view.h);
        ctx.stroke();
        ctx.fillStyle = "rgba(94, 224, 255, 0.85)";
        ctx.beginPath();
        ctx.arc(x, gY + 28, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#f5c451";
      ctx.fillRect(0, gY, view.w, 3);
      ctx.fillStyle = "#3ec8ef";
      ctx.fillRect(0, gY + 3, view.w, 2);
      const dash = (camera * 0.9) % 96;
      ctx.fillStyle = "rgba(94, 224, 255, 0.9)";
      for (let x = -dash; x < view.w; x += 96) ctx.fillRect(x, gY + 24, 40, 4);
      ctx.font = "700 14px Outfit, sans-serif";
      ctx.textAlign = "left";
      const marks = ["BLOCK", "NODE", "HASH", "CHAIN", "WALLET", "CONTRACT"];
      for (let i = 0; i < marks.length; i++) {
        const x = ((((i * 220 - camera * 0.48) % 1320) + 1320) % 1320) - 80;
        ctx.fillStyle = i % 2 === 0 ? "rgba(245, 196, 81, 0.45)" : "rgba(94, 224, 255, 0.4)";
        ctx.fillText(marks[i], x, gY + 58);
      }

      const shade = ctx.createLinearGradient(0, 0, 0, view.h);
      shade.addColorStop(0, "rgba(90, 150, 200, 0.08)");
      shade.addColorStop(0.35, "rgba(90, 150, 200, 0)");
      shade.addColorStop(1, "rgba(180, 120, 60, 0.08)");
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, view.w, view.h);

      for (const p of dust) {
        const sx1 = p.x - camera;
        ctx.globalAlpha = Math.max(0, p.life / p.max);
        ctx.fillStyle = "#fff6e4";
        ctx.fillRect(sx1, p.y, 5, 3);
      }
      ctx.globalAlpha = 1;

      for (const pad of pads) {
        if (!pad.alive) continue;
        const sx1 = pad.x - camera;
        const bob = Math.sin(clock * 7 + pad.x) * 3;
        ctx.save();
        ctx.translate(sx1, gY - 20 + bob);
        ctx.fillStyle = "rgba(245, 196, 81, 0.35)";
        ctx.beginPath();
        ctx.ellipse(0, 18, 30, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#f5c451";
        ctx.beginPath();
        ctx.moveTo(0, -18);
        ctx.lineTo(18, 2);
        ctx.lineTo(0, 16);
        ctx.lineTo(-18, 2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#fff8dc";
        ctx.font = "800 12px Outfit, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("▲", 0, 6);
        ctx.restore();
      }

      for (const o of obstacles) {
        if (!o.alive) continue;
        const sx1 = o.x - camera;
        const dw = o.w;
        const dh = o.h;
        const baseY = gY - o.lift - dh;
        const rock = rockImgs[Math.abs(Math.floor(o.x / 48)) % rockImgs.length];
        ctx.save();
        ctx.translate(sx1 + dw / 2, baseY + dh);
        ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
        ctx.beginPath();
        ctx.ellipse(0, 8, dw * 0.38, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        if (rock && rock.complete && rock.naturalWidth) {
          ctx.drawImage(rock, -dw / 2, -dh, dw, dh);
        }
        ctx.restore();
      }

      const drawBone = (w: number) => {
        const h = w * 0.34;
        const body = ctx.createLinearGradient(0, -h, 0, h);
        body.addColorStop(0, "#fffaf0");
        body.addColorStop(0.45, "#f3d48a");
        body.addColorStop(1, "#c8923e");
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.roundRect(-w * 0.22, -h * 0.28, w * 0.44, h * 0.56, h * 0.22);
        ctx.fill();
        for (const [kx, ky] of [
          [-w * 0.28, -h * 0.22],
          [-w * 0.28, h * 0.22],
          [w * 0.28, -h * 0.22],
          [w * 0.28, h * 0.22],
        ] as const) {
          const knob = ctx.createRadialGradient(kx - 3, ky - 3, 1, kx, ky, h * 0.4);
          knob.addColorStop(0, "#fff");
          knob.addColorStop(1, "#e2b15a");
          ctx.fillStyle = knob;
          ctx.beginPath();
          ctx.arc(kx, ky, h * 0.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.beginPath();
        ctx.ellipse(-w * 0.04, -h * 0.08, w * 0.08, h * 0.1, -0.4, 0, Math.PI * 2);
        ctx.fill();
      };

      for (const c of pickups) {
        if (!c.alive || c.got) continue;
        const sx1 = c.x - camera;
        const phaseOff = (c.x % 140) * 0.02;
        const bob = Math.sin(clock * 2.4 + phaseOff) * 6;
        const spin = clock * 1.7 + phaseOff;
        const face = Math.cos(spin);
        const thick = Math.sign(face || 1) * (0.22 + 0.78 * Math.abs(face));
        ctx.save();
        ctx.translate(sx1, c.y + bob);
        ctx.fillStyle = "rgba(8, 16, 32, 0.35)";
        ctx.beginPath();
        ctx.ellipse(0, gY - (c.y + bob), 28, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        const glow = ctx.createRadialGradient(0, 0, 4, 0, 0, 58);
        glow.addColorStop(
          0,
          c.kind === "shield"
            ? "rgba(120, 220, 255, 0.55)"
            : c.kind === "magnet"
              ? "rgba(255, 120, 180, 0.5)"
              : c.kind === "bone"
                ? "rgba(255, 214, 120, 0.45)"
                : "rgba(245, 196, 81, 0.5)",
        );
        glow.addColorStop(1, "rgba(245, 196, 81, 0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, 58, 0, Math.PI * 2);
        ctx.fill();
        const spark = clock * 1.3 + phaseOff;
        ctx.fillStyle = "#fff";
        ctx.globalAlpha = 0.85;
        ctx.fillRect(Math.cos(spark) * 36 - 2, Math.sin(spark) * 22 - 2, 4, 4);
        ctx.globalAlpha = 1;
        if (c.kind === "bone") {
          ctx.rotate(Math.sin(clock * 0.9 + phaseOff) * 0.35);
          drawBone(96);
        } else if (c.kind === "shield") {
          ctx.strokeStyle = "#9be7ff";
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.arc(0, 0, 26, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = "rgba(155, 231, 255, 0.28)";
          ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.font = "800 18px Outfit, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("S", 0, 6);
        } else if (c.kind === "magnet") {
          ctx.strokeStyle = "#ff7ab0";
          ctx.lineWidth = 8;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.arc(0, -2, 16, Math.PI, 0);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(-16, -2);
          ctx.lineTo(-16, 16);
          ctx.moveTo(16, -2);
          ctx.lineTo(16, 16);
          ctx.stroke();
        } else if (coinImg.complete && coinImg.naturalWidth) {
          ctx.scale(thick, 1);
          ctx.drawImage(coinImg, -46, -46, 92, 92);
          if (thick > 0.45) {
            ctx.fillStyle = "rgba(255,255,255,0.28)";
            ctx.beginPath();
            ctx.ellipse(-12, -14, 10, 22, -0.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }

      for (const f of floaters) {
        const sx1 = f.x - camera;
        ctx.globalAlpha = Math.max(0, f.life / 0.75);
        ctx.fillStyle = "#f5c451";
        ctx.font = "800 20px Outfit, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(f.text, sx1, f.y);
      }
      ctx.globalAlpha = 1;

      const lift = Math.max(0, gY - y);
      const shadow = Math.max(0.42, 1 - lift / 190);
      ctx.globalAlpha = 0.3 * shadow;
      ctx.fillStyle = "rgba(20, 40, 70, 0.55)";
      ctx.beginPath();
      ctx.ellipse(feetScreen, gY + 3, 38 * shadow, 7 * shadow, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      const size = 200;
      const footGap = 6;
      const idle = phase === "ready";
      const frameCount = runImgs.length;
      const cycle = ((anim % frameCount) + frameCount) % frameCount;
      const frame = Math.floor(cycle) % frameCount;
      const frac = cycle - frame;

      const drawAnchored = (img: CanvasImageSource, alpha: number) => {
        const ready = img instanceof HTMLImageElement ? img.complete && img.naturalWidth > 0 : true;
        if (alpha < 0.04 || !ready) return;
        if (img instanceof HTMLImageElement) lastGood = img;
        ctx.save();
        ctx.globalAlpha = Math.min(1, alpha);
        ctx.translate(feetScreen, y + footGap);
        ctx.rotate(idle ? 0 : lean);
        ctx.scale(bodySx, bodySy);
        ctx.drawImage(img, -size / 2, -size, size, size);
        ctx.restore();
      };

      const drawRun = (alpha: number) => {
        const img = runImgs[frame];
        const next = runImgs[(frame + 1) % frameCount];
        const ready = img.complete && img.naturalWidth > 0;
        if (!ready) {
          if (lastGood) drawAnchored(lastGood, alpha);
          return;
        }
        if (!blendCtx || !next.complete || !next.naturalWidth || frac < 0.03) {
          drawAnchored(img, alpha);
          return;
        }
        const w = blendCanvas.width;
        blendCtx.clearRect(0, 0, w, w);
        blendCtx.globalAlpha = 1;
        blendCtx.drawImage(img, 0, 0, w, w);
        blendCtx.globalAlpha = frac * 0.35;
        blendCtx.drawImage(next, 0, 0, w, w);
        blendCtx.globalAlpha = 1;
        drawAnchored(blendCanvas, alpha);
      };

      const drawJump = (alpha: number) => {
        const n = jumpImgs.length;
        const u = Math.min(1, Math.max(0, jumpT) / 0.4);
        const pos = u * (n - 1);
        const idx = Math.floor(pos);
        const blendAmt = pos - idx;
        const img = jumpImgs[idx];
        const next = jumpImgs[Math.min(n - 1, idx + 1)];
        if (!img?.complete || !img.naturalWidth) {
          drawRun(alpha);
          return;
        }
        if (!blendCtx || !next?.complete || !next.naturalWidth || blendAmt < 0.03) {
          drawAnchored(img, alpha);
          return;
        }
        const w = blendCanvas.width;
        blendCtx.clearRect(0, 0, w, w);
        blendCtx.globalAlpha = 1 - blendAmt;
        blendCtx.drawImage(img, 0, 0, w, w);
        blendCtx.globalAlpha = blendAmt;
        blendCtx.drawImage(next, 0, 0, w, w);
        blendCtx.globalAlpha = 1;
        drawAnchored(blendCanvas, alpha);
      };

      const drawPose = (p: Pose, alpha: number) => {
        if (p === "squash") drawAnchored(jumpImgs[jumpImgs.length - 1], alpha);
        else if (p === "run") drawRun(alpha);
        else drawJump(alpha);
      };

      if (phase === "ready") {
        if (idleImg.complete && idleImg.naturalWidth > 0) drawAnchored(idleImg, 1);
        else if (runImgs[0]) drawAnchored(runImgs[0], 1);
      } else if (pose === "run") drawRun(1);
      else drawPose(pose, 1);
      if (!idle && shield) {
        ctx.save();
        ctx.translate(feetScreen, y - 78);
        ctx.strokeStyle = "rgba(155, 231, 255, 0.9)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(0, 0, 54, 70, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      if (!idle && magnet > 0) {
        ctx.fillStyle = "#ff9ec4";
        ctx.font = "800 16px Outfit, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`MAGNET ${Math.ceil(magnet)}`, feetScreen, y - 168);
      }

      ctx.restore();
    };

    let alive = true;
    const loop = (now: number) => {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!pausedRef.current) {
        acc += dt;
        while (acc >= step) {
          simulate(step);
          acc -= step;
        }
      }
      if (shake > 0) shake = Math.max(0, shake - dt);
      hudAcc += dt;
      if (hudAcc > 0.12) {
        hudAcc = 0;
        setHud({
          score,
          dist: Math.floor(dist),
          coins,
          bones,
          best,
          phase,
          pace: speed / 760,
          quip,
          drun: rewardOf(Math.floor(dist), coins, bones),
          combo: Math.floor(coinStreak),
        });
      }
      (window as unknown as { __runner?: object }).__runner = {
        phase,
        pose,
        grounded,
        frame: Math.floor(anim) % runImgs.length,
        y: Math.round(y),
        speed: Math.round(speed * (boost ? 1.34 : 1)),
        dist: Math.round(dist),
        coins,
        vy: Math.round(vy),
        dropping,
      };
      render();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    setHud({ score: 0, dist: 0, coins: 0, bones: 0, best, phase: "ready", pace: 1, quip: "", drun: 0, combo: 0 });

    const onVis = () => {
      if (document.hidden) last = performance.now();
      else if (audio.ctx?.state === "suspended") void audio.ctx.resume();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelAnimationFrame(raf);
      alive = false;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      wrap.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("visibilitychange", onVis);
      sprintRef.current = false;
      dropRef.current = false;
    };
  }, []);

  const holdSprint = (on: boolean) => {
    sprintRef.current = on;
    setSprintOn(on);
  };

  const holdDrop = (on: boolean) => {
    dropRef.current = on;
  };

  const claimEarnings = () => {
    if (!userIdRef.current) {
      setClaimNote("Sign in to claim. The server checks the run, then your wallet sends it.");
      window.dispatchEvent(new Event("moon-open-account"));
      return;
    }
    setClaimNote("Preparing the claim…");
    void (async () => {
      try {
        const result = await requestClaim();
        setEarned(result.balance);
        if (!result.tx) {
          setClaimNote(result.message);
          if (/wallet|Open Account/i.test(result.message)) window.dispatchEvent(new Event("moon-open-account"));
          return;
        }
        if (!getConnectedProvider()) {
          claimAfterConnect.current = true;
          setClaimNote("Connect the payout wallet to confirm the claim.");
          window.dispatchEvent(new Event("moon-open-wallet"));
          return;
        }
        const connected = walletRef.current.toLowerCase();
        if (!connected.startsWith("0x") || connected !== result.tx.from.toLowerCase()) {
          setClaimNote(`Switch your wallet to ${shortAddress(result.tx.from)}, then claim again.`);
          window.dispatchEvent(new Event("moon-open-wallet"));
          return;
        }
        const hash = await sendClaimTransaction(result.tx);
        setClaimNote(`Claim sent on BSC. ${hash.slice(0, 10)}…${hash.slice(-4)}`);
      } catch (err) {
        const code = (err as { code?: number }).code;
        setClaimNote(code === 4001 ? "Claim cancelled in the wallet." : err instanceof Error ? err.message : "Claim failed.");
      }
    })();
  };
  claimRef.current = claimEarnings;

  bankRef.current = (run) => {
    void submitRun({ data: run })
      .then((result) => {
        setEarned(result.balance);
        setPayout({ credited: result.credited, capped: result.capped, waiting: 0 });
        setBoard(result.board);
        setClaimNote(result.message);
      })
      .catch((err: unknown) => {
        setClaimNote(err instanceof Error ? err.message : "Could not save this run.");
      });
  };

  const togglePause = () => {
    setPaused((p) => {
      const next = !p;
      pausedRef.current = next;
      return next;
    });
  };

  return (
    <main className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-bg text-fg">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 py-2 sm:gap-3 sm:px-6 sm:py-3">
        <div className="group flex items-center gap-3">
          <BrandMark className="transition duration-200 group-hover:scale-105" />
          <p className="font-display text-lg font-extrabold tracking-tight text-gold transition-all duration-200 group-hover:tracking-wide sm:text-xl">
            To The Moon
          </p>
        </div>
        <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
          <span className="rounded-full border border-gold/50 bg-surface px-3 py-2 text-xs font-semibold text-gold sm:text-sm">
            Earned {formatDrun(earned)}
          </span>
          <div className="relative">
            <button
              type="button"
              data-no-jump
              className="min-h-10 rounded-full border border-line bg-surface px-4 py-2 text-sm font-semibold transition hover:border-gold hover:text-gold"
              onClick={() => setSettingsOpen((o) => !o)}
            >
              Settings
            </button>
            {settingsOpen && (
              <div
                data-no-jump
                className="absolute right-0 top-full z-20 mt-2 w-52 rounded-xl border border-line bg-surface p-3 shadow-lg"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <label className="flex cursor-pointer items-center justify-between py-1.5 text-sm">
                  <span>Sound</span>
                  <input
                    type="checkbox"
                    checked={soundOn}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setSoundOn(on);
                      soundOnRef.current = on;
                      if (audioRef.current?.sfx) audioRef.current.sfx.gain.value = on ? 0.95 : 0;
                    }}
                    className="size-4 accent-gold"
                  />
                </label>
                <label className="flex cursor-pointer items-center justify-between py-1.5 text-sm">
                  <span>Music</span>
                  <input
                    type="checkbox"
                    checked={musicOn}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setMusicOn(on);
                      musicOnRef.current = on;
                      if (musicRef.current?.gain) musicRef.current.gain.gain.value = on ? 0.08 : 0;
                      if (on && audioRef.current?.ctx && !musicRef.current?.nodes.length) {
                        // restart music if needed
                      }
                    }}
                    className="size-4 accent-gold"
                  />
                </label>
              </div>
            )}
          </div>
          <button
            type="button"
            data-no-jump
            className="min-h-10 rounded-full border border-line bg-surface px-4 py-2 text-sm font-semibold transition hover:border-gold hover:text-gold"
            onClick={togglePause}
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            data-no-jump
            className="min-h-10 rounded-full bg-gold px-4 py-2 text-sm font-bold text-bg transition hover:scale-105"
            onClick={claimEarnings}
          >
            Claim
          </button>
          <AccountPanel />
          <WalletButton />
        </div>
      </header>

      <section className="relative mx-auto flex min-h-0 w-full flex-1 flex-col px-2 sm:px-6">
        <div
          ref={wrapRef}
          className="playfield relative min-h-0 w-full flex-1 overflow-hidden rounded-2xl border border-line bg-bg"
        >
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" />
          {paused && (
            <div className="absolute inset-0 grid place-items-center bg-bg/70 backdrop-blur-sm">
              <div className="rounded-2xl border border-line bg-surface/90 px-8 py-6 text-center">
                <p className="font-display text-3xl font-extrabold text-gold">Paused</p>
                <p className="mt-2 text-sm text-muted">Press P or click Resume to continue</p>
                <button
                  type="button"
                  data-no-jump
                  className="mt-4 rounded-full bg-gold px-6 py-2 text-sm font-bold text-bg"
                  onClick={togglePause}
                >
                  Resume
                </button>
              </div>
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-2 top-2 flex flex-wrap justify-between gap-1 text-xs sm:inset-x-3 sm:top-3 sm:gap-2 sm:text-sm">
            <span className="rounded-full bg-surface/80 px-3 py-1.5 font-semibold">
              Score <span className="text-gold">{hud.score}</span>
            </span>
            <span className="rounded-full bg-surface/80 px-3 py-1.5">{hud.dist} m · {(hud.pace ?? 1).toFixed(1)}×</span>
            <span
              key={`${hud.coins}-${hud.bones}`}
              className="coin-pop rounded-full border border-gold/50 bg-surface/80 px-3 py-1.5 font-semibold text-gold"
            >
              {`${hud.coins} coins · ${hud.bones} bones`}
            </span>
          </div>
          {hud.phase === "run" && (
            <p className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-surface/75 px-3 py-1 text-xs text-muted">
              Best {hud.best}
            </p>
          )}
          {hud.phase === "run" && hud.combo >= 3 && (
            <p className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-gold px-3 py-1 text-xs font-bold text-bg">
              {hud.combo} combo
            </p>
          )}
          {hud.phase === "ready" && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3 sm:p-4">
              <div
                className="pointer-events-auto w-full max-w-md rounded-2xl border border-line bg-surface/90 px-5 py-4 text-center"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <h1 className="font-display text-3xl font-extrabold text-fg">To The Moon</h1>
                <p className="mt-2 text-sm text-muted">Double jump in the air. Grab a shield for one free hit, or a magnet to pull coins in.</p>
                {!user && <p className="mt-1 text-xs text-gold">Sign in with Account if this run should count toward $DRUN.</p>}
                <label className="mt-3 block text-left text-xs font-semibold text-muted">
                  Player name
                  <input
                    data-no-jump
                    value={playerName}
                    maxLength={18}
                    className="mt-1 w-full rounded-xl border border-line bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-gold"
                    onChange={(e) => {
                      setPlayerName(e.target.value);
                      nameRef.current = e.target.value;
                      try {
                        localStorage.setItem(NAME_KEY, e.target.value);
                      } catch {
                        /* ignore */
                      }
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </label>
                <p className="mt-2 text-sm text-gold">Best {hud.best}</p>
                <button
                  type="button"
                  className="mt-4 min-h-12 touch-auto rounded-full bg-gold px-6 py-3 text-base font-bold text-bg"
                  onClick={(e) => {
                    e.stopPropagation();
                    jumpRef.current();
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    jumpRef.current();
                  }}
                >
                  Start running
                </button>
              </div>
            </div>
          )}
          {hud.phase === "dead" && (
            <div className="pointer-events-none absolute inset-0 flex items-end justify-center p-3 sm:p-4">
              <div
                className="pointer-events-auto flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-surface/95 text-left"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div className="px-4 pt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Play to earn</p>
                  <h1 className="font-display text-2xl font-extrabold text-gold">
                    {payout.waiting > 0
                      ? `+${formatDrun(payout.waiting)} $DRUN waiting`
                      : `+${formatDrun(payout.credited)} $DRUN`}
                  </h1>
                  <p className="mt-1 text-sm text-muted">
                    {payout.waiting > 0
                      ? "Connect a wallet to claim this run."
                      : payout.capped
                        ? "Daily earn cap reached. The rest waits until tomorrow."
                        : `${hud.quip} Added to your earned balance.`}
                  </p>
                </div>
                <div className="mt-3 overflow-auto px-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Leaderboard</p>
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-muted">
                      <tr>
                        <th className="py-2 pr-2 font-semibold">Player</th>
                        <th className="py-2 pr-2 font-semibold">Wallet</th>
                        <th className="py-2 pr-2 text-right font-semibold">Score</th>
                        <th className="py-2 text-right font-semibold">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {board.length === 0 && (
                        <tr>
                          <td className="py-3 text-muted" colSpan={4}>
                            No runs yet.
                          </td>
                        </tr>
                      )}
                      {board.map((row, i) => (
                        <tr key={`${row.name}-${row.address}-${row.score}`} className="border-t border-line">
                          <td className="max-w-28 truncate py-2 pr-2 font-semibold">
                            {i + 1}. {row.name}
                          </td>
                          <td className="py-2 pr-2 font-mono text-xs text-muted">{shortAddress(row.address)}</td>
                          <td className="py-2 pr-2 text-right font-semibold text-gold">{row.score}</td>
                          <td className="py-2 text-right">{clockTime(row.time)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="grid gap-2 p-4">
                  <button
                    type="button"
                    data-no-jump
                    className="min-h-12 w-full touch-auto rounded-full border border-gold bg-gold px-6 py-3 text-base font-bold text-bg"
                    onClick={(e) => {
                      e.stopPropagation();
                      claimEarnings();
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    Claim
                  </button>
                  <button
                    type="button"
                    className="min-h-12 w-full touch-auto rounded-full border border-line bg-surface px-6 py-3 text-base font-bold text-fg"
                    onClick={(e) => {
                      e.stopPropagation();
                      jumpRef.current();
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      jumpRef.current();
                    }}
                  >
                    Run again
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <p className="mt-2 shrink-0 text-center text-xs text-muted sm:mt-3 sm:text-sm">
          {claimNote || "0.05 $DRUN per meter, 1 per coin, 3 per bone. 200 $DRUN a player each day. The treasury stops at 10,000."}
        </p>
        <div className="mt-2 grid shrink-0 grid-cols-3 gap-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:mt-3 sm:gap-3">
          <button
            type="button"
            aria-pressed={sprintOn}
            className={`min-h-14 rounded-full border text-sm font-bold touch-none sm:text-base ${
              sprintOn ? "border-gold bg-gold text-bg" : "border-line bg-surface text-fg"
            }`}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              holdSprint(true);
            }}
            onPointerUp={() => holdSprint(false)}
            onPointerCancel={() => holdSprint(false)}
          >
            {sprintOn ? "Sprinting" : "Sprint"}
          </button>
          <button
            type="button"
            className="min-h-14 rounded-full border border-line bg-surface text-sm font-bold text-fg touch-none sm:text-base"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              holdDrop(true);
            }}
            onPointerUp={() => holdDrop(false)}
            onPointerCancel={() => holdDrop(false)}
          >
            Land
          </button>
          <button
            type="button"
            className="min-h-14 rounded-full bg-coral text-sm font-bold text-bg touch-none sm:text-base"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              jumpRef.current();
            }}
          >
            Jump
          </button>
        </div>
      </section>

      <footer data-no-jump className="mt-auto flex shrink-0 items-center justify-end border-t border-line px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <SocialLinks />
      </footer>
    </main>
  );
}
