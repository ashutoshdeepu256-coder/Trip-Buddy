export const currencies = ['AUD', 'CAD', 'CHF', 'EUR', 'GBP', 'INR', 'SGD', 'USD']

export const parseMinorUnits = (value, { allowZero = false } = {}) => {
  const text = String(value).trim()
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null
  const [whole, decimal = ''] = text.split('.')
  const amount = Number(whole) * 100 + Number(decimal.padEnd(2, '0'))
  return Number.isSafeInteger(amount) && (allowZero ? amount >= 0 : amount > 0) ? amount : null
}

export const formatMoney = (minorUnits, currency) => new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minorUnits / 100)

const weightedAmounts = (amount, rows, weightField) => {
  if (rows.some((row) => !Number.isSafeInteger(row[weightField]) || row[weightField] <= 0)) return null
  const weighted = rows.map((row) => ({ userId: row.userId, weight: BigInt(row[weightField]) }))
  const totalWeight = weighted.reduce((sum, row) => sum + row.weight, 0n)
  const amountBig = BigInt(amount)
  let assigned = 0
  const shares = weighted.map(({ userId, weight }) => {
    const numerator = amountBig * weight
    const floor = numerator / totalWeight
    assigned += Number(floor)
    return { userId, amountMinorUnits: Number(floor), remainder: numerator % totalWeight }
  })
  const priority = [...shares].sort((left, right) => left.remainder === right.remainder ? left.userId.localeCompare(right.userId) : left.remainder > right.remainder ? -1 : 1)
  for (let index = 0; index < amount - assigned; index += 1) priority[index].amountMinorUnits += 1
  return shares.sort((left, right) => left.userId.localeCompare(right.userId))
}

export const previewSplit = (amount, splitMethod, rows) => {
  if (!Number.isSafeInteger(amount) || amount < 1 || !rows.length) return null
  if (splitMethod === 'EQUAL') return weightedAmounts(amount, rows.map((row) => ({ userId: row.userId, weight: 1 })), 'weight')
  if (splitMethod === 'WEIGHTED') return weightedAmounts(amount, rows.map((row) => ({ userId: row.userId, weight: Number(row.shares) })), 'weight')
  if (splitMethod === 'PERCENTAGE') {
    const basisTotal = rows.reduce((sum, row) => sum + Number(row.basisPoints), 0)
    return basisTotal === 10000 ? weightedAmounts(amount, rows.map((row) => ({ userId: row.userId, weight: Number(row.basisPoints) })), 'weight') : null
  }
  if (splitMethod === 'EXACT') {
    if (rows.some((row) => row.amountMinorUnits === null || row.amountMinorUnits === undefined)) return null
    const result = rows.map((row) => ({ userId: row.userId, amountMinorUnits: Number(row.amountMinorUnits) }))
    return result.every((row) => Number.isSafeInteger(row.amountMinorUnits) && row.amountMinorUnits >= 0) && result.reduce((sum, row) => sum + row.amountMinorUnits, 0) === amount ? result : null
  }
  return null
}
