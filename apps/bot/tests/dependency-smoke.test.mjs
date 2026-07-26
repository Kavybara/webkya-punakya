import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";

import { ZipArchive } from "archiver";
import sharp from "sharp";

test("sharp dapat memproses gambar setelah upgrade", async () => {
  const input = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#fff"/></svg>',
  );

  const output = await sharp(input).png().toBuffer();

  assert.ok(output.length > 8);
  assert.equal(output.subarray(1, 4).toString("ascii"), "PNG");
});

test("archiver dapat menghasilkan ZIP setelah upgrade", async () => {
  const output = new PassThrough();
  const chunks = [];
  output.on("data", (chunk) => chunks.push(chunk));

  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.pipe(output);
  archive.append("kavya-backup-smoke", { name: "health.txt" });

  const completed = new Promise((resolve, reject) => {
    output.once("end", resolve);
    output.once("error", reject);
    archive.once("error", reject);
  });

  await archive.finalize();
  await completed;

  const zip = Buffer.concat(chunks);
  assert.ok(zip.length > 20);
  assert.equal(zip.subarray(0, 2).toString("ascii"), "PK");
});
