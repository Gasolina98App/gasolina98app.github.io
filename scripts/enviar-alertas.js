// Envía las "Alertas de bajada de precio" de la app con la REST API de OneSignal.
//
// La app guarda en cada usuario los tags g_id (IDEESS de la gasolinera), g_prod (1,3,4,5,6,20),
// g_precio (precio de referencia en céntimos, entero) y g_nombre. Aquí se compara el estaciones.json
// recién generado con el de la ejecución anterior y, para cada estación/carburante que ha bajado,
// se manda UNA notificación filtrada por tags:
//     g_id = X  AND  g_prod = Y  AND  g_precio > nuevoPrecioEnCentimos
// (es decir, solo le llega a quien la vigila y cuyo precio de referencia es al menos 1 céntimo mayor).
//
// API (https://documentation.onesignal.com/reference/create-message, consultada 2026-09-29):
//   POST https://api.onesignal.com/notifications   cabecera  Authorization: Key <App API key>
//   filters: [{field:'tag', key, relation:'='|'>'|'<'|'exists'..., value:'...'}]  (AND implícito, máx. 200 entradas)
//   Si ningún usuario cumple el filtro, responde 200 sin "id" (no se crea mensaje).
//   idempotency_key (UUID) evita duplicados en reintentos (se guarda 30 días).
//
// Variables de entorno:
//   ONESIGNAL_REST_API_KEY  App API key (os_v2_app_...). Si falta: solo log, sale con código 0.
//   ONESIGNAL_APP_ID        por defecto el de index.html.
//   ESTACIONES_PREVIAS      ruta al estaciones.json de la ejecución anterior.
//   ESTACIONES_ACTUALES     ruta al estaciones.json nuevo (por defecto ../estaciones.json).
//   MAX_ESTACIONES          máximo de envíos (estación+carburante) por ejecución. Por defecto 50.
//   PRUEBA                  IDEESS de una gasolinera -> envía un aviso de prueba a quien la vigile
//                           (sin mirar el precio); "todos" -> aviso de prueba a todos los que tengan alerta.
//   DRY_RUN=1               no llama a la API: solo imprime lo que enviaría.
// Este script NUNCA hace fallar el workflow: cualquier error se registra y se sale con código 0.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.join(__dirname, '..');
const API_URL = 'https://api.onesignal.com/notifications';
const APP_ID = process.env.ONESIGNAL_APP_ID || '1b49101f-35b3-45f3-866a-b384e3b81b2d';
const API_KEY = (process.env.ONESIGNAL_REST_API_KEY || '').trim();
const DRY_RUN = /^(1|true|si|sí|yes)$/i.test(process.env.DRY_RUN || '');
const MAX_ESTACIONES = Math.max(0, parseInt(process.env.MAX_ESTACIONES || '50', 10) || 50);
const PRUEBA = (process.env.PRUEBA || '').trim();
const RUN_ID = process.env.GITHUB_RUN_ID || String(Date.now());
const URL_APP = 'https://app.gasolina98.es/?utm_source=push&utm_medium=alerta';
const PAUSA_MS = 120; // muy por debajo del límite del plan gratuito (150 peticiones/s por app)

// Clave de producto -> texto para "Ha bajado {carburante}" (con artículo)
const CARBURANTES = {
  '1': 'la gasolina 95',
  '3': 'la gasolina 98',
  '20': 'la gasolina 95 Premium',
  '4': 'el gasóleo A',
  '5': 'el gasóleo Premium',
  '6': 'el GLP'
};

// Mismo redondeo que aCentimos() en index.html: primero a milésimas para evitar errores de coma flotante
function milesimas(p) { return Math.round(Number(p) * 1000); }
function centimos(p) { return Math.round(milesimas(p) / 10); }
function precioTxt(p) { return (milesimas(p) / 1000).toFixed(3).replace('.', ','); }
function dormir(ms) { return new Promise(r => setTimeout(r, ms)); }

