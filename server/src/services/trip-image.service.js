const cloudinary = require("cloudinary").v2;
const { randomToken } = require("../utils/security");
const { HttpError } = require("../utils/http");

const MAX_FILE_SIZE = 8 * 1024 * 1024;
const MAX_IMAGES_PER_TRIP = 8;
const contentTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

const configureStorage = () => {
  if (!process.env.CLOUDINARY_URL) {
    throw new HttpError(503, "Trip image storage is not configured", "STORAGE_NOT_CONFIGURED");
  }
  cloudinary.config({ secure: true });
};

const detectFormat = (file) => {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) return null;
  if (
    file.mimetype === "image/jpeg" &&
    file.buffer[0] === 0xff &&
    file.buffer[1] === 0xd8 &&
    file.buffer[file.buffer.length - 2] === 0xff &&
    file.buffer[file.buffer.length - 1] === 0xd9
  ) return "jpg";
  if (
    file.mimetype === "image/png" &&
    file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) return "png";
  if (
    file.mimetype === "image/webp" &&
    file.buffer.subarray(0, 4).toString() === "RIFF" &&
    file.buffer.subarray(8, 12).toString() === "WEBP"
  ) return "webp";
  return null;
};

const uploadTripImages = async ({ tripId, userId, files, currentCount }) => {
  if (!files?.length) throw new HttpError(400, "Select at least one image", "TRIP_IMAGE_REQUIRED");
  if (currentCount + files.length > MAX_IMAGES_PER_TRIP) {
    throw new HttpError(400, `A trip can have at most ${MAX_IMAGES_PER_TRIP} images`, "TRIP_IMAGE_LIMIT");
  }
  const formats = files.map(detectFormat);
  if (formats.some((format) => !format)) {
    throw new HttpError(400, "Only valid JPEG, PNG, or WEBP images are accepted", "INVALID_TRIP_IMAGE");
  }
  if (files.some((file) => file.size > MAX_FILE_SIZE)) {
    throw new HttpError(413, "Each trip image must be 8 MB or smaller", "TRIP_IMAGE_TOO_LARGE");
  }
  configureStorage();

  const uploaded = [];
  try {
    for (let index = 0; index < files.length; index += 1) {
      const publicId = `tripbuddy/trips/${userId}/${tripId}/${randomToken(16)}`;
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            public_id: publicId,
            resource_type: "image",
            overwrite: false,
            use_filename: false,
            unique_filename: false,
            allowed_formats: ["jpg", "png", "webp"],
          },
          (error, uploadResult) => (error ? reject(error) : resolve(uploadResult)),
        );
        stream.end(files[index].buffer);
      });
      uploaded.push({
        url: result.secure_url,
        publicId: result.public_id,
        format: formats[index],
        uploadedAt: new Date(),
      });
    }
    return uploaded;
  } catch (error) {
    console.error("Trip image upload failed:", {
      name: error.name,
      code: error.http_code || error.code || "PROVIDER_ERROR",
    });
    await Promise.all(
      uploaded.map((image) =>
        cloudinary.uploader.destroy(image.publicId, { resource_type: "image" }),
      ),
    ).catch((cleanupError) => {
      console.error("Trip image rollback failed:", cleanupError.message);
    });
    throw new HttpError(502, "Trip images could not be uploaded", "TRIP_IMAGE_UPLOAD_FAILED");
  }
};

const deleteTripImage = async (publicId) => {
  configureStorage();
  const result = await cloudinary.uploader.destroy(publicId, { resource_type: "image", invalidate: true });
  if (result.result !== "ok" && result.result !== "not found") {
    throw new HttpError(502, "Trip image could not be deleted", "TRIP_IMAGE_DELETE_FAILED");
  }
};

const deleteTripImages = async (images = []) => {
  if (!images.length) return;
  configureStorage();
  const results = await Promise.all(
    images.map((image) =>
      cloudinary.uploader.destroy(image.publicId, { resource_type: "image", invalidate: true }),
    ),
  );
  if (results.some((result) => !["ok", "not found"].includes(result.result))) {
    throw new HttpError(502, "One or more trip images could not be deleted", "TRIP_IMAGE_DELETE_FAILED");
  }
};

module.exports = {
  MAX_FILE_SIZE,
  MAX_IMAGES_PER_TRIP,
  contentTypes,
  detectFormat,
  uploadTripImages,
  deleteTripImage,
  deleteTripImages,
};
