export function formatDrun(n: number) {
  return (Math.round(Number(n) * 10) / 10).toFixed(1);
}

export function rewardOf(dist?: number, coins?: number, bones?: number) {
  return Math.round((Number(dist || 0) * 0.05 + Number(coins || 0) + Number(bones || 0) * 3) * 10) / 10;
}
