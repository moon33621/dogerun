/**
 * Telegram bot for password resets and withdrawal approvals.
 * Preview (no bot token and no DATABASE_URL) keeps an in-memory outbox
 * so the account panel can link a chat and approve a request.
 * A configured bot never exposes those approve buttons.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { getRequest } from "@tanstack/react-start/server";
import { getSql, type Sql } from "@/lib/db";
import { TREASURY_DAILY_TENTHS, tenthsToDrun } from "@/lib/p2e-check";
import { parseBotCommand, parseCallback, type TelegramStatus } from "@/lib/telegram-bot";
import { issueSignedClaim, refundExpiredClaims } from "@/lib/claim-issue.server";

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const WALLET_EMAIL = "@wallet.dogerun.gg";

type OutboxItem = {
  id: string;
  chatId: string;
  userId: string | null;
  role: "user" | "admin";
  text: string;
  at: number;
};

type ClaimResult = {
  balance: number;
  wallet: string | null;
  message: string;
  tx: { from: string; to: string; data: string; chainId: string } | null;
};

const globalTg = globalThis as typeof globalThis & {
  __drunTgOutbox__?: OutboxItem[];
  __drunTgHook__?: Promise<void> | null;
};

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

export function isPreviewTelegram() {
  return !process.env.TELEGRAM_BOT_TOKEN?.trim() && !process.env.DATABASE_URL?.trim();
}

function botUsername() {
  const name = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "") ?? "";
  return name || null;
}

function adminChatId() {
  return process.env.TELEGRAM_ADMIN_CHAT_ID?.trim() || null;
}

function webhookSecret() {
  const explicit = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (explicit) return explicit;
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  return createHash("sha256").update(token).digest("hex");
}

function secretsMatch(given: string, expected: string) {
  const left = Buffer.from(given);
  const right = Buffer.from(expected);
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

function outbox() {
  globalTg.__drunTgOutbox__ ??= [];
  return globalTg.__drunTgOutbox__;
}

function appOrigin() {
  const explicit = process.env.BETTER_AUTH_URL?.trim().replace(/\/$/, "");
  if (explicit) return explicit;
  try {
    const request = getRequest();
    if (request) return new URL(request.url).origin;
  } catch {
    /* no request scope */
  }
  return "http://127.0.0.1:8080";
}

function webhookOrigin(request?: Request) {
  const explicit = process.env.BETTER_AUTH_URL?.trim().replace(/\/$/, "");
  if (explicit?.startsWith("https://")) return explicit;
  if (!request) return null;
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || url.host;
  if (proto !== "https" || !host) return null;
  return `https://${host}`;
}

export function ensureWebhook(request?: Request) {
  if (globalTg.__drunTgHook__) return;
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const origin = webhookOrigin(request);
  if (!token || !origin) return;
  const secret = webhookSecret();
  globalTg.__drunTgHook__ = fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: `${origin}/api/telegram`,
      secret_token: secret,
      allowed_updates: ["message", "callback_query"],
    }),
  })
    .then((res) => {
      if (!res.ok) globalTg.__drunTgHook__ = null;
    })
    .catch(() => {
      globalTg.__drunTgHook__ = null;
    });
}

async function sendMessage(
  chatId: string,
  text: string,
  buttons?: { text: string; data: string }[],
  meta?: { userId: string | null; role: "user" | "admin" },
) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const virtual = chatId.startsWith("user:") || chatId === "admin";
  if (token && !virtual) {
    const reply_markup = buttons?.length
      ? { inline_keyboard: [buttons.map((button) => ({ text: button.text, callback_data: button.data }))] }
      : undefined;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, reply_markup }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Telegram didn't accept the message (${res.status}). ${body.slice(0, 140)}`);
    }
    return;
  }
  if (!isPreviewTelegram()) return;
  const box = outbox();
  box.push({
    id: randomUUID(),
    chatId,
    userId: meta?.userId ?? null,
    role: meta?.role ?? "user",
    text,
    at: Date.now(),
  });
  if (box.length > 40) box.splice(0, box.length - 40);
}

