const { z } = require("zod");

const csvList = (maximum = 10) =>
  z.preprocess(
    (value) => typeof value === "string" ? value.split(",") : value,
    z.array(z.string().trim().min(1).max(60))
      .max(maximum)
      .default([])
      .transform((values) => [...new Set(values.map((value) => value.toLocaleLowerCase()))]),
  );

const optionalNumber = (minimum, maximum) =>
  z.preprocess(
    (value) => value === undefined || value === "" ? undefined : value,
    z.coerce.number().finite().min(minimum).max(maximum).optional(),
  );

const optionalInteger = (minimum, maximum) =>
  z.preprocess(
    (value) => value === undefined || value === "" ? undefined : value,
    z.coerce.number().int().min(minimum).max(maximum).optional(),
  );

const optionalDate = z.preprocess(
  (value) => value === undefined || value === "" ? undefined : value,
  z.coerce.date().optional(),
);

const discoveryQuerySchema = z.object({
  destination: z.string().trim().min(1).max(140).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  startDate: optionalDate,
  endDate: optionalDate,
  dateFlexibility: z.preprocess(
    (value) => value === undefined || value === "" ? 0 : value,
    z.coerce.number().int().refine((value) => [0, 1, 3, 7].includes(value), "Use date flexibility 0, 1, 3, or 7"),
  ),
  budgetMin: optionalNumber(0, 100000000),
  budgetMax: optionalNumber(0, 100000000),
  budgetCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
  budgetFlexibility: z.preprocess(
    (value) => value === undefined || value === "" ? 0 : value,
    z.coerce.number().min(0).max(50),
  ),
  groupSize: optionalInteger(1, 100),
  groupMin: optionalInteger(1, 100),
  groupMax: optionalInteger(1, 100),
  travelStyle: csvList(),
  interests: csvList(),
  activities: csvList(),
  accommodation: csvList(),
  transport: csvList(),
  foodPreference: csvList(),
  language: csvList(),
  verifiedOnly: z.preprocess(
    (value) => value === undefined ? false : value,
    z.union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")]),
  ),
  ageMin: optionalInteger(18, 100),
  ageMax: optionalInteger(18, 100),
  page: z.preprocess(
    (value) => value === undefined ? 1 : value,
    z.coerce.number().int().min(1).max(10000),
  ),
  limit: z.preprocess(
    (value) => value === undefined ? 20 : value,
    z.coerce.number().int().min(1).max(50),
  ),
  sort: z.enum(["recent", "date", "budget_low", "budget_high", "group_availability", "popularity", "compatibility"])
    .default("recent"),
}).strict().superRefine((query, context) => {
  const hasDate = query.startDate !== undefined || query.endDate !== undefined;
  if (hasDate && (!query.startDate || !query.endDate)) {
    context.addIssue({ code: "custom", path: ["endDate"], message: "Provide both startDate and endDate" });
  }
  if (query.startDate && query.endDate && query.endDate < query.startDate) {
    context.addIssue({ code: "custom", path: ["endDate"], message: "endDate must be on or after startDate" });
  }
  if (query.dateFlexibility > 0 && !hasDate) {
    context.addIssue({ code: "custom", path: ["dateFlexibility"], message: "Date flexibility requires a date range" });
  }
  if (query.budgetMin !== undefined && query.budgetMax !== undefined && query.budgetMin > query.budgetMax) {
    context.addIssue({ code: "custom", path: ["budgetMax"], message: "budgetMax must be at least budgetMin" });
  }
  if ((query.budgetMin !== undefined || query.budgetMax !== undefined) && !query.budgetCurrency) {
    context.addIssue({ code: "custom", path: ["budgetCurrency"], message: "budgetCurrency is required with a budget filter" });
  }
  if (query.budgetFlexibility > 0 && query.budgetMin === undefined && query.budgetMax === undefined) {
    context.addIssue({ code: "custom", path: ["budgetFlexibility"], message: "Budget flexibility requires a budget range" });
  }
  if (query.groupMin !== undefined && query.groupMax !== undefined && query.groupMin > query.groupMax) {
    context.addIssue({ code: "custom", path: ["groupMax"], message: "groupMax must be at least groupMin" });
  }
  if (query.ageMin !== undefined && query.ageMax !== undefined && query.ageMin > query.ageMax) {
    context.addIssue({ code: "custom", path: ["ageMax"], message: "ageMax must be at least ageMin" });
  }
});

module.exports = { discoveryQuerySchema };
