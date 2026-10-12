'use strict';
/* BN Map Explorer — lee un mundo de Cataclysm: Bright Nights en el navegador
 * y dibuja el overmap con ciudades, misiones, NPCs, notas y lugares.
 *
 * Formato (BN 0.13):
 *  - map.sqlite3, tabla files(path, compression, data): "o.X.Y" = overmap
 *    180x180 OMT x 21 niveles (z -10..10), terreno en RLE fila a fila.
 *  - #<base64 nombre>.sav            = personaje (posición en "abs_pos", tiles)
 *  - #<base64 nombre>.sqlite3        = ".seen.X.Y": visto/explorado + notas
 *  - master.gsav                     = misiones, facciones, semilla
 *  Saves antiguos guardan esos mismos archivos sueltos en la carpeta.
 */

const OMAPX = 180, OMAPY = 180, LAYERS = 21, ZOFF = 10, OMT_TILES = 24, OM_SM = 2;
const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ colores */
const BASE = {
  black: [0, 0, 0], red: [255, 0, 0], green: [0, 110, 0], brown: [97, 56, 28],
  blue: [10, 10, 220], magenta: [139, 58, 98], cyan: [0, 150, 180],
  light_gray: [150, 150, 150], dark_gray: [99, 99, 99], light_red: [255, 150, 150],
  light_green: [0, 255, 0], yellow: [255, 255, 0], light_blue: [100, 100, 255],
  pink: [254, 0, 254], light_cyan: [0, 240, 255], white: [255, 255, 255],
};
const ALIAS = {
  ltred: 'light_red', ltgreen: 'light_green', ltblue: 'light_blue', ltcyan: 'light_cyan',
  ltgray: 'light_gray', lightgray: 'light_gray', gray: 'light_gray', dkgray: 'dark_gray',
  darkgray: 'dark_gray', light_magenta: 'pink', ltmagenta: 'pink',
};
const col = (n) => BASE[ALIAS[n] || n] || null;
const colorCache = new Map();
function parseColor(s) {
  s = (s || 'light_gray').toLowerCase();
  if (colorCache.has(s)) return colorCache.get(s);
  let n = s.startsWith('c_') ? s.slice(2) : s, r;
  if (n.startsWith('i_')) r = { fg: BASE.black, bg: col(n.slice(2)) || BASE.light_gray };
  else if (n.startsWith('h_')) r = { fg: col(n.slice(2)) || BASE.light_gray, bg: BASE.blue };
  else if (col(n)) r = { fg: col(n), bg: null };
  else {
    const p = n.split('_');
    for (let k = 1; k < p.length && !r; k++) {
      const a = col(p.slice(0, k).join('_')), b = col(p.slice(k).join('_'));
      if (a && b) r = { fg: a, bg: b };
    }
    r = r || { fg: BASE.light_gray, bg: null };
  }
  colorCache.set(s, r);
  return r;
}
const rgb = (c, f = 1) => `rgb(${c[0] * f | 0},${c[1] * f | 0},${c[2] * f | 0})`;

/* ------------------------------------------------------------------ terrenos */
const ROT = ['_north', '_east', '_south', '_west'];
// sufijo -> [símbolo, subtile del tileset, rotación]  (om_lines::all en overmap.cpp)
const LIN = {
  _isolated: ['┼', 'unconnected', 0], _end_south: ['│', 'end_piece', 2], _end_west: ['─', 'end_piece', 1],
  _ne: ['└', 'corner', 1], _end_north: ['│', 'end_piece', 0], _ns: ['│', 'edge', 0], _es: ['┌', 'corner', 0],
  _nes: ['├', 't_connection', 1], _end_east: ['─', 'end_piece', 3], _wn: ['┘', 'corner', 2],
  _ew: ['─', 'edge', 1], _new: ['┴', 't_connection', 2], _sw: ['┐', 'corner', 3],
  _nsw: ['┤', 't_connection', 3], _esw: ['┬', 't_connection', 0], _nesw: ['┼', 'center', 0],
};
const SYM_CYCLES = [['^', '>', 'v', '<'], ['│', '─', '│', '─'], ['┌', '┐', '┘', '└'], ['├', '┬', '┤', '┴']];
function rotSym(c, d) {
  for (const cyc of SYM_CYCLES) { const i = cyc.indexOf(c); if (i >= 0) return cyc[(i + d) % 4]; }
  return c;
}
let TDB = {};
function buildTDB(mods) {
  TDB = Object.assign({}, window.BN_TERRAIN.base);
  for (const m of mods) Object.assign(TDB, window.BN_TERRAIN.mods[m] || {});
}
function hashColor(s) {
  let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return [80 + (h & 127), 80 + ((h >> 7) & 127), 80 + ((h >> 14) & 127)];
}
function resolveTerrain(id) {
  // rota/sub siguen oter_t::get_rotation_and_subtile: rotaciones antihorarias
  let e = TDB[id], sym, base = id, rota = 0, sub = null;
  if (e) sym = e[2];
  else {
    for (let d = 0; d < 4 && !e; d++) {
      const s = ROT[d];
      if (id.endsWith(s) && TDB[id.slice(0, -s.length)]) {
        base = id.slice(0, -s.length); e = TDB[base]; sym = rotSym(e[2], d); rota = (4 - d) % 4;
      }
    }
    if (!e) for (const s in LIN) {
      const b = id.slice(0, -s.length);
      if (id.endsWith(s) && TDB[b] && (TDB[b][4] & 1)) { base = b; e = TDB[b]; [sym, sub, rota] = LIN[s]; break; }
    }
  }
  if (!e) {
    base = id.replace(/_(north|east|south|west)$/, '');
    return { id, base, name: base.replace(/_/g, ' '), es: base.replace(/_/g, ' '), sym: '?', fg: hashColor(base), bg: null, unknown: true };
  }
  const c = parseColor(e[3]);
  return { id, base, name: e[0], es: e[1] || e[0], sym, fg: c.fg, bg: c.bg, rota, sub };
}

/* ------------------------------------------------------------------ tileset
 * Replica cata_tiles: el sprite de una casilla sale del id de tipo de terreno
 * (con looks_like ya resuelto en build_tileset.py), variante "_season_x",
 * subtiles para terrenos lineales y rotación solo si el tile tiene "rotates". */
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const TS = { name: 'ascii', set: null, img: null, season: 0, key: 0 };
function useTileset(name) {
  const set = window.BN_TILESETS?.[name];
  TS.key++;
  if (!set) { TS.name = 'ascii'; TS.set = null; TS.img = null; invalidate(); return; }
  TS.name = name; TS.set = set;
  const img = new Image();
  img.onload = () => { if (TS.set === set) { TS.img = img; invalidate(); } };
  img.src = set.image;
  try { localStorage.setItem('bnme.tileset', name); } catch {}
}
function tileFor(t) {
  if (t._tsKey === TS.key) return t._tile;
  t._tsKey = TS.key; t._tile = null;
  const set = TS.set; if (!set) return null;
  const id = set.omap[t.base] || set.omap[t.id] || set.guess?.[t.base];
  if (!id) return null;
  let tid = id + '_season_' + SEASONS[TS.season];
  if (!set.tiles[tid]) tid = set.tiles[id] ? id : SEASONS.map((s) => id + '_season_' + s).find((k) => set.tiles[k]);
  let tile = tid && set.tiles[tid];
  if (!tile) return null;
  if (t.sub && tile.sub?.[t.sub]) tile = tile.sub[t.sub];
  t._tile = { tile, tid, avg: set.avg[tid] || set.avg[id] };
  return t._tile;
}
const rot32 = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;
function locRand(x, y) { // lookup3 mix, igual que draw_from_id_string
  const seed = (x + y * 65536) >>> 0;
  let a = seed, b = (-seed) >>> 0, c = Math.imul(seed, seed) >>> 0;
  c = ((c ^ b) - rot32(b, 14)) >>> 0; a = ((a ^ c) - rot32(c, 11)) >>> 0;
  b = ((b ^ a) - rot32(a, 25)) >>> 0; c = ((c ^ b) - rot32(b, 16)) >>> 0;
  a = ((a ^ c) - rot32(c, 4)) >>> 0; b = ((b ^ a) - rot32(a, 14)) >>> 0;
  c = ((c ^ b) - rot32(b, 24)) >>> 0;
  return c;
}
function pickVariant(list, rnd) {
  if (list.length <= 1) return list[0];
  let total = 0; for (const v of list) total += v[0];
  if (!total) return list[0];
  let r = rnd % total;
  for (const v of list) { if (r < v[0]) return v; r -= v[0]; }
  return list[list.length - 1];
}

