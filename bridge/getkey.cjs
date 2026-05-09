const crypto = require("crypto");

const accessId = "phgvasrfdrmpdnrsg454";
const accessSecret = "be912076d11242a799d95e7d3a4ebee1";
const deviceId = "eb07e6ad331f0a44dblrat";

function sign(method, url, body, token, t) {
  const contentHash = crypto
    .createHash("sha256")
    .update(body || "")
    .digest("hex");
  const stringToSign = [method, contentHash, "", url].join("\n");
  const str = accessId + (token || "") + t + stringToSign;
  return crypto
    .createHmac("sha256", accessSecret)
    .update(str)
    .digest("hex")
    .toUpperCase();
}

const t1 = Date.now().toString();
const tokenSign = sign("GET", "/v1.0/token?grant_type=1", "", "", t1);

fetch("https://openapi.tuyaus.com/v1.0/token?grant_type=1", {
  headers: {
    client_id: accessId,
    sign: tokenSign,
    sign_method: "HMAC-SHA256",
    t: t1,
  },
})
  .then((res) => res.json())
  .then((tokenData) => {
    console.log("Token:", JSON.stringify(tokenData, null, 2));
    const token = tokenData.result?.access_token;
    const t2 = Date.now().toString();
    const deviceSign = sign("GET", `/v1.0/devices/${deviceId}`, "", token, t2);

    return fetch(`https://openapi.tuyaus.com/v1.0/devices/${deviceId}`, {
      headers: {
        client_id: accessId,
        access_token: token,
        sign: deviceSign,
        sign_method: "HMAC-SHA256",
        t: t2,
      },
    });
  })
  .then((res) => res.json())
  .then((data) => console.log("Device:", JSON.stringify(data, null, 2)))
  .catch((err) => console.error(err));
