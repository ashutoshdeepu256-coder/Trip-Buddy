const { isMinorAmount } = require("../utils/money");

const fail = (message) => { throw new TypeError(message); };

const validateBase = (amountMinorUnits, participants) => {
  if (!isMinorAmount(amountMinorUnits)) fail("Expense amount must be a positive integer number of minor units");
  if (!Array.isArray(participants) || participants.length < 1 || participants.length > 100) fail("An expense needs between one and 100 participants");
  const ids = participants.map(({ userId }) => userId);
  if (ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) fail("Expense participants must be unique valid users");
};

const distributeByWeight = (amount, participants, weightOf) => {
  const weighted = participants.map((participant) => {
    const weight = weightOf(participant);
    if (!Number.isSafeInteger(weight) || weight <= 0) fail("Split weights must be positive integers");
    return { participant, weight: BigInt(weight) };
  });
  const totalWeight = weighted.reduce((total, item) => total + item.weight, 0n);
  const amountBig = BigInt(amount);
  let assigned = 0;
  const rows = weighted.map(({ participant, weight }) => {
    const numerator = amountBig * weight;
    const base = numerator / totalWeight;
    const remainder = numerator % totalWeight;
    assigned += Number(base);
    return { userId: participant.userId, amountMinorUnits: Number(base), remainder };
  });
  let unassigned = amount - assigned;
  const priority = [...rows].sort((left, right) => left.remainder === right.remainder ? left.userId.localeCompare(right.userId) : left.remainder > right.remainder ? -1 : 1);
  for (let index = 0; index < unassigned; index += 1) priority[index].amountMinorUnits += 1;
  return rows.sort((left, right) => left.userId.localeCompare(right.userId)).map(({ userId, amountMinorUnits }) => ({ userId, amountMinorUnits }));
};

const calculateAllocations = ({ amountMinorUnits, splitMethod, participants }) => {
  validateBase(amountMinorUnits, participants);
  let result;
  if (splitMethod === "EQUAL") result = distributeByWeight(amountMinorUnits, participants, () => 1);
  else if (splitMethod === "WEIGHTED") result = distributeByWeight(amountMinorUnits, participants, ({ shares }) => shares);
  else if (splitMethod === "PERCENTAGE") {
    if (participants.some(({ basisPoints }) => !Number.isSafeInteger(basisPoints) || basisPoints <= 0) || participants.reduce((sum, item) => sum + item.basisPoints, 0) !== 10000) fail("Percentage allocations must be positive and total exactly 100 percent");
    result = distributeByWeight(amountMinorUnits, participants, ({ basisPoints }) => basisPoints);
  } else if (splitMethod === "EXACT") {
    if (participants.some(({ amountMinorUnits: amount }) => !isMinorAmount(amount, { allowZero: true }))) fail("Exact allocations must be non-negative integer minor units");
    const total = participants.reduce((sum, item) => sum + item.amountMinorUnits, 0);
    if (total !== amountMinorUnits) fail("Exact allocations must equal the expense total");
    result = participants.map(({ userId, amountMinorUnits }) => ({ userId, amountMinorUnits })).sort((left, right) => left.userId.localeCompare(right.userId));
  } else fail("Unsupported split method");

  if (result.reduce((sum, item) => sum + item.amountMinorUnits, 0) !== amountMinorUnits) fail("Allocations must equal the expense total");
  return result;
};

module.exports = { calculateAllocations };
