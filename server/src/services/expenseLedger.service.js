const safeAmount = (value) => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError("Trip ledger exceeds safe integer bounds");
  return Number(value);
};
const asId = (value) => value?._id?.toString?.() || value?.toString?.() || "";

const buildLedger = ({ expenses, settlements, members = [] }) => {
  const currencies = new Map();
  const getCurrency = (currency) => {
    if (!currencies.has(currency)) currencies.set(currency, new Map());
    return currencies.get(currency);
  };
  const getMember = (currency, userId, name = "Trip member") => {
    const rows = getCurrency(currency);
    if (!rows.has(userId)) rows.set(userId, { userId, name, paidMinorUnits: 0n, shareMinorUnits: 0n, netMinorUnits: 0n, sentMinorUnits: 0n, receivedMinorUnits: 0n });
    const member = rows.get(userId);
    if (name && (member.name === "Trip member" || !member.name)) member.name = name;
    return member;
  };

  for (const member of members) for (const currency of new Set([...expenses.map((item) => item.currency), ...settlements.map((item) => item.currency)])) getMember(currency, asId(member.userId || member.id), member.name);
  for (const expense of expenses) {
    if (expense.status !== "ACTIVE") continue;
    const payerId = asId(expense.payer);
    const payer = getMember(expense.currency, payerId, expense.payerNameAtCreation);
    payer.paidMinorUnits += BigInt(expense.amountMinorUnits);
    let allocated = 0n;
    for (const allocation of expense.allocations) {
      const amount = BigInt(allocation.amountMinorUnits);
      allocated += amount;
      getMember(expense.currency, asId(allocation.user), allocation.nameAtCreation).shareMinorUnits += amount;
    }
    if (allocated !== BigInt(expense.amountMinorUnits)) throw new Error("Stored expense allocations do not match the expense total");
  }
  for (const settlement of settlements) {
    if (settlement.status !== "RECORDED") continue;
    const from = getMember(settlement.currency, asId(settlement.fromUser), settlement.fromNameAtCreation);
    const to = getMember(settlement.currency, asId(settlement.toUser), settlement.toNameAtCreation);
    const amount = BigInt(settlement.amountMinorUnits);
    from.sentMinorUnits += amount;
    to.receivedMinorUnits += amount;
  }

  const result = [];
  for (const [currency, rows] of currencies) {
    const membersForCurrency = [...rows.values()].sort((left, right) => left.userId.localeCompare(right.userId));
    for (const member of membersForCurrency) member.netMinorUnits = member.paidMinorUnits - member.shareMinorUnits + member.sentMinorUnits - member.receivedMinorUnits;
    const total = membersForCurrency.reduce((sum, member) => sum + member.netMinorUnits, 0n);
    if (total !== 0n) throw new Error(`Ledger is not balanced for ${currency}`);
    result.push({
      currency,
      totalExpenseMinorUnits: safeAmount(membersForCurrency.reduce((sum, member) => sum + member.shareMinorUnits, 0n)),
      members: membersForCurrency.map((member) => ({
        userId: member.userId, name: member.name,
        paidMinorUnits: safeAmount(member.paidMinorUnits), shareMinorUnits: safeAmount(member.shareMinorUnits),
        netMinorUnits: safeAmount(member.netMinorUnits), sentMinorUnits: safeAmount(member.sentMinorUnits), receivedMinorUnits: safeAmount(member.receivedMinorUnits),
      })),
    });
  }
  return result.sort((left, right) => left.currency.localeCompare(right.currency));
};

const suggestSettlements = (ledger) => ledger.flatMap(({ currency, members }) => {
  const debtors = members.filter((member) => member.netMinorUnits < 0).map((member) => ({ ...member, remaining: -member.netMinorUnits }));
  const creditors = members.filter((member) => member.netMinorUnits > 0).map((member) => ({ ...member, remaining: member.netMinorUnits }));
  const suggestions = [];
  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const amountMinorUnits = Math.min(debtors[debtorIndex].remaining, creditors[creditorIndex].remaining);
    if (amountMinorUnits > 0) suggestions.push({ fromUserId: debtors[debtorIndex].userId, fromName: debtors[debtorIndex].name, toUserId: creditors[creditorIndex].userId, toName: creditors[creditorIndex].name, amountMinorUnits, currency });
    debtors[debtorIndex].remaining -= amountMinorUnits;
    creditors[creditorIndex].remaining -= amountMinorUnits;
    if (!debtors[debtorIndex].remaining) debtorIndex += 1;
    if (!creditors[creditorIndex].remaining) creditorIndex += 1;
  }
  if (debtorIndex !== debtors.length || creditorIndex !== creditors.length) throw new Error("Settlement suggestions failed to balance");
  return suggestions;
});

module.exports = { buildLedger, suggestSettlements };