async function answerCallback(id: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_query_id: id, text: text.slice(0, 180) }),
  }).catch(() => undefined);
}

async function balanceDrun(sql: Sql, userId: string) {
  const rows = await sql<{ unclaimed: number }>`
    select unclaimed_tenths as unclaimed from user_balance where user_id = ${userId}
  `;
  const nowSec = Math.floor(Date.now() / 1000);
  const open = await sql<{ tenths: number }>`
    select coalesce(sum(tenths), 0) as tenths
    from payout_claims
    where user_id = ${userId} and status = 'open' and deadline > ${nowSec}
  `;
  return tenthsToDrun(num(rows[0]?.unclaimed) + num(open[0]?.tenths));
}

async function walletOf(sql: Sql, userId: string) {
  const rows = await sql<{ address: string }>`select address from user_wallets where user_id = ${userId}`;
  return rows[0]?.address ?? null;
}

async function userChat(sql: Sql, userId: string) {
  const rows = await sql<{ chat_id: string; username: string | null }>`
    select chat_id, username from telegram_links where user_id = ${userId}
  `;
  return rows[0] ?? null;
}

function drunLabel(tenths: number) {
  return `${tenthsToDrun(tenths).toFixed(1)} $DRUN`;
}

export async function readTelegramStatus(userId: string): Promise<TelegramStatus> {
  ensureWebhook();
  const sql = await getSql();
  const link = await userChat(sql, userId);
  const pending = await sql<{ id: string; wallet: string; tenths: number; status: string }>`
    select id, wallet, tenths, status
    from withdrawal_requests
    where user_id = ${userId}
    order by created_at desc
    limit 1
  `;
  const row = pending[0];
  const preview = isPreviewTelegram();
  const inbox = preview
    ? outbox()
        .filter((item) => item.userId === userId)
        .slice(-8)
        .map((item) => ({ id: item.id, role: item.role, text: item.text }))
    : [];
  return {
    linked: Boolean(link),
    username: link?.username ?? null,
    preview,
    botUsername: botUsername(),
    adminReady: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim() && adminChatId()) || preview,
    request: row
      ? { id: row.id, tenths: num(row.tenths), drun: tenthsToDrun(num(row.tenths)), status: row.status, wallet: row.wallet }
      : null,
    inbox,
  };
}

export async function createLinkCode(userId: string) {
  ensureWebhook();
  const code = randomBytes(4).toString("hex");
  const sql = await getSql();
  await sql`delete from telegram_link_codes where user_id = ${userId} or expires_at < now()`;
  await sql`
    insert into telegram_link_codes (code, user_id, expires_at)
    values (${code}, ${userId}, now() + interval '15 minutes')
  `;
  const username = botUsername();
  return {
    code,
    url: username ? `https://t.me/${username}?start=${code}` : null,
    preview: isPreviewTelegram(),
  };
}

async function bindChat(sql: Sql, code: string, chatId: string, username: string | null) {
  const rows = await sql<{ user_id: string }>`
    select user_id from telegram_link_codes where code = ${code} and expires_at > now()
  `;
  const userId = rows[0]?.user_id;
  if (!userId) return { ok: false as const, text: "That code expired. Ask for a new one in Account." };
  await sql`delete from telegram_links where user_id = ${userId} or chat_id = ${chatId}`;
  await sql`
    insert into telegram_links (user_id, chat_id, username)
    values (${userId}, ${chatId}, ${username})
  `;
  await sql`delete from telegram_link_codes where user_id = ${userId}`;
  return { ok: true as const, userId, text: "Telegram is linked. Password resets and withdrawal updates come here." };
}

export async function previewBind(userId: string, code: string) {
  if (!isPreviewTelegram()) throw new Error("Preview linking is off.");
  if (!/^[a-z0-9]{8}$/.test(code)) throw new Error("That code expired. Connect Telegram again.");
  const sql = await getSql();
  const rows = await sql<{ user_id: string }>`
    select user_id from telegram_link_codes where code = ${code} and expires_at > now()
  `;
  if (rows[0]?.user_id !== userId) throw new Error("That code isn't yours.");
  const bound = await bindChat(sql, code, `user:${userId}`, "preview");
  if (!bound.ok) throw new Error(bound.text);
  await sendMessage(`user:${userId}`, bound.text, undefined, { userId, role: "user" });
  return readTelegramStatus(userId);
}

