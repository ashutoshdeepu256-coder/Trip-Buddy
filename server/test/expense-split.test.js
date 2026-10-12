const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateAllocations } = require("../src/services/expenseSplit.service");
const { createSchema } = require("../src/validators/expense.validator");

const participants = ["c", "a", "b"].map((userId) => ({ userId }));
const total = (allocations) => allocations.reduce((sum, item) => sum + item.amountMinorUnits, 0);

test("equal splits allocate indivisible cents deterministically by participant ID", () => {
  const first = calculateAllocations({ amountMinorUnits: 101, splitMethod: "EQUAL", participants });
  const second = calculateAllocations({ amountMinorUnits: 101, splitMethod: "EQUAL", participants: [...participants].reverse() });
  assert.deepEqual(first, second);
  assert.deepEqual(first, [{ userId: "a", amountMinorUnits: 34 }, { userId: "b", amountMinorUnits: 34 }, { userId: "c", amountMinorUnits: 33 }]);
  assert.equal(total(first), 101);
});

test("exact minor-unit splits require the total to match exactly", () => {
  const result = calculateAllocations({ amountMinorUnits: 905, splitMethod: "EXACT", participants: [{ userId: "b", amountMinorUnits: 405 }, { userId: "a", amountMinorUnits: 500 }] });
  assert.equal(total(result), 905);
  assert.throws(() => calculateAllocations({ amountMinorUnits: 905, splitMethod: "EXACT", participants: [{ userId: "a", amountMinorUnits: 904 }] }), /equal the expense total/);
  assert.throws(() => calculateAllocations({ amountMinorUnits: 905, splitMethod: "EXACT", participants: [{ userId: "a", amountMinorUnits: -1 }] }), /non-negative/);
});

test("percentage and weighted splits use largest remainders and stable user ID ties", () => {
  const percentage = calculateAllocations({ amountMinorUnits: 101, splitMethod: "PERCENTAGE", participants: [{ userId: "b", basisPoints: 3333 }, { userId: "a", basisPoints: 3333 }, { userId: "c", basisPoints: 3334 }] });
  assert.equal(total(percentage), 101);
  assert.deepEqual(percentage, [{ userId: "a", amountMinorUnits: 34 }, { userId: "b", amountMinorUnits: 33 }, { userId: "c", amountMinorUnits: 34 }]);
  const weighted = calculateAllocations({ amountMinorUnits: 10, splitMethod: "WEIGHTED", participants: [{ userId: "c", shares: 1 }, { userId: "a", shares: 2 }, { userId: "b", shares: 1 }] });
  assert.deepEqual(weighted, [{ userId: "a", amountMinorUnits: 5 }, { userId: "b", amountMinorUnits: 3 }, { userId: "c", amountMinorUnits: 2 }]);
});

test("split calculator rejects invalid totals, duplicate users, non-finite input and unsupported methods", () => {
  assert.throws(() => calculateAllocations({ amountMinorUnits: Infinity, splitMethod: "EQUAL", participants }), /positive integer/);
  assert.throws(() => calculateAllocations({ amountMinorUnits: 100, splitMethod: "PERCENTAGE", participants: [{ userId: "a", basisPoints: 6000 }, { userId: "b", basisPoints: 3999 }] }), /total exactly 100 percent/);
  assert.throws(() => calculateAllocations({ amountMinorUnits: 100, splitMethod: "WEIGHTED", participants: [{ userId: "a", shares: 0 }] }), /positive integers/);
  assert.throws(() => calculateAllocations({ amountMinorUnits: 100, splitMethod: "EQUAL", participants: [{ userId: "a" }, { userId: "a" }] }), /unique valid users/);
  assert.throws(() => calculateAllocations({ amountMinorUnits: 100, splitMethod: "NOPE", participants }), /Unsupported split method/);
});

test("expense request validation accepts only the selected split fields and integer minor units", () => {
  const valid = { description: "Meal", category: "FOOD", amountMinorUnits: 1234, currency: "INR", expenseDate: "2027-05-01", splitMethod: "EQUAL", participants: [{ userId: "507f1f77bcf86cd799439011" }] };
  assert.equal(createSchema.safeParse(valid).success, true);
  assert.equal(createSchema.safeParse({ ...valid, amountMinorUnits: 12.34 }).success, false);
  assert.equal(createSchema.safeParse({ ...valid, payerId: "507f1f77bcf86cd799439011" }).success, false);
  assert.equal(createSchema.safeParse({ ...valid, participants: [{ userId: "507f1f77bcf86cd799439011", shares: 2 }] }).success, false);
});
