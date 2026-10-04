const { z } = require("zod");

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

const verifyEmailSchema = z.object({
  token: z.string().min(32).max(256),
});

const profileSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    bio: z.string().trim().max(1000).optional(),
    city: z.string().trim().max(100).optional(),
    country: z.string().trim().max(100).optional(),
    travelPreferences: z
      .object({
        destinations: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
        interests: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
        activities: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
        travelStyle: z.string().trim().max(80).optional(),
        budget: z.string().trim().max(80).optional(),
        groupPreference: z.string().trim().max(80).optional(),
      })
      .optional(),
  })
  .strict();

module.exports = { registerSchema, loginSchema, verifyEmailSchema, profileSchema };
