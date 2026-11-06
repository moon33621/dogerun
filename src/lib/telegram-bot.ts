export type TelegramRequest = {
  id: string;
  drun: number;
  status: "pending" | "approved" | "rejected";
};

export type TelegramNote = {
  id: string;
  role: "bot" | "admin" | "player";
  text: string;
};

export type TelegramStatus = {
  linked: boolean;
  username: string | null;
  request: TelegramRequest | null;
  preview: boolean;
  adminReady: boolean;
  inbox: TelegramNote[];
};

type Desk = {
  linked: boolean;
  username: string | null;
  code: string;
  balance: number;
  request: TelegramRequest | null;
  inbox: TelegramNote[];
};

const KEY = "dogerun.telegram";

const PLAYER_HELP = [
  "Player",
  "/start — link this chat",
  "/balance — earned $DRUN",
  "/claim — ask an admin to pay",
  "/status — link and latest withdrawal",
  "/reset email — password reset note",
  "/help — these commands",
].join("\n");

const ADMIN_HELP = [
  "Admin",
  "/pending — withdrawals waiting",
  "/approve — pay the latest",
  "/reject — refuse the latest",
  "/players — linked chats",
  "/admin — these commands",
].join("\n");

function empty(): Desk {
  return { linked: false, username: null, code: "", balance: 0, request: null, inbox: [] };
}

function load(): Desk {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "") as Desk;
    if (!raw || !Array.isArray(raw.inbox)) return empty();
    return { ...empty(), ...raw, inbox: raw.inbox.slice(-20) };
  } catch {
    return empty();
  }
}

function save(desk: Desk) {
  desk.inbox = desk.inbox.slice(-20);
  try {
    localStorage.setItem(KEY, JSON.stringify(desk));
  } catch {
    /* private mode */
  }
}

function nid() {
  return Math.random().toString(36).slice(2, 8);
}

function say(desk: Desk, role: TelegramNote["role"], text: string) {
  desk.inbox.push({ id: nid(), role, text });
}

function view(desk: Desk): TelegramStatus {
  return {
    linked: desk.linked,
    username: desk.username,
    request: desk.request,
    preview: true,
    adminReady: true,
    inbox: desk.inbox,
  };
}

export function parseBotCommand(text: string) {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  const head = (parts[0] || "").toLowerCase();
  const command = head.startsWith("/") ? head.slice(1) : head;
  return { command, args: parts.slice(1) };
}

export function parseCallback(data: string) {
  const [action, payload] = data.split(":");
  return { action: action || "", payload: payload || "" };
}

function money(n: number) {
  return (Math.round(n * 10) / 10).toFixed(1);
}

function runCommand(desk: Desk, text: string) {
  const { command, args } = parseBotCommand(text);
  if (!command) return;
  if (command !== "start") say(desk, command === "approve" || command === "reject" || command === "pending" || command === "players" || command === "admin" ? "admin" : "player", text.trim());
  if (command === "help" || command === "start" && args.length === 0 && desk.linked) {
    say(desk, "bot", PLAYER_HELP);
    return;
  }
  if (command === "start") {
    const code = (args[0] || "").toUpperCase();
    if (!desk.code || code !== desk.code) {
      say(desk, "bot", "That link code is not active. Press Connect Telegram first.");
      return;
    }
    desk.linked = true;
    desk.username = desk.username || "player";
    say(desk, "bot", "Chat linked. /balance, /claim, /status, /reset, and /help are open.");
    return;
  }
  if (command === "balance") {
    say(desk, "bot", `Balance ${money(desk.balance)} $DRUN.`);
    return;
  }
  if (command === "status") {
    const link = desk.linked ? `Linked${desk.username ? ` as @${desk.username}` : ""}.` : "Not linked.";
    const payout = desk.request ? ` Latest withdrawal ${desk.request.id}: ${money(desk.request.drun)} $DRUN · ${desk.request.status}.` : " No withdrawal yet.";
    say(desk, "bot", link + payout);
    return;
  }
  if (command === "claim") {
    openClaim(desk);
    return;
  }
  if (command === "reset") {
    const email = args[0] || "";
    if (!email.includes("@")) {
      say(desk, "bot", "Use /reset you@email.com");
      return;
    }
    say(desk, "bot", `Reset note for ${email} is in this chat. Open Account on the site to finish.`);
    return;
  }
  if (command === "admin") {
    say(desk, "admin", ADMIN_HELP);
    return;
  }
  if (command === "pending") {
    say(desk, "admin", desk.request?.status === "pending" ? `${desk.request.id} · ${money(desk.request.drun)} $DRUN · pending` : "No withdrawal is waiting.");
    return;
  }
  if (command === "players") {
    say(desk, "admin", desk.linked ? `1 linked chat${desk.username ? `: @${desk.username}` : ""}.` : "No chat is linked.");
    return;
  }
  if (command === "approve" || command === "reject") {
    decide(desk, command === "approve", args[0]);
    return;
  }
  say(desk, "bot", "Unknown command. /help for players, /admin for payouts.");
}

