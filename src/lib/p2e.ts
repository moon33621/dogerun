import {
  connectTelegramChat,
  creditTelegramRun,
  decideTelegramWithdrawal,
  finishTelegramLink,
  readTelegramStatus,
  requestTelegramClaim,
  runTelegramCommand,
  telegramBalance,
} from "@/lib/telegram-bot";

const stub = { ok: true, credited: 0, capped: false, balance: 0, earned: 0, linked: false, username: null as string | null, message: "", challenge: "stub", hash: "", waiting: 0, preview: null, request: null, adminReady: false, inbox: [] as unknown[] };

export async function getLeaderboard(..._args: unknown[]): Promise<any[]> { return []; }
export async function getMyEarn(..._args: unknown[]): Promise<any> {
  const status = readTelegramStatus();
  return { ...stub, balance: telegramBalance(), linked: status.linked, username: status.username };
}
export async function requestClaim(..._args: unknown[]): Promise<any> { return requestTelegramClaim(); }
export async function submitRun(args?: { data?: { dist?: number; coins?: number; bones?: number } }): Promise<any> {
  const run = args?.data ?? {};
  const saved = creditTelegramRun(Number(run.dist || 0), Number(run.coins || 0), Number(run.bones || 0));
  return { ...stub, ...saved, capped: false, waiting: 0, board: [] };
}
export async function bindSessionWallet(..._args: unknown[]): Promise<any> { return { ...stub }; }
export async function connectTelegram(..._args: unknown[]): Promise<any> { return connectTelegramChat(); }
export async function linkPayoutWallet(..._args: unknown[]): Promise<any> { return { ...stub }; }
export async function peekResetLink(..._args: unknown[]): Promise<any> { return { ...stub }; }
export async function previewDecideWithdrawal(args?: { data?: { id?: string; approve?: boolean } }): Promise<any> {
  return decideTelegramWithdrawal(args?.data?.id || "", Boolean(args?.data?.approve));
}
export async function previewFinishTelegram(args?: { data?: { code?: string } }): Promise<any> {
  return finishTelegramLink(args?.data?.code || "");
}
export async function previewTelegramCommand(args?: { data?: { text?: string } }): Promise<any> {
  return runTelegramCommand(args?.data?.text || "");
}
export async function telegramStatus(..._args: unknown[]): Promise<any> { return readTelegramStatus(); }
export async function walletChallenge(..._args: unknown[]): Promise<any> { return { ...stub }; }
export async function walletLogin(..._args: unknown[]): Promise<any> { return { ...stub }; }