// UUID determinista (por ejecución + estación + carburante + precio) para que los reintentos no dupliquen
function uuidDe(texto) {
  const h = crypto.createHash('sha1').update(texto).digest('hex');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-5' + h.slice(13, 16) + '-' +
    ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) + h.slice(18, 20) + '-' + h.slice(20, 32);
}

function leerEstaciones(ruta) {
  if (!ruta || !fs.existsSync(ruta)) return null;
  const d = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  return Array.isArray(d.estaciones) ? d.estaciones : null;
}

function tag(key, relation, value) {
  const f = { field: 'tag', key: key, relation: relation };
  if (value !== undefined) f.value = String(value);
  return f;
}

function mensaje(titulo, texto, filters, clave) {
  return {
    app_id: APP_ID,
    target_channel: 'push',
    headings: { en: titulo, es: titulo },
    contents: { en: texto, es: texto },
    url: URL_APP,
    filters: filters,
    idempotency_key: uuidDe(clave)
  };
}

function textoAlerta(est, prod, precio) {
  const carb = CARBURANTES[prod] || 'el carburante';
  return '⛽ Ha bajado ' + carb + ' en ' + (est.r || 'tu gasolinera') +
    (est.l ? ' (' + est.l + ')' : '') + ': ' + precioTxt(precio) + ' €/l';
}

async function enviar(body) {
  if (DRY_RUN) {
    console.log('[DRY_RUN] Enviaría:', JSON.stringify(body));
    return { dry: true };
  }
  for (let intento = 1; intento <= 3; intento++) {
    let res;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Key ' + API_KEY },
        body: JSON.stringify(body)
      });
    } catch (err) {
      console.log('  Error de red (intento ' + intento + '):', err.message);
      if (intento < 3) { await dormir(5000 * intento); continue; }
      return { error: err.message };
    }
    const texto = await res.text();
    let json = {};
    try { json = JSON.parse(texto); } catch (e) { json = { raw: texto }; }
    if (res.status === 429 || res.status >= 500) {
      const espera = Math.max(parseInt(res.headers.get('retry-after') || '0', 10) * 1000, 5000 * intento);
      console.log('  HTTP ' + res.status + ', reintento en ' + espera + ' ms');
      if (intento < 3) { await dormir(espera); continue; }
    }
    if (res.status === 401 || res.status === 403) {
      console.log('  HTTP ' + res.status + ': la clave ONESIGNAL_REST_API_KEY no es válida para esta app. Se detienen los envíos.');
      return { fatal: true, status: res.status, json };
    }
    return { status: res.status, json };
  }
  return { error: 'agotados los reintentos' };
}

function describir(r) {
  if (r.dry) return 'simulado';
  if (r.error) return 'error: ' + r.error;
  if (r.json && r.json.id) return 'ENVIADO id=' + r.json.id;
  return 'sin destinatarios (HTTP ' + r.status + ')' + (r.json && r.json.errors ? ' ' + JSON.stringify(r.json.errors) : '');
}

// Estaciones+carburantes cuyo precio ha bajado respecto a la ejecución anterior
function bajadas(previas, actuales) {
  const antes = new Map(previas.map(e => [String(e.i), e]));
  const lista = [];
  actuales.forEach(function (e) {
    const p = antes.get(String(e.i));
    if (!p) return;
    Object.keys(CARBURANTES).forEach(function (prod) {
      const k = 'p' + prod;
      if (!(e[k] > 0) || !(p[k] > 0)) return;
      const baja = milesimas(p[k]) - milesimas(e[k]);
      if (baja > 0) lista.push({ est: e, prod: prod, precio: e[k], previo: p[k], baja: baja });
    });
  });
  // Primero las bajadas más grandes (son las que más probablemente superan el céntimo de la referencia)
  lista.sort((a, b) => b.baja - a.baja || String(a.est.i).localeCompare(String(b.est.i)));
  return lista;
}

