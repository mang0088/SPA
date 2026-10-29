import { cp, mkdir } from 'node:fs/promises';

await mkdir('_site', { recursive: true });
await cp('index.html', '_site/index.html');
await cp('css', '_site/css', { recursive: true });
await cp('dist', '_site/dist', { recursive: true });
