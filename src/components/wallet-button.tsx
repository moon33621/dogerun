import { useCallback, useEffect, useState } from "react";

const BSC_ID = "0x38";
const TOKEN = "0x29b86ecb7d434a5571f959f1c9a812b7aab34894";
const RPC = "https://bsc-dataseed.binance.org";

type Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, cb: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, cb: (...args: unknown[]) => void) => void;
};

type Wallet = {
  uuid: string;
  name: string;
  icon: string;
  provider: Provider;
};

type Session = {
  wallet: Wallet;
  address: string;
  chainId: string;
  drun: string | null;
};

const CHAINS: Record<string, string> = {
  "0x1": "Ethereum",
  "0x38": "BNB Chain",
  "0x89": "Polygon",
  "0xa4b1": "Arbitrum",
  "0xa": "Optimism",
  "0x2105": "Base",
  "0xaa36a7": "Sepolia",
};

function short(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatUnits(hex: string, decimals: number) {
  const raw = BigInt(hex);
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = (raw % base).toString().padStart(decimals, "0").slice(0, 2);
  return `${whole.toString()}.${frac}`;
}

async function rpc(method: string, params: unknown[]) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: string; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result ?? "0x0";
}

async function readDrun(address: string) {
  const padded = address.slice(2).toLowerCase().padStart(64, "0");
  const [raw, dec] = await Promise.all([
    rpc("eth_call", [{ to: TOKEN, data: `0x70a08231${padded}` }, "latest"]),
    rpc("eth_call", [{ to: TOKEN, data: "0x313ce567" }, "latest"]),
  ]);
  const decimals = Number(BigInt(dec));
  return formatUnits(raw, Number.isFinite(decimals) ? decimals : 18);
}

export type WalletSnap = { address: string; walletName: string } | null;

let walletSnap: WalletSnap = null;
const walletSubs = new Set<(snap: WalletSnap) => void>();

export function watchWallet(cb: (snap: WalletSnap) => void) {
  walletSubs.add(cb);
  cb(walletSnap);
  return () => walletSubs.delete(cb);
}

let connectedProvider: Provider | null = null;

export function getConnectedProvider() {
  return connectedProvider;
}

export function connectedAddress() {
  return walletSnap?.address?.startsWith("0x") ? walletSnap.address : null;
}

export async function personalSign(message: string) {
  const provider = connectedProvider;
  const address = connectedAddress();
  if (!provider || !address) throw new Error("Connect a wallet first.");
  const signature = (await provider.request({
    method: "personal_sign",
    params: [message, address],
  })) as string;
  if (!signature?.startsWith("0x")) throw new Error("The wallet didn't return a signature.");
  return signature;
}

function publishWallet(snap: WalletSnap, provider?: Provider | null) {
  walletSnap = snap;
  if (!snap) connectedProvider = null;
  else if (provider !== undefined) connectedProvider = provider;
  walletSubs.forEach((cb) => cb(snap));
}

function listWallets(found: Wallet[], session: Session | null) {
  if (found.length > 0) return found;
  return session ? [session.wallet] : [];
}

