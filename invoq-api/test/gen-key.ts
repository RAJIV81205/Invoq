// gen-key.ts
// Load environment variables from .env file in parent directory
import "dotenv/config";

// NOW import modules that depend on environment variables
import { createApiKey } from "../src/lib/auth/api-key.js";
import {
  createDeveloper,
  findDeveloperByEmail,
  findDeveloperByStellarAddress,
  newId,
  now,
} from "../src/lib/db/index.js";

const stellarAddress = process.env.CUSTOMER_ADDRESS ?? process.env.TEST_CUSTOMER_ADDRESS;
const email = process.env.TEST_DEVELOPER_EMAIL ?? "smoke-test@invoq.local";
const name = process.env.TEST_DEVELOPER_NAME ?? "Smoke Test Developer";

if (!stellarAddress) {
  console.error("Set CUSTOMER_ADDRESS or TEST_CUSTOMER_ADDRESS to the developer Stellar G... address.");
  process.exit(1);
}

let developer = await findDeveloperByStellarAddress(stellarAddress);
if (!developer) {
  const byEmail = await findDeveloperByEmail(email);
  if (byEmail && byEmail.stellarAddress !== stellarAddress) {
    console.error(`Developer email ${email} already belongs to ${byEmail.stellarAddress}. Set TEST_DEVELOPER_EMAIL to a different value.`);
    process.exit(1);
  }

  const developerId = byEmail?.id ?? newId();
  if (!byEmail) {
    await createDeveloper({
      id:             developerId,
      stellarAddress,
      email,
      name,
      payoutAddress:  null,
      createdAt:      now(),
      updatedAt:      now(),
    });
  }
  developer = await findDeveloperByStellarAddress(stellarAddress);
}

if (!developer) {
  console.error("Failed to create or load developer record.");
  process.exit(1);
}

const { plaintext, keyId } = await createApiKey({
  developerId: developer.id,
  type: "sk",
  name: "test-key",
});

console.log("Developer ID:", developer.id);
console.log("Developer Address:", developer.stellarAddress);
console.log("Key ID:", keyId);
console.log("API Key:", plaintext);
console.log("\nSave this — plaintext never stored again.");
process.exit(0);
