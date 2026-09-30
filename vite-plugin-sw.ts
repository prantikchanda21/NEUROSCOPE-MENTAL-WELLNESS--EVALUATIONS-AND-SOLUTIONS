import { createHash } from 'crypto';
import { createReadStream, promises as fs } from 'fs';
import path from 'path';
import type { Plugin } from 'vite';

/**
 * Builds /sw.js from src/sw/service-worker.js and injects the file lists the worker needs.
 * No runtime dependency (no workbox / vite-plugin-pwa), so nothing extra to install.
 *
 *  precache  files <= PRECACHE_MAX_BYTES from the Vite bundle and /public (blocks SW install)
 *  warm      larger files + everything in public/models (fetched in the background)
 */
const PRECACHE_MAX_BYTES = 2 * 1024 * 1024;
const SKIP_EXT = /\.(map|txt|md)$/i;

interface FileInfo {
  url: string;
  size: number;
  hash: string;
}

const md5 = (data: string | Uint8Array) => createHash('md5').update(data).digest('hex');

function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('md5');
    createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

async function walk(dir: string, base = dir): Promise<string[]> {
  let out: string[] = [];
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out; // no public dir
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(await walk(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

export function neuroscopeServiceWorker(options: { template?: string } = {}): Plugin {
  let publicDir = '';
  let base = '/';
  const templatePath = path.resolve(options.template ?? 'src/sw/service-worker.js');

  return {
    name: 'neuroscope-sw',
    apply: 'build',
    configResolved(config) {
      publicDir = config.publicDir || '';
      base = config.base || '/';
    },
    async generateBundle(_out, bundle) {
      if (base !== '/') {
        this.warn('neuroscope-sw: only base "/" is supported; skipping service worker.');
        return;
      }

      const shell: FileInfo[] = [];

      // 1) Everything Vite emitted (index.html, hashed js/css/assets).
      for (const [fileName, item] of Object.entries(bundle)) {
        if (SKIP_EXT.test(fileName) || fileName === 'sw.js') continue;
        const content = item.type === 'chunk' ? item.code : item.source;
        shell.push({
          url: '/' + fileName,
          size: typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength,
          hash: md5(content),
        });
      }

      // 2) Files copied from /public (icons, landscapes, manifest...). Models handled below.
      const models: FileInfo[] = [];
      for (const rel of await walk(publicDir)) {
        if (SKIP_EXT.test(rel) && !rel.startsWith('models/')) continue;
        const full = path.join(publicDir, rel);
        const info: FileInfo = { url: '/' + rel, size: (await fs.stat(full)).size, hash: await hashFile(full) };
        if (rel.startsWith('models/')) {
          if (!/\.(md)$/i.test(rel)) models.push(info); // MODEL_CARD.md is not needed offline
        } else {
          shell.push(info);
        }
      }

      const precache = shell.filter((f) => f.size <= PRECACHE_MAX_BYTES);
      const bigShell = shell.filter((f) => f.size > PRECACHE_MAX_BYTES);
      models.sort((a, b) => a.size - b.size); // small files first, the big .onnx last

      const buildId = md5(
        [...precache, ...bigShell].map((f) => `${f.url}:${f.hash}`).sort().join('\n'),
      ).slice(0, 12);
      const modelsRev = md5(models.map((f) => `${f.url}:${f.size}:${f.hash}`).sort().join('\n')).slice(0, 12);

      const manifest = {
        precache: precache.map((f) => f.url).sort(),
        warm: [...bigShell.map((f) => f.url), ...models.map((f) => f.url)],
      };

      const template = await fs.readFile(templatePath, 'utf8');
      const replacements: Array<[string, string]> = [
        ["'__BUILD_ID__'", JSON.stringify(buildId)],
        ["'__MODELS_REV__'", JSON.stringify(modelsRev)],
        ['__MANIFEST__', JSON.stringify(manifest, null, 2)],
      ];
      let source = template;
      for (const [token, value] of replacements) {
        if (!source.includes(token)) this.error(`neuroscope-sw: placeholder ${token} not found in ${templatePath}`);
        source = source.replace(token, () => value);
      }

      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