async function modoPrueba(actuales) {
  console.log('--- Modo PRUEBA: ' + PRUEBA + ' ---');
  if (PRUEBA.toLowerCase() === 'todos') {
    const body = mensaje('Gasolina98 · prueba', '🔔 Prueba: tus alertas de bajada de precio funcionan. Te avisaremos cuando baje tu gasolinera.',
      [tag('g_id', 'exists')], 'prueba|todos|' + RUN_ID);
    const r = await enviar(body);
    console.log('Prueba a todos los que tienen alerta:', describir(r));
    return;
  }
  const est = actuales.find(e => String(e.i) === PRUEBA);
  if (!est) { console.log('No existe la estación ' + PRUEBA + ' en estaciones.json.'); return; }
  for (const prod of Object.keys(CARBURANTES)) {
    const precio = est['p' + prod];
    if (!(precio > 0)) continue;
    const body = mensaje('Gasolina98 · prueba de alerta', textoAlerta(est, prod, precio) + ' (prueba)',
      [tag('g_id', '=', est.i), tag('g_prod', '=', prod)], 'prueba|' + est.i + '|' + prod + '|' + RUN_ID);
    const r = await enviar(body);
    console.log('Prueba ' + est.i + ' p' + prod + ':', describir(r));
    if (r.fatal) return;
    await dormir(PAUSA_MS);
  }
}

async function main() {
  if (!API_KEY && !DRY_RUN) {
    console.log('Falta el secreto ONESIGNAL_REST_API_KEY: no se envían alertas (el workflow sigue normalmente).');
    return;
  }
  const rutaActuales = process.env.ESTACIONES_ACTUALES || path.join(RAIZ, 'estaciones.json');
  const actuales = leerEstaciones(rutaActuales);
  if (!actuales) { console.log('No se pudo leer ' + rutaActuales + ': no se envían alertas.'); return; }

  if (PRUEBA) await modoPrueba(actuales);

  const previas = leerEstaciones(process.env.ESTACIONES_PREVIAS);
  if (!previas) {
    console.log('No hay estaciones.json de la ejecución anterior (' + (process.env.ESTACIONES_PREVIAS || 'sin ruta') + '): nada que comparar.');
    return;
  }

  const lista = bajadas(previas, actuales);
  const aEnviar = lista.slice(0, MAX_ESTACIONES);
  console.log('Bajadas detectadas: ' + lista.length + ' (estación+carburante). Se procesan ' + aEnviar.length +
    ' (MAX_ESTACIONES=' + MAX_ESTACIONES + ')' + (DRY_RUN ? ' en modo DRY_RUN.' : '.'));

  let enviados = 0;
  for (const b of aEnviar) {
    const nuevoCent = centimos(b.precio);
    const body = mensaje('Gasolina98 · ¡Ha bajado el precio!', textoAlerta(b.est, b.prod, b.precio), [
      tag('g_id', '=', b.est.i),
      tag('g_prod', '=', b.prod),
      tag('g_precio', '>', nuevoCent)
    ], 'alerta|' + b.est.i + '|' + b.prod + '|' + milesimas(b.precio) + '|' + RUN_ID);
    const r = await enviar(body);
    if (r.json && r.json.id) enviados++;
    console.log('  ' + b.est.i + ' p' + b.prod + ' ' + precioTxt(b.previo) + ' -> ' + precioTxt(b.precio) +
      ' (g_precio > ' + nuevoCent + '): ' + describir(r));
    if (r.fatal) break;
    await dormir(PAUSA_MS);
  }
  console.log('Alertas creadas con destinatarios: ' + enviados + ' de ' + aEnviar.length + ' peticiones.');
}

main().catch(function (err) {
  console.log('Error enviando alertas (no se interrumpe el workflow):', err && err.stack || err);
}).finally(function () { process.exitCode = 0; });
