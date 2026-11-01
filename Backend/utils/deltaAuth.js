import crypto from "crypto";

function generateSignature(secret, message) {
  return crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");
}

export function getAuthHeaders(method, path, body = "") {
  const timestamp = Math.floor(Date.now() / 1000).toString();

  // ✅ Correct order confirmed by Delta error
  const message = method + timestamp + path + body;

  const signature = generateSignature(
    process.env.DELTA_SECRET,
    message
  );

  return {
    "api-key": process.env.DELTA_KEY,
    timestamp,
    signature,
  };
}