// three.js'i (+ GLTFLoader / SkeletonUtils) www klasörüne kopyalar (APK'ya gömülür, internetsiz de yüklenir).
import fs from 'node:fs';

function need(src) {
  if (!fs.existsSync(src)) { console.error(src + ' bulunamadı: önce "npm install" çalıştır'); process.exit(1); }
}

const core = 'node_modules/three/build/three.module.js';
need(core);
fs.copyFileSync(core, 'www/three.module.js');
console.log('three.module.js kopyalandı');

// GLTFLoader ve SkeletonUtils, 'three' paketinden bare-import ile import eder.
// index.html'deki <script type="importmap"> bunu './three.module.js'ye yönlendiriyor,
// o yüzden burada dosyaları OLDUĞU GİBİ (değiştirmeden) kopyalamak yeterli ve daha güvenilir.
function copyAddon(src, dest) {
  need(src);
  fs.copyFileSync(src, dest);
  console.log(dest + ' kopyalandı');
}
copyAddon('node_modules/three/examples/jsm/loaders/GLTFLoader.js', 'www/GLTFLoader.js');
copyAddon('node_modules/three/examples/jsm/utils/SkeletonUtils.js', 'www/SkeletonUtils.js');
