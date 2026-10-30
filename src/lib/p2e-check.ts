export type RunPayload = any;

export const TREASURY_DAILY_TENTHS = 0;
export const BSC_CHAIN_ID = 56;
export const DRUN_TOKEN = "0x0000000000000000000000000000000000000000";

export function tenthsToDrun(n: number) {
  return n / 10;
}
