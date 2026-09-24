/**
 * Verify the multi-image upload path without publishing.
 *
 *   node scripts/verify-multiimage.mjs <post-id>
 *
 * Uploads the rendered slides as LinkedIn images and prints the URNs. An image
 * that is never referenced by a post expires on its own, so nothing reaches her
 * feed. This exists because the deck path changed from document to multi-image
 * and the first real use is a scheduled morning publish; a failure there is a
 * missed post.
 */
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getSecret } from '../workers/lib/db.mjs';
import { DATA_DIR } from '../workers/lib/publish/paths.mjs';
import { makeClient, sleep } from '../workers/lib/publish/linkedin-api.mjs';

const id = process.argv[2];
if (!id) { console.error('usage: node scripts/verify-multiimage.mjs <post-id>'); process.exit(2); }
const dir = join(DATA_DIR, 'out', id);
if (!existsSync(dir)) { console.error(`no renders at ${dir}; run workers/render.mjs first`); process.exit(2); }
const files = readdirSync(dir).filter((f) => /\.png$/i.test(f)).sort().map((f) => join(dir, f));
console.log(`${id}: ${files.length} slide(s) in ${dir}`);

const secret = await getSecret('linkedin_token');
if (!secret?.access_token) throw new Error('no LinkedIn token in secrets');
const client = makeClient({ token: secret.access_token, apiVersion: secret.api_version || '202608' });

const images = [];
for (const [i, f] of files.entries()) {
  const init = await client.initImage(secret.person_urn);
  await client.putBinary(init.uploadUrl, f);
  images.push(init.image);
  console.log(`  ${String(i + 1).padStart(2)}/${files.length}  ${init.image}`);
  await sleep(1000);
}
console.log(`\nuploaded ${images.length} image(s). Nothing was published.`);
setTimeout(() => process.exit(0), 200);
