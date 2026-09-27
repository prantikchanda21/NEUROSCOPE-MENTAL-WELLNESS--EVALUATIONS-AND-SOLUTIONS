import fs from 'fs';
import path from 'path';
import { ZipArchive } from 'archiver';

async function buildZip() {
  const rootDir = process.cwd();
  const zipPath = path.join(rootDir, 'neuroscope-mental-health-evaluator.zip');

  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  const output = fs.createWriteStream(zipPath);
  const archive = new ZipArchive({
    zlib: { level: 9 },
    forceLocalTime: true,
    forceZip64: false,
  });

  return new Promise((resolve, reject) => {
    output.on('close', () => {
      console.log(`Archive finalized successfully: ${archive.pointer()} bytes written to ${zipPath}`);
      resolve();
    });

    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        console.warn(err);
      } else {
        reject(err);
      }
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);

    archive.glob('**/*', {
      cwd: rootDir,
      ignore: [
        'node_modules/**',
        '.git/**',
        'dist/**',
        '.vite/**',
        'neuroscope-mental-health-evaluator.zip',
        'test.zip',
        '.env',
        '**/.DS_Store',
        // The exported zip is a source hand-off package; the 65MB model weights
        // are distributed with the site itself (public/models), not re-zipped.
        'public/models/**',
      ],
      dot: true,
    });

    archive.finalize();
  });
}

buildZip().catch((err) => {
  console.error('Failed to build zip:', err);
  process.exit(1);
});
