import assert from "node:assert/strict";
import test from "node:test";
import { checkRun, rewardTenths } from "./p2e-check.ts";

test("a real short run is payable", () => {
  const run = {
    dist: 100,
    coins: 5,
    bones: 1,
    tricks: 0,
    durationMs: 10_000,
    score: 100 + 5 * 15 + 30,
    name: "Doge",
  };
  assert.deepEqual(checkRun(run), { ok: true });
  assert.equal(rewardTenths(100, 5, 1), 130);
});

test("a forged score is rejected", () => {
  const verdict = checkRun({
    dist: 10,
    coins: 0,
    bones: 0,
    tricks: 0,
    durationMs: 5_000,
    score: 999_999,
    name: "Doge",
  });
  assert.equal(verdict.ok, false);
});

test("a teleport pace is rejected", () => {
  const verdict = checkRun({
    dist: 10_000,
    coins: 0,
    bones: 0,
    tricks: 0,
    durationMs: 2_000,
    score: 10_000,
    name: "Doge",
  });
  assert.equal(verdict.ok, false);
});
