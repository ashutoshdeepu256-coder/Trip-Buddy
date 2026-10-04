const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { HttpError } = require("../utils/http");

const createSessionToken = (userId, tokenVersion = 0) => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters");
  }
  return jwt.sign({ v: tokenVersion }, process.env.JWT_SECRET, {
    algorithm: "HS256",
    subject: userId.toString(),
    issuer: "tripbuddy",
    audience: "tripbuddy-web",
    expiresIn: "7d",
  });
};

const register = async ({ name, email, password }) => {
  const normalizedEmail = email.toLowerCase();
  if (await User.exists({ email: normalizedEmail })) {
    throw new HttpError(409, "An account with this email already exists", "EMAIL_IN_USE");
  }
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    return await User.create({ name, email: normalizedEmail, passwordHash });
  } catch (error) {
    if (error.code === 11000) {
      throw new HttpError(409, "An account with this email already exists", "EMAIL_IN_USE");
    }
    throw error;
  }
};

const login = async ({ email, password }) => {
  const user = await User.findOne({ email: email.toLowerCase() }).select(
    "+passwordHash +role +tokenVersion",
  );
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new HttpError(401, "Email or password is incorrect", "INVALID_CREDENTIALS");
  }
  return user;
};

const publicUser = (user) => ({
  id: user._id.toString(),
  name: user.name,
  email: user.email,
  profile: user.profile,
  verification: {
    email: {
      status: user.verification?.email?.status || "NOT_VERIFIED",
      verified: user.verification?.email?.status === "VERIFIED",
      verifiedAt: user.verification?.email?.verifiedAt || null,
    },
    phone: {
      status: user.verification?.phone?.status || "NOT_VERIFIED",
      verified: user.verification?.phone?.status === "VERIFIED",
      verifiedAt: user.verification?.phone?.verifiedAt || null,
    },
    identity: {
      status: user.verification?.identity?.status || "NOT_SUBMITTED",
      verified: user.verification?.identity?.status === "VERIFIED",
      verifiedAt: user.verification?.identity?.verifiedAt || null,
    },
  },
  createdAt: user.createdAt,
});

module.exports = { register, login, createSessionToken, publicUser };
