import { createFileRoute } from "@tanstack/react-router";
import { AccountAuth } from "@/components/account-auth";
import { SiteFrame } from "@/components/site-frame";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  return (
    <SiteFrame
      kicker="Account"
      title="Sign in"
      lede="Save each run, climb the shared board, and claim $DRUN to a wallet you control."
    >
      <AccountAuth />
    </SiteFrame>
  );
}