/* ------------------------------------------------------------------ idioma
 * Textos de la interfaz. Los nombres de terreno/misión salen de terrain_db.js
 * ([inglés, castellano]); el resto, de aquí. Inglés por defecto. */
const I18N = {
  en: {
    'lang.name': 'English',
    'intro.title': 'Explore your world in<br><span>Cataclysm: Bright Nights</span>',
    'intro.sub': 'Choose a world folder (inside <code>save/</code>) or the whole <code>save/</code> folder.',
    'intro.pick': '> Choose folder', 'intro.drop': 'or drag the folder here',
    'intro.privacy': '[!] Everything is processed in your browser. Nothing leaves your computer.',
    'intro.where': 'Where is my save?',
    'intro.whereText': 'In the game folder: <code>cbn-…/save/&lt;WorldName&gt;</code>. It should contain <code>master.gsav</code>, <code>map.sqlite3</code> and one or more <code>#….sav</code> files.',
    'ui.lang': 'Language', 'ui.char': 'Character', 'ui.graphics': 'Graphics', 'ui.zlevel': 'Z level',
    'ui.zdown': 'Go down (PgDn)', 'ui.zup': 'Go up (PgUp)', 'ui.center': 'Center on character (C)',
    'ui.fog': 'Fog', 'fog.dim': 'Dim unseen', 'fog.seen': 'Seen only', 'fog.all': 'Show everything',
    't.cities': 'Cities', 't.missions': 'Missions', 't.npcs': 'NPCs', 't.notes': 'Notes', 't.radios': 'Radios',
    't.hordes': 'Hordes', 't.grid': 'Overmap borders',
    'tab.missions': 'Missions', 'tab.cities': 'Cities', 'tab.places': 'Places', 'tab.npcs': 'NPCs', 'tab.notes': 'Notes',
    'ui.filter': 'Filter / search terrain… (e.g. lab)', 'ui.back': '← Load another world',
    'ui.legend': 'Wheel: zoom · Drag: pan · PgUp/PgDn: Z level · C: center · Click: pin info',
    'ts.ascii': 'ASCII (classic)',
    'err.sqljs': 'Could not load sql.js (no internet connection?).',
    'err.nomaster': 'No master.gsav found. Choose a world folder (save/<World>) or the save/ folder.',
    'err.noom': 'No overmaps (o.X.Y) found in this world.',
    'err.noterrain': 'terrain_db.js is missing: run build_terrain.py (see README).',
    'st.multi': 'Several worlds found, pick one:', 'st.chars': '{n} character(s)',
    'st.reading': 'Reading {w}…', 'st.overmaps': 'Reading overmaps…', 'st.folder': 'Reading folder…', 'st.error': 'Error: {m}',
    'ui.nochars': '(no characters)',
    'meta.oms': '{n} overmap(s)', 'meta.mods': '{n} mods', 'meta.day': 'survival day {n}', 'meta.seed': 'seed {n}',
    'dir': ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], 'here': 'here',
    'tip.outside': 'Outside the generated map', 'tip.unexplored': 'Unexplored', 'tip.place': 'Place: {v}',
    'tip.city': 'City: {v}', 'tip.note': 'Note: {v}', 'tip.npc': 'NPC: {v}', 'tip.follower': ' (follower)',
    'tip.mission': 'Mission: {v}', 'tip.seen': 'seen', 'tip.unseen': 'not seen',
    'status.mission_yet_to_start': 'not started', 'status.mission_in_progress': 'in progress',
    'status.mission_success': 'completed', 'status.mission_failure': 'failed',
    'm.notarget': 'no target on the map', 'm.left': '{n} h left', 'm.active': 'ACTIVE',
    'm.mine': 'Your missions', 'm.other': 'Other missions in the world',
    'm.none': 'No active missions in this save. Talk to NPCs or find survivors to get missions.',
    'c.size': 'size {n}', 'undiscovered': 'undiscovered', 'c.none': 'No cities.',
    'n.follower': 'follower', 'n.nofac': 'no faction', 'n.offers': '{n} mission(s) to offer',
    'n.none': 'No NPCs saved in the loaded overmaps.',
    'no.empty': '(empty note)', 'no.danger': 'DANGER', 'no.extras': 'Discovered events',
    'no.none': 'This character has no map notes.',
    'p.hl': '{n} terrain tile(s) highlighted on z {z}', 'p.nearest': 'Go to the nearest', 'p.types': '{n} place types',
    'p.none': 'Nothing matches.',
  },
  es: {
    'lang.name': 'Castellano',
    'intro.title': 'Explora tu mundo de<br><span>Cataclysm: Bright Nights</span>',
    'intro.sub': 'Elige la carpeta de un mundo (dentro de <code>save/</code>) o la carpeta <code>save/</code> entera.',
    'intro.pick': '> Elegir carpeta', 'intro.drop': 'o arrastra la carpeta aquí',
    'intro.privacy': '[!] Todo se procesa en tu navegador. Nada sale de tu equipo.',
    'intro.where': '¿Dónde está mi save?',
    'intro.whereText': 'En la carpeta del juego: <code>cbn-…/save/&lt;NombreDelMundo&gt;</code>. Dentro deben estar <code>master.gsav</code>, <code>map.sqlite3</code> y uno o más <code>#….sav</code>.',
    'ui.lang': 'Idioma', 'ui.char': 'Personaje', 'ui.graphics': 'Gráficos', 'ui.zlevel': 'Nivel Z',
    'ui.zdown': 'Bajar (PgDn)', 'ui.zup': 'Subir (PgUp)', 'ui.center': 'Centrar en el personaje (C)',
    'ui.fog': 'Niebla', 'fog.dim': 'Atenuar lo no visto', 'fog.seen': 'Solo lo visto', 'fog.all': 'Mostrar todo',
    't.cities': 'Ciudades', 't.missions': 'Misiones', 't.npcs': 'NPCs', 't.notes': 'Notas', 't.radios': 'Radios',
    't.hordes': 'Hordas', 't.grid': 'Bordes overmap',
    'tab.missions': 'Misiones', 'tab.cities': 'Ciudades', 'tab.places': 'Lugares', 'tab.npcs': 'NPCs', 'tab.notes': 'Notas',
    'ui.filter': 'Filtrar / buscar terreno… (ej. laboratorio)', 'ui.back': '← Cargar otro mundo',
    'ui.legend': 'Rueda: zoom · Arrastrar: mover · PgUp/PgDn: nivel Z · C: centrar · Clic: fijar info',
    'ts.ascii': 'ASCII (clásico)',
    'err.sqljs': 'No se pudo cargar sql.js (¿sin conexión a internet?).',
    'err.nomaster': 'No encontré master.gsav. Elige la carpeta de un mundo (save/<Mundo>) o la carpeta save/.',
    'err.noom': 'No encontré overmaps (o.X.Y) en este mundo.',
    'err.noterrain': 'Falta terrain_db.js: ejecuta build_terrain.py (ver README).',
    'st.multi': 'Hay varios mundos, elige uno:', 'st.chars': '{n} personaje(s)',
    'st.reading': 'Leyendo {w}…', 'st.overmaps': 'Leyendo overmaps…', 'st.folder': 'Leyendo carpeta…', 'st.error': 'Error: {m}',
    'ui.nochars': '(sin personajes)',
    'meta.oms': '{n} overmap(s)', 'meta.mods': '{n} mods', 'meta.day': 'día {n} de supervivencia', 'meta.seed': 'semilla {n}',
    'dir': ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'], 'here': 'aquí',
    'tip.outside': 'Fuera del mapa generado', 'tip.unexplored': 'Sin explorar', 'tip.place': 'Lugar: {v}',
    'tip.city': 'Ciudad: {v}', 'tip.note': 'Nota: {v}', 'tip.npc': 'NPC: {v}', 'tip.follower': ' (seguidor)',
    'tip.mission': 'Misión: {v}', 'tip.seen': 'visto', 'tip.unseen': 'no visto',
    'status.mission_yet_to_start': 'sin empezar', 'status.mission_in_progress': 'en curso',
    'status.mission_success': 'completada', 'status.mission_failure': 'fallida',
    'm.notarget': 'sin objetivo en el mapa', 'm.left': '{n} h restantes', 'm.active': 'ACTIVA',
    'm.mine': 'Tus misiones', 'm.other': 'Otras misiones del mundo',
    'm.none': 'No hay misiones activas en este save. Habla con NPCs o busca supervivientes para conseguir misiones.',
    'c.size': 'tamaño {n}', 'undiscovered': 'sin descubrir', 'c.none': 'Sin ciudades.',
    'n.follower': 'seguidor', 'n.nofac': 'sin facción', 'n.offers': '{n} misión(es) que ofrecer',
    'n.none': 'No hay NPCs guardados en los overmaps cargados.',
    'no.empty': '(nota vacía)', 'no.danger': 'PELIGRO', 'no.extras': 'Eventos descubiertos',
    'no.none': 'Este personaje no tiene notas en el mapa.',
    'p.hl': '{n} casilla(s) de terreno resaltadas en z {z}', 'p.nearest': 'Ir a la más cercana', 'p.types': '{n} tipos de lugar',
    'p.none': 'Nada coincide.',
  },
};
let LANG = 'en';
try { const l = localStorage.getItem('bnme.lang'); if (I18N[l]) LANG = l; } catch {}
function T(k, vars) {
  let v = I18N[LANG][k] ?? I18N.en[k] ?? k;
  if (vars && typeof v === 'string') v = v.replace(/\{(\w+)\}/g, (_, n) => vars[n] ?? '');
  return v;
}
function applyLang() {
  document.documentElement.lang = LANG;
  document.querySelectorAll('[data-i18n]').forEach((e) => (e.textContent = T(e.dataset.i18n)));
  document.querySelectorAll('[data-i18n-html]').forEach((e) => (e.innerHTML = T(e.dataset.i18nHtml)));
  document.querySelectorAll('[data-i18n-title]').forEach((e) => (e.title = T(e.dataset.i18nTitle)));
  document.querySelectorAll('[data-i18n-ph]').forEach((e) => (e.placeholder = T(e.dataset.i18nPh)));
  document.querySelectorAll('select.lang').forEach((sel) => (sel.value = LANG));
  const asc = [...$('tileset').options].find((o) => o.value === 'ascii');
  if (asc) asc.text = T('ts.ascii');
}
function setLang(l) {
  if (!I18N[l]) return;
  LANG = l;
  try { localStorage.setItem('bnme.lang', l); } catch {}
  applyLang();
  if (S.world) { renderMeta(); computeHighlight(); renderList(); dirty = true; }
}

