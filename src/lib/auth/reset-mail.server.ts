/**
 * Password-reset delivery. Resend when RESEND_API_KEY is set, and a Telegram
 * DM when that account already linked a chat. Never messages an unlinked chat.
 * In the preview (no database, no mail key) the latest link is kept in memory
 * so Forgot password can be tried. A deployed database never exposes the link.
 */

type ResetPreview = { email: string; url: string; token: string; at: number; viaTelegram: boolean };

const globalReset = globalThis as typeof globalThis & { __drunReset__?: ResetPreview };

const WALLET_EMAIL_SUFFIX = "@wallet.dogerun.gg";

function appResetUrl(authUrl: string, token: string) {
  try {
    const origin = new URL(authUrl).origin;
    return `${origin}/reset-password?token=${encodeURIComponent(token)}`;
  } catch {
    return authUrl;
  }
}

export async function deliverPasswordReset(input: { email: string; url: string; token: string }) {
  const email = input.email.trim().toLowerCase();
  // Wallet accounts prove ownership with a signature. A reset link would skip that.
  if (email.endsWith(WALLET_EMAIL_SUFFIX)) return;

  const appUrl = appResetUrl(input.url, input.token);
  let viaTelegram = false;
  let telegramError: string | null = null;
  try {
    const { notifyPasswordReset } = await import("@/lib/telegram.server");
    viaTelegram = await notifyPasswordReset(email, appUrl);
  } catch (err) {
    telegramError = err instanceof Error ? err.message : "Telegram didn't send the reset.";
  }

  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM?.trim() || "To The Moon <onboarding@resend.dev>";
  if (key) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: email,
        subject: "Reset your To The Moon password",
        text: `Reset your To The Moon password:\n${appUrl}\n\nThe link expires in one hour. If you didn't ask, you can ignore this email.`,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Could not send the reset email (${res.status}). ${body.slice(0, 160)}`);
    }
    return;
  }

  if (telegramError) throw new Error(telegramError);

  if (!process.env.DATABASE_URL?.trim()) {
    globalReset.__drunReset__ = { email, url: appUrl, token: input.token, at: Date.now(), viaTelegram };
  }
}

function previewRow(email: string) {
  if (process.env.DATABASE_URL?.trim() || process.env.RESEND_API_KEY?.trim()) return null;
  const row = globalReset.__drunReset__;
  if (!row || row.email !== email.trim().toLowerCase()) return null;
  if (Date.now() - row.at > 15 * 60 * 1000) return null;
  return row;
}

/** Preview-only. Returns a same-app reset path, or null when mail is real. */
export function peekResetPath(email: string): string | null {
  const row = previewRow(email);
  if (!row) return null;
  return `/reset-password?token=${encodeURIComponent(row.token)}`;
}

/** Preview-only. True when the reset was also queued to the linked Telegram chat. */
export function peekResetViaTelegram(email: string): boolean {
  return previewRow(email)?.viaTelegram ?? false;
}
