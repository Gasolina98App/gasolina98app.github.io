// Publica en X (Twitter) el precio medio nacional del día, leyendo precio-medio.json.
// Firma OAuth 1.0a a mano (sin dependencias) y llama a POST https://api.twitter.com/2/tweets.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.join(__dirname, '..');
const URL_APP = 'https://app.gasolina98.es';

const API_KEY = process.env.X_API_KEY;
const API_SECRET = process.env.X_API_SECRET;
const ACCESS_TOKEN = process.env.X_ACCESS_TOKEN;
const ACCESS_TOKEN_SECRET = process.env.X_ACCESS_TOKEN_SECRET;

function encode(str) {
  return encodeURIComponent(str).replace(/[!*'()]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function cabeceraOAuth(method, url) {
  const oauthParams = {
    oauth_consumer_key: API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: ACCESS_TOKEN,
    oauth_version: '1.0',
  };

  const baseParams = Object.keys(oauthParams)
    .sort()
    .map(k => encode(k) + '=' + encode(oauthParams[k]))
    .join('&');

  const baseString = [method.toUpperCase(), encode(url), encode(baseParams)].join('&');
  const signingKey = encode(API_SECRET) + '&' + encode(ACCESS_TOKEN_SECRET);
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

  const headerParams = Object.assign({}, oauthParams, { oauth_signature: signature });
  return 'OAuth ' + Object.keys(headerParams)
    .sort()
    .map(k => encode(k) + '="' + encode(headerParams[k]) + '"')
    .join(', ');
}

function fechaEnEs(fechaISO) {
  return fechaISO.split('-').reverse().join('/');
}

async function main() {
  if (!API_KEY || !API_SECRET || !ACCESS_TOKEN || !ACCESS_TOKEN_SECRET) {
    throw new Error('Faltan credenciales de X (X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET).');
  }

  const datos = JSON.parse(fs.readFileSync(path.join(RAIZ, 'precio-medio.json'), 'utf8'));
  const fechaEs = fechaEnEs(datos.fecha);

  const texto =
    '📣 Precio medio en España hoy (' + fechaEs + '): Gasolina 95 ' + datos.gasolina95 +
    ' €/l · Gasóleo A ' + datos.gasoleoA + ' €/l\n\n' +
    '⛽️ Recuerda comprobar el precio de tu gasolinera más barata en ' + URL_APP + '\n\n' +
    '#ahorro #gasolina #diesel';

  const url = 'https://api.twitter.com/2/tweets';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: cabeceraOAuth('POST', url),
    },
    body: JSON.stringify({ text: texto }),
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error('Error publicando en X (' + res.status + '): ' + body);
  }

  console.log('Publicado en X:', body);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
