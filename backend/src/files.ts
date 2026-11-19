import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { config } from "./config.js";

/** Stores a file under FILES_DIR and returns its public URL (served by /files/*). Names get a random suffix so links cannot be guessed. */
export async function storeFile(folder: string, filename: string, data: Buffer): Promise<string> {
  const c = config();
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  const token = randomBytes(6).toString("hex");
  const dir = path.join(c.FILES_DIR, folder);
  await mkdir(dir, { recursive: true });
  const name = `${token}-${safe}`;
  await writeFile(path.join(dir, name), data);
  return `${c.PUBLIC_URL}/files/${folder}/${name}`;
}
