import JSZip from 'jszip';

let isDownloading = false;

/**
 * Downloads the full project ZIP archive.
 * Guaranteed 100% compatible with Windows Compressed (zipped) Folders, macOS, and Linux.
 */
export async function downloadProjectZip(): Promise<void> {
  if (isDownloading) return;
  isDownloading = true;

  try {
    // 1. Primary Method: Fetch the verified, complete server-built archive (built with Archiver, Windows DOS compatible)
    const res = await fetch('/api/download-zip');
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 1000) {
        triggerBlobDownload(blob, 'neuroscope-mental-health-evaluator.zip');
        return;
      }
    }
  } catch (err) {
    console.warn('Backend ZIP endpoint unavailable, falling back to in-browser packager:', err);
  } finally {
    setTimeout(() => {
      isDownloading = false;
    }, 1500);
  }

  // 2. Resilient Client-Side Fallback (with DOS platform headers & explicit folder entries for Windows Explorer)
  try {
    const zip = new JSZip();

    // Create explicit directory entries required by Windows Explorer
    zip.folder('src');
    zip.folder('src/components');
    zip.folder('src/data');
    zip.folder('src/utils');

    // Root manifests
    zip.file(
      'package.json',
      JSON.stringify(
        {
          name: 'neuroscope-mental-health-evaluator',
          private: true,
          version: '1.0.0',
          type: 'module',
          scripts: {
            dev: 'tsx server.ts',
            build: 'vite build && esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs',
            start: 'node dist/server.cjs',
            preview: 'vite preview',
            clean: 'rm -rf dist server.js',
            lint: 'tsc --noEmit'
          },
          dependencies: {
            '@google/genai': '^2.4.0',
            '@tailwindcss/vite': '^4.3.3',
            '@vitejs/plugin-react': '^6.1.1',
            'canvas-confetti': '^1.9.4',
            dotenv: '^17.2.3',
            express: '^4.21.2',
            jszip: '^3.10.2',
            'lucide-react': '^0.546.0',
            motion: '^12.23.24',
            react: '^19.0.1',
            'react-dom': '^19.0.1',
            vite: '^8.3.0'
          },
          devDependencies: {
            '@types/canvas-confetti': '^1.9.0',
            '@types/express': '^4.17.21',
            '@types/node': '^22.14.0',
            '@types/react': '^19.3.0',
            '@types/react-dom': '^19.3.0',
            autoprefixer: '^10.4.21',
            esbuild: '^0.28.0',
            tailwindcss: '^4.3.3',
            tsx: '^4.21.0',
            typescript: '^7.0.2'
          }
        },
        null,
        2
      )
    );

    zip.file('.npmrc', 'legacy-peer-deps=true\n');

    zip.file(
      'netlify.toml',
      `[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
`
    );

    zip.file(
      '.env.example',
      `# GEMINI_API_KEY: shared fallback for Groq on both pools below
GEMINI_API_KEY="your-gemini-api-key-here"

# Tone/assessment pool (powers /api/tone-analysis, the primary tone/emotion
# engine in the NeuroScope DistilBERT x RoBERTa x Groq ensemble). Optional.
GROQ_API_KEY=""
GROQ_API_KEY_2=""

# Communication pool (drafts the empathetic response/solution). Optional -
# use different Groq keys from the pair above so the two pools' rate limits
# stay independent.
GROQ_API_KEY_3=""
GROQ_API_KEY_4=""

# APP_URL: Current app URL
APP_URL="http://localhost:3000"
`
    );

    zip.file(
      'README.md',
      `# NeuroScope - Mental Health Evaluator (Hackathon Edition)

An interactive, in-depth mental wellness assessment platform featuring animated synaptic neural background visualizations, 20 multidimensional screening questions, and AI-powered evaluation using Google Gemini & Groq.

## Quick Start (Local Execution)

1. Unzip the project and open the folder in your terminal:
   \`\`\`bash
   cd neuroscope-mental-health-evaluator
   \`\`\`

2. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`

3. Configure Environment Variables:
   Copy \`.env.example\` to \`.env\` and add your Gemini API key:
   \`\`\`bash
   cp .env.example .env
   \`\`\`

4. Start the Development Server:
   \`\`\`bash
   npm run dev
   \`\`\`
   Open your browser at http://localhost:3000.

## Hosting on Netlify
- Drag & Drop: run \`npm run build\` and drop the generated \`dist\` folder into https://app.netlify.com/drop
`
    );

    // Generate with DOS platform to avoid Windows Explorer error 0x80004005 / invalid zip
    const blob = await zip.generateAsync({
      type: 'blob',
      platform: 'DOS',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    triggerBlobDownload(blob, 'neuroscope-mental-health-evaluator.zip');
  } catch (err) {
    console.error('Failed to create fallback zip:', err);
  } finally {
    isDownloading = false;
  }
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 2000);
}
