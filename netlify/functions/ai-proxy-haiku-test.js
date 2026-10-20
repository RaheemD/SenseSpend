// TEMPORARY: same proxy (auth, validation, daily quota) pinned to Claude Haiku 5.5, used to test the
// model without changing the live app. Remove once the evaluation is done.
process.env.OPENROUTER_MODEL = "anthropic/claude-haiku-5.5";
process.env.OPENROUTER_FALLBACK_MODELS = "google/gemini-3-flash-preview";
module.exports = require("./ai-proxy");
