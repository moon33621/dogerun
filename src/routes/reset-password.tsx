import { useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { authClient } from "@/lib/auth/client";
import { SiteFrame } from "@/components/site-frame";

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
    error: typeof search.error === "string" ? search.error : "",
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token, error: tokenError } = Route.useSearch();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(tokenError === "INVALID_TOKEN" ? "That reset link is invalid or expired." : "");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!token) {
      setError("This page needs a reset link.");
      return;
    }
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const result = await authClient.resetPassword({ newPassword: password, token });
      if (result.error) throw new Error(result.error.message || "Could not reset the password.");
      await navigate({ to: "/login" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset the password.");
      setBusy(false);
    }
  }

  return (
    <SiteFrame
      kicker="Account"
      title="New password"
      lede="This replaces the password on your email account. Wallet sign-in stays the same."
    >
      <form className="grid gap-3" onSubmit={(event) => void submit(event)}>
        <label className="grid gap-1 text-xs font-semibold text-muted">
          New password
          <input
            type="password"
            required
            value={password}
            autoComplete="new-password"
            className="theme-field"
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
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
        <button type="submit" disabled={busy || !token} className="theme-btn w-full">
          {busy ? "Saving…" : "Update password"}
        </button>
        {!token && <p className="text-sm leading-6 text-muted">Open the link from your reset email. It expires in one hour.</p>}
        {error && <p className="text-sm text-coral">{error}</p>}
      </form>
    </SiteFrame>
  );
}
