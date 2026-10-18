const { sendSuccess, HttpError } = require("../utils/http");
const notifications = require("../services/notification.service");
const send = (res, data, message) => sendSuccess(res, data, message);

const list = async (req, res) => send(res, await notifications.list(req.user._id, req.validatedQuery));
const unreadCount = async (req, res) => send(res, { count: await notifications.unreadCount(req.user._id) });
const preferences = async (req, res) => send(res, { preferences: await notifications.getPreferences(req.user._id) });
const updatePreferences = async (req, res) => send(res, { preferences: await notifications.updatePreferences(req.user._id, req.body.categories) }, "Notification preferences updated");
const markRead = async (req, res) => {
  const result = await notifications.markRead(req.user._id, req.params.notificationId, req.app.get("io"));
  if (!result) throw new HttpError(404, "Notification was not found", "NOTIFICATION_NOT_FOUND");
  return send(res, result, "Notification marked as read");
};
const markAllRead = async (req, res) => send(res, await notifications.markAllRead(req.user._id, req.app.get("io")), "Notifications marked as read");
const dismiss = async (req, res) => {
  const result = await notifications.dismiss(req.user._id, req.params.notificationId, req.app.get("io"));
  if (!result) throw new HttpError(404, "Notification was not found", "NOTIFICATION_NOT_FOUND");
  return send(res, result, "Notification dismissed");
};

module.exports = { list, unreadCount, preferences, updatePreferences, markRead, markAllRead, dismiss };
