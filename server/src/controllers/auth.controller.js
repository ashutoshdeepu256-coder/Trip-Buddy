const { sendSuccess } = require("../utils/http");
const authService = require("../services/auth.service");
const verificationService = require("../services/verification.service");
const { getCookieOptions } = require("../middleware/auth");

const register = async (req, res) => {
  const user = await authService.register(req.body);
  res.cookie("tripbuddy_session", authService.createSessionToken(user._id, user.tokenVersion), getCookieOptions());
  return sendSuccess(res, { user: authService.sessionUser(user) }, "Account created", 201);
};

const login = async (req, res) => {
  const user = await authService.login(req.body);
  res.cookie("tripbuddy_session", authService.createSessionToken(user._id, user.tokenVersion), getCookieOptions());
  return sendSuccess(res, { user: authService.sessionUser(user) }, "Signed in");
};

const logout = async (req, res) => {
  req.user.tokenVersion = (req.user.tokenVersion || 0) + 1;
  await req.user.save();
  res.clearCookie("tripbuddy_session", {
    ...getCookieOptions(),
    maxAge: undefined,
  });
  return sendSuccess(res, null, "Signed out");
};

const currentUser = (req, res) =>
  sendSuccess(res, { user: authService.sessionUser(req.user) });

const resendEmailVerification = async (req, res) => {
  const result = await verificationService.sendEmailVerificationForUser(req.user);
  const data = { expiresAt: result.expiresAt };
  if (result.developmentToken) data.developmentToken = result.developmentToken;
  return sendSuccess(res, data, "Verification email requested", 202);
};

const verifyEmail = async (req, res) => {
  const status = await verificationService.verifyEmail(req.body, req);
  return sendSuccess(res, status, "Email verified");
};

module.exports = { register, login, logout, currentUser, resendEmailVerification, verifyEmail };
