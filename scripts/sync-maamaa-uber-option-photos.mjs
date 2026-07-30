import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { put } from "@vercel/blob";
import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

const imageDirectory = process.argv[2];
const apply = process.argv.includes("--apply");
const brandId = "30d5d8b7-a65d-4190-8016-f796bb54219e";

if (!imageDirectory) {
  throw new Error("Usage: node scripts/sync-maamaa-uber-option-photos.mjs <image-directory> [--apply]");
}
if (apply && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set.");
}
if (apply && !process.env.BLOB_READ_WRITE_TOKEN) {
  throw new Error("BLOB_READ_WRITE_TOKEN is not set.");
}

const files = (await readdir(imageDirectory))
  .filter((name) => /^[a-z0-9-]+__[a-z0-9-]+\.(jpe?g|png|webp)$/i.test(name))
  .sort();

const entries = files.map((fileName) => {
  const extension = extname(fileName);
  const [groupKey, optionKey] = fileName.slice(0, -extension.length).split("__");
  return { extension, fileName, groupKey, optionKey };
});

if (!apply) {
  console.log(JSON.stringify({ apply: false, count: entries.length, entries }, null, 2));
  process.exit(0);
}

const sql = neon(process.env.DATABASE_URL);
const contentTypes = {
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

async function syncPhoto(entry) {
  const bytes = await readFile(join(imageDirectory, entry.fileName));
  const blob = await put(
    `menu-items/maamaa/options/${entry.groupKey}/${entry.optionKey}${entry.extension.toLowerCase()}`,
    bytes,
    {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: contentTypes[entry.extension.toLowerCase()] ?? "image/jpeg",
      token: process.env.BLOB_READ_WRITE_TOKEN,
    },
  );
  const imageUrl = `/api/public/menu-image?pathname=${encodeURIComponent(blob.pathname)}&v=${Date.now()}`;

  const updated = await sql.query(
    `
      update menu_options as options
      set image_url = $3, updated_at = now()
      from menu_option_groups as groups
      where options.option_group_id = groups.id
        and groups.brand_id = $4
        and groups.group_key = $1
        and options.option_key = $2
      returning options.id
    `,
    [entry.groupKey, entry.optionKey, imageUrl, brandId],
  );

  if (updated.length !== 1) {
    throw new Error(
      `Expected one option for ${entry.groupKey}/${entry.optionKey}, updated ${updated.length}.`,
    );
  }

  return { groupKey: entry.groupKey, optionKey: entry.optionKey, imageUrl };
}

const results = [];
for (let index = 0; index < entries.length; index += 5) {
  results.push(...(await Promise.all(entries.slice(index, index + 5).map(syncPhoto))));
}

console.log(JSON.stringify({ apply: true, count: results.length, results }, null, 2));
