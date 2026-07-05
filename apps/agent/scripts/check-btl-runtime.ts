import { checkBtlRuntime, getBtlRuntimeConfig } from "../src/runtime";

const config = getBtlRuntimeConfig();
if (config === null) {
  console.error("BTL Runtime is not configured. Set BTL_API_KEY in apps/agent/.env.");
  process.exit(1);
}

console.log(`Checking BTL Runtime at ${config.baseURL} with model ${config.model}...`);

try {
  const result = await checkBtlRuntime();
  console.log(`BTL Runtime model: ${result.model}`);
  console.log("BTL Runtime response:");
  console.log(result.response);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown BTL Runtime error";
  console.error(`BTL Runtime check failed: ${message}`);
  process.exit(1);
}
