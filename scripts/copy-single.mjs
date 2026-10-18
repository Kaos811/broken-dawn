import { copyFileSync } from 'node:fs';
copyFileSync('dist-single/index.html', 'broken-dawn-stage1.html');
console.log('Wrote broken-dawn-stage1.html');
