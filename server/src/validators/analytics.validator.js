const { z } = require("zod");

const zonedDateTime = z.string().refine((value) =>
  /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(new Date(value).getTime()),
"Use an ISO date-time with an explicit timezone");

const query = z.object({
  window: z.enum(["24h", "7d", "30d"]).optional(),
  from: zonedDateTime.optional(),
  to: zonedDateTime.optional(),
}).strict().superRefine((value, context) => {
  if (Boolean(value.from) !== Boolean(value.to)) context.addIssue({ code: "custom", message: "Provide both from and to" });
  if (value.window && (value.from || value.to)) context.addIssue({ code: "custom", message: "Choose a preset window or a custom range" });
  if (value.from && value.to) {
    const from = new Date(value.from).getTime();
    const to = new Date(value.to).getTime();
    if (from >= to) context.addIssue({ code: "custom", message: "The range must have a positive duration" });
    if (to - from > 90 * 24 * 60 * 60 * 1000) context.addIssue({ code: "custom", message: "Custom ranges cannot exceed 90 days" });
    if (to > Date.now()) context.addIssue({ code: "custom", message: "The end of the range cannot be in the future" });
  }
});

module.exports = { query };
