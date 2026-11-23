// Renders icons/icon.svg to the PNG sizes Chrome needs, using headless Chrome.
// Usage: npm run icons   (set CHROME_PATH if Chrome isn't in the default location)
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SIZES = [16, 32, 48, 128];
const iconsDir = path.resolve(__dirname, '..', 'icons');
const svg = fs.readFileSync(path.join(iconsDir, 'icon.svg'), 'utf8');

const chromePath =
  process.env.CHROME_PATH ||
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
  ].find((candidate) => fs.existsSync(candidate));

if (!chromePath) {
  console.error('Chrome not found. Set CHROME_PATH to your Chrome or Edge executable.');
  process.exit(1);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gridgrab-icons-'));

for (const size of SIZES) {
  const page = path.join(workDir, `icon-${size}.html`);
  fs.writeFileSync(
    page,
    `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`
  );

  const output = path.join(iconsDir, `icon-${size}.png`);
  execFileSync(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--default-background-color=00000000',
    `--window-size=${size},${size}`,
    `--screenshot=${output}`,
    `file:///${page.replace(/\\/g, '/')}`,
  ], { stdio: 'ignore' });

  console.log(`icons/icon-${size}.png`);
}

fs.rmSync(workDir, { recursive: true, force: true });
