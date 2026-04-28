import { pbkdf2Sync } from "node:crypto";

const password = process.env.SITE_ACCESS_PASSWORD;

if (!password) {
  console.error("SITE_ACCESS_PASSWORD is required");
  process.exit(1);
}

const salt = "js-guild-stg-site-access-v1";
const iterations = 120000;
const keyLength = 32;
const digest = "sha256";

const hash = pbkdf2Sync(password, salt, iterations, keyLength, digest).toString("hex");

console.log(`VITE_SITE_PASSWORD_HASH=${hash}`);
