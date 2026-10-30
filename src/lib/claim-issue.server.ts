import { getSql, type Sql } from "@/lib/db";
import { PAYOUT_ABI } from "@/lib/payout-abi";
import { BSC_CHAIN_ID, DRUN_TOKEN, TREASURY_DAILY_TENTHS } from "@/lib/p2e-check";

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

/** Return expired open vouchers to the balance and the daily treasury. */
export async function refundExpiredClaims(sql: Sql, userId: string) {
  const nowSec = Math.floor(Date.now() / 1000);
  const expired = await sql<{ id: string; tenths: number; day: string }>`
    select id, tenths, day from payout_claims
    where user_id = ${userId} and status = 'open' and deadline <= ${nowSec - 120}
  `;
  for (const row of expired) {
    const flipped = await sql<{ id: string }>`
      update payout_claims set status = 'expired'
      where id = ${row.id} and status = 'open'
      returning id
    `;
    if (!flipped.length) continue;
    const tenths = num(row.tenths);
    await sql`
      insert into user_balance (user_id, unclaimed_tenths) values (${userId}, ${tenths})
      on conflict (user_id) do update
      set unclaimed_tenths = user_balance.unclaimed_tenths + ${tenths}
    `;
    await sql`
      update treasury_day
      set spent_tenths = greatest(0, spent_tenths - ${tenths})
      where day = ${row.day}
    `;
  }
}

/**
 * Reserve the treasury, deduct the balance, and store a signed BSC voucher.
 * Throws after putting the tenths back if signing fails.
 */
export async function issueSignedClaim(userId: string, wallet: string, tenths: number) {
  const contract = process.env.PAYOUT_CONTRACT?.trim() ?? "";
  if (!ADDRESS.test(contract)) throw new Error("The payout contract isn't set on this site yet.");
  const sql = await getSql();
  const day = utcDay();
  const reserved = await sql<{ spent: number }>`
    insert into treasury_day (day, spent_tenths) values (${day}, ${tenths})
    on conflict (day) do update
      set spent_tenths = treasury_day.spent_tenths + ${tenths}
      where treasury_day.spent_tenths + ${tenths} <= ${TREASURY_DAILY_TENTHS}
    returning spent_tenths as spent
  `;
  if (!reserved.length) throw new Error("The treasury's daily limit is used up. Try again tomorrow.");

  const deducted = await sql`
    update user_balance
    set unclaimed_tenths = unclaimed_tenths - ${tenths}
    where user_id = ${userId} and unclaimed_tenths >= ${tenths}
    returning unclaimed_tenths
  `;
  if (!deducted.length) {
    await sql`
      update treasury_day set spent_tenths = greatest(0, spent_tenths - ${tenths}) where day = ${day}
    `;
    throw new Error("Nothing to claim yet. Finish a run first.");
  }

  try {
    const signed = await signVoucher(wallet, tenths, contract);
    const { randomUUID } = await import("node:crypto");
    await sql`
      insert into payout_claims (
        id, user_id, wallet, tenths, amount_wei, nonce, deadline, signature, calldata, contract, status, day
      ) values (
        ${randomUUID()}, ${userId}, ${wallet}, ${tenths}, ${signed.amountWei}, ${signed.nonce},
        ${signed.deadline}, ${signed.signature}, ${signed.data}, ${signed.contract}, 'open', ${day}
      )
    `;
    return { contract: signed.contract, data: signed.data, tenths };
  } catch (err) {
    await sql`
      update user_balance set unclaimed_tenths = unclaimed_tenths + ${tenths} where user_id = ${userId}
    `;
    await sql`
      update treasury_day set spent_tenths = greatest(0, spent_tenths - ${tenths}) where day = ${day}
    `;
    throw err instanceof Error ? err : new Error("Could not sign the claim.");
  }
}

async function signVoucher(wallet: string, tenths: number, contract: string) {
  const { keccak256, encodeAbiParameters, toBytes, encodeFunctionData, getAddress, isAddress } = await import("viem");
  const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts");
  if (!isAddress(contract) || !isAddress(wallet)) throw new Error("Payout address is not valid.");

  const rawKey = process.env.CLAIM_SIGNER_PRIVATE_KEY?.trim();
  let key: `0x${string}` | null = null;
  if (rawKey) {
    const hex = rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`;
    if (/^0x[a-fA-F0-9]{64}$/.test(hex)) key = hex as `0x${string}`;
  } else if (!process.env.DATABASE_URL?.trim()) {
    const slot = globalThis as typeof globalThis & { __drunClaimKey__?: `0x${string}` };
    slot.__drunClaimKey__ ??= generatePrivateKey();
    key = slot.__drunClaimKey__;
  }
  if (!key) throw new Error("The claim signer isn't configured on this site yet.");

  const { randomBytes } = await import("node:crypto");
  const decimals = await drunDecimals();
  const amount = (BigInt(tenths) * 10n ** BigInt(decimals)) / 10n;
  const nonce = BigInt(`0x${randomBytes(16).toString("hex")}`);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 60);
  const to = getAddress(wallet);
  const payout = getAddress(contract);
  const tag = keccak256(toBytes("DRUN_CLAIM_V1"));
  const digest = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
      ],
      [tag, to, amount, nonce, deadline, payout, BigInt(BSC_CHAIN_ID)],
    ),
  );
  const account = privateKeyToAccount(key);
  const signature = await account.signMessage({ message: { raw: digest } });
  const data = encodeFunctionData({
    abi: PAYOUT_ABI,
    functionName: "claim",
    args: [to, amount, nonce, deadline, signature],
  });
  return {
    amountWei: amount.toString(),
    nonce: nonce.toString(),
    deadline: Number(deadline),
    signature,
    data,
    contract: payout,
  };
}

async function drunDecimals() {
  const slot = globalThis as typeof globalThis & { __drunDecimals__?: number };
  if (slot.__drunDecimals__) return slot.__drunDecimals__;
  try {
    const res = await fetch("https://bsc-dataseed.binance.org", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: DRUN_TOKEN, data: "0x313ce567" }, "latest"],
      }),
    });
    const json = (await res.json()) as { result?: string };
    const n = Number(BigInt(json.result || "0x12"));
    slot.__drunDecimals__ = Number.isInteger(n) && n >= 0 && n <= 36 ? n : 18;
  } catch {
    slot.__drunDecimals__ = 18;
  }
  return slot.__drunDecimals__;
}
