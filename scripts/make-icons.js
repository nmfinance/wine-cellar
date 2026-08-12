// Одноразовый генератор иконок PWA: SVG-силуэт бутылки → PNG в public/icons.
// Запуск: npm run make-icons
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const WINE = '#722F37';
const CREAM = '#F7EDE4';

const bottle = `
  <g fill="${CREAM}">
    <rect x="238" y="86" width="36" height="28" rx="6"/>
    <path d="M240 120 h32 v58 c0 20 8 30 20 44 c14 17 22 34 22 58 v112
             c0 22 -18 40 -40 40 h-36 c-22 0 -40 -18 -40 -40 v-112
             c0 -24 8 -41 22 -58 c12 -14 20 -24 20 -44 z"/>
  </g>
  <rect x="220" y="296" width="72" height="60" rx="8" fill="${WINE}"/>`;

// обычная иконка: скруглённый бордовый квадрат, бутылка почти во весь рост
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="${WINE}"/>
  ${bottle}
</svg>`;

// maskable: фон во весь холст без скруглений, бутылка уменьшена
// в безопасную зону (центральные ~60%), чтобы не резалась любой маской
const maskableSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${WINE}"/>
  <g transform="translate(102.4 102.4) scale(0.6)">${bottle}</g>
</svg>`;

await mkdir('public/icons', { recursive: true });

const jobs = [
  { svg: iconSvg, size: 192, out: 'public/icons/icon-192.png' },
  { svg: iconSvg, size: 512, out: 'public/icons/icon-512.png' },
  { svg: iconSvg, size: 180, out: 'public/icons/apple-touch-icon-180.png' },
  { svg: maskableSvg, size: 512, out: 'public/icons/icon-512-maskable.png' },
];

for (const { svg, size, out } of jobs) {
  await sharp(Buffer.from(svg), { density: 300 }).resize(size, size).png().toFile(out);
  console.log('✓', out);
}

await writeFile('public/favicon.svg', iconSvg, 'utf8');
console.log('✓ public/favicon.svg');
