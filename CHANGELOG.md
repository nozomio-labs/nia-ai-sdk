# @nozomioai/nia-ai-sdk

## 0.0.1

### Patch Changes

- [`e93b253`](https://github.com/nozomio-labs/nia-ai-sdk/commit/e93b253df969cb737ce83734177a93df3a55dcf7) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Allow shared transport options (`apiKey`, `baseURL`, etc.) at the top level of `createNiaResearchTools` so credentials only need to be specified once instead of per-service. Per-service values still override the shared ones when provided.
