import assert from "node:assert/strict";
import test from "node:test";
import { parseBotCommand, parseCallback } from "./telegram-bot.ts";

test("start carries an 8-character link code", () => {
  assert.deepEqual(parseBotCommand("/start Ab12Cd34"), { type: "start", code: "ab12cd34" });
  assert.deepEqual(parseBotCommand("/start@DogeRunBot"), { type: "start", code: null });
});

test("reset only accepts a real email", () => {
  assert.deepEqual(parseBotCommand("/reset Nova@Example.com"), { type: "reset", email: "nova@example.com" });
  assert.deepEqual(parseBotCommand("/reset"), { type: "reset", email: null });
});

test("withdraw and help", () => {
  assert.deepEqual(parseBotCommand("/withdraw"), { type: "withdraw" });
  assert.deepEqual(parseBotCommand("hello"), { type: "help" });
});

test("approval buttons only match our callback shape", () => {
  const id = "11111111-1111-1111-1111-111111111111";
  assert.deepEqual(parseCallback(`wd:ok:${id}`), { id, approve: true });
  assert.equal(parseCallback("wd:ok:nope"), null);
});
