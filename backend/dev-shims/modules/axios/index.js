// Minimal axios shim (test-only). The sandbox has no outbound network, so all
// requests reject. Only loaded when USE_MOCK=false; mock-mode tests never hit it.
function reject() {
  return Promise.reject(new Error("axios shim: network disabled in test sandbox"));
}
function makeInstance() {
  return { get: reject, post: reject, put: reject, delete: reject, request: reject };
}
const axios = makeInstance();
axios.create = () => makeInstance();
module.exports = axios;
