import { useEffect, useState, type FormEvent } from "react";
import { authClient, signIn } from "@/lib/auth/client";
import { GROK_PROVIDERS } from "@/lib/auth/providers";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { connectedAddress, personalSign } from "@/components/wallet-button";
import { bindSessionWallet, connectTelegram, linkPayoutWallet, peekResetLink, previewDecideWithdrawal, previewFinishTelegram, previewTelegramCommand, telegramStatus, walletChallenge, walletLogin } from "@/lib/p2e";
import type { TelegramStatus } from "@/lib/telegram-bot";

const BEARER_KEY = "grok-auth.bearer-token";

function captureBearer(response: Response) {
  const token = response.headers.get("set-auth-token");
  if (!token) return;
  try {
    sessionStorage.setItem(BEARER_KEY, token);
  } catch {
    /* ignore */
  }
}

const bearerFetch = {
  onSuccess(ctx: { response: Response }) {
    captureBearer(ctx.response);
  },
};

type Mode = "in" | "up" | "forgot";

export function AccountAuth({ onDone }: { onDone?: () => void }) {
  const { user, isPending } = useCurrentUserState();
  const [mode, setMode] = useState<Mode>("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [resetPath, setResetPath] = useState("");

  if (isPending) {
    return <div className="h-24 animate-pulse rounded-2xl bg-bg" />;
  }

  if (user) {
    return (
      <div className="grid gap-3">
        <div className="theme-user">
          <UserButton />
        </div>
        <p className="text-sm leading-6 text-muted">
          Signed in{user.primaryEmail ? ` as ${user.primaryEmail}` : ""}. Finished runs are checked on the server. Claim asks Telegram to approve the withdrawal, then your wallet sends it.
        </p>
        <TelegramLink />
        <button
          type="button"
          className="theme-btn-ghost w-full"
          onClick={() => {
            window.dispatchEvent(new Event("moon-open-wallet"));
            setError("");
            setInfo("");
          }}
        >
          Connect a payout wallet
        </button>
        <button type="button" disabled={busy} className="theme-btn w-full" onClick={() => void linkConnected()}>
          {busy ? "Waiting for the wallet…" : "Link the connected wallet"}
        </button>
        {error && <p className="text-sm text-coral">{error}</p>}
        {info && <p className="text-sm text-gold">{info}</p>}
      </div>
    );
  }

  async function linkConnected() {
    const address = connectedAddress();
    if (!address) {
      window.dispatchEvent(new Event("moon-open-wallet"));
      setError("Connect a wallet first, then link it.");
      return;
    }
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const challenge = await walletChallenge({ data: { address, purpose: "link" } });
      const signature = await personalSign(challenge.message);
      const linked = await linkPayoutWallet({ data: { address, signature } });
      setInfo(`Payout wallet linked: ${linked.address.slice(0, 6)}…${linked.address.slice(-4)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not link that wallet.");
    } finally {
      setBusy(false);
    }
  }

  async function submitEmail(event: FormEvent) {
    event.preventDefault();
    setError("");
    setInfo("");
    setResetPath("");
    const mail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      setError("Enter a real email address.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "forgot") {
        if (mail.endsWith("@wallet.dogerun.gg")) {
          setError("Wallet accounts don't use a password. Sign in with the wallet.");
          return;
        }
        const result = await authClient.requestPasswordReset({
          email: mail,
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (result.error) throw new Error(result.error.message || "Could not start the reset.");
        const peeked = await peekResetLink({ data: { email: mail } });
        if (peeked.path && peeked.viaTelegram) {
          setResetPath(peeked.path);
          setInfo("Email isn't configured here. The reset link is below, and the same link was sent to the linked Telegram chat.");
        } else if (peeked.path) {
          setResetPath(peeked.path);
          setInfo("Email delivery isn't configured here. Use the reset link below. Link Telegram in Account and the next reset goes there too.");
        } else {
          setInfo("If that email has an account, the reset link is on its way. A linked Telegram chat gets it too.");
        }
        return;
      }
      if (password.length < 8) {
        setError("Use at least 8 characters.");
        return;
      }
      if (mode === "up") {
        if (password !== confirm) {
          setError("Those passwords don't match.");
          return;
        }
        const result = await authClient.signUp.email({
          email: mail,
          password,
          name: name.trim() || "Doge",
          fetchOptions: bearerFetch,
        });
        if (result.error) throw new Error(result.error.message || "Could not create the account.");
      } else {
        const result = await authClient.signIn.email({
          email: mail,
          password,
          fetchOptions: bearerFetch,
        });
        if (result.error) throw new Error(result.error.message || "Email or password is wrong.");
      }
      await authClient.getSession();
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function submitWallet() {
    const address = connectedAddress();
    if (!address) {
      window.dispatchEvent(new Event("moon-open-wallet"));
      setError("Connect a wallet first, then sign in with it.");
      return;
    }
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const challenge = await walletChallenge({ data: { address, purpose: "sign-in" } });
      const signature = await personalSign(challenge.message);
      const creds = await walletLogin({ data: { address, signature } });
      const existing = await authClient.signIn.email({
        email: creds.email,
        password: creds.password,
        fetchOptions: bearerFetch,
      });
      if (existing.error) {
        const created = await authClient.signUp.email({
          email: creds.email,
          password: creds.password,
          name: creds.name,
          fetchOptions: bearerFetch,
        });
        if (created.error) throw new Error(created.error.message || "Could not create the wallet account.");
      }
      await bindSessionWallet();
      await authClient.getSession();
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wallet sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="theme-tabs" role="tablist" aria-label="Account">
        {(
          [
            ["in", "Sign in"],
            ["up", "Sign up"],
            ["forgot", "Reset"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            className="theme-tab"
            onClick={() => {
              setMode(id);
              setError("");
              setInfo("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <form className="grid gap-3" onSubmit={(event) => void submitEmail(event)}>
        {mode === "up" && (
          <label className="grid gap-1 text-xs font-semibold text-muted">
            Player name
            <input
              value={name}
              maxLength={18}
              autoComplete="nickname"
              className="theme-field"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        )}
        <label className="grid gap-1 text-xs font-semibold text-muted">
          Email
          <input
            type="email"
            required
            value={email}
            autoComplete="email"
            className="theme-field"
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        {mode !== "forgot" && (
          <label className="grid gap-1 text-xs font-semibold text-muted">
            Password
            <input
              type="password"
              required
              value={password}
              autoComplete={mode === "up" ? "new-password" : "current-password"}
              className="theme-field"
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        )}
        {mode === "up" && (
          <label className="grid gap-1 text-xs font-semibold text-muted">
            Confirm password
            <input
              type="password"
              required
              value={confirm}
              autoComplete="new-password"
              className="theme-field"
              onChange={(event) => setConfirm(event.target.value)}
            />
          </label>
        )}
        <button type="submit" disabled={busy} className="theme-btn w-full">
          {busy ? "Working…" : mode === "up" ? "Create account" : mode === "forgot" ? "Send reset link" : "Sign in"}
        </button>
      </form>
      {mode !== "forgot" && (
        <>
          <button type="button" disabled={busy} className="theme-btn-line w-full" onClick={() => void submitWallet()}>
            Sign in with wallet
          </button>
          <div className="grid grid-cols-2 gap-2">
            {GROK_PROVIDERS.map((provider) => (
              <button
                key={provider.providerId}
                type="button"
                className="theme-btn-ghost"
                onClick={() => void signIn(provider.providerId, { callbackURL: "/" })}
              >
                {provider.label}
              </button>
            ))}
          </div>
        </>
      )}
      {error && <p className="text-sm text-coral">{error}</p>}
      {info && <p className="text-sm leading-6 text-muted">{info}</p>}
      {resetPath && (
        <a className="text-sm font-semibold text-gold underline" href={resetPath}>
          Open the reset page
        </a>
      )}
    </div>
  );
}

function TelegramLink() {
  const [tg, setTg] = useState<TelegramStatus | null>(null);
  const [code, setCode] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [cmd, setCmd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => {
    let cancel = false;
    void telegramStatus()
      .then((row) => {
        if (!cancel) setTg(row);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);

  async function connect() {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const minted = await connectTelegram();
      setCode(minted.code);
      setUrl(minted.url);
      setInfo(minted.url ? "Open the bot, then press Start." : `Send /start ${minted.code} to the bot.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the Telegram link.");
    } finally {
      setBusy(false);
    }
  }

  async function finishPreview() {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const row = await previewFinishTelegram({ data: { code } });
      setTg(row);
      setInfo("Preview chat linked. Resets and withdrawal notes show below.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not link the preview chat.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(approve: boolean) {
    if (!tg?.request) return;
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const result = await previewDecideWithdrawal({ data: { id: tg.request.id, approve } });
      setTg(result.status);
      setInfo(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not decide that withdrawal.");
    } finally {
      setBusy(false);
    }
  }

  async function sendCommand(event: FormEvent) {
    event.preventDefault();
    const text = cmd.trim();
    if (!text) return;
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const row = await previewTelegramCommand({ data: { text } });
      setTg(row);
      setCmd("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The preview bot didn't answer.");
    } finally {
      setBusy(false);
    }
  }

  const pending = tg?.preview && tg.request?.status === "pending";

  return (
    <div className="grid gap-2 rounded-2xl border border-line bg-bg p-3">
      <p className="text-xs font-semibold tracking-widest text-gold uppercase">Telegram</p>
      {tg?.linked ? (
        <p className="text-sm leading-6 text-muted">
          Linked{tg.username ? ` as @${tg.username}` : ""}. Password resets and withdrawal updates go to that chat.
        </p>
      ) : (
        <p className="text-sm leading-6 text-muted">
          Link a chat for password resets. Withdrawals wait for an admin approval in Telegram before $DRUN can move.
        </p>
      )}
      <button type="button" disabled={busy} className="theme-btn-ghost w-full" onClick={() => void connect()}>
        {busy ? "Working…" : tg?.linked ? "New link code" : "Connect Telegram"}
      </button>
      {code && (
        <p className="text-sm leading-6 text-fg">
          Code <span className="font-semibold text-gold">{code}</span>
          {url && (
            <>
              {" "}
              ·{" "}
              <a className="font-semibold text-gold underline" href={url} target="_blank" rel="noreferrer">
                Open the bot
              </a>
            </>
          )}
        </p>
      )}
      {tg?.preview && code && !tg.linked && (
        <button type="button" disabled={busy} className="theme-btn w-full" onClick={() => void finishPreview()}>
          Link preview chat
        </button>
      )}
      {tg?.preview && (
        <p className="text-xs leading-5 text-muted">
          This preview has no live bot. Approve withdrawals here. On your domain, only the admin chat can.
        </p>
      )}
      {tg && !tg.preview && !tg.adminReady && (
        <p className="text-xs leading-5 text-muted">The host still needs TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID before an admin can approve.</p>
      )}
      {tg?.request && (
        <p className="text-sm leading-6 text-fg">
          Latest withdrawal: {tg.request.drun.toFixed(1)} $DRUN · {tg.request.status}
        </p>
      )}
      {pending && tg.request && (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={busy} className="theme-btn w-full" onClick={() => void decide(true)}>
            Approve
          </button>
          <button type="button" disabled={busy} className="theme-btn-ghost" onClick={() => void decide(false)}>
            Reject
          </button>
        </div>
      )}
      {tg?.preview && tg.linked && (
        <form className="grid gap-2" onSubmit={(event) => void sendCommand(event)}>
          <input
            value={cmd}
            placeholder="/reset you@email.com"
            className="theme-field"
            onChange={(event) => setCmd(event.target.value)}
          />
          <button type="submit" disabled={busy} className="theme-btn-ghost w-full">
            Send to the preview bot
          </button>
        </form>
      )}
      {tg?.preview && tg.inbox.length > 0 && (
        <ul className="grid max-h-36 gap-2 overflow-auto text-xs leading-5 text-muted">
          {tg.inbox.map((item) => (
            <li key={item.id} className="rounded-xl border border-line px-2 py-1 whitespace-pre-wrap">
              <span className="font-semibold text-gold">{item.role === "admin" ? "Admin" : "Bot"} · </span>
              {item.text}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-coral">{error}</p>}
      {info && <p className="text-sm leading-6 text-gold">{info}</p>}
    </div>
  );
}

export function AccountPanel() {
  const [open, setOpen] = useState(false);
  const { user, isPending } = useCurrentUserState();

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("moon-open-account", onOpen);
    return () => window.removeEventListener("moon-open-account", onOpen);
  }, []);

  return (
    <>
      <button
        type="button"
        data-no-jump
        className="min-h-10 max-w-36 truncate rounded-full border border-line bg-surface px-3 py-2 text-xs font-semibold sm:text-sm"
        onClick={() => setOpen(true)}
      >
        {isPending ? "Account" : user?.displayName || "Account"}
      </button>
      {open && (
        <div data-no-jump className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-black/55 p-4" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-label="Account"
            className="theme-card max-h-[90dvh] w-full max-w-md overflow-auto"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold tracking-widest text-gold uppercase">Account</p>
                <h2 className="mt-1 font-display text-2xl font-extrabold">Your run</h2>
                <p className="mt-1 text-sm leading-6 text-muted">Email, wallet, Telegram resets, and withdrawal requests. The same night-run account pays $DRUN.</p>
              </div>
              <button type="button" className="theme-btn-ghost w-11 shrink-0 px-0" aria-label="Close" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>
            <AccountAuth onDone={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
