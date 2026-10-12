const test = require("node:test");
const assert = require("node:assert/strict");
const { buildLedger, suggestSettlements } = require("../src/services/expenseLedger.service");

const id = (digit) => digit.repeat(24);
const expense = ({ payer, total, currency = "INR", allocations, status = "ACTIVE" }) => ({
  payer: id(payer), payerNameAtCreation: `Member ${payer}`,
  amountMinorUnits: total, currency, status,
  allocations: allocations.map(([user, amount]) => ({ user: id(user), nameAtCreation: `Member ${user}`, amountMinorUnits: amount })),
});
const settlement = ({ from, to, amount, currency = "INR", status = "RECORDED" }) => ({
  fromUser: id(from), fromNameAtCreation: `Member ${from}`, toUser: id(to), toNameAtCreation: `Member ${to}`, amountMinorUnits: amount, currency, status,
});

test("ledger derives paid, shares, settlements and zero-sum balances independently per currency", () => {
  const ledger = buildLedger({
    members: [{ userId: id("a"), name: "A" }, { userId: id("b"), name: "B" }, { userId: id("c"), name: "C" }],
    expenses: [expense({ payer: "a", total: 10001, allocations: [["a", 5001], ["b", 5000]] }), expense({ payer: "b", total: 3000, allocations: [["b", 1000], ["c", 2000]] }), expense({ payer: "c", total: 700, currency: "USD", allocations: [["c", 700]] }), expense({ payer: "c", total: 800, allocations: [["a", 800]], status: "VOIDED" })],
    settlements: [settlement({ from: "b", to: "a", amount: 2000 }), settlement({ from: "b", to: "a", amount: 999, status: "REVERSED" })],
  });
  const inr = ledger.find((entry) => entry.currency === "INR");
  assert.deepEqual(inr.members.map((member) => member.netMinorUnits), [3000, -1000, -2000]);
  assert.equal(inr.members.reduce((sum, member) => sum + member.netMinorUnits, 0), 0);
  const usd = ledger.find((entry) => entry.currency === "USD");
  assert.equal(usd.members.find((member) => member.userId === id("c")).netMinorUnits, 0);
  assert.equal(usd.totalExpenseMinorUnits, 700);
});

test("settlement suggestions are deterministic, simplified and preserve every currency total", () => {
  const ledger = buildLedger({
    expenses: [expense({ payer: "a", total: 10000, allocations: [["a", 7000], ["b", 3000], ["c", 0]] }), expense({ payer: "b", total: 2000, allocations: [["a", 1000], ["b", 1000], ["c", 0]] })],
    settlements: [],
  });
  const suggestions = suggestSettlements(ledger);
  assert.deepEqual(suggestions.map(({ fromUserId, toUserId, amountMinorUnits }) => [fromUserId, toUserId, amountMinorUnits]), [[id("b"), id("a"), 2000]]);
  assert.equal(suggestions.reduce((sum, entry) => sum + entry.amountMinorUnits, 0), 2000);
});

test("empty expenses have no currency ledger and unbalanced stored records are rejected", () => {
  const ledger = buildLedger({ members: [{ userId: id("a"), name: "A" }], expenses: [], settlements: [] });
  assert.deepEqual(ledger, []);
  assert.throws(() => buildLedger({ expenses: [expense({ payer: "a", total: 100, allocations: [["b", 90]] })], settlements: [] }), /do not match/);
});

test("historical allocations for former members remain in balances without restoring their access", () => {
  const ledger = buildLedger({
    members: [{ userId: id("a"), name: "Active member" }],
    expenses: [expense({ payer: "a", total: 1000, allocations: [["a", 500], ["b", 500]] })],
    settlements: [],
  });
  assert.deepEqual(ledger[0].members.map(({ userId, netMinorUnits }) => [userId, netMinorUnits]), [[id("a"), 500], [id("b"), -500]]);
  assert.equal(ledger[0].members[1].name, "Member b");
});
