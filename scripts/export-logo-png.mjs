import { readFileSync, writeFileSync } from 'fs';
import { Resvg } from '@resvg/resvg-js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(__dirname, '..', 'assets');

const exportsList = [
  { svg: 'inexc-logo.svg', png: 'inexc-logo.png', width: 1260 },
  { svg: 'inexc-logo-white.svg', png: 'inexc-logo-white.png', width: 1260 },
  { svg: 'inexc-logo.svg', png: 'inexc-logo-sm.png', width: 630 },
  { svg: 'inexc-logo-white.svg', png: 'inexc-logo-white-sm.png', width: 630 },
];

for (const item of exportsList) {
  const svg = readFileSync(join(assetsDir, item.svg), 'utf8');
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: item.width },
    background: 'transparent',
  });
  writeFileSync(join(assetsDir, item.png), resvg.render().asPng());
  console.log('Wrote', item.png);
}

// Icon-only crop for favicon
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 112">
  <path d="M14 78 C14 58 24 46 40 42 C52 39 62 39 72 42 C88 46 98 58 98 78 L98 92 L72 84 L56 92 L30 84 L14 92 Z" fill="none" stroke="#0046AA" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M56 42 L56 92" fill="none" stroke="#0046AA" stroke-width="3.5" stroke-linecap="round"/>
  <circle cx="56" cy="24" r="6" fill="#0046AA"/>
  <circle cx="36" cy="34" r="4.2" fill="none" stroke="#0046AA" stroke-width="2.4"/>
  <circle cx="76" cy="34" r="4.2" fill="none" stroke="#0046AA" stroke-width="2.4"/>
  <circle cx="28" cy="50" r="3.6" fill="none" stroke="#0046AA" stroke-width="2.2"/>
  <circle cx="84" cy="50" r="3.6" fill="none" stroke="#0046AA" stroke-width="2.2"/>
  <circle cx="56" cy="12" r="3" fill="none" stroke="#0046AA" stroke-width="2"/>
  <line x1="56" y1="24" x2="36" y2="34" stroke="#0046AA" stroke-width="2.2" stroke-linecap="round"/>
  <line x1="56" y1="24" x2="76" y2="34" stroke="#0046AA" stroke-width="2.2" stroke-linecap="round"/>
  <line x1="56" y1="24" x2="56" y2="12" stroke="#0046AA" stroke-width="2.2" stroke-linecap="round"/>
  <line x1="36" y1="34" x2="28" y2="50" stroke="#0046AA" stroke-width="2.2" stroke-linecap="round"/>
  <line x1="76" y1="34" x2="84" y2="50" stroke="#0046AA" stroke-width="2.2" stroke-linecap="round"/>
  <line x1="36" y1="34" x2="76" y2="34" stroke="#0046AA" stroke-width="2.2" stroke-linecap="round"/>
  <line x1="56" y1="24" x2="56" y2="42" stroke="#0046AA" stroke-width="2.2" stroke-linecap="round"/>
</svg>`;
const iconResvg = new Resvg(iconSvg, { fitTo: { mode: 'width', value: 256 }, background: 'transparent' });
writeFileSync(join(assetsDir, 'inexc-icon.png'), iconResvg.render().asPng());
console.log('Wrote inexc-icon.png');
