import { copyFileSync } from 'node:fs';
copyFileSync('dist-single/index.html', 'broken-dawn.html');
console.log('Wrote broken-dawn.html');
