// Calcula el precio medio nacional de hoy (MITECO) y lo escribe en:
// - precio-medio.json (dato crudo, por si se reutiliza en el futuro)
// - index.html (entre los marcadores PRECIO-MEDIO-START/END, texto estático visible sin JS)
// - sw.js (sube la versión de CACHE para que los usuarios con la PWA instalada vean el dato nuevo)
// - sitemap.xml (lastmod de "/" a hoy, porque el contenido cambia a diario)
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const API = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/';

function media(estaciones, campo) {
  const precios = estaciones
    .map(e => parseFloat((e[campo] || '').replace(',', '.')))
    .filter(p => p > 0);
  return precios.reduce((a, b) => a + b, 0) / precios.length;
}

function comaDecimal(n) {
  return n.toFixed(3).replace('.', ',');
}

async function main() {
  const res = await fetch(API);
  const data = await res.json();
  const estaciones = data.ListaEESSPrecio || [];
  if (!estaciones.length) throw new Error('La API de MITECO no devolvió estaciones.');

  const gasolina95 = comaDecimal(media(estaciones, 'Precio Gasolina 95 E5'));
  const gasoleoA = comaDecimal(media(estaciones, 'Precio Gasoleo A'));
  const hoy = new Date();
  const fechaISO = hoy.toISOString().slice(0, 10); // YYYY-MM-DD
  const fechaEs = fechaISO.split('-').reverse().join('/'); // DD/MM/YYYY

  // 1) precio-medio.json
  fs.writeFileSync(
    path.join(RAIZ, 'precio-medio.json'),
    JSON.stringify({ fecha: fechaISO, gasolina95, gasoleoA }, null, 2) + '\n'
  );

  // 2) index.html: sustituir el contenido entre marcadores
  const indexPath = path.join(RAIZ, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  const textoPrecio =
    'Precio medio en España hoy (' + fechaEs + '): Gasolina 95 <strong>' + gasolina95 +
    ' €/l</strong> · Gasóleo A <strong>' + gasoleoA + ' €/l</strong>';
  html = html.replace(
    /<!--PRECIO-MEDIO-START-->[\s\S]*?<!--PRECIO-MEDIO-END-->/,
    '<!--PRECIO-MEDIO-START-->' + textoPrecio + '<!--PRECIO-MEDIO-END-->'
  );
  fs.writeFileSync(indexPath, html);

  // 3) sw.js: subir versión de CACHE (g98-app-vN -> vN+1)
  const swPath = path.join(RAIZ, 'sw.js');
  let sw = fs.readFileSync(swPath, 'utf8');
  sw = sw.replace(/g98-app-v(\d+)/, function (_, n) {
    return 'g98-app-v' + (parseInt(n, 10) + 1);
  });
  fs.writeFileSync(swPath, sw);

  // 4) sitemap.xml: lastmod de "/" a hoy
  const sitemapPath = path.join(RAIZ, 'sitemap.xml');
  let sitemap = fs.readFileSync(sitemapPath, 'utf8');
  sitemap = sitemap.replace(/<lastmod>[\d-]+<\/lastmod>/, '<lastmod>' + fechaISO + '</lastmod>');
  fs.writeFileSync(sitemapPath, sitemap);

  console.log('Precio medio actualizado:', fechaEs, '| Gasolina 95:', gasolina95, '| Gasóleo A:', gasoleoA);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