function openClaim(desk: Desk) {
  if (!desk.linked) {
    say(desk, "bot", "Link Telegram before a claim. Press Connect Telegram, then /start and the code.");
    return;
  }
  if (desk.request?.status === "pending") {
    say(desk, "bot", `Withdrawal ${desk.request.id} is already waiting for an admin.`);
    return;
  }
  if (desk.balance <= 0) {
    say(desk, "bot", "Nothing to claim yet. Finish a run first.");
    return;
  }
  desk.request = { id: nid(), drun: desk.balance, status: "pending" };
  say(desk, "bot", `Withdrawal ${desk.request.id} for ${money(desk.request.drun)} $DRUN is waiting. An admin uses /approve or /reject.`);
  say(desk, "admin", `New withdrawal ${desk.request.id} · ${money(desk.request.drun)} $DRUN.`);
}

function decide(desk: Desk, approve: boolean, id?: string) {
  const request = desk.request;
  if (!request || request.status !== "pending" || (id && id !== request.id)) {
    say(desk, "admin", "No matching withdrawal is waiting.");
    return;
  }
  if (approve) {
    request.status = "approved";
    desk.balance = Math.max(0, Math.round((desk.balance - request.drun) * 10) / 10);
    say(desk, "admin", `Approved ${request.id}. ${money(request.drun)} $DRUN can be sent.`);
    say(desk, "bot", `Approved. Balance left ${money(desk.balance)} $DRUN.`);
    return;
  }
  request.status = "rejected";
  say(desk, "admin", `Rejected ${request.id}. The balance stays.`);
  say(desk, "bot", "Withdrawal rejected. Your balance was not paid.");
}

export function telegramBalance() {
  return load().balance;
}

export function readTelegramStatus(): TelegramStatus {
  return view(load());
}

export function connectTelegramChat() {
  const desk = load();
  desk.code = nid().toUpperCase();
  save(desk);
  return { code: desk.code, url: null as string | null };
}

export function finishTelegramLink(code: string): TelegramStatus {
  const desk = load();
  runCommand(desk, `/start ${code}`);
  save(desk);
  return view(desk);
}

export function decideTelegramWithdrawal(id: string, approve: boolean) {
  const desk = load();
  decide(desk, approve, id);
  save(desk);
  return { status: view(desk), message: approve ? "Withdrawal approved." : "Withdrawal rejected." };
}

export function runTelegramCommand(text: string): TelegramStatus {
  const desk = load();
  runCommand(desk, text);
  save(desk);
  return view(desk);
}

export function creditTelegramRun(dist: number, coins: number, bones: number) {
  const credited = Math.round((Number(dist || 0) * 0.05 + Number(coins || 0) + Number(bones || 0) * 3) * 10) / 10;
  const desk = load();
  desk.balance = Math.round((desk.balance + credited) * 10) / 10;
  say(desk, "bot", `Run saved. +${money(credited)} $DRUN. Balance ${money(desk.balance)}.`);
  save(desk);
  return { balance: desk.balance, credited, message: `+${money(credited)} $DRUN saved. Claim asks an admin to approve it in Telegram.` };
}

export function requestTelegramClaim() {
  const desk = load();
  openClaim(desk);
  save(desk);
  const waiting = desk.request?.status === "pending";
  return {
    balance: desk.balance,
    tx: null,
    message: waiting ? `Withdrawal ${desk.request?.id} is waiting for an admin in Telegram.` : desk.inbox.at(-1)?.text || "Claim was not opened.",
  };
}

export function startTelegramBot() {}
