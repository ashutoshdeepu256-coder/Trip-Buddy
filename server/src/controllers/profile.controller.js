const mongoose = require("mongoose");
const { HttpError, sendSuccess } = require("../utils/http");
const { publicUser } = require("../services/auth.service");
const { getPublicProfile } = require("../services/trust.service");

const currentProfile = (req, res) =>
  sendSuccess(res, { user: publicUser(req.user) });

const updateProfile = async (req, res) => {
  const { name, bio, city, country, travelPreferences } = req.body;
  if (name !== undefined) req.user.name = name;
  for (const [field, value] of Object.entries({ bio, city, country })) {
    if (value !== undefined) req.user.profile[field] = value;
  }
  if (travelPreferences) {
    req.user.profile.travelPreferences = {
      ...req.user.profile.travelPreferences.toObject(),
      ...travelPreferences,
    };
  }
  await req.user.save();
  return sendSuccess(res, { user: publicUser(req.user) }, "Profile updated");
};

const publicProfile = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.userId)) {
    throw new HttpError(400, "Invalid user ID", "INVALID_USER_ID");
  }
  const profile = await getPublicProfile(req.params.userId);
  if (!profile) throw new HttpError(404, "User was not found", "USER_NOT_FOUND");
  return sendSuccess(res, profile);
};

module.exports = { currentProfile, updateProfile, publicProfile };
