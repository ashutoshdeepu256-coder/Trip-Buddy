const cloudinary = require("cloudinary").v2;
const { randomToken } = require("../utils/security");
const { HttpError } = require("../utils/http");
const Verification = require("../models/Verification");

const ensureStorageConfiguration = () => {
  if (!process.env.CLOUDINARY_URL) {
    throw new HttpError(503, "Secure identity document storage is not configured", "STORAGE_NOT_CONFIGURED");
  }
  cloudinary.config({ secure: true });
};

const uploadIdentityDocument = async ({ userId, file }) => {
  ensureStorageConfiguration();
  const verification = await Verification.findOne({
    user: userId,
    type: "IDENTITY",
    status: "PENDING",
  }).select("+metadata");
  if (!verification) {
    throw new HttpError(409, "Start identity verification before uploading a document", "IDENTITY_NOT_PENDING");
  }

  const publicId = `tripbuddy/identity/${userId}/${randomToken(16)}`;
  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        resource_type: "raw",
        type: "authenticated",
        access_mode: "authenticated",
        overwrite: false,
        use_filename: false,
        unique_filename: false,
      },
      (error, uploadResult) => (error ? reject(error) : resolve(uploadResult)),
    );
    stream.end(file.buffer);
  });
  verification.metadata = {
    ...verification.metadata,
    documentAssetId: result.public_id,
    documentFormat: file.mimetype,
    documentUploadedAt: new Date(),
  };
  await verification.save();
  return { uploaded: true };
};

const streamIdentityDocument = async (assetId, response) => {
  ensureStorageConfiguration();
  const url = cloudinary.url(assetId, {
    resource_type: "raw",
    type: "authenticated",
    sign_url: true,
    secure: true,
  });
  const remote = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!remote.ok || !remote.body) {
    throw new HttpError(502, "Secure document storage could not serve the file", "STORAGE_READ_FAILED");
  }
  response.setHeader("Cache-Control", "no-store, private");
  response.setHeader("Content-Type", "application/octet-stream");
  response.setHeader("Content-Disposition", 'attachment; filename="identity-document"');
  await new Promise((resolve, reject) => {
    const { Readable } = require("stream");
    Readable.fromWeb(remote.body).pipe(response).on("finish", resolve).on("error", reject);
  });
};

module.exports = { uploadIdentityDocument, streamIdentityDocument };
