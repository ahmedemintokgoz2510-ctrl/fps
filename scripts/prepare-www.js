// three.js'i www klasörüne kopyalar (APK'ya gömülür, internetsiz de yüklenir).
import fs from 'node:fs';
const src = 'node_modules/three/build/three.module.js';
if (!fs.existsSync(src)) { console.error('three bulunamadı: önce "npm install" çalıştır'); process.exit(1); }
fs.copyFileSync(src, 'www/three.module.js');
console.log('three.module.js kopyalandı');
