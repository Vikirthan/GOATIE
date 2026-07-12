import sharp from 'sharp';
import { mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, '../public/goat-source.png');
const publicDir = join(__dirname, '../public');

const sizes = [
  { name: 'favicon-16x16.png', size: 16 },
  { name: 'favicon-32x32.png', size: 32 },
  { name: 'favicon-48x48.png', size: 48 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'android-chrome-192x192.png', size: 192 },
  { name: 'android-chrome-192x192-maskable.png', size: 192 },
  { name: 'android-chrome-512x512.png', size: 512 },
  { name: 'android-chrome-512x512-maskable.png', size: 512 },
];

console.log('Generating PWA icons from goat logo...');

for (const { name, size } of sizes) {
  const outPath = join(publicDir, name);
  await sharp(src)
    .resize(size, size, { fit: 'contain', background: { r: 34, g: 197, b: 94, alpha: 1 } })
    .png()
    .toFile(outPath);
  console.log(`  ✅ ${name} (${size}x${size})`);
}

// Also create a screenshots placeholder dir
const screenshotsDir = join(publicDir, 'screenshots');
if (!existsSync(screenshotsDir)) {
  mkdirSync(screenshotsDir, { recursive: true });
}

// Generate placeholder screenshots (simple green boxes with text)
await sharp({
  create: { width: 540, height: 720, channels: 4, background: { r: 34, g: 197, b: 94, alpha: 1 } }
}).png().toFile(join(screenshotsDir, 'screenshot-540x720.png'));

await sharp({
  create: { width: 1280, height: 800, channels: 4, background: { r: 34, g: 197, b: 94, alpha: 1 } }
}).png().toFile(join(screenshotsDir, 'screenshot-1280x800.png'));

console.log('  ✅ screenshots/screenshot-540x720.png');
console.log('  ✅ screenshots/screenshot-1280x800.png');
console.log('\n✅ All icons generated!');