/* ------------------------------------------------------------------ estado */
const S = {
  world: null, master: null, mods: [], chars: [], char: null, player: null,
  oms: new Map(),          // "ox,oy" -> overmap
  terr: [], terrIdx: new Map(),
  seen: new Map(),         // "ox,oy" -> {vis: Uint8Array[21]|null}
  notes: [], extras: [],
  missions: [],
  z: 0, scale: 4, cx: 0, cy: 0, fog: 'dim',
  tab: 'missions', filter: '', hl: null, hlCells: [], pin: null, pulse: null,
  bounds: { x0: 0, y0: 0, x1: 0, y1: 0 },
};
const nameOf = (t) => (LANG === 'es' ? t.es : t.name);
const mname = (m) => (LANG === 'es' ? m.name_es : m.name_en);
const key = (x, y) => x + ',' + y;
const fdiv = (a, b) => Math.floor(a / b);

/* ------------------------------------------------------------------ lectura de archivos */
const stripHeader = (txt) => (txt.startsWith('#') ? txt.slice(txt.indexOf('\n') + 1) : txt);
async function inflate(u8) {
  const ds = new DecompressionStream('deflate');
  const buf = await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer();
  return new TextDecoder().decode(buf);
}
async function bytesToText(u8, compression) {
  if (compression === 'zlib' || (u8[0] === 0x78 && [0x01, 0x5e, 0x9c, 0xda].includes(u8[1]))) return inflate(u8);
  return new TextDecoder().decode(u8);
}
const readJSON = async (file) => JSON.parse(stripHeader(await file.text()));
function decodeName(b64) {
  try {
    const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch { return b64; }
}

let SQL = null;
async function sqlite(file) {
  if (!SQL) {
    if (!window.initSqlJs) throw new Error(T('err.sqljs'));
    SQL = await initSqlJs({ locateFile: (f) => 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/' + f });
  }
  return new SQL.Database(new Uint8Array(await file.arrayBuffer()));
}
/** Devuelve [{path, text}] de los archivos que cumplen `re`, ya sea desde
 *  un .sqlite3 o sueltos en la carpeta (saves antiguos). */
async function readEntries(files, dbName, re, loosePrefix = '') {
  const out = [];
  if (files.has(dbName)) {
    const db = await sqlite(files.get(dbName));
    const res = db.exec('SELECT path, compression, data FROM files');
    for (const [path, comp, data] of res[0]?.values || []) {
      if (re.test(path)) out.push({ path, text: await bytesToText(data, comp) });
    }
    db.close();
  } else {
    for (const [name, f] of files) {
      if (!name.startsWith(loosePrefix)) continue;
      const path = name.slice(loosePrefix.length);
      if (re.test(path)) out.push({ path, text: await bytesToText(new Uint8Array(await f.arrayBuffer())) });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ selección de carpeta */
async function walkEntry(entry, prefix, out) {
  if (entry.isFile) {
    const f = await new Promise((res, rej) => entry.file(res, rej));
    out.push({ path: prefix + entry.name, file: f });
  } else if (entry.isDirectory) {
    if (entry.name === 'maps' || entry.name === 'mmr') return; // no hace falta y puede ser enorme
    const r = entry.createReader();
    for (;;) {
      const batch = await new Promise((res, rej) => r.readEntries(res, rej));
      if (!batch.length) break;
      for (const e of batch) await walkEntry(e, prefix + entry.name + '/', out);
    }
  }
}
function findWorlds(list) {
  const worlds = new Map();
  for (const { path } of list) {
    const parts = path.split('/');
    if (parts[parts.length - 1] === 'master.gsav') {
      const dir = parts.slice(0, -1).join('/');
      worlds.set(dir, { name: parts[parts.length - 2] || 'Mundo', dir, files: new Map() });
    }
  }
  for (const { path, file } of list) {
    const i = path.lastIndexOf('/');
    const w = worlds.get(path.slice(0, i));
    if (w) w.files.set(path.slice(i + 1), file);
  }
  return [...worlds.values()];
}
async function handleList(list) {
  const st = $('intro-status');
  const worlds = findWorlds(list);
  if (!worlds.length) {
    st.textContent = T('err.nomaster');
    return;
  }
  if (worlds.length === 1) return loadWorld(worlds[0]);
  const box = $('worlds');
  box.innerHTML = `<div class="muted">${T('st.multi')}</div>`;
  for (const w of worlds) {
    const b = document.createElement('button');
    const n = [...w.files.keys()].filter((k) => k.endsWith('.sav')).length;
    b.textContent = `${w.name}  ·  ${T('st.chars', { n })}`;
    b.onclick = () => loadWorld(w);
    box.appendChild(b);
  }
  box.hidden = false;
  st.textContent = '';
}

/* ------------------------------------------------------------------ carga del mundo */
function internTerrain(id) {
  let i = S.terrIdx.get(id);
  if (i === undefined) { i = S.terr.length; S.terr.push(resolveTerrain(id)); S.terrIdx.set(id, i); }
  return i;
}
function clusterPoints(pts) {
  const idx = new Map(pts.map((p, i) => [p.join(','), i]));
  const parent = pts.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  pts.forEach(([x, y, z], i) => {
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const j = idx.get(`${x + dx},${y + dy},${z + dz}`);
      if (j !== undefined) parent[find(i)] = find(j);
    }
  });
  const groups = new Map();
  pts.forEach((p, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); });
  return [...groups.values()];
}
/** Punto representativo y nombre legible de una instancia de special. */
function specialInfo(sp) {
  if (sp._info) return sp._info;
  const byZ = sp.pts.slice().sort((a, b) => Math.abs(a[2]) - Math.abs(b[2]));
  let rep = byZ[0], t = null;
  for (const p of byZ) {
    const tt = terrainAt(...p);
    if (tt && !/^(open_air|empty_rock|solid_earth)/.test(tt.base) && !/roof/.test(tt.base)) { rep = p; t = tt; break; }
  }
  sp._info = { rep, t };
  return sp._info;
}
function parseOvermap(ox, oy, o) {
  const layers = [];
  for (let z = 0; z < LAYERS; z++) {
    const L = new Uint16Array(OMAPX * OMAPY);
    let p = 0;
    for (const [id, n] of o.layers?.[z] || []) { L.fill(internTerrain(id), p, p + n); p += n; }
    layers.push(L);
  }
  const gx = ox * OMAPX, gy = oy * OMAPY;
  const om = { ox, oy, layers, cities: [], specials: [], radios: [], hordes: [], npcs: [] };
  const seenCity = new Set();
  for (const c of o.cities || []) {
    const k = c.name + c.x + ',' + c.y;
    if (seenCity.has(k)) continue; seenCity.add(k);
    om.cities.push({ name: c.name, x: gx + c.x, y: gy + c.y, size: c.size });
  }
  // El save guarda todos los puntos de un mismo tipo de special juntos; los
  // separo en instancias uniendo puntos vecinos (8-vecindad, |dz| <= 1).
  for (const sp of o.overmap_special_placements || []) {
    const pts = (sp.placements || []).flatMap((pl) => (pl.points || []).map((q) => q.p)).filter(Boolean);
    for (const inst of clusterPoints(pts)) {
      om.specials.push({ id: sp.special, pts: inst.map(([x, y, z]) => [gx + x, gy + y, z]) });
    }
  }
  for (const r of o.radios || []) {
    om.radios.push({ x: gx + fdiv(r.x, OM_SM), y: gy + fdiv(r.y, OM_SM), z: 0, type: r.type, msg: r.message, strength: r.strength });
  }
  for (const [grp, pts] of o.monster_groups || []) {
    for (const [x, y, z] of pts) {
      om.hordes.push({ x: gx + fdiv(x, OM_SM), y: gy + fdiv(y, OM_SM), z, type: grp.type, pop: grp.population || 1, horde: !!grp.horde });
    }
  }
  for (const n of o.npcs || []) {
    const ap = n.abs_pos || [0, 0, 0];
    om.npcs.push({
      name: n.name, x: fdiv(ap[0], OMT_TILES), y: fdiv(ap[1], OMT_TILES), z: ap[2],
      fac: n.my_fac || n.fac_id || '', follower: n.my_fac === 'your_followers',
      missions: n.chatbin?.missions?.length || 0,
    });
  }
  return om;
}

async function loadWorld(w) {
  const st = $('intro-status');
  try {
    st.textContent = T('st.reading', { w: w.name });
    S.world = w;
    S.master = await readJSON(w.files.get('master.gsav'));
    S.mods = w.files.has('mods.json') ? await readJSON(w.files.get('mods.json')) : [];
    S.seasonLen = 91;
    if (w.files.has('worldoptions.json')) {
      const opts = await readJSON(w.files.get('worldoptions.json'));
      const o = (Array.isArray(opts) ? opts : []).find((x) => x.name === 'SEASON_LENGTH');
      if (o && +o.value > 0) S.seasonLen = +o.value;
    }
    buildTDB(S.mods);
    S.terr = []; S.terrIdx = new Map(); S.oms = new Map();

    st.textContent = T('st.overmaps');
    const entries = await readEntries(w.files, 'map.sqlite3', /^o\.-?\d+\.-?\d+$/);
    if (!entries.length) throw new Error(T('err.noom'));
    for (const { path, text } of entries) {
      const [, ox, oy] = path.split('.').map(Number);
      S.oms.set(key(ox, oy), parseOvermap(ox, oy, JSON.parse(stripHeader(text))));
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const om of S.oms.values()) {
      x0 = Math.min(x0, om.ox * OMAPX); y0 = Math.min(y0, om.oy * OMAPY);
      x1 = Math.max(x1, (om.ox + 1) * OMAPX); y1 = Math.max(y1, (om.oy + 1) * OMAPY);
    }
    S.bounds = { x0, y0, x1, y1 };

    S.chars = [...w.files.entries()]
      .filter(([n]) => n.startsWith('#') && n.endsWith('.sav'))
      .map(([n, f]) => ({ b64: n.slice(1, -4), name: decodeName(n.slice(1, -4)), file: f }))
      .sort((a, b) => b.file.lastModified - a.file.lastModified);

    const sel = $('char');
    sel.innerHTML = '';
    S.chars.forEach((c, i) => sel.add(new Option(c.name, i)));
    if (!S.chars.length) sel.add(new Option(T('ui.nochars'), -1));

    $('world-name').textContent = w.name;
    $('intro').hidden = true; $('app').hidden = false;
    resize();
    await selectChar(S.chars.length ? 0 : -1);
    st.textContent = '';
  } catch (e) {
    console.error(e);
    st.textContent = T('st.error', { m: e.message });
  }
}

const BORING_EXTRAS = /^mx_(grass|point_burned_ground|burned_ground|dead_vegetation|clay_deposit|shrubbery|fallen_shrubs|reed|pond|clearcut|trash|mud|sand|null)/;
function renderMeta() {
  $('world-meta').textContent = [
    T('meta.oms', { n: S.oms.size }), T('meta.mods', { n: S.mods.length }),
    S.days !== null && S.days !== undefined ? T('meta.day', { n: S.days + 1 }) : '',
    S.master?.seed ? T('meta.seed', { n: S.master.seed }) : '',
  ].filter(Boolean).join(' · ');
}
async function selectChar(i) {
  const c = S.chars[i];
  S.char = c || null; S.player = null; S.seen = new Map(); S.notes = []; S.extras = [];
  let sav = null;
  if (c) {
    sav = await readJSON(c.file);
    const p = sav.player || {};
    const ap = p.abs_pos || [ (sav.om_x * OMAPX * 2 + sav.levx) * 12, (sav.om_y * OMAPY * 2 + sav.levy) * 12, sav.levz || 0 ];
    S.player = {
      name: p.name || c.name, x: fdiv(ap[0], OMT_TILES), y: fdiv(ap[1], OMT_TILES), z: ap[2],
      id: p.id, active: new Set(p.active_missions || []), current: p.active_mission,
      completed: new Set(p.completed_missions || []), failed: new Set(p.failed_missions || []),
    };
    const seen = await readEntries(S.world.files, '#' + c.b64 + '.sqlite3', /^\.seen\.-?\d+\.-?\d+$/, '#' + c.b64);
    for (const { path, text } of seen) {
      const [ox, oy] = path.split('.').slice(-2).map(Number);
      const d = JSON.parse(stripHeader(text));
      const vis = (d.visible || []).map((layer) => {
        const a = new Uint8Array(OMAPX * OMAPY); let p = 0, any = false;
        for (const [v, n] of layer) { if (v) { a.fill(1, p, p + n); any = true; } p += n; }
        return any ? a : null;
      });
      S.seen.set(key(ox, oy), vis);
      const gx = ox * OMAPX, gy = oy * OMAPY;
      (d.notes || []).forEach((layer, zi) => (layer || []).forEach(([x, y, text, danger, radius]) => {
        // Formato: [SPRITE:id;][sym[:color];]texto con <color_x>…</color>
        let body = String(text).replace(/^SPRITE:[^;]*;/, '');
        const m = /^(.)(?::([A-Za-z]))?;(.*)$/s.exec(body);
        if (m) body = m[3];
        body = body.replace(/<\/?color[^>]*>/g, '');
        S.notes.push({ x: gx + x, y: gy + y, z: zi - ZOFF, text: body, sym: m ? m[1] : 'N', danger: !!danger, radius });
      }));
      (d.extras || []).forEach((layer, zi) => (layer || []).forEach(([x, y, id]) => {
        if (BORING_EXTRAS.test(id)) return;
        S.extras.push({ x: gx + x, y: gy + y, z: zi - ZOFF, id });
      }));
    }
  }
  // Misiones
  const all = S.master.active_missions || [];
  const NONE = -2147483647;
  S.missions = all.map((m) => {
    const def = window.BN_TERRAIN.missions?.[m.type_id];
    const t = m.target || [];
    return {
      uid: m.uid, type: m.type_id, status: m.status,
      name_en: def ? def[0] : m.type_id.replace(/^MISSION_/, '').replace(/_/g, ' ').toLowerCase(),
      name_es: def ? (def[1] || def[0]) : m.type_id.replace(/^MISSION_/, '').replace(/_/g, ' ').toLowerCase(),
      x: t[0], y: t[1], z: t[2], hasTarget: t.length === 3 && t[0] > NONE,
      deadline: m.deadline, mine: S.player ? (S.player.active.has(m.uid) || m.player_id === S.player.id) : false,
      current: S.player && S.player.current === m.uid, npc: m.npc_id,
    };
  });
  // Info del mundo
  const turn = sav?.turn;
  S.days = sav ? Math.floor((sav.turn - sav.game_start) / 86400) : null;
  renderMeta();
  S.turn = turn;
  if (sav) {
    const season = Math.floor(sav.turn / 86400 / S.seasonLen) % 4;
    if (season !== TS.season) { TS.season = season; TS.key++; }
  }
  invalidate();
  if (S.player) centerOn(S.player.x, S.player.y, S.player.z, Math.max(S.scale, 6));
  else { centerOn((S.bounds.x0 + S.bounds.x1) / 2, (S.bounds.y0 + S.bounds.y1) / 2, 0); fitAll(); }
  renderList();
}

/* ------------------------------------------------------------------ consultas */
function omAt(x, y) { return S.oms.get(key(fdiv(x, OMAPX), fdiv(y, OMAPY))); }
function terrainAt(x, y, z) {
  const om = omAt(x, y); if (!om || z < -ZOFF || z > ZOFF) return null;
  return S.terr[om.layers[z + ZOFF][(y - om.oy * OMAPY) * OMAPX + (x - om.ox * OMAPX)]];
}
function isSeen(x, y, z) {
  const vis = S.seen.get(key(fdiv(x, OMAPX), fdiv(y, OMAPY)));
  const L = vis && vis[z + ZOFF];
  return !!(L && L[(y - fdiv(y, OMAPY) * OMAPY) * OMAPX + (x - fdiv(x, OMAPX) * OMAPX)]);
}
const visibleTo = (x, y, z) => S.fog !== 'seen' || !S.char || isSeen(x, y, z);
const allOf = (k) => [...S.oms.values()].flatMap((om) => om[k]);
function specialAt(x, y, z) {
  const om = omAt(x, y); if (!om) return null;
  if (!om._spIdx) {
    om._spIdx = new Map();
    for (const sp of om.specials) for (const p of sp.pts) om._spIdx.set(p.join(','), sp);
  }
  return om._spIdx.get([x, y, z].join(','));
}
function cityAt(x, y) {
  let best = null, bd = Infinity;
  for (const c of allOf('cities')) {
    const d = Math.hypot(c.x - x, c.y - y);
    if (d <= c.size + 1 && d < bd) { best = c; bd = d; }
  }
  return best;
}
function rel(x, y) {
  if (!S.player) return '';
  const dx = x - S.player.x, dy = y - S.player.y, d = Math.round(Math.hypot(dx, dy));
  if (!d) return T('here');
  const a = (Math.atan2(dx, -dy) * 180 / Math.PI + 360 + 22.5) % 360;
  return `${d} ${T('dir')[Math.floor(a / 45)]}`;
}
const dist = (x, y) => (S.player ? Math.hypot(x - S.player.x, y - S.player.y) : 0);
const fmtZ = (z) => (z > 0 ? `+${z}` : `${z}`);

/* ------------------------------------------------------------------ render */
const cv = $('map'), ctx = cv.getContext('2d');
let DPR = 1, dirty = true;
const cache = new Map(); // "ox,oy,z" -> canvas
function invalidate() { cache.clear(); dirty = true; }
function resize() {
  DPR = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  cv.width = Math.max(1, r.width * DPR); cv.height = Math.max(1, r.height * DPR);
  dirty = true;
}
function omCanvas(om, z) {
  const k = `${om.ox},${om.oy},${z}`;
  let c = cache.get(k);
  if (c) return c;
  c = document.createElement('canvas'); c.width = OMAPX; c.height = OMAPY;
  const g = c.getContext('2d'), img = g.createImageData(OMAPX, OMAPY), L = om.layers[z + ZOFF];
  const vis = S.seen.get(key(om.ox, om.oy))?.[z + ZOFF];
  for (let i = 0; i < L.length; i++) {
    const t = S.terr[L[i]];
    const tt = TS.set && tileFor(t);
    let col = tt?.avg || (t.bg && t.bg !== BASE.black ? t.bg : t.fg), f = 1;
    // Aire libre/tejados: mezclar con lo que hay debajo, como en la vista cercana
    for (let zz = z - 1, a = 0.45; tt && tt.tile.tr && zz >= -ZOFF; zz--) {
      const tb = tileFor(S.terr[om.layers[zz + ZOFF][i]]);
      const cb = tb?.avg; if (!cb) break;
      col = col.map((v, j) => v * a + cb[j] * (1 - a));
      if (!tb.tile.tr) break;
    }
    if (S.char && S.fog !== 'all' && !(vis && vis[i])) f = S.fog === 'seen' ? 0 : tt ? 0.45 : 0.28;
    img.data[i * 4] = col[0] * f; img.data[i * 4 + 1] = col[1] * f; img.data[i * 4 + 2] = col[2] * f; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  cache.set(k, c);
  return c;
}
function drawAscii(t, sx, sy, s, f) {
  if (t.bg) { ctx.fillStyle = rgb(t.bg, f); ctx.fillRect(sx, sy, s + 0.5, s + 0.5); }
  ctx.fillStyle = rgb(t.fg, f);
  ctx.fillText(t.sym, sx + s / 2, sy + s / 2 + 1);
}
const ANGLE = [0, -Math.PI / 2, Math.PI, Math.PI / 2]; // rota 1 = -90º, 3 = +90º (como SDL)
function drawSprite(idx, sx, sy, k, rota) {
  const sp = TS.set.sprites[idx]; if (!sp) return;
  const [x, y, w, h, ox, oy] = sp, cw = TS.set.w * k, ch = TS.set.h * k;
  if (!rota) { ctx.drawImage(TS.img, x, y, w, h, sx + ox * k, sy + oy * k, w * k, h * k); return; }
  ctx.save();
  ctx.translate(sx + cw / 2, sy + ch / 2); ctx.rotate(ANGLE[rota]);
  ctx.drawImage(TS.img, x, y, w, h, -cw / 2 + ox * k, -ch / 2 + oy * k, w * k, h * k);
  ctx.restore();
}
function drawTileCell(t, x, y, z, sx, sy, s, depth) {
  const r = tileFor(t); if (!r) return false;
  const T = r.tile, k = s / TS.set.w;
  // Tiles con transparencia (aire libre, tejados): se pinta antes el nivel de abajo
  // (el juego los pinta opacos; aquí se dejan semitransparentes para ver debajo)
  let alpha = 1;
  if (T.tr && depth < 6) {
    const below = terrainAt(x, y, z - 1);
    if (below) {
      if (!drawTileCell(below, x, y, z - 1, sx, sy, s, depth + 1)) drawAscii(below, sx, sy, s, 1);
      alpha = 0.45;
    }
  }
  const rota = T.rot ? t.rota : 0;
  const rnd = T.fg.length > 1 || T.bg.length > 1 ? locRand(x, y) : 0;
  ctx.globalAlpha = alpha;
  for (const layer of T.tr ? ['fg'] : ['bg', 'fg']) {
    const v = pickVariant(T[layer], rnd);
    if (!v || !v[1].length) continue;
    const list = v[1];
    if (list.length === 1) drawSprite(list[0], sx, sy, k, layer === 'fg' || (T.rot && !T.ms) ? rota : 0);
    else drawSprite(list[rota % list.length], sx, sy, k, 0);
  }
  ctx.globalAlpha = 1;
  return true;
}
const toScreen = (x, y) => [(x - S.cx) * S.scale + cv.width / DPR / 2, (y - S.cy) * S.scale + cv.height / DPR / 2];
const toWorld = (sx, sy) => [Math.floor((sx - cv.width / DPR / 2) / S.scale + S.cx), Math.floor((sy - cv.height / DPR / 2) / S.scale + S.cy)];

function draw() {
  const W = cv.width / DPR, H = cv.height / DPR, s = S.scale, z = S.z;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const [x0, y0] = toWorld(0, 0), [x1, y1] = toWorld(W, H);

  const sprites = TS.set && TS.img && s >= 8;
  if (!sprites && s < 10) {
    ctx.imageSmoothingEnabled = false;
    for (const om of S.oms.values()) {
      const gx = om.ox * OMAPX, gy = om.oy * OMAPY;
      if (gx > x1 || gy > y1 || gx + OMAPX < x0 || gy + OMAPY < y0) continue;
      const [sx, sy] = toScreen(gx, gy);
      ctx.drawImage(omCanvas(om, z), sx, sy, OMAPX * s, OMAPY * s);
    }
  } else {
    ctx.font = `${Math.floor(s * 0.92)}px ${getComputedStyle(document.body).getPropertyValue('--mono')}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.imageSmoothingEnabled = s < TS.set?.w;
    const dark = [];
    // Filas de arriba abajo y con margen: los sprites grandes (árboles,
    // edificios altos) sobresalen hacia arriba de su casilla.
    for (let y = y0 - 1; y <= y1 + 3; y++) for (let x = x0 - 1; x <= x1 + 1; x++) {
      const t = terrainAt(x, y, z); if (!t) continue;
      const seen = !S.char || S.fog === 'all' || isSeen(x, y, z);
      if (!seen && S.fog === 'seen') continue;
      const [sx, sy] = toScreen(x, y);
      if (sprites) { if (!drawTileCell(t, x, y, z, sx, sy, s, 0)) drawAscii(t, sx, sy, s, 1); }
      else drawAscii(t, sx, sy, s, seen ? 1 : 0.3);
      if (!seen && sprites) dark.push(sx, sy);
    }
    ctx.fillStyle = 'rgba(0,0,0,.68)';
    for (let i = 0; i < dark.length; i += 2) ctx.fillRect(dark[i], dark[i + 1], s + 0.5, s + 0.5);
  }

  // Bordes de overmap
  if ($('t-grid').checked) {
    ctx.strokeStyle = 'rgba(185,229,122,.35)'; ctx.lineWidth = 1;
    for (const om of S.oms.values()) {
      const [sx, sy] = toScreen(om.ox * OMAPX, om.oy * OMAPY);
      ctx.strokeRect(sx, sy, OMAPX * s, OMAPY * s);
      ctx.fillStyle = 'rgba(185,229,122,.6)'; ctx.font = '11px monospace'; ctx.textAlign = 'left';
      ctx.fillText(`o.${om.ox}.${om.oy}`, sx + 4, sy + 12);
    }
  }

  // Resaltado de búsqueda
  if (S.hlCells.length) {
    ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 2;
    const r = Math.max(s, 6);
    for (const [x, y] of S.hlCells) {
      if (x < x0 - 1 || x > x1 + 1 || y < y0 - 1 || y > y1 + 1) continue;
      const [sx, sy] = toScreen(x, y);
      ctx.strokeRect(sx + s / 2 - r / 2, sy + s / 2 - r / 2, r, r);
    }
  }

  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const marker = (x, y, txt, fill, stroke = '#000', size = 14) => {
    const [sx, sy] = toScreen(x + 0.5, y + 0.5);
    if (sx < -40 || sy < -40 || sx > W + 40 || sy > H + 40) return null;
    const r = Math.max(size / 2, s * 0.6);
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = stroke; ctx.stroke();
    ctx.fillStyle = '#000'; ctx.font = `bold ${Math.round(r * 1.2)}px monospace`;
    ctx.fillText(txt, sx, sy + 1);
    return [sx, sy, r];
  };
  const label = (sx, sy, txt, color = '#fff', size = 12) => {
    ctx.font = `bold ${size}px ${getComputedStyle(document.body).getPropertyValue('--mono')}`;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(txt, sx, sy);
    ctx.fillStyle = color; ctx.fillText(txt, sx, sy);
  };

  if ($('t-hordes').checked) for (const h of allOf('hordes')) {
    if (h.z !== z) continue;
    const [sx, sy] = toScreen(h.x + 0.5, h.y + 0.5);
    ctx.beginPath(); ctx.arc(sx, sy, Math.max(2, Math.min(12, Math.sqrt(h.pop) * s * 0.25)), 0, Math.PI * 2);
    ctx.fillStyle = h.horde ? 'rgba(255,60,60,.55)' : 'rgba(255,140,60,.35)'; ctx.fill();
  }
  if ($('t-cities').checked && z === 0 && s >= 1.5) for (const c of allOf('cities')) {
    if (S.char && S.fog === 'seen' && !isSeen(c.x, c.y, 0)) continue;
    const [sx, sy] = toScreen(c.x + 0.5, c.y + 0.5);
    label(sx, sy - c.size * s * 0.25, c.name, '#ffe9a8', Math.round(Math.min(18, 10 + c.size * s * 0.06)));
  }
  if ($('t-radios').checked && z === 0) for (const r of allOf('radios')) marker(r.x, r.y, '≈', '#7fd0ff');
  if ($('t-notes').checked) for (const n of S.notes) {
    if (n.z !== z) continue;
    const m = marker(n.x, n.y, n.sym, n.danger ? '#ff6b6b' : '#e9e27a');
    if (m && s >= 6) {
      ctx.textAlign = 'left';
      label(m[0] + m[2] + 4, m[1], n.text.length > 40 ? n.text.slice(0, 39) + '…' : n.text, n.danger ? '#ffb0b0' : '#fff6b0', 11);
      ctx.textAlign = 'center';
    }
  }
  if ($('t-npcs').checked) for (const n of allOf('npcs')) {
    if (n.z !== z || (S.player && n.x === S.player.x && n.y === S.player.y && n.follower)) continue;
    const m = marker(n.x, n.y, n.missions ? '!' : '☺', n.follower ? '#7dff7d' : '#ffd166');
    if (m && s >= 8) label(m[0], m[1] - m[2] - 8, n.name, '#fff', 11);
  }
  if ($('t-missions').checked) for (const m of S.missions) {
    if (!m.hasTarget || !m.mine && S.player) continue;
    const mk = m.z === z ? marker(m.x, m.y, '★', m.current ? '#ff4d6d' : '#ff9e4d', '#fff', 18)
                          : marker(m.x, m.y, m.z > z ? '↑' : '↓', 'rgba(255,120,80,.6)', '#000', 14);
    if (mk && s >= 3) label(mk[0], mk[1] - mk[2] - 9, mname(m), '#ffc2b3', 11);
  }
  if (S.player) {
    const [sx, sy] = toScreen(S.player.x + 0.5, S.player.y + 0.5);
    const r = Math.max(8, s * 0.8);
    ctx.beginPath(); ctx.arc(sx, sy, r + 6, 0, Math.PI * 2);
    ctx.strokeStyle = S.player.z === z ? 'rgba(255,255,255,.7)' : 'rgba(255,255,255,.25)'; ctx.lineWidth = 2; ctx.stroke();
    marker(S.player.x, S.player.y, '@', S.player.z === z ? '#fff' : '#888', '#000', 16);
    if (S.player.z !== z) label(sx, sy + r + 16, `${S.player.name} (z ${fmtZ(S.player.z)})`, '#ccc', 11);
  }
  if (S.pulse) {
    const k = (performance.now() - S.pulse.t) / 1500;
    if (k > 1) S.pulse = null;
    else {
      const [sx, sy] = toScreen(S.pulse.x + 0.5, S.pulse.y + 0.5);
      ctx.beginPath(); ctx.arc(sx, sy, 10 + k * 50, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,225,77,${1 - k})`; ctx.lineWidth = 3; ctx.stroke();
    }
  }
  if (S.pin) {
    const [sx, sy] = toScreen(S.pin.x, S.pin.y);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(sx - 1, sy - 1, s + 2, s + 2);
  }
}
function loop() {
  if (dirty || S.pulse) { draw(); dirty = false; }
  requestAnimationFrame(loop);
}

/* ------------------------------------------------------------------ navegación */
function setZ(z) {
  S.z = Math.max(-ZOFF, Math.min(ZOFF, z));
  $('zval').textContent = fmtZ(S.z);
  computeHighlight(); dirty = true;
}
function centerOn(x, y, z, scale) {
  S.cx = x + 0.5; S.cy = y + 0.5;
  if (scale) S.scale = scale;
  if (z !== undefined && z !== S.z) setZ(z);
  dirty = true;
}
function goTo(x, y, z) {
  centerOn(x, y, z, Math.max(S.scale, 8));
  S.pulse = { x, y, t: performance.now() };
  showInfo(x, y, z ?? S.z);
}
function fitAll() {
  const b = S.bounds, W = cv.width / DPR, H = cv.height / DPR;
  S.scale = Math.max(1, Math.min(W / (b.x1 - b.x0), H / (b.y1 - b.y0)));
  S.cx = (b.x0 + b.x1) / 2; S.cy = (b.y0 + b.y1) / 2; dirty = true;
}
function zoomAt(f, sx, sy) {
  const [wx, wy] = [(sx - cv.width / DPR / 2) / S.scale + S.cx, (sy - cv.height / DPR / 2) / S.scale + S.cy];
  S.scale = Math.max(0.5, Math.min(48, S.scale * f));
  S.cx = wx - (sx - cv.width / DPR / 2) / S.scale;
  S.cy = wy - (sy - cv.height / DPR / 2) / S.scale;
  dirty = true;
}

/* ------------------------------------------------------------------ info / tooltip */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function describe(x, y, z) {
  const t = terrainAt(x, y, z);
  if (!t) return `<span class="muted">${T('tip.outside')}</span>`;
  const hidden = S.char && S.fog === 'seen' && !isSeen(x, y, z);
  const lines = [];
  if (hidden) lines.push(`<b>${T('tip.unexplored')}</b>`);
  else {
    lines.push(`<b>${esc(nameOf(t))}</b> <span class="muted">${esc(t.id)}</span>`);
    const sp = specialAt(x, y, z);
    if (sp) lines.push(T('tip.place', { v: esc(prettyId(sp.id)) }));
  }
  const c = z === 0 && cityAt(x, y);
  if (c) lines.push(T('tip.city', { v: esc(c.name) }));
  for (const n of S.notes) if (n.x === x && n.y === y && n.z === z) lines.push(T('tip.note', { v: esc(n.text) }));
  for (const n of allOf('npcs')) if (n.x === x && n.y === y && n.z === z) lines.push(T('tip.npc', { v: esc(n.name) }) + (n.follower ? T('tip.follower') : ''));
  for (const m of S.missions) if (m.hasTarget && m.x === x && m.y === y && m.z === z) lines.push(T('tip.mission', { v: esc(mname(m)) }));
  if (S.player && S.player.x === x && S.player.y === y && S.player.z === z) lines.push(`@ ${esc(S.player.name)}`);
  const lx = x - fdiv(x, OMAPX) * OMAPX, ly = y - fdiv(y, OMAPY) * OMAPY;
  lines.push(`<span class="muted">OMT ${x}, ${y}, z ${fmtZ(z)} · o.${fdiv(x, OMAPX)}.${fdiv(y, OMAPY)} [${lx},${ly}]` +
    (S.player ? ` · ${rel(x, y)}` : '') + (S.char && !hidden ? (' · ' + T(isSeen(x, y, z) ? 'tip.seen' : 'tip.unseen')) : '') + '</span>');
  return lines.join('<br>');
}
function showInfo(x, y, z) {
  S.pin = { x, y, z };
  $('info').innerHTML = `<span class="x" onclick="S.pin=null;this.parentNode.innerHTML='';dirty=true">✕</span>` + describe(x, y, z);
  dirty = true;
}
const prettyId = (id) => {
  const s = String(id).replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/* ------------------------------------------------------------------ listas */
function item(t, s, tag, onClick, cls = '') {
  const d = document.createElement('div');
  d.className = 'item ' + cls;
  d.innerHTML = `${tag ? `<span class="tag">${esc(tag)}</span>` : ''}<div class="t">${esc(t)}</div>${s ? `<div class="s">${esc(s)}</div>` : ''}`;
  d.onclick = onClick;
  return d;
}
const group = (t) => Object.assign(document.createElement('div'), { className: 'group', textContent: t });
const match = (q, ...xs) => !q || xs.some((x) => String(x ?? '').toLowerCase().includes(q));

function computeHighlight() {
  S.hlCells = [];
  const q = S.filter;
  if (S.tab !== 'places' || q.length < 3) return;
  const want = new Set();
  S.terr.forEach((t, i) => { if (match(q, t.name, t.es, t.base)) want.add(i); });
  for (const om of S.oms.values()) {
    const L = om.layers[S.z + ZOFF];
    for (let i = 0; i < L.length; i++) if (want.has(L[i])) {
      const x = om.ox * OMAPX + (i % OMAPX), y = om.oy * OMAPY + Math.floor(i / OMAPX);
      if (visibleTo(x, y, S.z)) S.hlCells.push([x, y]);
    }
  }
}

function renderList() {
  const L = $('list'), q = S.filter;
  L.innerHTML = '';
  const empty = (t) => L.appendChild(Object.assign(document.createElement('div'), { className: 'empty', textContent: t }));

  if (S.tab === 'missions') {
    const ms = S.missions.filter((m) => match(q, m.name_es, m.name_en, m.type));
    const mine = ms.filter((m) => m.mine), other = ms.filter((m) => !m.mine);
    const add = (m) => {
      const left = m.deadline && S.turn ? Math.round((m.deadline - S.turn) / 3600) : null;
      const sub = [m.status ? T('status.' + m.status) : '', m.hasTarget ? `${rel(m.x, m.y)} · z ${fmtZ(m.z)}` : T('m.notarget'),
        left !== null && left > 0 ? T('m.left', { n: left }) : ''].filter(Boolean).join(' · ');
      L.appendChild(item(mname(m), sub, m.current ? T('m.active') : '', () => m.hasTarget && goTo(m.x, m.y, m.z), m.current ? 'bad' : ''));
    };
    if (mine.length) { L.appendChild(group(T('m.mine'))); mine.forEach(add); }
    if (other.length) { L.appendChild(group(T('m.other'))); other.forEach(add); }
    if (!ms.length) empty(T('m.none'));
  }

  if (S.tab === 'cities') {
    const cs = allOf('cities').filter((c) => match(q, c.name)).sort((a, b) => dist(a.x, a.y) - dist(b.x, b.y));
    cs.forEach((c) => L.appendChild(item(c.name, `${T('c.size', { n: c.size })} · ${rel(c.x, c.y)}` + (S.char && !isSeen(c.x, c.y, 0) ? ' · ' + T('undiscovered') : ''),
      '', () => goTo(c.x, c.y, 0))));
    if (!cs.length) empty(T('c.none'));
  }

  if (S.tab === 'npcs') {
    const ns = allOf('npcs').filter((n) => match(q, n.name, n.fac)).sort((a, b) => dist(a.x, a.y) - dist(b.x, b.y));
    ns.forEach((n) => L.appendChild(item(n.name, `${n.follower ? T('n.follower') : (n.fac || T('n.nofac'))} · ${rel(n.x, n.y)} · z ${fmtZ(n.z)}` +
      (n.missions ? ' · ' + T('n.offers', { n: n.missions }) : ''), '', () => goTo(n.x, n.y, n.z))));
    if (!ns.length) empty(T('n.none'));
  }

  if (S.tab === 'notes') {
    const ns = S.notes.filter((n) => match(q, n.text));
    ns.forEach((n) => L.appendChild(item(n.text || T('no.empty'), `${rel(n.x, n.y)} · z ${fmtZ(n.z)}`, n.danger ? T('no.danger') : '', () => goTo(n.x, n.y, n.z), n.danger ? 'bad' : '')));
    const ex = S.extras.filter((e) => match(q, e.id));
    if (ex.length) { L.appendChild(group(T('no.extras'))); ex.forEach((e) => L.appendChild(item(prettyId(e.id.replace(/^mx_/, '')), `${rel(e.x, e.y)} · z ${fmtZ(e.z)}`, '', () => goTo(e.x, e.y, e.z)))); }
    if (!ns.length && !ex.length) empty(T('no.none'));
  }

  if (S.tab === 'places') {
    // Lugares especiales agrupados por tipo
    const groups = new Map();
    for (const sp of allOf('specials')) {
      const { rep: [x, y, z], t } = specialInfo(sp);
      const seen = !S.char || sp.pts.some((p) => isSeen(...p));
      if (!seen && S.fog === 'seen') continue;
      const name = prettyId(t ? nameOf(t) : sp.id);
      if (!match(q, sp.id, name, t?.name)) continue;
      if (!groups.has(name)) groups.set(name, { name, ids: new Set(), list: [] });
      const g = groups.get(name);
      g.ids.add(sp.id);
      g.list.push({ x, y, z, seen, id: sp.id });
    }
    const gs = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    if (q.length >= 3) {
      const n = S.hlCells.length;
      L.appendChild(group(T('p.hl', { n, z: fmtZ(S.z) })));
      if (n) {
        const near = S.hlCells.slice().sort((a, b) => dist(...a) - dist(...b))[0];
        L.appendChild(item(T('p.nearest'), terrainAt(near[0], near[1], S.z) ? nameOf(terrainAt(near[0], near[1], S.z)) : '', rel(...near), () => goTo(near[0], near[1], S.z)));
      }
    }
    L.appendChild(group(T('p.types', { n: gs.length })));
    for (const [, g] of gs) {
      g.list.sort((a, b) => dist(a.x, a.y) - dist(b.x, b.y));
      const ids = [...g.ids];
      const idsTxt = ids.slice(0, 3).join(', ') + (ids.length > 3 ? ` +${ids.length - 3}` : '');
      const head = item(`${g.name}  ×${g.list.length}`, idsTxt, rel(g.list[0].x, g.list[0].y), null);
      let open = false, sub;
      head.onclick = () => {
        if (g.list.length === 1) return goTo(g.list[0].x, g.list[0].y, g.list[0].z);
        open = !open;
        if (open) {
          sub = document.createElement('div'); sub.style.paddingLeft = '12px';
          g.list.slice(0, 60).forEach((p) => sub.appendChild(item(`${rel(p.x, p.y)} · z ${fmtZ(p.z)}`, p.seen ? '' : T('undiscovered'), '', () => goTo(p.x, p.y, p.z))));
          head.after(sub);
        } else sub?.remove();
      };
      L.appendChild(head);
    }
    if (!gs.length) empty(T('p.none'));
  }
}

/* ------------------------------------------------------------------ eventos */
$('pick').addEventListener('change', (e) => {
  const list = [...e.target.files].map((f) => ({ path: f.webkitRelativePath || f.name, file: f }))
    .filter((x) => !/\/(maps|mmr)\//.test(x.path));
  handleList(list);
});
const drop = $('drop');
['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
document.addEventListener('drop', async (e) => {
  if ($('intro').hidden) return;
  $('intro-status').textContent = T('st.folder');
  const out = [];
  for (const it of e.dataTransfer.items) { const en = it.webkitGetAsEntry?.(); if (en) await walkEntry(en, '', out); }
  handleList(out);
});

$('char').onchange = (e) => selectChar(+e.target.value);
$('tileset').onchange = (e) => useTileset(e.target.value);
$('zup').onclick = () => setZ(S.z + 1);
$('zdown').onclick = () => setZ(S.z - 1);
$('center').onclick = () => S.player && centerOn(S.player.x, S.player.y, S.player.z);
$('fog').onchange = (e) => { S.fog = e.target.value; invalidate(); computeHighlight(); renderList(); };
document.querySelectorAll('select.lang').forEach((sel) => {
  for (const [k, v] of Object.entries(I18N)) sel.add(new Option(v['lang.name'], k));
  sel.onchange = (e) => setLang(e.target.value);
});
for (const id of ['t-cities', 't-missions', 't-npcs', 't-notes', 't-radios', 't-hordes', 't-grid']) $(id).onchange = () => (dirty = true);
document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  S.tab = b.dataset.tab; computeHighlight(); renderList(); dirty = true;
}));
let ft;
$('filter').oninput = (e) => {
  clearTimeout(ft);
  ft = setTimeout(() => { S.filter = e.target.value.trim().toLowerCase(); computeHighlight(); renderList(); dirty = true; }, 200);
};
$('back').onclick = () => { $('app').hidden = true; $('intro').hidden = false; $('worlds').hidden = true; $('pick').value = ''; };

window.addEventListener('resize', resize);
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = cv.getBoundingClientRect();
  zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
let drag = null;
cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: S.cx, cy: S.cy, moved: false }; cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointermove', (e) => {
  const r = cv.getBoundingClientRect(), tip = $('tip');
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) { drag.moved = true; cv.classList.add('drag'); }
    S.cx = drag.cx - dx / S.scale; S.cy = drag.cy - dy / S.scale; dirty = true;
    tip.hidden = true; return;
  }
  const [x, y] = toWorld(e.clientX - r.left, e.clientY - r.top);
  tip.innerHTML = describe(x, y, S.z);
  tip.hidden = false;
  const tx = e.clientX - r.left + 16, ty = e.clientY - r.top + 16;
  tip.style.left = Math.min(tx, r.width - tip.offsetWidth - 8) + 'px';
  tip.style.top = Math.min(ty, r.height - tip.offsetHeight - 8) + 'px';
});
cv.addEventListener('pointerup', (e) => {
  if (drag && !drag.moved) {
    const r = cv.getBoundingClientRect();
    const [x, y] = toWorld(e.clientX - r.left, e.clientY - r.top);
    showInfo(x, y, S.z);
  }
  drag = null; cv.classList.remove('drag');
});
cv.addEventListener('pointerleave', () => ($('tip').hidden = true));
window.addEventListener('keydown', (e) => {
  if ($('app').hidden || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const step = 40 / S.scale;
  const k = e.key;
  if (k === 'PageUp' || k === '<') setZ(S.z + 1);
  else if (k === 'PageDown' || k === '>') setZ(S.z - 1);
  else if (k === '+' || k === '=') zoomAt(1.25, cv.width / DPR / 2, cv.height / DPR / 2);
  else if (k === '-') zoomAt(0.8, cv.width / DPR / 2, cv.height / DPR / 2);
  else if (k === 'c' || k === 'C') S.player && centerOn(S.player.x, S.player.y, S.player.z);
  else if (k === 'f' || k === 'F') fitAll();
  else if (k === 'ArrowLeft') S.cx -= step; else if (k === 'ArrowRight') S.cx += step;
  else if (k === 'ArrowUp') S.cy -= step; else if (k === 'ArrowDown') S.cy += step;
  else return;
  e.preventDefault(); dirty = true;
});

{
  const sel = $('tileset');
  for (const [k, v] of Object.entries(window.BN_TILESETS || {})) sel.add(new Option(v.name === 'UNDEAD_PEOPLE_BASE' ? 'UndeadPeople' : v.name, k));
  sel.add(new Option(T('ts.ascii'), 'ascii'));
  let want = 'udp';
  try { want = localStorage.getItem('bnme.tileset') || want; } catch {}
  if (![...sel.options].some((o) => o.value === want)) want = sel.options[0].value;
  sel.value = want;
  useTileset(want);
}
applyLang();
if (!window.BN_TERRAIN) $('intro-status').textContent = T('err.noterrain');
requestAnimationFrame(loop);
