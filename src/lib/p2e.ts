const stub = { ok: true, credited: 0, capped: false, balance: 0, earned: 0, linked: false, username: null as string | null, message: "", challenge: "stub", hash: "", waiting: 0, preview: null, request: null, adminReady: false, inbox: [] as unknown[] };

export async function getLeaderboard(..._args: unknown[]): Promise<any[]> { return []; }
export async function getMyEarn(..._args: unknown[]): Promise<any> { return { ...stub }; }
export async function requestClaim(..._args: unknown[]): Promise<any> { return { ...stub }; }
export async function submitRun(..._args: unknown[]): Promise<any> { return { ...stub }; }
export async function bindSessionWallet(..._args: unknown[]): Promise<any> { return { ...stub }; }
export async function connectTelegram(..._args: unknown[]): Promise<any> { return { ...stub }; }
export async function linkPayoutWallet(..._args: unknown[]): Promise<any> { return { ...stub }; }
export async function peekResetLink(..._args: unknown[]): Promise<any> { return { ...stub }; }
export async function previewDecideWithdrawal(..._args: unknown[]): Promise<any> { return { ...stub }; }
export async function previewFinishTelegram(..._args: unknown[]): Promise<any> { return { ...stub }; }
export async function previewTelegramCommand(..._args: unknown[]): Promise<any> { return { ...stub }; }
export async function telegramStatus(..._args: unknown[]): Promise<any> { return { ...stub }; }
export async function walletChallenge(..._args: unknown[]): Promise<any> { return { ...stub }; }
export async function walletLogin(..._args: unknown[]): Promise<any> { return { ...stub }; }
