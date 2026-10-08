const { sendSuccess } = require("../utils/http");
const tripService = require("../services/trip.service");

const create = async (req, res) =>
  sendSuccess(res, await tripService.createTrip(req.user, req.body), "Trip draft created", 201);

const mine = async (req, res) =>
  sendSuccess(res, await tripService.getMyTrips(req.user, req.validatedQuery));

const get = async (req, res) =>
  sendSuccess(res, await tripService.getTripById(req.params.tripId, req.user || null));

const update = async (req, res) =>
  sendSuccess(res, await tripService.updateTrip(req.params.tripId, req.user, req.body), "Trip updated");

const remove = async (req, res) =>
  sendSuccess(res, await tripService.deleteTrip(req.params.tripId, req.user), "Draft trip deleted");

const publish = async (req, res) =>
  sendSuccess(res, await tripService.publishTrip(req.params.tripId, req.user), "Trip published");

const cancel = async (req, res) =>
  sendSuccess(res, await tripService.cancelTrip(req.params.tripId, req.user), "Trip cancelled");

const changeStatus = async (req, res) =>
  sendSuccess(
    res,
    await tripService.changeTripStatus(req.params.tripId, req.user, req.body.status),
    "Trip status updated",
  );

const uploadImages = async (req, res) =>
  sendSuccess(
    res,
    { images: await tripService.addTripImages(req.params.tripId, req.user, req.files) },
    "Trip images uploaded",
    201,
  );

const removeImage = async (req, res) =>
  sendSuccess(
    res,
    await tripService.removeTripImage(req.params.tripId, req.user, Number(req.params.imageIndex)),
    "Trip image removed",
  );

module.exports = { create, mine, get, update, remove, publish, cancel, changeStatus, uploadImages, removeImage };
