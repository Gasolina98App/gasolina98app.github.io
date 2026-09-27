// Genera un listado nacional compacto de estaciones para el mapa de la app (estaciones.json).
// El listado completo de MITECO (EstacionesTerrestres/ sin filtro) pesa ~12 MB y trae un
// campo de precio distinto por cada carburante, así que aquí se recorta a solo lo que
// necesita el mapa y se normaliza a las mismas claves de producto que usa el <select> de la app.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const API = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/';

// clave interna (id del <select id="g98prod"> de index.html) -> campo del listado nacional de MITECO
const CAMPOS_PRECIO = {
  p1: 'Precio Gasolina 95 E5',
  p3: 'Precio Gasolina 98 E5',
  p20: 'Precio Gasolina 95 E5 Premium',
  p4: 'Precio Gasoleo A',
  p5: 'Precio Gasoleo Premium',
  p6: 'Precio Gases licuados del petróleo'
};

function num(s) {
  var n = parseFloat(String(s || '').replace(',', '.'));
  return isFinite(n) ? n : 0;
}

async function main() {
  const res = await fetch(API);
  const data = await res.json();
  const estaciones = data.ListaEESSPrecio || [];
  if (!estaciones.length) throw new Error('La API de MITECO no devolvió estaciones.');

  const compactas = [];
  estaciones.forEach(function (e) {
    const lat = num(e.Latitud);
    const lon = num(e['Longitud (WGS84)']);
    if (!lat || !lon) return;

    const precios = {};
    let tieneAlgunPrecio = false;
    Object.keys(CAMPOS_PRECIO).forEach(function (clave) {
      const p = num(e[CAMPOS_PRECIO[clave]]);
      if (p > 0) { precios[clave] = p; tieneAlgunPrecio = true; }
    });
    if (!tieneAlgunPrecio) return;

    compactas.push(Object.assign({
      i: e.IDEESS,
      r: e['Rótulo'],
      d: e['Dirección'],
      l: e.Localidad,
      h: e.Horario,
      x: lat,
      y: lon
    }, precios));
  });

  fs.writeFileSync(
    path.join(RAIZ, 'estaciones.json'),
    JSON.stringify({ fecha: new Date().toISOString().slice(0, 10), estaciones: compactas })
  );

  console.log('Estaciones generadas:', compactas.length, 'de', estaciones.length, 'totales.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