export async function notifyPasswordReset(email: string, url: string) {
  const sql = await getSql();
  const users = await sql<{ id: string }>`select id from "user" where lower(email) = ${email}`;
  const userId = users[0]?.id;
  if (!userId) return false;
  const link = await userChat(sql, userId);
  if (!link) return false;
  await sendMessage(
    link.chat_id,
    `Reset your To The Moon password:\n${url}\n\nThe link expires in one hour. If you didn't ask, ignore this.`,
    undefined,
    { userId, role: "user" },
  );
  return true;
}

async function commandReset(chatId: string, email: string | null) {
  if (!email) {
    await sendMessage(chatId, "Send /reset and the account email. Example: /reset you@email.com");
    return;
  }
  const sql = await getSql();
  const link = await sql<{ user_id: string }>`select user_id from telegram_links where chat_id = ${chatId}`;
  if (!link[0]) {
    await sendMessage(chatId, "This chat isn't linked. Open Account in the game and connect Telegram.");
    return;
  }
  const users = await sql<{ id: string; email: string }>`
    select id, email from "user" where id = ${link[0].user_id}
  `;
  const account = users[0];
  if (!account || account.email.toLowerCase() !== email) {
    await sendMessage(chatId, "This chat isn't linked to that email.", undefined, {
      userId: link[0].user_id,
      role: "user",
    });
    return;
  }
  if (email.endsWith(WALLET_EMAIL)) {
    await sendMessage(chatId, "Wallet accounts don't use a password. Sign in with the wallet.", undefined, {
      userId: account.id,
      role: "user",
    });
    return;
  }
  const { auth } = await import("@/lib/auth/server");
  const origin = appOrigin();
  await auth.api.requestPasswordReset({
    body: { email, redirectTo: `${origin}/reset-password` },
    headers: new Headers({ origin, "content-type": "application/json" }),
  });
}

async function tellUser(sql: Sql, userId: string, text: string) {
  const link = await userChat(sql, userId);
  if (!link) return;
  await sendMessage(link.chat_id, text, undefined, { userId, role: "user" });
}

