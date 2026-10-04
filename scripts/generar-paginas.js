// Genera las fichas SEO estáticas de precios por provincia y municipio a partir del listado
// nacional de MITECO, dentro de la carpeta de publicación (por defecto _site/):
//   /gasolineras-baratas/                      índice con las 52 provincias
//   /gasolineras-baratas/<provincia>/          precio medio y más baratas de la provincia
//   /gasolineras-baratas/<provincia>/<muni>/   municipios con al menos MIN_GASOLINERAS estaciones
// y reescribe sitemap.xml con todas las URLs. Estas páginas NO se guardan en el repo (pesarían
// cientos de MB al año en el historial): las publica el workflow publicar.yml en cada ejecución.
// Uso: node scripts/generar-paginas.js [carpeta_salida]
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const SALIDA = path.resolve(process.argv[2] || path.join(RAIZ, '_site'));
const API = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/';
const BASE = 'https://app.gasolina98.es';
const CARPETA = 'gasolineras-baratas';
const MIN_GASOLINERAS = 3; // con 1-2 gasolineras la página sería contenido pobre
const TOP = 10;            // gasolineras por carburante en los rankings
const MAX_LISTADO = 80;    // tope de la tabla "todas las gasolineras" de un municipio
const VECINOS = 8;         // municipios cercanos enlazados desde cada ficha

const CARBURANTES = [
  { k: 'g95', campo: 'Precio Gasolina 95 E5', nombre: 'Gasolina 95', corto: '95', de: 'de la gasolina 95' },
  { k: 'diesel', campo: 'Precio Gasoleo A', nombre: 'Diésel (Gasóleo A)', corto: 'Diésel', de: 'del diésel' },
  { k: 'g98', campo: 'Precio Gasolina 98 E5', nombre: 'Gasolina 98', corto: '98', de: 'de la gasolina 98' }
];

// IDProvincia de MITECO -> nombre para mostrar y slug de la URL
const PROVINCIAS = {
  '01': ['Álava', 'alava'], '02': ['Albacete', 'albacete'], '03': ['Alicante', 'alicante'],
  '04': ['Almería', 'almeria'], '05': ['Ávila', 'avila'], '06': ['Badajoz', 'badajoz'],
  '07': ['Illes Balears', 'baleares'], '08': ['Barcelona', 'barcelona'], '09': ['Burgos', 'burgos'],
  '10': ['Cáceres', 'caceres'], '11': ['Cádiz', 'cadiz'], '12': ['Castellón', 'castellon'],
  '13': ['Ciudad Real', 'ciudad-real'], '14': ['Córdoba', 'cordoba'], '15': ['A Coruña', 'a-coruna'],
  '16': ['Cuenca', 'cuenca'], '17': ['Girona', 'girona'], '18': ['Granada', 'granada'],
  '19': ['Guadalajara', 'guadalajara'], '20': ['Gipuzkoa', 'gipuzkoa'], '21': ['Huelva', 'huelva'],
  '22': ['Huesca', 'huesca'], '23': ['Jaén', 'jaen'], '24': ['León', 'leon'], '25': ['Lleida', 'lleida'],
  '26': ['La Rioja', 'la-rioja'], '27': ['Lugo', 'lugo'], '28': ['Madrid', 'madrid'],
  '29': ['Málaga', 'malaga'], '30': ['Murcia', 'murcia'], '31': ['Navarra', 'navarra'],
  '32': ['Ourense', 'ourense'], '33': ['Asturias', 'asturias'], '34': ['Palencia', 'palencia'],
  '35': ['Las Palmas', 'las-palmas'], '36': ['Pontevedra', 'pontevedra'], '37': ['Salamanca', 'salamanca'],
  '38': ['Santa Cruz de Tenerife', 'santa-cruz-de-tenerife'], '39': ['Cantabria', 'cantabria'],
  '40': ['Segovia', 'segovia'], '41': ['Sevilla', 'sevilla'], '42': ['Soria', 'soria'],
  '43': ['Tarragona', 'tarragona'], '44': ['Teruel', 'teruel'], '45': ['Toledo', 'toledo'],
  '46': ['Valencia', 'valencia'], '47': ['Valladolid', 'valladolid'], '48': ['Bizkaia', 'bizkaia'],
  '49': ['Zamora', 'zamora'], '50': ['Zaragoza', 'zaragoza'], '51': ['Ceuta', 'ceuta'], '52': ['Melilla', 'melilla']
};

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const ARTICULOS = ['El', 'La', 'Los', 'Las', "L'", 'Les', 'Els', 'Es', 'Sa', 'Ses', 'A', 'O', 'As', 'Os'];

