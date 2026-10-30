/**
 * Deploy contracts/DogeRunPayout.sol to BSC and print the address to set as PAYOUT_CONTRACT.
 *
 * Required in the environment (never commit these):
 *   DEPLOYER_PRIVATE_KEY   wallet that pays BNB gas and becomes the owner
 *   CLAIM_SIGNER_PRIVATE_KEY  server key that will sign claims (or it is generated and printed)
 *
 * Optional:
 *   DRUN_TOKEN   defaults to the Doge Run token
 *   BSC_RPC_URL  defaults to the public BSC dataseed
 *   DAILY_DRUN   defaults to 10000 (whole tokens, 18 decimals assumed if the token call fails)
 *
 * After it prints the address, set PAYOUT_CONTRACT on the host and transfer $DRUN to that address.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, http, decodeFunctionResult, encodeFunctionData } from "viem";
import { bsc } from "viem/chains";

const require = createRequire(import.meta.url);
const TOKEN = process.env.DRUN_TOKEN?.trim() || "0x29b86ecb7d434a5571f959f1c9a812b7aab34894";
const RPC = process.env.BSC_RPC_URL?.trim() || "https://bsc-dataseed.binance.org";

function key(name, { generate = false } = {}) {
  const raw = process.env[name]?.trim();
  if (raw) return raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!generate) {
    console.error(`Missing ${name}.`);
    process.exit(1);
  }
  const made = generatePrivateKey();
  console.log(`${name} was not set. Generated (save this, it is not stored): ${made}`);
  return made;
}

function compile() {
  const solc = require("solc");
  const source = readFileSync(new URL("../contracts/DogeRunPayout.sol", import.meta.url), "utf8");
  const input = {
    language: "Solidity",
    sources: { "DogeRunPayout.sol": { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter((item) => item.severity === "error");
  if (errors.length) {
    console.error(errors.map((item) => item.formattedMessage).join("\n"));
    process.exit(1);
  }
  const contract = output.contracts["DogeRunPayout.sol"].DogeRunPayout;
  return { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` };
}

const deployerKey = key("DEPLOYER_PRIVATE_KEY");
const signerKey = key("CLAIM_SIGNER_PRIVATE_KEY", { generate: true });
const deployer = privateKeyToAccount(deployerKey);
const signer = privateKeyToAccount(signerKey);
const { abi, bytecode } = compile();

const publicClient = createPublicClient({ chain: bsc, transport: http(RPC) });
const walletClient = createWalletClient({ account: deployer, chain: bsc, transport: http(RPC) });

let decimals = 18;
try {
  const data = encodeFunctionData({
    abi: [{ type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] }],
    functionName: "decimals",
  });
  const raw = await publicClient.call({ to: TOKEN, data });
  decimals = Number(
    decodeFunctionResult({
      abi: [{ type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] }],
      functionName: "decimals",
      data: raw.data,
    }),
  );
} catch {
  console.log("Could not read token decimals, using 18.");
}

const dailyWhole = BigInt(process.env.DAILY_DRUN?.trim() || "10000");
const dailyLimit = dailyWhole * 10n ** BigInt(decimals);

console.log(`Deployer ${deployer.address}`);
console.log(`Signer   ${signer.address}`);
console.log(`Daily limit ${dailyWhole.toString()} tokens (${dailyLimit.toString()} base units)`);

const hash = await walletClient.deployContract({
  abi,
  bytecode,
  args: [TOKEN, signer.address, dailyLimit],
});
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log(`PAYOUT_CONTRACT=${receipt.contractAddress}`);
console.log("Transfer $DRUN to that address. Set PAYOUT_CONTRACT and CLAIM_SIGNER_PRIVATE_KEY on the host.");