export async function requestWithdrawal(userId: string): Promise<ClaimResult> {
  ensureWebhook();
  const sql = await getSql();
  await refundExpiredClaims(sql, userId);
  const wallet = await walletOf(sql, userId);
  const balance = await balanceDrun(sql, userId);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!wallet) {
    return { balance, wallet: null, tx: null, message: "Link a payout wallet, then Claim can pay that address." };
  }

  const open = await sql<{ tenths: number; calldata: string; contract: string }>`
    select tenths, calldata, contract
    from payout_claims
    where user_id = ${userId} and status = 'open' and deadline > ${nowSec}
    order by created_at desc
    limit 1
  `;
  if (open[0]) {
    return {
      balance,
      wallet,
      message: "Confirm this claim in your wallet. $DRUN moves when BSC accepts it.",
      tx: { from: wallet, to: open[0].contract, data: open[0].calldata, chainId: "0x38" },
    };
  }

  const latest = await sql<{ id: string; status: string }>`
    select id, status from withdrawal_requests
    where user_id = ${userId}
    order by created_at desc
    limit 1
  `;
  if (latest[0]?.status === "pending") {
    return { balance, wallet, tx: null, message: "Your withdrawal is waiting for a Telegram approval." };
  }

  const contract = process.env.PAYOUT_CONTRACT?.trim() ?? "";
  const contractReady = ADDRESS.test(contract);
  if (!contractReady && latest[0]?.status === "approved") {
    return {
      balance,
      wallet,
      tx: null,
      message: "Approved in Telegram. The payout contract isn't set on this site yet, so your balance stays.",
    };
  }

  const balRows = await sql<{ n: number }>`select unclaimed_tenths as n from user_balance where user_id = ${userId}`;
  const unclaimed = num(balRows[0]?.n);
  if (unclaimed <= 0) {
    return { balance, wallet, tx: null, message: "Nothing to claim yet. Finish a run first." };
  }
  const day = utcDay();
  const spentRows = await sql<{ n: number }>`select spent_tenths as n from treasury_day where day = ${day}`;
  const room = TREASURY_DAILY_TENTHS - num(spentRows[0]?.n);
  const tenths = Math.min(unclaimed, room);
  if (tenths <= 0) {
    return { balance, wallet, tx: null, message: "The treasury's daily limit is used up. Try again tomorrow." };
  }

  const id = randomUUID();
  try {
    await sql`
      insert into withdrawal_requests (id, user_id, wallet, tenths, status)
      values (${id}, ${userId}, ${wallet}, ${tenths}, 'pending')
    `;
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    if (/unique|duplicate|withdrawal_one_pending/i.test(text)) {
      return { balance, wallet, tx: null, message: "Your withdrawal is waiting for a Telegram approval." };
    }
    throw err;
  }

  const label = drunLabel(tenths);
  const short = `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
  try {
    await tellUser(sql, userId, `Withdrawal of ${label} to ${short} is waiting for approval.`);
    const admin = adminChatId();
    const adminText = `Withdrawal ${label}\n${wallet}\nApprove to sign the BSC claim.`;
    const buttons = [
      { text: "Approve", data: `wd:ok:${id}` },
      { text: "Reject", data: `wd:no:${id}` },
    ];
    if (admin) await sendMessage(admin, adminText, buttons, { userId, role: "admin" });
    else if (isPreviewTelegram()) await sendMessage("admin", adminText, buttons, { userId, role: "admin" });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Telegram didn't send.";
    return {
      balance,
      wallet,
      tx: null,
      message: `Withdrawal requested, but the bot couldn't send it. ${reason}`,
    };
  }

  const preview = isPreviewTelegram();
  const liveAdmin = Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim() && adminChatId());
  const message = preview
    ? `Withdrawal of ${label} requested. Open Account to approve it in this preview.`
    : liveAdmin
      ? `Withdrawal of ${label} requested. Telegram has to approve it, then press Claim again.`
      : `Withdrawal of ${label} requested. Set the Telegram bot token and admin chat on the host before it can be approved.`;
  return { balance, wallet, tx: null, message };
}

export async function settleWithdrawal(
  id: string,
  approve: boolean,
  actor: { adminChatId?: string | null; previewUserId?: string | null },
) {
  if (actor.previewUserId) {
    if (!isPreviewTelegram()) throw new Error("Approvals happen in Telegram, not on the site.");
  } else if (!adminChatId() || actor.adminChatId !== adminChatId()) {
    return "Only the treasury admin can decide this.";
  }

  const sql = await getSql();
  if (actor.previewUserId) {
    const owner = await sql<{ user_id: string }>`select user_id from withdrawal_requests where id = ${id}`;
    if (owner[0]?.user_id !== actor.previewUserId) throw new Error("That withdrawal isn't yours.");
  }

  const next = approve ? "approved" : "rejected";
  const flipped = await sql<{ id: string; user_id: string; wallet: string; tenths: number }>`
    update withdrawal_requests
    set status = ${next}, decided_at = now()
    where id = ${id} and status = 'pending'
    returning id, user_id, wallet, tenths
  `;
  const row = flipped[0];
  if (!row) return "That withdrawal was already decided.";

  if (!approve) {
    await tellUser(sql, row.user_id, "Withdrawal rejected. Your balance was not changed.");
    return "Rejected. The balance stays.";
  }

  const contract = process.env.PAYOUT_CONTRACT?.trim() ?? "";
  if (!ADDRESS.test(contract)) {
    await tellUser(sql, row.user_id, "Approved. The payout contract isn't live yet, so the balance stays on the site.");
    return "Approved. The payout contract isn't live, so nothing was deducted.";
  }

  try {
    const signed = await issueSignedClaim(row.user_id, row.wallet, num(row.tenths));
    await sql`update withdrawal_requests set status = 'ready' where id = ${row.id} and status = 'approved'`;
    await tellUser(sql, row.user_id, `Approved. Open the game and press Claim to send ${drunLabel(signed.tenths)}.`);
    return `Approved. ${drunLabel(signed.tenths)} is ready to claim.`;
  } catch (err) {
    await sql`
      update withdrawal_requests
      set status = 'pending', decided_at = null
      where id = ${row.id} and status = 'approved'
    `;
    const reason = err instanceof Error ? err.message : "Could not sign the claim.";
    await tellUser(sql, row.user_id, `Approval couldn't be signed yet: ${reason} The request is pending again.`);
    return reason;
  }
}