// ---------- utilidades ----------
function num(s) { const n = parseFloat(String(s || '').replace(',', '.')); return isFinite(n) ? n : 0; }
function eur(n) { return n.toFixed(3).replace('.', ',') + ' €'; }
function eur2(n) { return n.toFixed(2).replace('.', ',') + ' €'; }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function slug(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function media(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function capital(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// "Rozas de Madrid (Las)" -> "Las Rozas de Madrid"; "Alfàs del Pi (l')" -> "L'Alfàs del Pi"
function nombreMunicipio(s) {
  const m = String(s).trim().match(/^(.*)\s+\(([^)]+)\)$/);
  if (!m) return String(s).trim();
  const art = ARTICULOS.find(a => a.toLowerCase() === m[2].toLowerCase());
  if (!art) return String(s).trim();
  return art.endsWith("'") ? art + m[1] : art + ' ' + m[1];
}

// Rótulos y direcciones de MITECO vienen en MAYÚSCULAS
const MINUS = ['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'a', 'en', 'con', 'sn', 's/n'];
function suavizar(s) {
  s = String(s || '').trim().replace(/\s+/g, ' ');
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().split(' ').map((w, i) => {
    if (i > 0 && MINUS.indexOf(w) !== -1) return w === 'sn' ? 's/n' : w;
    if (/^[a-z](\.[a-z])+\.?$/.test(w) || (w.length === 2 && !/[aeiouáéíóú]/.test(w))) return w.toUpperCase(); // S.L., BP, CR
    if (/^(n-|a-|ap-|m-|c-|cv-|gr-|ma-)?\d/.test(w) || /^[a-z]{1,3}-\d/.test(w)) return w.toUpperCase();
    return capital(w);
  }).join(' ');
}

function fechaLarga(d) { return d.getUTCDate() + ' de ' + MESES[d.getUTCMonth()] + ' de ' + d.getUTCFullYear(); }

function distanciaKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function diferencia(valor, ref, quien) {
  const c = Math.round((valor - ref) * 1000) / 10; // céntimos con un decimal
  if (Math.abs(c) < 0.5) return 'en línea con ' + quien;
  return Math.abs(c).toFixed(1).replace('.', ',') + ' céntimos ' + (c < 0 ? 'por debajo de ' : 'por encima de ') + quien;
}

async function descargar() {
  // Para pruebas sin red: MITECO_JSON=ruta/al/listado.json
  if (process.env.MITECO_JSON) return JSON.parse(fs.readFileSync(process.env.MITECO_JSON, 'utf8'));
  let ultimoError;
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(API, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data.ListaEESSPrecio || !data.ListaEESSPrecio.length) throw new Error('Listado vacío');
      return data;
    } catch (e) {
      ultimoError = e;
      console.log('Intento ' + i + ' fallido: ' + e.message);
      await new Promise(r => setTimeout(r, 15000 * i));
    }
  }
  throw ultimoError;
}

// ---------- plantilla común ----------
const UTM = '?utm_source=fichas&utm_medium=seo&utm_campaign=';
const CSS = `*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f7fa;color:#222;line-height:1.5}
header{background:#2e3160;color:#e8e4d8;padding:12px 16px;display:flex;align-items:center;gap:10px}header a{color:inherit;text-decoration:none;display:flex;align-items:center;gap:10px}
header img{height:40px;width:40px}header .t{font-weight:800;font-size:18px;letter-spacing:.5px}header .s{font-size:11px;opacity:.8}
main{padding:14px;max-width:760px;margin:0 auto}.migas{font-size:13px;color:#666;margin:0 0 10px}.migas a{color:#2e3160}
.panel{background:#fff;border:1px solid #dde3ea;border-radius:12px;padding:16px;margin-bottom:14px}
h1{font-size:24px;line-height:1.25;margin:0 0 8px;color:#2e3160}h2{font-size:19px;margin:0 0 10px;color:#2e3160}
.intro{font-size:16px;color:#333;margin:0}.medias{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0 0}
.medias div{flex:1;min-width:150px;background:#f0f3f8;border-radius:10px;padding:10px 12px}.medias b{display:block;font-size:24px;color:#2e3160}.medias span{font-size:13px;color:#555}
.cta{display:block;text-align:center;background:#1e9e4a;color:#fff;font-weight:bold;font-size:18px;padding:14px;border-radius:10px;text-decoration:none;margin:14px 0 0}
table{width:100%;border-collapse:collapse;font-size:15px}th{background:#2e3160;color:#fff;text-align:left;padding:8px;font-weight:600}
td{padding:8px;border-bottom:1px solid #e6e9ef;vertical-align:top}td.p{font-weight:bold;white-space:nowrap;text-align:right}th.p{text-align:right}
td .d{font-size:13px;color:#666}td a{color:#2e3160}tr.top1 td{background:#eaf7ee}.nota{font-size:13px;color:#666;margin:8px 0 0}
.enlaces{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0;list-style:none}.enlaces a{display:inline-block;background:#f0f3f8;border:1px solid #dde3ea;border-radius:8px;padding:6px 10px;color:#2e3160;text-decoration:none;font-size:14px}
.faq h3{font-size:16px;margin:14px 0 4px;color:#222}.faq p{margin:0;color:#444}
footer{text-align:center;font-size:12px;color:#888;padding:16px}footer a{color:#2e3160;font-weight:bold;text-decoration:none}`;

function pagina(o) {
  // o: { ruta, titulo, descripcion, migas:[[texto,url]], cuerpo, faq:[[p,r]], campana }
  const url = BASE + o.ruta;
  const migasLd = o.migas.map((m, i) => ({ '@type': 'ListItem', position: i + 1, name: m[0], item: BASE + m[1] }));
  const ld = [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: migasLd }];
  if (o.faq && o.faq.length) {
    ld.push({
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: o.faq.map(f => ({ '@type': 'Question', name: f[0], acceptedAnswer: { '@type': 'Answer', text: f[1] } }))
    });
  }
  const migasHtml = o.migas.map((m, i) => i === o.migas.length - 1 ? esc(m[0]) : '<a href="' + m[1] + '">' + esc(m[0]) + '</a>').join(' › ');
  const faqHtml = o.faq && o.faq.length
    ? '<section class="panel faq"><h2>Preguntas frecuentes</h2>' + o.faq.map(f => '<h3>' + esc(f[0]) + '</h3><p>' + esc(f[1]) + '</p>').join('') + '</section>'
    : '';
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.titulo)}</title>
<meta name="description" content="${esc(o.descripcion)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Gasolina98">
<meta property="og:locale" content="es_ES">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(o.titulo)}">
<meta property="og:description" content="${esc(o.descripcion)}">
<meta property="og:image" content="${BASE}/icon-512.png">
<meta name="theme-color" content="#2e3160">
<link rel="icon" sizes="192x192" href="/icon-192.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('consent', 'default', {'ad_storage':'denied','ad_user_data':'denied','ad_personalization':'denied','analytics_storage':'denied','wait_for_update':500});
</script>
<script async src="https://fundingchoicesmessages.google.com/i/pub-5561147546413268?ers=1"></script>
<script>(function() {function signalGooglefcPresent() {if (!window.frames['googlefcPresent']) {if (document.body) {const iframe = document.createElement('iframe'); iframe.style = 'width: 0; height: 0; border: none; z-index: -1000; left: -1000px; top: -1000px;'; iframe.style.display = 'none'; iframe.name = 'googlefcPresent'; document.body.appendChild(iframe);} else {setTimeout(signalGooglefcPresent, 0);}}}signalGooglefcPresent();})();</script>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5561147546413268" crossorigin="anonymous"></script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-BYB1CNTNKN"></script>
<script>gtag('js', new Date());gtag('config', 'G-BYB1CNTNKN', {content_group: 'fichas_${o.campana}'});</script>
<style>${CSS}</style>
</head>
<body>
<header><a href="/${UTM}${o.campana}"><img src="/icon-192.png" alt="Gasolina98" width="40" height="40"><div><div class="t">GASOLINA98</div><div class="s">Gasolineras baratas · precios oficiales de hoy</div></div></a></header>
<main>
<nav class="migas">${migasHtml}</nav>
${o.cuerpo}
${faqHtml}
</main>
<footer>
Precios: Ministerio para la Transición Ecológica (datos oficiales, actualización diaria)<br>
Un servicio gratuito de <a href="https://www.gasolina98.es">Gasolina98.es</a> · <a href="/${UTM}${o.campana}">Abrir la app</a><br>
<a href="https://www.gasolina98.es/p/aviso-legal.html">Aviso legal</a> ·
<a href="https://www.gasolina98.es/p/politica-de-privacidad.html">Política de privacidad</a> ·
<a href="https://www.gasolina98.es/p/politica-de-cookies.html">Política de cookies</a>
</footer>
</body>
</html>
`;
}

function escribir(ruta, html) {
  const dir = path.join(SALIDA, ruta);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
}

function comoLlegar(e) {
  return 'https://www.google.com/maps/dir/?api=1&destination=' + e.lat + ',' + e.lon;
}

// Tabla con las más baratas de un carburante
function tablaRanking(lista, c, conMunicipio) {
  const filas = lista.slice(0, TOP).map((e, i) =>
    '<tr' + (i === 0 ? ' class="top1"' : '') + '><td>' + (i + 1) + '</td><td><b>' + esc(e.rotulo) + '</b><div class="d">' +
    esc(e.dir) + (conMunicipio ? ' · ' + esc(e.muniNombre) : '') + ' · <a href="' + comoLlegar(e) + '" rel="nofollow noopener" target="_blank">Cómo llegar</a></div>' +
    (e.horario ? '<div class="d">' + esc(e.horario) + '</div>' : '') + '</td><td class="p">' + eur(e[c.k]) + '</td></tr>').join('');
  return '<table><thead><tr><th>#</th><th>Gasolinera</th><th class="p">' + esc(c.corto) + ' €/l</th></tr></thead><tbody>' + filas + '</tbody></table>';
}

function ordenarPor(lista, k) { return lista.filter(e => e[k] > 0).sort((a, b) => a[k] - b[k]); }

function resumen(lista) {
  const r = { n: lista.length };
  CARBURANTES.forEach(c => {
    const orden = ordenarPor(lista, c.k);
    r[c.k] = { orden: orden, media: media(orden.map(e => e[c.k])), min: orden[0], max: orden[orden.length - 1] };
  });
  return r;
}

// ---------- main ----------
async function main() {
  const data = await descargar();
  const m = String(data.Fecha || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const fecha = m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : new Date();
  const fechaISO = fecha.toISOString().slice(0, 10);
  const hoy = fechaLarga(fecha);

  // Estaciones normalizadas
  const estaciones = [];
  data.ListaEESSPrecio.forEach(e => {
    const prov = PROVINCIAS[e.IDProvincia];
    if (!prov) return;
    const est = {
      id: e.IDEESS, rotulo: suavizar(e['Rótulo']) || 'Gasolinera', dir: suavizar(e['Dirección']),
      horario: String(e.Horario || '').trim(), lat: num(e.Latitud), lon: num(e['Longitud (WGS84)']),
      prov: e.IDProvincia, muniId: e.IDProvincia + '-' + e.IDMunicipio, muniNombre: nombreMunicipio(e.Municipio)
    };
    let alguno = false;
    CARBURANTES.forEach(c => { est[c.k] = num(e[c.campo]); if (est[c.k] > 0) alguno = true; });
    if (alguno) estaciones.push(est);
  });

  const nacional = resumen(estaciones);

  // Agrupar por provincia y municipio
  const provincias = {};
  estaciones.forEach(e => {
    const p = provincias[e.prov] || (provincias[e.prov] = { id: e.prov, nombre: PROVINCIAS[e.prov][0], slug: PROVINCIAS[e.prov][1], est: [], munis: {} });
    p.est.push(e);
    const mu = p.munis[e.muniId] || (p.munis[e.muniId] = { id: e.muniId, nombre: e.muniNombre, est: [] });
    mu.est.push(e);
  });

  const urls = [];
  const ordenProv = Object.values(provincias).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  ordenProv.forEach(p => {
    p.res = resumen(p.est);
    p.ruta = '/' + CARPETA + '/' + p.slug + '/';
    // Municipios con ficha propia, con slug único dentro de la provincia
    const usados = {};
    p.conFicha = Object.values(p.munis).filter(mu => mu.est.length >= MIN_GASOLINERAS)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    p.conFicha.forEach(mu => {
      let s = slug(mu.nombre) || mu.id;
      if (usados[s]) s += '-' + mu.id.split('-')[1];
      usados[s] = true;
      mu.ruta = p.ruta + s + '/';
      mu.res = resumen(mu.est);
      mu.lat = media(mu.est.map(e => e.lat).filter(Boolean));
      mu.lon = media(mu.est.map(e => e.lon).filter(Boolean));
    });
  });

  // ---- fichas de municipio ----
  let nMunis = 0;
  ordenProv.forEach(p => {
    p.conFicha.forEach(mu => {
      const r = mu.res, g = r.g95, d = r.diesel, g98 = r.g98;
      const n = mu.nombre;
      const frases = [];
      if (g.min) frases.push('la gasolina 95 más barata está en <b>' + esc(g.min.rotulo) + '</b> (' + esc(g.min.dir) + ') a <b>' + eur(g.min.g95) + '/l</b>');
      if (d.min) frases.push('el diésel más barato, en <b>' + esc(d.min.rotulo) + '</b> (' + esc(d.min.dir) + ') a <b>' + eur(d.min.diesel) + '/l</b>');
      const ahorro = g.orden.length > 1 ? (g.max.g95 - g.min.g95) * 50 : 0;

      const medias = '<div class="medias">' +
        (g.media ? '<div><span>Gasolina 95 · media</span><b>' + eur(g.media) + '</b><span>' + diferencia(g.media, nacional.g95.media, 'la media nacional') + '</span></div>' : '') +
        (d.media ? '<div><span>Diésel · media</span><b>' + eur(d.media) + '</b><span>' + diferencia(d.media, nacional.diesel.media, 'la media nacional') + '</span></div>' : '') +
        '</div>';

      let cuerpo = '<section class="panel"><h1>Gasolineras más baratas en ' + esc(n) + ' hoy</h1>' +
        '<p class="intro">Precios oficiales del ' + hoy + ' en las ' + r.n + ' gasolineras de ' + esc(n) + ' (' + esc(p.nombre) + '). ' +
        (frases.length ? capital(frases.join(', y ')) + '.' : '') +
        (ahorro >= 1 ? ' Llenar un depósito de 50 litros de gasolina 95 en la más barata en lugar de en la más cara te ahorra <b>' + eur2(ahorro) + '</b>.' : '') +
        '</p>' + medias +
        '<a class="cta" href="/' + UTM + 'municipio">🗺️ Ver en el mapa las más baratas cerca de ti</a></section>';

      CARBURANTES.forEach(c => {
        const x = r[c.k];
        if (!x.orden.length) return;
        if (c.k === 'g98' && x.orden.length < 2) return;
        cuerpo += '<section class="panel"><h2>' + esc(c.nombre) + ': las más baratas de ' + esc(n) + '</h2>' + tablaRanking(x.orden, c, false) +
          '<p class="nota">Precio medio ' + c.de + ' en ' + esc(n) + ': ' + eur(x.media) + '/l, ' +
          diferencia(x.media, p.res[c.k].media, 'la media de ' + p.nombre) + '.</p></section>';
      });

      // Todas las gasolineras del municipio
      const todas = mu.est.slice().sort((a, b) => (a.g95 || 9) - (b.g95 || 9) || (a.diesel || 9) - (b.diesel || 9));
      cuerpo += '<section class="panel"><h2>Todas las gasolineras de ' + esc(n) + '</h2><table><thead><tr><th>Gasolinera</th><th class="p">95</th><th class="p">Diésel</th></tr></thead><tbody>' +
        todas.slice(0, MAX_LISTADO).map(e => '<tr><td><b>' + esc(e.rotulo) + '</b><div class="d">' + esc(e.dir) + '</div></td><td class="p">' +
          (e.g95 ? eur(e.g95) : '—') + '</td><td class="p">' + (e.diesel ? eur(e.diesel) : '—') + '</td></tr>').join('') +
        '</tbody></table>' + (todas.length > MAX_LISTADO ? '<p class="nota">Mostramos ' + MAX_LISTADO + ' de ' + todas.length + '. Consulta el resto en la <a href="/' + UTM + 'municipio">app</a>.</p>' : '') +
        '</section>';

      // Municipios cercanos de la misma provincia
      const cerca = p.conFicha.filter(o => o !== mu && o.lat)
        .map(o => ({ o: o, km: distanciaKm(mu, o) })).sort((a, b) => a.km - b.km).slice(0, VECINOS);
      cuerpo += '<section class="panel"><h2>Gasolineras baratas cerca de ' + esc(n) + '</h2><ul class="enlaces">' +
        cerca.map(c => '<li><a href="' + c.o.ruta + '">' + esc(c.o.nombre) + ' (' + Math.round(c.km) + ' km)</a></li>').join('') +
        '<li><a href="' + p.ruta + '">Toda la provincia de ' + esc(p.nombre) + '</a></li></ul></section>';

      const faq = [];
      if (g.min) faq.push(['¿Cuál es la gasolinera más barata de ' + n + ' hoy?',
        'Según los precios oficiales del ' + hoy + ', la gasolina 95 más barata de ' + n + ' está en ' + g.min.rotulo + ' (' + g.min.dir + '), a ' + eur(g.min.g95) + ' por litro.']);
      if (d.min) faq.push(['¿Dónde está el diésel más barato de ' + n + '?',
        'El gasóleo A más barato de ' + n + ' hoy está en ' + d.min.rotulo + ' (' + d.min.dir + '), a ' + eur(d.min.diesel) + ' por litro.']);
      if (g.media) faq.push(['¿Cuál es el precio medio de la gasolina en ' + n + '?',
        'El precio medio de la gasolina 95 en ' + n + ' es de ' + eur(g.media) + ' por litro' + (d.media ? ' y el del diésel, de ' + eur(d.media) : '') +
        ', calculado con las ' + r.n + ' gasolineras del municipio.']);
      faq.push(['¿Cada cuánto se actualizan estos precios?',
        'Todos los días. Las gasolineras comunican sus precios al Ministerio para la Transición Ecológica y esta página se regenera a diario con esos datos oficiales. El precio en el surtidor puede variar si la estación lo cambia durante el día.']);

      const titulo = 'Gasolineras baratas en ' + n + ' hoy' + (g.min ? ': 95 desde ' + eur(g.min.g95) : '');
      const desc = 'Precios de hoy (' + hoy + ') en las ' + r.n + ' gasolineras de ' + n + ', ' + p.nombre + '.' +
        (g.min ? ' Gasolina 95 desde ' + eur(g.min.g95) + '/l' : '') + (d.min ? ', diésel desde ' + eur(d.min.diesel) + '/l' : '') + '. Datos oficiales del Ministerio.';

      escribir(mu.ruta, pagina({
        ruta: mu.ruta, titulo: titulo, descripcion: desc, campana: 'municipio', cuerpo: cuerpo, faq: faq,
        migas: [['Inicio', '/'], ['Gasolineras baratas', '/' + CARPETA + '/'], [p.nombre, p.ruta], [n, mu.ruta]]
      }));
      urls.push(mu.ruta);
      nMunis++;
    });
  });

  // ---- fichas de provincia ----
  ordenProv.forEach(p => {
    const r = p.res, g = r.g95, d = r.diesel;
    const medias = '<div class="medias">' +
      (g.media ? '<div><span>Gasolina 95 · media</span><b>' + eur(g.media) + '</b><span>' + diferencia(g.media, nacional.g95.media, 'la media nacional') + '</span></div>' : '') +
      (d.media ? '<div><span>Diésel · media</span><b>' + eur(d.media) + '</b><span>' + diferencia(d.media, nacional.diesel.media, 'la media nacional') + '</span></div>' : '') +
      '</div>';
    let cuerpo = '<section class="panel"><h1>Precio de la gasolina hoy en ' + esc(p.nombre) + '</h1>' +
      '<p class="intro">Precios oficiales del ' + hoy + ' en las ' + r.n + ' gasolineras de la provincia de ' + esc(p.nombre) + '.' +
      (g.min ? ' La gasolina 95 más barata está en <b>' + esc(g.min.rotulo) + '</b> de ' + esc(g.min.muniNombre) + ' a <b>' + eur(g.min.g95) + '/l</b>' : '') +
      (d.min ? ' y el diésel más barato, en <b>' + esc(d.min.rotulo) + '</b> de ' + esc(d.min.muniNombre) + ' a <b>' + eur(d.min.diesel) + '/l</b>.' : '.') +
      '</p>' + medias + '<a class="cta" href="/' + UTM + 'provincia">🗺️ Ver en el mapa las más baratas cerca de ti</a></section>';

    CARBURANTES.forEach(c => {
      if (!r[c.k].orden.length) return;
      cuerpo += '<section class="panel"><h2>' + esc(c.nombre) + ': las ' + Math.min(TOP, r[c.k].orden.length) + ' más baratas de ' + esc(p.nombre) + '</h2>' + tablaRanking(r[c.k].orden, c, true) + '</section>';
    });

    // Ranking de municipios por precio medio de la gasolina 95
    const rank = p.conFicha.filter(mu => mu.res.g95.media).sort((a, b) => a.res.g95.media - b.res.g95.media);
    if (rank.length > 1) {
      cuerpo += '<section class="panel"><h2>Municipios de ' + esc(p.nombre) + ' con la gasolina más barata</h2><table><thead><tr><th>Municipio</th><th class="p">95 media</th><th class="p">Diésel media</th></tr></thead><tbody>' +
        rank.slice(0, 15).map(mu => '<tr><td><a href="' + mu.ruta + '">' + esc(mu.nombre) + '</a><div class="d">' + mu.est.length + ' gasolineras</div></td><td class="p">' +
          eur(mu.res.g95.media) + '</td><td class="p">' + (mu.res.diesel.media ? eur(mu.res.diesel.media) : '—') + '</td></tr>').join('') +
        '</tbody></table><p class="nota">Solo municipios con ' + MIN_GASOLINERAS + ' o más gasolineras.</p></section>';
    }
    if (p.conFicha.length) {
      cuerpo += '<section class="panel"><h2>Gasolineras por municipio en ' + esc(p.nombre) + '</h2><ul class="enlaces">' +
        p.conFicha.map(mu => '<li><a href="' + mu.ruta + '">' + esc(mu.nombre) + '</a></li>').join('') + '</ul></section>';
    }
    cuerpo += '<section class="panel"><h2>Otras provincias</h2><ul class="enlaces">' +
      ordenProv.filter(o => o !== p).map(o => '<li><a href="' + o.ruta + '">' + esc(o.nombre) + '</a></li>').join('') + '</ul></section>';

    const faq = [];
    if (g.media) faq.push(['¿Cuál es el precio medio de la gasolina en ' + p.nombre + ' hoy?',
      'El ' + hoy + ' la gasolina 95 cuesta de media ' + eur(g.media) + ' por litro en ' + p.nombre + (d.media ? ' y el diésel, ' + eur(d.media) : '') +
      '. La media nacional es de ' + eur(nacional.g95.media) + ' para la gasolina 95 y ' + eur(nacional.diesel.media) + ' para el diésel.']);
    if (g.min) faq.push(['¿Dónde está la gasolinera más barata de ' + p.nombre + '?',
      'Hoy la gasolina 95 más barata de la provincia está en ' + g.min.rotulo + ' (' + g.min.dir + ', ' + g.min.muniNombre + '), a ' + eur(g.min.g95) + ' por litro.']);
    if (rank.length > 1) faq.push(['¿Qué municipio de ' + p.nombre + ' tiene la gasolina más barata?',
      'Entre los municipios con al menos ' + MIN_GASOLINERAS + ' gasolineras, ' + rank[0].nombre + ' tiene hoy el precio medio más bajo de gasolina 95: ' + eur(rank[0].res.g95.media) + ' por litro.']);

    const titulo = 'Precio gasolina hoy en ' + p.nombre + ': gasolineras más baratas';
    const desc = 'Precio medio de la gasolina y el diésel hoy (' + hoy + ') en ' + p.nombre + ' y las gasolineras más baratas de la provincia.' +
      (g.min ? ' Gasolina 95 desde ' + eur(g.min.g95) + '/l.' : '');
    escribir(p.ruta, pagina({
      ruta: p.ruta, titulo: titulo, descripcion: desc, campana: 'provincia', cuerpo: cuerpo, faq: faq,
      migas: [['Inicio', '/'], ['Gasolineras baratas', '/' + CARPETA + '/'], [p.nombre, p.ruta]]
    }));
    urls.push(p.ruta);
  });

  // ---- índice nacional ----
  const porPrecio = ordenProv.filter(p => p.res.g95.media).sort((a, b) => a.res.g95.media - b.res.g95.media);
  const barata = porPrecio[0], cara = porPrecio[porPrecio.length - 1];
  let cuerpo = '<section class="panel"><h1>Gasolineras más baratas de España por provincia</h1>' +
    '<p class="intro">Precios oficiales del ' + hoy + ' en las ' + nacional.n + ' gasolineras de España. La provincia con la gasolina 95 más barata es <b>' +
    esc(barata.nombre) + '</b> (' + eur(barata.res.g95.media) + '/l de media) y la más cara, <b>' + esc(cara.nombre) + '</b> (' + eur(cara.res.g95.media) + '/l).</p>' +
    '<div class="medias"><div><span>Gasolina 95 · media nacional</span><b>' + eur(nacional.g95.media) + '</b></div><div><span>Diésel · media nacional</span><b>' +
    eur(nacional.diesel.media) + '</b></div></div><a class="cta" href="/' + UTM + 'indice">🗺️ Ver en el mapa las más baratas cerca de ti</a></section>' +
    '<section class="panel"><h2>Precio medio por provincia</h2><table><thead><tr><th>Provincia</th><th class="p">95</th><th class="p">Diésel</th></tr></thead><tbody>' +
    ordenProv.map(p => '<tr><td><a href="' + p.ruta + '">' + esc(p.nombre) + '</a><div class="d">' + p.res.n + ' gasolineras</div></td><td class="p">' +
      (p.res.g95.media ? eur(p.res.g95.media) : '—') + '</td><td class="p">' + (p.res.diesel.media ? eur(p.res.diesel.media) : '—') + '</td></tr>').join('') +
    '</tbody></table></section>';
  const faqIndice = [
    ['¿Cuál es el precio medio de la gasolina en España hoy?', 'El ' + hoy + ' la gasolina 95 cuesta de media ' + eur(nacional.g95.media) + ' por litro y el diésel, ' + eur(nacional.diesel.media) + ', según los datos oficiales del Ministerio para la Transición Ecológica.'],
    ['¿Qué provincia tiene la gasolina más barata?', 'Hoy la provincia con la gasolina 95 más barata de media es ' + barata.nombre + ', a ' + eur(barata.res.g95.media) + ' por litro, y la más cara es ' + cara.nombre + ', a ' + eur(cara.res.g95.media) + '.']
  ];
  escribir('/' + CARPETA + '/', pagina({
    ruta: '/' + CARPETA + '/', titulo: 'Gasolineras más baratas por provincia: precio de la gasolina hoy',
    descripcion: 'Precio medio de la gasolina y el diésel hoy en cada provincia de España y las gasolineras más baratas de cada municipio. Datos oficiales, actualizados a diario.',
    campana: 'indice', cuerpo: cuerpo, faq: faqIndice, migas: [['Inicio', '/'], ['Gasolineras baratas', '/' + CARPETA + '/']]
  }));
  urls.unshift('/' + CARPETA + '/');

  // ---- sitemap.xml ----
  const sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '  <url><loc>' + BASE + '/</loc><lastmod>' + fechaISO + '</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>']
    .concat(urls.map(u => '  <url><loc>' + BASE + u + '</loc><lastmod>' + fechaISO + '</lastmod><changefreq>daily</changefreq><priority>' +
      (u.split('/').length > 4 ? '0.6' : '0.8') + '</priority></url>'))
    .concat(['</urlset>', '']).join('\n');
  fs.writeFileSync(path.join(SALIDA, 'sitemap.xml'), sm);

  console.log('Fichas generadas en ' + SALIDA + ': 1 índice, ' + ordenProv.length + ' provincias, ' + nMunis + ' municipios (' + (urls.length + 1) + ' URLs en el sitemap).');
}

main().catch(err => { console.error(err); process.exit(1); });
