const supportedCurrencies = Object.freeze(["AUD", "CAD", "CHF", "EUR", "GBP", "INR", "SGD", "USD"]);
const MAX_MINOR_UNITS = 1_000_000_000_000;

const isMinorAmount = (amount, { allowZero = false } = {}) =>
  Number.isSafeInteger(amount) && amount <= MAX_MINOR_UNITS && (allowZero ? amount >= 0 : amount > 0);

const assertMinorAmount = (amount, options) => {
  if (!isMinorAmount(amount, options)) throw new TypeError("Amount must be a supported positive integer number of minor units");
  return amount;
};

module.exports = { supportedCurrencies, MAX_MINOR_UNITS, isMinorAmount, assertMinorAmount };