export async function previewDecide(userId: string, id: string, approve: boolean) {
  const message = await settleWithdrawal(id, approve, { previewUserId: userId });
  return { message, status: await readTelegramStatus(userId) };
}

export async function previewCommand(userId: string, text: string) {
  if (!isPreviewTelegram()) throw new Error("The preview bot is off.");
  const sql = await getSql();
  const link = await userChat(sql, userId);
  if (!link) throw new Error("Link the preview chat first.");
  await handleUpdate({
    message: { text, chat: { id: link.chat_id }, from: { username: link.username ?? "preview" } },
  });
  return readTelegramStatus(userId);
}

type TgUpdate = {
  message?: { text?: string; chat?: { id?: number | string }; from?: { username?: string } };
  callback_query?: {
    id?: string;
    data?: string;
    message?: { chat?: { id?: number | string } };
  };
};

export async function handleUpdate(update: TgUpdate) {
  if (update.callback_query) {
    const data = update.callback_query.data ?? "";
    const parsed = parseCallback(data);
    const chatId = update.callback_query.message?.chat?.id;
    const answer = parsed
      ? await settleWithdrawal(parsed.id, parsed.approve, { adminChatId: chatId == null ? null : String(chatId) })
      : "That button isn't a withdrawal decision.";
    if (update.callback_query.id) await answerCallback(update.callback_query.id, answer);
    return;
  }
  const text = update.message?.text ?? "";
  const chatRaw = update.message?.chat?.id;
  if (!text || chatRaw == null) return;
  const chatId = String(chatRaw);
  const username = update.message?.from?.username?.replace(/^@/, "") || null;
  const command = parseBotCommand(text);
  if (command.type === "start") {
    if (!command.code) {
      await sendMessage(chatId, "Open Account, press Connect Telegram, then send /start and that 8-character code.");
      return;
    }
    const sql = await getSql();
    const bound = await bindChat(sql, command.code, chatId, username);
    await sendMessage(chatId, bound.text, undefined, bound.ok ? { userId: bound.userId, role: "user" } : undefined);
    return;
  }
  if (command.type === "reset") {
    await commandReset(chatId, command.email);
    return;
  }
  if (command.type === "withdraw") {
    const sql = await getSql();
    const link = await sql<{ user_id: string }>`select user_id from telegram_links where chat_id = ${chatId}`;
    if (!link[0]) {
      await sendMessage(chatId, "This chat isn't linked. Open Account and connect Telegram first.");
      return;
    }
    const result = await requestWithdrawal(link[0].user_id);
    await sendMessage(chatId, result.message, undefined, { userId: link[0].user_id, role: "user" });
    return;
  }
  await sendMessage(
    chatId,
    "Commands:\n/start CODE — link this chat\n/reset you@email.com — password reset for the linked account\n/withdraw — request a $DRUN withdrawal",
  );
}

export async function handleTelegramWebhook(request: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return new Response("Telegram bot is not configured.", { status: 404 });
  const given = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secretsMatch(given, webhookSecret())) return new Response("Forbidden", { status: 401 });
  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  try {
    await handleUpdate(update);
  } catch (err) {
    const text = err instanceof Error ? err.message : "Could not handle that update.";
    if (update.callback_query?.id) await answerCallback(update.callback_query.id, text);
  }
  return Response.json({ ok: true });
}