export function WalletButton() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const found = new Map<string, Wallet>();
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<{ info: { uuid: string; name: string; icon: string }; provider: Provider }>).detail;
      if (!detail?.info || !detail.provider) return;
      found.set(detail.info.uuid, {
        uuid: detail.info.uuid,
        name: detail.info.name,
        icon: detail.info.icon,
        provider: detail.provider,
      });
      setWallets([...found.values()]);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const openWallet = () => setOpen(true);
    window.addEventListener("moon-open-wallet", openWallet);
    const timer = window.setTimeout(() => {
      const eth = (window as unknown as { ethereum?: Provider & { providers?: Provider[] } }).ethereum;
      if (!eth) return;
      const list = eth.providers?.length ? eth.providers : [eth];
      list.forEach((provider, i) => {
        const uuid = `legacy-${i}`;
        if ([...found.values()].some((w) => w.provider === provider)) return;
        found.set(uuid, {
          uuid,
          name: list.length === 1 ? "Browser wallet" : `Installed wallet ${i + 1}`,
          icon: "",
          provider,
        });
      });
      setWallets([...found.values()]);
    }, 400);
    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      window.removeEventListener("moon-open-wallet", openWallet);
      window.clearTimeout(timer);
    };
  }, []);

  const refresh = useCallback(async (wallet: Wallet, address: string, chainId: string) => {
    let drun: string | null = null;
    try {
      drun = await readDrun(address);
    } catch {
      drun = null;
    }
    setSession({ wallet, address, chainId, drun });
    publishWallet({ address, walletName: wallet.name }, wallet.provider);
  }, []);

  const connect = async (wallet: Wallet) => {
    setBusy(wallet.uuid);
    setError("");
    try {
      const accounts = (await wallet.provider.request({ method: "eth_requestAccounts" })) as string[];
      const address = accounts[0];
      if (!address) throw new Error("No account returned");
      let chainId = (await wallet.provider.request({ method: "eth_chainId" })) as string;
      if (chainId.toLowerCase() !== BSC_ID) {
        try {
          await wallet.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BSC_ID }] });
          chainId = BSC_ID;
        } catch (err) {
          const code = (err as { code?: number }).code;
          if (code === 4902) {
            await wallet.provider.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId: BSC_ID,
                  chainName: "BNB Smart Chain",
                  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
                  rpcUrls: [RPC],
                  blockExplorerUrls: ["https://bscscan.com"],
                },
              ],
            });
            chainId = BSC_ID;
          }
        }
      }
      await refresh(wallet, address, chainId);
      setOpen(false);
    } catch (err) {
      const code = (err as { code?: number }).code;
      setError(code === 4001 ? "Connection cancelled." : "Could not connect that wallet.");
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (!session) return;
    const provider = session.wallet.provider;
    const onAccounts = (accounts: unknown) => {
      const next = (accounts as string[])[0];
      if (!next) {
        setSession(null);
        publishWallet(null);
      } else void refresh(session.wallet, next, session.chainId);
    };
    const onChain = (chainId: unknown) => {
      void refresh(session.wallet, session.address, String(chainId));
    };
    provider.on?.("accountsChanged", onAccounts);
    provider.on?.("chainChanged", onChain);
    return () => {
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, [session, refresh]);

  return (
    <>
      <button
        type="button"
        data-no-jump
        className="min-h-10 rounded-full border border-gold/60 bg-surface px-3 py-2 text-xs font-semibold text-fg transition hover:border-gold hover:text-gold sm:px-4 sm:text-sm"
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        {session ? short(session.address) : "Connect wallet"}
      </button>
      {open && (
        <div
          data-no-jump
          className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Connect a wallet"
            className="theme-card w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-extrabold">Connect a wallet</h2>
                <p className="mt-1 text-sm text-muted">MetaMask, Rabby, Coinbase, Trust, OKX, Brave, and any other installed wallet.</p>
              </div>
              <button type="button" className="rounded-full px-2 text-lg text-muted" onClick={() => setOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
            {session && (
              <div className="mt-4 rounded-xl border border-line bg-bg px-3 py-3 text-sm">
                <p className="font-semibold">{short(session.address)}</p>
                <p className="mt-1 text-muted">{CHAINS[session.chainId.toLowerCase()] ?? "Other network"}</p>
                <p className="mt-1 text-gold">{session.drun == null ? "DRUN balance unavailable" : `${session.drun} DRUN`}</p>
                <button
                  type="button"
                  className="mt-3 text-sm font-semibold text-muted underline"
                  onClick={() => {
                    setSession(null);
                    publishWallet(null);
                    setOpen(false);
                  }}
                >
                  Disconnect
                </button>
              </div>
            )}
            <ul className="mt-4 grid gap-2">
              {listWallets(wallets, session).map((wallet) => (
                <li key={wallet.uuid}>
                  <button
                    type="button"
                    disabled={busy === wallet.uuid}
                    className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-line bg-bg px-3 text-left font-semibold transition hover:border-gold"
                    onClick={() => void connect(wallet)}
                  >
                    {wallet.icon ? (
                      <img src={wallet.icon} alt="" className="size-7 rounded-md" />
                    ) : (
                      <span className="grid size-7 place-items-center rounded-md bg-gold text-xs text-bg">W</span>
                    )}
                    <span>{busy === wallet.uuid ? "Waiting for approval…" : wallet.name}</span>
                  </button>
                </li>
              ))}
              {wallets.length === 0 && !session && (
                <li className="rounded-xl border border-dashed border-line px-3 py-3 text-sm text-muted">
                  No wallet found in this browser. Install MetaMask, Rabby, Coinbase Wallet, Trust, or OKX, then come back.
                </li>
              )}
            </ul>
            {error && <p className="mt-3 text-sm text-gold">{error}</p>}
          </div>
        </div>
      )}
    </>
  );
}
