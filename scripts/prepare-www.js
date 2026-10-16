// three.js'i (+ GLTFLoader / SkeletonUtils) www klasörüne kopyalar (APK'ya gömülür, internetsiz de yüklenir).
import fs from 'node:fs';

function need(src) {
  if (!fs.existsSync(src)) { console.error(src + ' bulunamadı: önce "npm install" çalıştır'); process.exit(1); }
}

const core = 'node_modules/three/build/three.module.js';
need(core);
fs.copyFileSync(core, 'www/three.module.js');
console.log('three.module.js kopyalandı');

// GLTFLoader ve SkeletonUtils "three" paketinden bare-import ile 'three' çağırır;
// www'da paket yöneticisi olmadığı için bunu yerel dosyaya işaret edecek şekilde değiştiriyoruz.
function copyAddon(src, dest) {
  need(src);
  let txt = fs.readFileSync(src, 'utf8');
  txt = txt.replace(/from\s+'three'/g, "from './three.module.js'");
  fs.writeFileSync(dest, txt);
  console.log(dest + ' kopyalandı');
}
copyAddon('node_modules/three/examples/jsm/loaders/GLTFLoader.js', 'www/GLTFLoader.js');
copyAddon('node_modules/three/examples/jsm/utils/SkeletonUtils.js', 'www/SkeletonUtils.js');
