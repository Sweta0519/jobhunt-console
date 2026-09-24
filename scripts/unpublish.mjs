/**
 * Delete a published LinkedIn post and return its row to approved.
 *
 *   node scripts/unpublish.mjs <post-id>
 *
 * Only for a post that should go out again in a different form. Deleting on
 * LinkedIn is permanent and takes its reactions and comments with it, so this
 * prints what it is about to remove and requires the id explicitly.
 */
import { select, patch, getSecret } from '../workers/lib/db.mjs';
import { makeClient } from '../workers/lib/publish/linkedin-api.mjs';

const id = process.argv[2];
if (!id) { console.error('usage: node scripts/unpublish.mjs <post-id>'); process.exit(2); }

const [row] = await select('posts', `?id=eq.${id}`);
if (!row) { console.error(`no post ${id}`); process.exit(2); }
if (!row.published_urn) { console.error(`${id} has no published_urn; nothing to delete`); process.exit(2); }
console.log(`${id}  ${row.title}\n  ${row.published_url}`);

const secret = await getSecret('linkedin_token');
if (!secret?.access_token) throw new Error('no LinkedIn token in secrets');
const client = makeClient({ token: secret.access_token, apiVersion: secret.api_version || '202608' });

const status = await client.deletePost(row.published_urn);
console.log(`  delete -> HTTP ${status}`);

await patch('posts', `?id=eq.${id}`, {
  status: 'approved',
  published_urn: null,
  published_url: null,
  published_at: null,
  last_error: null,
  updated_at: new Date().toISOString(),
});
console.log(`  ${id} is approved again; publish with: node workers/publish.mjs --now --id ${id}`);
setTimeout(() => process.exit(0), 200);
