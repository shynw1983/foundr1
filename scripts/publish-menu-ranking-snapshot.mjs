// Authorized one-time September seed. No token is downloaded or created.
// Later Git builds omit the private input and use the immutable existing blob.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { get, put, BlobNotFoundError } from '@vercel/blob';
const config = await readFile(new URL('../lib/menu-ranking-snapshot-config.ts',import.meta.url),'utf8');
const hash = config.match(/menuRankingSnapshotSha256 = "([a-f0-9]+)"/)[1];
const pathname = config.match(/menuRankingSnapshotPath = "([^"]+)"/)[1];
let input;
try { input = await readFile(new URL('../data/menu-ranking/september-2026.json',import.meta.url)); }
catch(e) { if(e.code !== 'ENOENT') throw e; console.log('Private September input absent; retain existing immutable snapshot.'); }
if (input && process.env.VERCEL_ENV === 'production') {
  if(createHash('sha256').update(input).digest('hex')!==hash)throw Error('Snapshot integrity mismatch');
  const token=process.env.CAMERA_BLOB_READ_WRITE_TOKEN;
  if(!token)throw Error('Existing private Blob configuration unavailable; do not publish business data publicly.');
  let existing;
  try { existing=await get(pathname,{access:'private',token,useCache:false,abortSignal:AbortSignal.timeout(20000)}); }
  catch(e) { if(!(e instanceof BlobNotFoundError))throw e; }
  if(existing?.statusCode===200){const bytes=Buffer.from(await new Response(existing.stream).arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('Existing private snapshot integrity mismatch');}
  else await put(pathname,input,{access:'private',token,addRandomSuffix:false,allowOverwrite:false,contentType:'application/json',abortSignal:AbortSignal.timeout(20000)});
  console.log('Verified immutable September snapshot in the existing private Blob store.');
} else if (input) console.log('Local build: private snapshot upload skipped.');
