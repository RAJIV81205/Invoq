// gen-key.ts
// Load environment variables from .env file in parent directory
import "dotenv/config";

// NOW import modules that depend on environment variables
import { createApiKey } from "../src/lib/auth/api-key.js";

const { plaintext, keyId } = await createApiKey({
  developerId: "dev-1",
  type: "sk",
  name: "test-key",
});

console.log("Key ID:", keyId);
console.log("API Key:", plaintext);
console.log("\nSave this — plaintext never stored again.");
process.exit(0);