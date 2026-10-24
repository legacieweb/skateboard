import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, 'dist');
const apiBase = (process.env.API_BASE_URL || 'https://skateboard-wz0h.onrender.com').replace(/\/$/, '');

await mkdir(output, { recursive: true });
const html = await readFile(path.join(root, 'index.html'), 'utf8');
const configuredHtml = html.replace(
  /(<meta\s+name=["']rollcall-api-base["']\s+content=["'])[^"']*(["']\s*\/?\s*>)/i,
  `$1${apiBase}$2`,
);
if (configuredHtml === html && !html.includes(`content="${apiBase}"`)) {
  throw new Error('Could not configure the rollcall-api-base meta tag in index.html');
}
await writeFile(path.join(output, 'index.html'), configuredHtml);
for (const file of ['styles.css', 'shop.js', 'account.js', 'favicon.svg', 'robots.txt', 'sitemap.xml']) {
  await copyFile(path.join(root, file), path.join(output, file));
}
console.log(`Built static storefront in dist/ (API: ${apiBase})`);
