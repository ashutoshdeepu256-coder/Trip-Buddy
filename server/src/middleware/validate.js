const { HttpError } = require("../utils/http");

const validate = (schema, source = "body") => (req, _res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    return next(
      new HttpError(400, "Request validation failed", "VALIDATION_ERROR"),
    );
  }
  req[source] = result.data;
  next();
};

module.exports = validate;
