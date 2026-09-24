export class ServiceError extends Error {
  constructor(statusCode, message, code = null) {
    super(message);
    this.name = "ServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}
