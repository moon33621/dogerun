import { useMemo, useRef, useState } from "react";

const KEY = "dogerun.human.key";
const FRESH_MS = 10 * 60 * 1000;
const HEX_64 = /^[0-9a-f]{128}$/;

type Tile = "coin" | "bone" | "rock" | "moon";

const LABEL: Record<Tile, string> = {
  coin: "Coin",
  bone: "Bone",
  rock: "Rock",
  moon: "Moon",
};

const MARK: Record<Tile, string> = {
  coin: "◉",
  bone: "◍",
  rock: "◆",
  moon: "☾",
};

function shuffle(): Tile[] {
  const tiles: Tile[] = ["coin", "coin", "bone", "bone", "rock", "moon"];
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return tiles;
}

export function humanKey() {
  try {
    const raw = sessionStorage.getItem(KEY) || "";
    const [hex, at] = raw.split(".");
    if (!HEX_64.test(hex || "")) return null;
    if (!Number.isFinite(Number(at)) || Date.now() - Number(at) >= FRESH_MS) return null;
    return hex;
  } catch {
    return null;
  }
}

export function humanStillValid() {
  return humanKey() !== null;
}

function issueHumanKey() {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    sessionStorage.setItem(KEY, `${hex}.${Date.now()}`);
  } catch {
    /* private mode */
  }
  return hex;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function u32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true);
}

function zipStored(name: string, data: Uint8Array) {
  const fileName = new TextEncoder().encode(name);
  const crc = crc32(data);
  const local = 30 + fileName.length;
  const central = 46 + fileName.length;
  const out = new Uint8Array(local + data.length + central + 22);
  const view = new DataView(out.buffer);
  u32(view, 0, 0x04034b50);
  u16(view, 4, 20);
  u16(view, 8, 0);
  u32(view, 14, crc);
  u32(view, 18, data.length);
  u32(view, 22, data.length);
  u16(view, 26, fileName.length);
  out.set(fileName, 30);
  out.set(data, local);
  const cd = local + data.length;
  u32(view, cd, 0x02014b50);
  u16(view, cd + 4, 20);
  u16(view, cd + 6, 20);
  u32(view, cd + 16, crc);
  u32(view, cd + 20, data.length);
  u32(view, cd + 24, data.length);
  u16(view, cd + 28, fileName.length);
  u32(view, cd + 42, 0);
  out.set(fileName, cd + 46);
  const end = cd + central;
  u32(view, end, 0x06054b50);
  u16(view, end + 8, 1);
  u16(view, end + 10, 1);
  u32(view, end + 12, central);
  u32(view, end + 16, cd);
  return out;
}

function downloadHumanCode(hex: string) {
  const zip = zipStored("code.hex", new TextEncoder().encode(hex));
  const url = URL.createObjectURL(new Blob([zip], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "dogerun-human.zip";
  link.click();
  URL.revokeObjectURL(url);
}

export function HumanCheck({ onPass }: { onPass: () => void }) {
  const [tiles, setTiles] = useState<Tile[]>(() => shuffle());
  const [picked, setPicked] = useState<number[]>([]);
  const [hold, setHold] = useState(false);
  const [note, setNote] = useState("Tap both coins. Leave everything else.");
  const [step, setStep] = useState<"tap" | "hold">("tap");
  const trap = useRef<HTMLInputElement>(null);
  const started = useRef(performance.now());
  const holdAt = useRef(0);

  const coinsLeft = useMemo(() => tiles.filter((tile) => tile === "coin").length - picked.length, [tiles, picked]);

  const fail = (message: string) => {
    setTiles(shuffle());
    setPicked([]);
    setStep("tap");
    setHold(false);
    setNote(message);
    started.current = performance.now();
  };

  const tap = (index: number) => {
    if (trap.current?.value) {
      fail("That didn’t look human. Try again.");
      return;
    }
    if (picked.includes(index)) return;
    if (tiles[index] !== "coin") {
      fail("That wasn’t a coin. Start again.");
      return;
    }
    const next = [...picked, index];
    setPicked(next);
    if (next.length < 2) {
      setNote("One coin left.");
      return;
    }
    if (performance.now() - started.current < 350) {
      fail("Too fast for a person. Try again.");
      return;
    }
    setStep("hold");
    setNote("Hold Launch until the bar fills.");
  };

  const beginHold = () => {
    holdAt.current = performance.now();
    setHold(true);
  };

  const endHold = () => {
    const held = performance.now() - holdAt.current;
    setHold(false);
    if (held < 700) {
      setNote("Hold a little longer.");
      return;
    }
    const key = issueHumanKey();
    downloadHumanCode(key);
    onPass();
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-bg/80 p-4 backdrop-blur-sm"
      data-no-jump
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface px-5 py-5 text-center shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Human check</p>
        <h2 className="mt-1 font-display text-2xl font-extrabold text-gold">Not a trading bot</h2>
        <p className="mt-2 text-sm text-muted">{note}</p>
        <input
          ref={trap}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden
          className="pointer-events-none absolute h-0 w-0 opacity-0"
          name="company"
        />
        {step === "tap" ? (
          <div className="mt-4 grid grid-cols-3 gap-2">
            {tiles.map((tile, index) => {
              const on = picked.includes(index);
              return (
                <button
                  key={`${tile}-${index}`}
                  type="button"
                  data-no-jump
                  className={`min-h-16 rounded-xl border text-sm font-bold ${
                    on ? "border-gold bg-gold text-bg" : "border-line bg-bg text-fg"
                  }`}
                  onClick={() => tap(index)}
                >
                  <span className="block text-lg leading-none">{MARK[tile]}</span>
                  <span className="mt-1 block text-xs">{LABEL[tile]}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <button
            type="button"
            data-no-jump
            className="relative mt-4 min-h-14 w-full overflow-hidden rounded-full border border-gold bg-bg text-base font-bold text-gold"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              beginHold();
            }}
            onPointerUp={endHold}
            onPointerLeave={() => hold && endHold()}
            onPointerCancel={() => setHold(false)}
          >
            <span
              className="absolute inset-y-0 left-0 bg-gold/30"
              style={{ width: hold ? "100%" : "0%", transition: hold ? "width 800ms linear" : "none" }}
            />
            <span className="relative">{coinsLeft <= 0 ? "Hold to launch" : "Hold to launch"}</span>
          </button>
        )}
      </div>
    </div>
  );
}
