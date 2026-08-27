import { PETS, petMarkup } from './pets.js';
import { toPNG, PetTalk } from './pet.js';
import { VOICES, Blip } from './blips.js';
import { deltaColor, noteColor, noteScaleRGB, lineChart, dailyChart, bandMarkup, SATURATION } from './charts.js';

/* ============================= socle ============================= */

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const MONTHS_FR = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc'];
const fmtDay = d => {
  const [y, m, dd] = d.split('-');
  return `${Number(dd)} ${MONTHS_FR[Number(m) - 1].toLowerCase()} ${y}`;
};
const fmtTime = ts => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dayShift = (d, n) => {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd) + n * 86400000).toISOString().slice(0, 10);
};

async function api(path, body) {
  const res = await fetch(path, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : undefined);
  // session expirée ou déconnexion : on repasse par le verrou au lieu
  // d'empiler des erreurs dans la console
  if (res.status === 401) { location.href = '/login'; throw new Error('session expirée'); }
  const j = await res.json();
  if (j.error) throw new Error(j.error);
  return j;
}

let S = null;              // /api/state
let view = 'tonight';

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('on'), 2200);
}

/* --------- infobulle globale (data-tip) --------- */
document.addEventListener('mouseover', e => {
  const t = e.target.closest('[data-tip]');
  const tip = $('#tip');
  if (!t) return;
  tip.textContent = t.dataset.tip;
  tip.classList.add('on');
  const move = ev => {
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.min(ev.clientX + 13, innerWidth - r.width - 8) + 'px';
    tip.style.top = Math.max(ev.clientY - r.height - 11, 8) + 'px';
  };
  move(e);
  t._m = move;
  t.addEventListener('mousemove', move);
  t.addEventListener('mouseleave', () => {
    tip.classList.remove('on');
    t.removeEventListener('mousemove', move);
  }, { once: true });
});

/** La voix du compagnon : un blip par syllabe (web/blips.js), pas de synthèse vocale. */
const speakChar = c => Blip.tick(c, S.settings);

/**
 * La jauge de jetons. Un point coloré, rien de plus tant qu'on ne clique pas :
 * un compteur permanent transformerait chaque phrase en dépense, ce qui est la
 * dernière chose à avoir en tête quand on vient écrire un mauvais soir.
 */
function syncGauge() {
  const btn = $('#gauge');
  if (!btn) return;
  const u = S.usage;
  if (!u) { btn.hidden = true; return; }
  btn.hidden = false;
  btn.dataset.level = u.level;
  btn.innerHTML = `<span class="dot"></span>${
    S.user?.avatar ? `<img src="${esc(S.user.avatar)}" alt="">`
                   : `<span class="who">${esc(S.user?.username ?? 'toi')}</span>`}`;
  btn.setAttribute('aria-label', `Jetons : ${u.level}`);
}

/** Sous 10 000 on garde une décimale : « 5 k » pour 4 800 fait perdre 200 jetons à l'œil. */
const fmtTok = n =>
  n >= 1e6  ? (n / 1e6).toFixed(1).replace('.0', '') + ' M' :
  n >= 1e4  ? Math.round(n / 1000) + ' k' :
  n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + ' k' : String(n);

function drawGaugePanel() {
  const el = $('#gaugePanel'), u = S.usage;
  if (!el || !u) return;
  const pct = u.allowance > 0 ? Math.min(100, Math.round(u.used / u.allowance * 100)) : 0;
  el.innerHTML = `
    <div class="head">
      ${S.user?.avatar ? `<img src="${esc(S.user.avatar)}" alt="">` : ''}
      <div>
        <b>${esc(S.user?.username ?? 'Toi')}</b>
        <span>connecté${S.user?.id && S.user.id !== 'local' ? ' avec Discord' : ''}</span>
      </div>
      <form method="post" action="/logout" style="margin-left:auto"><button class="btn" type="submit">Déconnexion</button></form>
    </div>

    <div class="bar" data-level="${u.level}"><i style="width:${pct}%"></i></div>
    <p class="nums">
      <b>${fmtTok(u.remaining)}</b> jetons restants sur ${fmtTok(u.allowance)} ce mois-ci
    </p>
    <p class="sub" style="margin:0 0 12px">
      Remise à zéro le ${fmtDay(u.resetsOn)}. ${u.calls} échange${u.calls > 1 ? 's' : ''} depuis le début du mois.
    </p>
    <p class="paid">Tu n'as rien à payer. C'est BrainDebugger qui règle.</p>
    ${u.exhausted ? `<p class="sub" style="color:var(--warn);margin:12px 0 0">
      Enveloppe épuisée pour ce mois. Le compagnon continue de répondre, mais hors-ligne —
      il ne se souvient plus de la conversation.</p>` : ''}`;
  el.querySelector('form')?.addEventListener('submit', () => { /* laisse le POST partir */ });
}

function toggleGauge(force) {
  const el = $('#gaugePanel'), btn = $('#gauge');
  const open = force ?? el.hidden;
  if (open) drawGaugePanel();
  el.hidden = !open;
  btn?.setAttribute('aria-expanded', String(open));
}

function syncHeader() {
  $('#dayline').textContent = S.stats.days
    ? `${S.stats.days} jours · ${S.stats.firstDate} → ${S.stats.lastDate}`
    : 'aucune journée enregistrée';
}

async function saveSettings(patch) {
  const { settings } = await api('/api/settings', patch);
  S.settings = settings;
  return settings;
}

/* ============================= vue : parler =============================

   Une seule page pour le rituel du soir : tu parles, le compagnon relance,
   tes propres mots d'avant remontent tout seuls, et tu notes.
   La recherche n'est pas un onglet : chercher est une corvee, se voir rappeler
   ses mots ne l'est pas. -- SPEC 2.2
                                                                            */

let ECHOES = { items: [], textCount: 0 };

async function renderTonight() {
  const t = S.today;
  const note = S.entry?.note ?? null;
  const s = S.settings;

  $('#view').innerHTML = `
    <div class="tonight">
      <div class="petcard">
        <div class="art" id="art" tabindex="0" role="button"
             aria-label="Changer l'image du compagnon">${petMarkup(s)}</div>
        <input type="file" id="petPick" accept="image/*" hidden>
      </div>

      <div class="stack">
        <div class="card">
          <div class="threadhead">
            <button class="newchat" id="newChat" title="Repartir sur un fil vide. Rien n'est effacé : tes journées restent dans le journal.">Nouveau&nbsp;fil</button>
          </div>
          <div class="thread" id="thread"></div>
          <div class="composer">
            <textarea id="input" rows="1" placeholder="Écris ici…" aria-label="Ton message"></textarea>
            <button class="btn primary" id="send">Envoyer</button>
          </div>
        </div>

        <div id="echoes"></div>

        <div class="card notecard">
          <h2>Note avant de te coucher</h2>
          ${S.stats.reference !== null
            ? `<p class="ref">référence glissante <b class="mono">${S.stats.reference}</b></p>` : ''}

          <div class="noteface">
            <div class="val" id="noteVal" style="${noteFaceStyle(note)}">
              ${note ?? '—'}<span class="sl">/10</span>
            </div>
            <div class="say" id="noteSay">${noteSay(note)}</div>
          </div>

          <div class="notestrip" id="notestrip">
            ${Array.from({ length: 11 }, (_, n) => {
              const c = noteScaleRGB(n);
              const on = note === n;
              return `<button data-n="${n}" aria-pressed="${on}" style="background:rgb(${c})"
                data-tip="${esc(S.anchors.find(a => a.note === n)?.descr ?? `${n}/10`)}">${n}</button>`;
            }).join('')}
          </div>

        </div>
      </div>
    </div>`;

  drawThread();
  drawEchoes();

  $('#newChat')?.addEventListener('click', async e => {
    const b = e.currentTarget;
    const th = $('#thread');
    if (!S.messages.length) { toast('Le fil est déjà vide.'); return; }
    b.disabled = true;
    // Le fil s'efface avant que le serveur réponde : c'est le geste qu'on veut
    // sentir, pas l'aller-retour réseau.
    th?.classList.add('wiping');
    await new Promise(r => setTimeout(r, 380));
    try {
      const r = await api('/api/chat/new', {});
      S.messages = r.messages;
      S.settings.chatSince = r.chatSince;
      drawThread();
      $('#echoes').innerHTML = '';
      toast('Nouveau fil. Tes journées sont intactes.');
    } catch (err) {
      toast(err.message);
    } finally {
      th?.classList.remove('wiping');
      b.disabled = false;
    }
  });

  $('#notestrip').onclick = async e => {
    const b = e.target.closest('button[data-n]');
    if (!b) return;
    const n = Number(b.dataset.n);
    await api('/api/note', { date: t, note: n });
    S = await api('/api/state');
    syncHeader();
    renderTonight();
    toast(`Journée notée ${n}/10`);
  };

  $('#voiceBtn')?.addEventListener('click', async e => {
    // capture AVANT le await : le DOM vide currentTarget des que le handler rend
    // la main, ce qui arrive au premier await d'une fonction async.
    const b = e.currentTarget;
    const on = !S.settings.blipEnabled;
    await saveSettings({ blipEnabled: on });
    b.setAttribute('aria-pressed', String(on));
    const v = VOICES.find(x => x.id === S.settings.blipVoice);
    b.innerHTML = `<span class="ico"></span>${on ? esc(v?.name ?? 'il parle') : 'muet'}`;
    if (on) Blip.preview(S.settings.blipVoice, S.settings);   // le clic autorise l'audio
  });

  // n'importe quelle image -> PNG carre normalise
  $('#art').onclick = () => $('#petPick').click();
  $('#art').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#petPick').click(); } };
  $('#petPick').onchange = async e => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 12 * 1024 * 1024) return toast('Fichier trop lourd (max 12 Mo)');
    try {
      const png = await toPNG(f, 256);
      await saveSettings({ petImage: png, petSprite: 'custom' });
      renderTonight();
      toast('Nouveau compagnon');
    } catch (err) { toast(err.message); }
  };

  const input = $('#input');
  input.oninput = () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
    scheduleEchoes(input.value);
  };
  input.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
  $('#send').onclick = send;
  input.focus();
}

const noteFaceStyle = n => n === null || n === undefined
  ? 'background:var(--surface);color:var(--ink-faint)'
  : `background:rgb(${noteScaleRGB(n)});color:#08110c`;

function noteSay(n) {
  if (n === null || n === undefined) return '';
  const a = S.anchors.find(x => x.note === n);
  if (a) return `<b>${esc(a.label)}</b> — ${esc(a.descr)}`;
  const near = S.anchors.filter(x => x.note < n).sort((x, y) => y.note - x.note)[0];
  return near ? `Au-dessus de <b>${esc(near.label)}</b> (${near.note}).` : `Noté ${n} sur 10.`;
}

/**
 * Le fil est continu : le changement de jour n'est qu'un repère, pas une
 * coupure. On revient vers quelqu'un qu'on connaît, on ne remplit pas un
 * formulaire quotidien.
 */
function drawThread() {
  const th = $('#thread');
  if (!th) return;
  if (!S.messages.length) {
    th.innerHTML = `<div class="empty">Ce que tu dis reste.</div>`;
    return;
  }
  let last = null;
  th.innerHTML = S.messages.map(m => {
    const day = m.date ?? m.ts.slice(0, 10);
    const sep = day !== last
      ? `<div class="daysep"><span>${day === S.today ? "aujourd'hui" : fmtDay(day)}</span></div>`
      : '';
    last = day;
    // Ce qui n'est pas d'aujourd'hui est du passé : présent, mais en retrait.
    const passe = day !== S.today ? ' past' : '';
    return sep + `<div class="msg ${m.role}${passe}"><span class="tx">${esc(m.text)}</span><span class="t">${fmtTime(m.ts)}</span></div>`;
  }).join('');
  th.scrollTop = th.scrollHeight;
  th.classList.remove('reading');
  bindThreadReveal(th);
}

/**
 * L'historique est atténué à l'ouverture, et redevient net dès qu'on remonte.
 *
 * C'est ce que fait l'œil de toute façon : en arrivant on regarde le bas, pas
 * le mois dernier. Garder le passé lisible à pleine intensité met la journée en
 * concurrence avec elle-même. Il est là, on le voit, il n'appelle pas.
 *
 * Le seuil est bas — quelques pixels suffisent : le geste de remonter est
 * l'intention, il n'y a pas à la mériter.
 */
function bindThreadReveal(th) {
  if (th.dataset.reveal) return;      // un seul écouteur, pas un par rendu
  th.dataset.reveal = '1';
  th.addEventListener('scroll', () => {
    const enBas = th.scrollHeight - th.scrollTop - th.clientHeight < 24;
    th.classList.toggle('reading', !enBas);
  }, { passive: true });
}

/** Lit un flux SSE renvoyé par fetch et appelle `on(event, data)` par trame. */
async function readSSE(res, on) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const frames = buf.split('\n\n');
    buf = frames.pop() ?? '';
    for (const f of frames) {
      const ev = f.match(/^event: (.+)$/m)?.[1];
      const raw = f.match(/^data: (.+)$/m)?.[1];
      if (ev && raw) { try { on(ev, JSON.parse(raw)); } catch { /* trame partielle */ } }
    }
  }
}

async function send() {
  const input = $('#input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  $('#send').disabled = true;
  PetTalk.stop();

  // affichage optimiste : ce que tu écris apparaît tout de suite
  S.messages.push({ ts: new Date().toISOString(), date: S.today, role: 'user', text });
  drawThread();
  refreshEchoes(text);

  let typing = null;

  try {
    const res = await fetch('/api/message/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, date: S.today })
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    await readSSE(res, (ev, data) => {
      if (ev === 'error') { toast(data.error); return; }

      if (ev === 'user') {
        S.messages = data.messages;
        drawThread();
        // bulle vide dans laquelle le compagnon va écrire
        const th = $('#thread');
        const el = document.createElement('div');
        el.className = 'msg pet';
        el.innerHTML = '<span class="tx"></span>';
        th.appendChild(el);
        th.scrollTop = th.scrollHeight;
        Blip.reset();
        typing = PetTalk.startStream($('#art'), el.querySelector('.tx'), { onChar: speakChar });
        return;
      }

      if (ev === 'delta') { PetTalk.feed(data.text); $('#thread').scrollTop = $('#thread').scrollHeight; return; }

      if (ev === 'done') {
        PetTalk.endStream();
        if (data.usage) { S.usage = data.usage; syncGauge(); }
        if (data.exhausted) toast("Enveloppe de jetons épuisée — le compagnon répond hors-ligne.");
        S.messages = data.messages;

        if (data.refused) {
          toast('Le modèle a décliné — le compagnon hors-ligne a pris la main.');
          showHelpline();
        } else if (data.degraded) {
          toast(`Modèle injoignable — repli hors-ligne (${String(data.degraded).slice(0, 60)})`);
        }
      }
    });

    await typing;
    drawThread();                       // repose les horodatages définitifs
  } catch (err) {
    PetTalk.stop();
    toast(String(err.message));
  } finally {
    const b = $('#send');
    if (b) b.disabled = false;
    $('#input')?.focus();
  }
}

/**
 * Si le modèle décline, on ne laisse pas un blanc. Le numéro d'aide devient
 * visible sur la page où la personne est déjà en train d'écrire.
 */
function showHelpline() {
  if ($('#helpline')) return;
  const el = document.createElement('div');
  el.className = 'helpline';
  el.id = 'helpline';
  el.innerHTML = "Si tu as besoin de parler à quelqu'un maintenant : <b>3114</b>, gratuit, 24h/24, partout en France.";
  $('#thread')?.after(el);
}

/* --------- echos : tes mots d'avant, sans avoir rien demande --------- */

let _echoTimer = null;
function scheduleEchoes(text) {
  clearTimeout(_echoTimer);
  _echoTimer = setTimeout(() => refreshEchoes(text), 700);
}

async function refreshEchoes(text) {
  const t = String(text ?? '').trim();
  if (t.length < 12) { ECHOES = { ...ECHOES, items: [] }; return drawEchoes(); }
  try {
    ECHOES = await api('/api/echoes', { text: t, date: S.today, limit: 3 });
    drawEchoes();
  } catch { /* les echos ne doivent jamais casser la saisie */ }
}

function drawEchoes() {
  const el = $('#echoes');
  if (!el) return;
  if (!ECHOES.items?.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="card echoes">
    <h2>Tu as déjà écrit ça</h2>

    ${ECHOES.items.map(it => `<div class="simitem">
      <div class="hd">
        <span class="d">${fmtDay(it.date)}</span>
        <span class="pill" style="background:rgba(${noteScaleRGB(it.note ?? 5)},.2);color:rgb(${noteScaleRGB(it.note ?? 5)});border-color:transparent">${it.note ?? '—'}/10</span>
        <span class="faint" style="font-size:11.5px">${it.terms.map(esc).join(' · ')}</span>
      </div>
      <p class="q">${highlight(it.text.slice(0, 240), it.terms)}${it.text.length > 240 ? '…' : ''}</p>
      ${bandMarkup(it.band)}
    </div>`).join('')}
  </div>`;
}

/**
 * Premier lancement : aucune donnée. On ne montre pas une page vide avec des
 * tirets — on dit ce qui manque et par où commencer.
 */
function renderNoData(why) {
  $('#view').innerHTML = `<div class="card" style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
    <div style="width:84px;height:84px;flex:none">${petMarkup(S.settings)}</div>
    <div style="flex:1;min-width:240px">
      <h2 style="margin:0 0 5px">Rien à afficher</h2>
      <p class="sub" style="margin:0 0 13px">${esc(why)}</p>
      <div style="display:flex;gap:9px;flex-wrap:wrap">
        <button class="btn primary" data-goview="tonight">Noter aujourd'hui</button>
      </div>
      <p class="faint" style="font-size:12px;margin:13px 0 0">
        Si tu as déjà un historique dans un tableur :
        <span class="mono">node server/import-csv.js ton-export.csv</span>
      </p>
    </div>
  </div>`;
  $('#view').onclick = e => {
    const v = e.target.closest('[data-goview]');
    if (v) go(v.dataset.goview);
  };
}

/* ============================= vue : année =============================

   Trois lectures des memes notes, chacune avec son metier :
     - la grille  : ou etaient les journees
     - l'ecart quotidien : signe(x)·x²/2,5, l'expansion qui fait ressortir les extremes
     - le cumul   : somme des ecarts LINEAIRES a l'etalon, dont la pente est lisible
   Le carre sert au quotidien, le lineaire au cumul. Cumuler le carre ecrase la forme.
                                                                          */

let SERIES = null;
let CUMMODE = 'etalon';
let DAILYALL = false;   // le tableur d'origine montrait une annee a la fois

async function renderYear(year) {
  if (!S.stats.days) return renderNoData('Les courbes ont besoin de journées notées.');
  year = year ?? Number(S.stats.lastDate.slice(0, 4));
  SERIES ??= await api('/api/series');
  const grid = await api(`/api/year?year=${year}`);
  const years = S.stats.years;
  const eta = SERIES.etalon;

  const cumKey = CUMMODE === 'etalon' ? 'cumEtalon' : 'cumDeltaRef';
  const drift = SERIES[cumKey][SERIES[cumKey].length - 1] / SERIES[cumKey].length;

  $('#view').innerHTML = `
    <div class="stack">
      <div class="card">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:15px">
          <h2 style="margin:0">Grille</h2>
          <div class="centerpick" style="margin:0 0 0 auto">
            ${years.map(y => `<button data-year="${y}" aria-pressed="${Number(y) === year}">${y}</button>`).join('')}
          </div>
        </div>
        <div class="gridwrap">${gridMarkup(grid)}</div>
        <div class="legend">
          <span>pire</span>
          ${Array.from({ length: 17 }, (_, i) => `<i style="background:${deltaColor(-SATURATION + (i / 16) * 2 * SATURATION)}"></i>`).join('')}
          <span>meilleur</span>
          <span style="margin-left:12px">écart à la référence, ±${SATURATION}</span>
          <span style="margin-left:auto" class="mono">${grid.count} jours · moyenne ${grid.avg ?? '—'}</span>
        </div>
      </div>

      <div class="card">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:4px">
          <h2 style="margin:0">Écart quotidien</h2>
          <div class="centerpick" style="margin:0 0 0 auto">
            <button data-daily="year" aria-pressed="${!DAILYALL}">${year}</button>
            <button data-daily="all" aria-pressed="${DAILYALL}">tout</button>
          </div>
        </div>
        <p class="sub">Les écarts d'humeur, jour par jour.</p>
        ${(() => {
          const idx = DAILYALL
            ? SERIES.date.map((_, i) => i)
            : SERIES.date.map((d, i) => d.startsWith(String(year)) ? i : -1).filter(i => i >= 0);
          return dailyChart(idx.map(i => SERIES.date[i]), idx.map(i => SERIES.contrastFixed[i]),
                            { height: 240, events: SERIES.events });
        })()}
      </div>

      <div class="card">
        <h2>Cumul</h2>
        <p class="sub"><span class="mono">Σ (note − étalon)</span></p>
        <div class="centerpick">
          <button data-cum="etalon" aria-pressed="${CUMMODE === 'etalon'}">étalon fixe<span class="drift mono">${eta}</span></button>
          <button data-cum="reference" aria-pressed="${CUMMODE === 'reference'}">référence glissante<span class="drift">365 j</span></button>
          <label class="field" style="margin:0 0 0 auto;display:flex;align-items:center;gap:8px">
            <span style="margin:0;font-size:12px">étalon</span>
            <input type="number" id="etalon" min="0" max="10" step="0.1" value="${eta}" style="width:76px">
          </label>
        </div>
        ${lineChart(SERIES.date, SERIES[cumKey], { height: 250, events: SERIES.events })}
        <p class="sub" style="margin:13px 0 0">
          ${CUMMODE === 'etalon'
            ? `Ta moyenne réelle est à <b class="mono">${SERIES.mean}</b>, ta médiane à <b class="mono">${SERIES.globalMedian}</b>.
               Avec un étalon à <b class="mono">${eta}</b>, la courbe dérive de <b class="mono">${drift > 0 ? '+' : ''}${drift.toFixed(3)}</b>/jour.
               Plus l'étalon colle à ta moyenne, plus la pente ne dit que ce qui a vraiment changé.`
            : `Ici l'étalon n'est pas figé : c'est la médiane de tes 365 derniers jours, recalculée chaque jour.
               Dérive résiduelle <b class="mono">${drift > 0 ? '+' : ''}${drift.toFixed(3)}</b>/jour, sans rien avoir à régler à la main.`}
        </p>
      </div>

      <div class="card">
        <h2>Repères</h2>
        <p class="sub">En pointillés sur les deux courbes.</p>
        <form id="evform" style="display:flex;gap:9px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px">
          <label class="field" style="margin:0;flex:0 0 160px"><span>Date</span>
            <input type="date" id="evdate" required min="${S.stats.firstDate}" max="${S.stats.lastDate}" value="${S.today}"></label>
          <label class="field" style="margin:0;flex:1 1 240px"><span>Quoi</span>
            <input type="text" id="evlabel" required maxlength="120" placeholder="ex. changement de boulot"></label>
          <button class="btn" type="submit">Ajouter</button>
        </form>
        ${SERIES.events.length
          ? `<div style="display:flex;flex-direction:column;gap:1px">
              ${SERIES.events.map(ev => `<div style="display:flex;align-items:baseline;gap:11px;padding:7px 0;border-top:1px solid var(--line-soft)">
                <span class="mono faint" style="font-size:12px;flex:0 0 92px">${esc(ev.date)}</span>
                <span style="flex:1">${esc(ev.label)}</span>
                <button class="btn" data-delev="${ev.id}" style="padding:3px 9px;font-size:11.5px">retirer</button>
              </div>`).join('')}
            </div>`
          : `<p class="sub" style="margin:0">Aucun repère pour l'instant.</p>`}
      </div>
    </div>`;

  $('#view').onclick = async e => {
    const y = e.target.closest('[data-year]');
    if (y) return renderYear(Number(y.dataset.year));
    const c = e.target.closest('[data-cum]');
    if (c) { CUMMODE = c.dataset.cum; return renderYear(year); }
    const dl = e.target.closest('[data-daily]');
    if (dl) { DAILYALL = dl.dataset.daily === 'all'; return renderYear(year); }
    const cell = e.target.closest('td.cell.has');
    if (cell) { view = 'mirror'; syncNav(); return renderMirror(cell.dataset.date); }
    const del = e.target.closest('[data-delev]');
    if (del) {
      const { events } = await api('/api/events', { delete: Number(del.dataset.delev) });
      SERIES.events = events;
      return renderYear(year);
    }
  };

  $('#etalon').onchange = async e => {
    const v = Number(e.target.value);
    if (!Number.isFinite(v) || v < 0 || v > 10) return toast('Étalon hors 0..10');
    await saveSettings({ etalon: v });
    SERIES = await api('/api/series');
    CUMMODE = 'etalon';
    renderYear(year);
  };

  $('#evform').onsubmit = async e => {
    e.preventDefault();
    const date = $('#evdate').value, label = $('#evlabel').value.trim();
    if (!date || !label) return;
    try {
      const { events } = await api('/api/events', { date, label });
      SERIES.events = events;
      $('#evlabel').value = '';
      await renderYear(year);
      toast('Repère ajouté');
    } catch (err) { toast(err.message); }
  };
}

function gridMarkup(grid) {
  const today = S.today;
  return `<table class="grid">
    <tr><th></th>${Array.from({ length: 31 }, (_, i) => `<th>${i + 1}</th>`).join('')}<th></th></tr>
    ${grid.months.map(mo => `<tr>
      <th class="mo">${MONTHS_FR[mo.month - 1]}</th>
      ${mo.days.map(d => {
        if (!d) return '<td></td>';
        const has = d.note !== null && d.note !== undefined;
        return `<td class="cell${has ? ' has' : ''}${d.date === today ? ' today' : ''}"
          ${has ? `style="background:${deltaColor(d.delta)}" data-date="${d.date}"
          data-tip="${fmtDay(d.date)}\n${d.note}/10 · écart ${d.delta > 0 ? '+' : ''}${d.delta}"` : ''}></td>`;
      }).join('')}
      <td class="avg">${mo.avg ?? ''}</td>
    </tr>`).join('')}
  </table>`;
}

/* ============================= vue : miroir ============================= */

let MIRROR_DATE = null;

/** Surligne les termes qui ont fait matcher. Montrer POURQUOI ca ressort. */
function highlight(text, terms = []) {
  let out = esc(text);
  for (const t of terms) {
    const re = new RegExp(`(^|[^a-zà-ÿ])(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[a-zà-ÿ]*)`, 'gi');
    out = out.replace(re, '$1<mark>$2</mark>');
  }
  return out;
}

async function renderMirror(date) {
  if (!S.stats.days) return renderNoData('Le miroir a besoin de journées passées pour te montrer quoi que ce soit.');
  date = date ?? MIRROR_DATE ?? S.today;
  MIRROR_DATE = date;
  const m = await api(`/api/mirror?date=${date}`);
  const prev = dayShift(date, -1), next = dayShift(date, 1);
  const nav = `<div class="daynav">
      <button data-goto="${prev}" aria-label="Jour précédent">‹</button>
      <button data-goto="${next}" ${next > S.today ? 'disabled' : ''} aria-label="Jour suivant">›</button>
      ${date !== S.today ? `<button class="wide" data-goto="${S.today}">aujourd'hui</button>` : ''}
    </div>`;

  /* --- SPEC 4.1 : sous le plancher, aucune statistique. --- */
  if (m.floored) {
    $('#view').innerHTML = `
      <div class="card floorbox">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:5px">
          <h2 style="margin:0">Aujourd'hui, pas de chiffres</h2>
          <div style="margin-left:auto">${nav}</div>
        </div>
        <p class="sub" style="color:#c9a19b">
          Tu as noté ${m.note}/10. En dessous de ${m.floor.threshold}, cet outil ne sort aucune statistique.
          Un chiffre rassurant maintenant ne vaudrait rien.
        </p>
        <div class="helpline">
          Si tu as besoin de parler à quelqu'un maintenant : <b>3114</b>, gratuit, 24h/24, partout en France.
        </div>
      </div>
      ${m.yesterday.text ? `<div class="card">
        <h2>Hier</h2>
        <p class="serif" style="white-space:pre-wrap;font-size:15.5px;line-height:1.65;margin:0">${esc(m.yesterday.text)}</p>
      </div>` : ''}
      ${m.rawPast?.length ? `<div class="card">
        <h2>Ce que tu as écrit avant</h2>
        ${m.rawPast.map(p => `<div class="simitem">
          <div class="hd"><span class="d">${fmtDay(p.date)}</span></div>
          <p class="q">${esc(p.text)}</p>
        </div>`).join('')}
      </div>` : ''}
      ${!m.rawPast?.length && !m.yesterday.text ? `<div class="card" style="display:flex;align-items:center;gap:20px">
        <div style="width:76px;height:76px;flex:none">${petMarkup(S.settings)}</div>
        <div>
          <p style="margin:0 0 4px">Il n'y a rien d'écrit à te remontrer pour l'instant.</p>
          <p class="sub" style="margin:0 0 12px">Le miroir a besoin de tes mots pour servir à quelque chose. Il n'en a pas encore.</p>
          <button class="btn" id="backToChat">Écrire</button>
        </div>
      </div>` : ''}`;
    wireMirror();
    return;
  }

  const ep = m.episodes;
  let epCard;
  if (!ep || !ep.applicable) {
    epCard = `<div class="card"><h2>Preuve de résolution</h2>
      <p class="sub">${
        !m.note && m.note !== 0 ? 'Note ta journée pour que cette section ait un sens.'
        : `Tu es à ${m.note}/10, au niveau ou au-dessus de ta référence (${m.reference}). Il n'y a pas d'épisode à mesurer.`
      }</p></div>`;
  } else if (ep.insufficient) {
    epCard = `<div class="card"><h2>Preuve de résolution</h2>
      <p class="sub">Seulement ${ep.comparableCount} journée${ep.comparableCount > 1 ? 's' : ''} comparable${ep.comparableCount > 1 ? 's' : ''} dans ton historique.
      En dessous de ${ep.minComparable}, je n'ai rien à en tirer.</p></div>`;
  } else {
    epCard = `<div class="card">
      <h2>Preuve de résolution</h2>
      <p class="sub">
        <b>${ep.comparableCount}</b> épisodes à ${ep.note}/10 ou moins · retour au-dessus de la référence,
        tenu ${ep.sustain} jour${ep.sustain > 1 ? 's' : ''}${ep.censoredCount ? ` · <span class="faint">épisode en cours non compté</span>` : ''}
      </p>
      <div class="statgrid">
        <div class="s"><div class="k">Médiane</div><div class="v">${ep.medianDays}<span class="u"> jours</span></div></div>
        <div class="s"><div class="k">Sous 4 jours</div><div class="v">${Math.round(ep.shareUnder4 * 100)}<span class="u">%</span></div></div>
        <div class="s"><div class="k">Le plus long</div><div class="v">${ep.maxDays}<span class="u"> jours</span></div></div>
        <div class="s"><div class="k">Jamais remonté à ${ep.horizon}j</div>
          <div class="v" style="color:${ep.unresolvedCount ? 'var(--warn)' : 'var(--accent)'}">${ep.unresolvedCount}</div></div>
      </div>
      <p class="sub" style="margin:16px 0 0;font-size:12px">
        ${ep.beyondHorizonDays?.length ? `Parmi elles, ${ep.beyondHorizonDays.length} sont finalement remontées, au bout de ${ep.beyondHorizonDays.join(', ')} jours.` : ''}
      </p>
    </div>`;
  }

  const sim = m.similar;
  let simCard = '';
  if (sim?.items?.length) {
    simCard = `<div class="card">
      <h2>${sim.mode === 'text' ? 'Tu as déjà écrit ça' : 'Les autres fois à ' + m.note + '/10'}</h2>
      ${sim.mode === 'text' ? '' : `<p class="sub">Comparaison sur les notes, pas sur les mots.</p>`}
      ${sim.items.map(it => `<div class="simitem">
        <div class="hd">
          <span class="d">${fmtDay(it.date)}</span>
          <span class="pill">${it.note}/10</span>
          ${it.terms?.length ? `<span class="faint" style="font-size:11.5px">${it.terms.map(esc).join(' · ')}</span>` : ''}
        </div>
        ${it.text ? `<p class="q">${highlight(it.text.slice(0, 260), it.terms)}${it.text.length > 260 ? '…' : ''}</p>` : ''}
        ${bandMarkup(it.band)}
      </div>`).join('')}
    </div>`;
  }

  const y = m.yesterday;
  const yCard = `<div class="card">
    <h2>Hier</h2>
    ${y.text
      ? `<p class="serif" style="white-space:pre-wrap;font-size:15.5px;line-height:1.65;margin:0">${esc(y.text)}</p>`
      : `<p class="sub" style="margin:0">${y.note !== null ? `Noté ${y.note}/10, sans texte.` : 'Rien pour hier.'}</p>`}
  </div>`;

  $('#view').innerHTML = `
    <div class="card" style="display:flex;align-items:center;gap:22px;flex-wrap:wrap">
      <div>
        <div class="k faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.06em">${fmtDay(date)}</div>
        <div class="bignum" style="color:${m.note !== null ? deltaColor(m.delta) : 'var(--ink-faint)'}">
          ${m.note ?? '—'}<span style="font-size:16px;color:var(--ink-faint)">/10</span>
        </div>
      </div>
      <div class="statgrid" style="flex:1;min-width:220px">
        <div class="s"><div class="k">Référence glissante</div><div class="v">${m.reference ?? '—'}</div></div>
        <div class="s"><div class="k">Écart</div><div class="v">${m.delta > 0 ? '+' : ''}${m.delta ?? '—'}</div></div>
        <div class="s"><div class="k">Corpus texte</div><div class="v">${m.textCount ?? 0}<span class="u"> jours</span></div></div>
      </div>
      ${nav}
    </div>
    ${epCard}${simCard}${yCard}`;
  wireMirror();
}

function wireMirror() {
  $('#view').onclick = e => {
    const g = e.target.closest('[data-goto]');
    if (g) return renderMirror(g.dataset.goto);
    if (e.target.closest('#backToChat')) return go('tonight');
  };
}

/* ============================= vue : réglages ============================= */

async function renderSettings() {
  const s = S.settings;

  $('#view').innerHTML = `
    <div class="row">
      <div class="card">
        <h2>Le compagnon</h2>
        <p class="sub">Change sa tête et son nom. Il n'a accès à aucune de tes statistiques.</p>
        <label class="field"><span>Nom</span>
          <input type="text" id="petName" value="${esc(s.petName)}"></label>
        <label class="field"><span>Apparence</span></label>
        <div class="spritepick" id="spritepick">
          ${Object.entries(PETS).map(([k, p]) => `
            <button data-sprite="${k}" aria-pressed="${s.petSprite === k}" data-tip="${esc(p.name)}">${p.svg}</button>`).join('')}
          ${s.petImage ? `<button data-sprite="custom" aria-pressed="${s.petSprite === 'custom'}" data-tip="ton image"><img src="${s.petImage}"></button>` : ''}
        </div>
        <label class="field" style="margin-top:14px"><span>Ou charge ton PNG</span>
          <input type="file" id="petFile" accept="image/png,image/jpeg,image/webp,image/gif"></label>
      </div>

      <div class="card">
        <h2>La voix</h2>
        <p class="sub">Un blip par syllabe. Pas de synthèse vocale.</p>
        <label class="field"><span>
          <input type="checkbox" id="blipEnabled" ${s.blipEnabled ? 'checked' : ''} style="width:auto;margin-right:7px">
          Le compagnon fait du bruit quand il parle</span></label>
        <div class="voicepick" id="voicepick">
          ${VOICES.map(v => `<button data-voice="${v.id}" aria-pressed="${s.blipVoice === v.id}">
            <b>${esc(v.name)}</b><span>${esc(v.hint)}</span></button>`).join('')}
        </div>
        <div class="row" style="gap:11px;margin-top:14px">
          <label class="field"><span>Hauteur <b class="mono" id="bp">${s.blipPitch}</b></span>
            <input type="range" id="blipPitch" min=".6" max="1.6" step=".05" value="${s.blipPitch}"></label>
          <label class="field"><span>Volume <b class="mono" id="bv">${Math.round(s.blipVolume * 100)}%</b></span>
            <input type="range" id="blipVolume" min="0" max="1" step=".05" value="${s.blipVolume}"></label>
        </div>
        <p class="sub" style="margin:0;font-size:12px">Clique un timbre pour l'écouter.</p>
      </div>
    </div>

    <div class="card">
      <h2>Le modèle</h2>
      <p class="sub">Par défaut, aucun modèle : les relances sont scriptées et rien ne quitte cette machine.</p>
      <label class="field"><span>Backend</span>
        <select id="chatBackend">
          <option value="scripted" ${s.chatBackend === 'scripted' ? 'selected' : ''}>Aucun modèle — relances scriptées (hors-ligne)</option>
          <option value="anthropic" ${s.chatBackend === 'anthropic' ? 'selected' : ''}>Claude (API Anthropic)</option>
          <option value="ollama" ${s.chatBackend === 'ollama' ? 'selected' : ''}>Ollama local</option>
        </select></label>
      <div id="backendCfg"></div>
    </div>

    <div class="row">
      <div class="card">
        <h2>Le plancher</h2>
        <p class="sub">Sous ce seuil, aucune statistique n'est affichée. Uniquement tes entrées passées, brutes.</p>
        <label class="field"><span>Mode</span>
          <select id="floorMode">
            <option value="fixed" ${s.floorMode === 'fixed' ? 'selected' : ''}>Seuil fixe</option>
            <option value="relative" ${s.floorMode === 'relative' ? 'selected' : ''}>Relatif (référence − 3)</option>
          </select></label>
        <label class="field"><span>Seuil fixe</span>
          <input type="number" id="floor" min="0" max="10" step="1" value="${s.floor}"></label>
      </div>

      <div class="card">
        <h2>Le retour à la référence</h2>
        <p class="sub">Combien de jours consécutifs au-dessus de la référence comptent comme une vraie remontée.</p>
        <label class="field"><span>Tenue exigée <b class="mono" id="sv">${s.sustain}</b> jour${s.sustain > 1 ? 's' : ''}</span>
          <input type="range" id="sustain" min="1" max="5" step="1" value="${s.sustain}"></label>
      </div>

      <div class="card">
        <h2>Importer un historique</h2>
        <p class="sub">L'export d'une grille annuelle depuis un tableur : une ligne par mois,
          les notes en colonnes 1 à 31. Les repères d'étalonnage présents dans la feuille sont
          récupérés au passage.</p>
        <label class="field"><span>Fichier CSV</span>
          <input type="file" id="csvFile" accept=".csv,text/csv,text/plain"></label>
        <div id="importReport"></div>
      </div>

      <div class="card">
        <h2>Coller des notes déjà écrites</h2>
        <p class="sub">Les notes du tableur donnent les chiffres ; celles-ci donnent les mots.</p>
        <p class="sub" style="font-size:12.5px">
          Chaque journée commence par une date sur sa propre ligne, puis le texte en dessous.
          <span class="mono">2024-03-12</span>, <span class="mono">12/03/2024</span> ou
          <span class="mono">12 mars 2024</span> — le jour avant le mois. Ce qui précède la
          première date est ignoré.
        </p>
        <textarea id="notesPaste" rows="8" placeholder="12 mars 2024&#10;Nuit blanche, je tourne en rond…&#10;&#10;13 mars 2024&#10;Un peu mieux."
          style="width:100%;resize:vertical;background:var(--panel-2);border:1px solid var(--line);
                 border-radius:var(--r);padding:10px 12px;font:13.5px/1.6 var(--sans)"></textarea>
        <div style="display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap">
          <button class="btn" id="scanNotes">Analyser</button>
          <span class="sub" style="margin:0">Rien n'est écrit avant que tu aies vu le résultat.</span>
        </div>
        <div id="notesReport"></div>
      </div>

      <div class="card">
        <h2>Tes données</h2>
        <p class="sub">${S.stats.days} journées notées · ${S.stats.textDays} avec du texte · ${esc(S.stats.firstDate)} → ${esc(S.stats.lastDate)}</p>
        <p class="sub" style="font-size:12.5px">
          Tout est dans un fichier SQLite sur ce disque. Aucun compte, aucun serveur, aucune synchro.
        </p>
        <div style="display:flex;gap:9px;flex-wrap:wrap">
          <button class="btn" id="export">Exporter en JSON</button>
          <form method="post" action="/logout" style="margin:0"><button class="btn" type="submit">Se déconnecter</button></form>
        </div>
      </div>
    </div>`;

  renderBackendCfg();

  const bind = (id, key, ev = 'change', get = el => el.value) =>
    $('#' + id)?.addEventListener(ev, async e => { await saveSettings({ [key]: get(e.target) }); });

  bind('petName', 'petName', 'change');
  bind('floorMode', 'floorMode');
  bind('floor', 'floor', 'change', el => Number(el.value));
  bind('blipEnabled', 'blipEnabled', 'change', el => el.checked);
  $('#sustain')?.addEventListener('change', async e => { await saveSettings({ sustain: Number(e.target.value) }); renderSettings(); });

  $('#voicepick')?.addEventListener('click', async e => {
    const b = e.target.closest('[data-voice]');
    if (!b) return;
    await saveSettings({ blipVoice: b.dataset.voice });
    for (const x of $('#voicepick').children) x.setAttribute('aria-pressed', String(x === b));
    Blip.preview(b.dataset.voice, S.settings);      // le clic autorise l'audio
  });
  $('#blipPitch')?.addEventListener('input', async e => {
    $('#bp').textContent = e.target.value;
    await saveSettings({ blipPitch: Number(e.target.value) });
  });
  $('#blipPitch')?.addEventListener('change', () => Blip.preview(S.settings.blipVoice, S.settings));
  $('#blipVolume')?.addEventListener('input', async e => {
    $('#bv').textContent = Math.round(e.target.value * 100) + '%';
    await saveSettings({ blipVolume: Number(e.target.value) });
  });
  $('#blipVolume')?.addEventListener('change', () => Blip.preview(S.settings.blipVoice, S.settings));

  // Surtout PAS renderSettings() ici : il reconstruit l'innerHTML de la vue,
  // donc détruit et recrée le <select> pendant que son menu natif est encore
  // ouvert. Le navigateur rouvrait alors le popup sur l'élément neuf, la
  // sélection repartait, et le menu clignotait sans fin. On ne redessine que
  // le bloc qui dépend réellement du choix.
  $('#chatBackend').addEventListener('change', async e => {
    await saveSettings({ chatBackend: e.target.value });
    renderBackendCfg();
  });

  $('#spritepick').addEventListener('click', async e => {
    const b = e.target.closest('[data-sprite]');
    if (!b) return;
    await saveSettings({ petSprite: b.dataset.sprite });
    renderSettings();
  });

  $('#petFile').addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 3 * 1024 * 1024) return toast('Image trop lourde (max 3 Mo)');
    const r = new FileReader();
    r.onload = async () => {
      await saveSettings({ petImage: r.result, petSprite: 'custom' });
      renderSettings();
      toast('Compagnon mis à jour');
    };
    r.readAsDataURL(f);
  });

  $('#scanNotes')?.addEventListener('click', async e => {
    // capture AVANT le await : le DOM vide currentTarget des que le handler rend
    // la main, ce qui arrive au premier await d'une fonction async.
    const b = e.currentTarget;
    const texte = $('#notesPaste')?.value ?? '';
    if (!texte.trim()) { toast('Colle d\'abord tes notes.'); return; }
    b.disabled = true; b.textContent = 'Analyse…';
    try {
      const r = await api('/api/import-notes', { text: texte });
      NOTES_PASTE = texte;
      drawNotesPreview(r.preview);
    } catch (err) {
      $('#notesReport').innerHTML = `<p class="sub" style="color:var(--warn);margin:12px 0 0">${esc(err.message)}</p>`;
    } finally {
      b.disabled = false; b.textContent = 'Analyser';
    }
  });

  $('#csvFile')?.addEventListener('change', async e => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) return toast('Fichier trop lourd (max 8 Mo)');
    let csv;
    try { csv = await f.text(); } catch (err) { return toast('Lecture impossible'); }
    IMPORT_CSV = csv;
    const box = $('#importReport');
    box.innerHTML = '<p class="sub" style="margin:12px 0 0">Analyse…</p>';
    try {
      const { preview } = await api('/api/import', { csv });
      drawImportPreview(preview);
    } catch (err) {
      box.innerHTML = `<p class="sub" style="margin:12px 0 0;color:var(--danger)">${esc(err.message)}</p>`;
    }
  });

  $('#export').addEventListener('click', async () => {
    const data = await api('/api/export');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `braindebugger-${S.today}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

async function renderBackendCfg() {
  const s = S.settings;
  const el = $('#backendCfg');
  if (!el) return;

  // Ce qui sort de la machine doit être relu à chaque changement de backend,
  // pas une seule fois à la première lecture : il vit donc dans le bloc qui se
  // redessine, pas dans le markup figé de la vue.
  const SORTIE_ANTHROPIC = `<p class="sub" style="margin:12px 0 0;font-size:12.5px;color:var(--warn)">
    Dans ce mode, <b>le texte de tes conversations part chez Anthropic</b>. Tes notes, tes
    statistiques et tes journées chiffrées ne bougent pas : le Miroir est du calcul et
    de la recherche, il ne fait aucun appel réseau. Seul ce que tu écris dans le chat sort d'ici.
  </p>`;

  if (s.chatBackend === 'anthropic') {
    let info = { models: [], hasEnvKey: false };
    try { info = await api('/api/models'); } catch { /* ignoré */ }
    el.innerHTML = `<div class="row">
      <label class="field"><span>Modèle</span>
        <select id="anthropicModel">
          ${info.models.map(m => `<option value="${esc(m.id)}" ${m.id === s.anthropicModel ? 'selected' : ''}>${esc(m.label)} — ${esc(m.note)}</option>`).join('')}
        </select></label>
      <label class="field"><span>Effort</span>
        <select id="anthropicEffort">
          <option value="low" ${s.anthropicEffort === 'low' ? 'selected' : ''}>bas — répond vite</option>
          <option value="medium" ${s.anthropicEffort === 'medium' ? 'selected' : ''}>moyen</option>
          <option value="high" ${s.anthropicEffort === 'high' ? 'selected' : ''}>élevé — réfléchit plus, répond moins vite</option>
        </select></label>
    </div>
    <div class="field">
      <span>Clé API</span>
      <div class="keystate ${s.keySource}">
        ${s.keySource === 'env'
          ? `<b>Fournie par l'environnement</b> — variable <code>ANTHROPIC_API_KEY</code>. Rien à faire.
             ${s.hasStoredKey ? `Une clé traîne aussi en base ; elle est ignorée.
               <button class="btn" id="clearKey" style="padding:2px 9px;font-size:11.5px;margin-left:6px">l'effacer</button>` : ''}`
          : s.keySource === 'stored'
            ? `<b>Enregistrée dans l'app</b> — elle n'est jamais renvoyée au navigateur.
               <button class="btn" id="clearKey" style="padding:2px 9px;font-size:11.5px;margin-left:6px">effacer</button>`
            : `<b>Aucune clé</b> — le compagnon reste en mode hors-ligne.`}
      </div>
      <input type="password" id="apiKey" value="" autocomplete="off"
        placeholder="${s.keySource === 'none' ? 'sk-ant-… — colle ta clé ici' : 'sk-ant-… — pour la remplacer'}">
      <p class="faint" style="font-size:11.5px;margin:6px 0 0">
        Sur un serveur, préfère la variable d'environnement : la clé ne passe alors jamais par la base,
        et elle l'emporte sur toute clé collée ici — sur une instance à plusieurs comptes, c'est celle
        de l'hébergeur qui doit servir. Sans variable, la clé collée ici prend le relais.
      </p>
      <div style="display:flex;align-items:center;gap:10px;margin-top:11px;flex-wrap:wrap">
        <button class="btn" id="testKey">Tester la clé</button>
        <span id="keyResult" class="sub" style="margin:0"></span>
      </div>
    </div>
    <label class="field"><span>Mémoire — <b class="mono">${s.memoryDays}</b> journée${s.memoryDays > 1 ? 's' : ''} passée${s.memoryDays > 1 ? 's' : ''} transmise${s.memoryDays > 1 ? 's' : ''}</span>
      <input type="range" id="memoryDays" min="0" max="30" step="1" value="${s.memoryDays}"></label>
    <p class="sub" style="margin:0;font-size:12px">
      Ce qui donne la continuité : sans mémoire, il repart de zéro chaque soir. Seul le
      <b>texte</b> de ces journées est transmis — jamais tes notes, jamais tes statistiques.
      À 0, il ne connaît que la conversation du jour.
    </p>` + SORTIE_ANTHROPIC;
  } else if (s.chatBackend === 'ollama') {
    el.innerHTML = `<div class="row">
      <label class="field"><span>URL Ollama</span><input type="text" id="ollamaUrl" value="${esc(s.ollamaUrl)}"></label>
      <label class="field"><span>Modèle</span><input type="text" id="ollamaModel" value="${esc(s.ollamaModel)}"></label>
    </div>`;
  } else if (s.chatBackend === 'openai') {
    el.innerHTML = `<div class="row">
      <label class="field"><span>URL de base</span><input type="text" id="apiUrl" placeholder="https://api.exemple.com/v1" value="${esc(s.apiUrl)}"></label>
      <label class="field"><span>Modèle</span><input type="text" id="apiModel" value="${esc(s.apiModel)}"></label>
    </div>
    <label class="field"><span>Clé API</span><input type="password" id="apiKey" value="${esc(s.apiKey)}"></label>`;
  } else { el.innerHTML = ''; return; }

  for (const id of ['ollamaUrl', 'ollamaModel', 'anthropicModel', 'anthropicEffort']) {
    $('#' + id)?.addEventListener('change', async e => { await saveSettings({ [id]: e.target.value }); });
  }
  // Le champ est vide en permanence : une chaine vide ne doit pas effacer la
  // cle enregistree. L'effacement passe par le bouton.
  $('#apiKey')?.addEventListener('change', async e => {
    const v = e.target.value.trim();
    if (!v) return;
    await saveSettings({ apiKey: v });
    e.target.value = '';
    renderSettings();
    toast('Clé enregistrée');
  });
  $('#testKey')?.addEventListener('click', async e => {
    const b = e.currentTarget, out = $('#keyResult');
    b.disabled = true; b.textContent = 'Test…'; out.textContent = '';
    try {
      const r = await api('/api/test-key', {});
      out.innerHTML = r.ok
        ? `<span style="color:var(--accent)">✓ ${esc(r.displayName ?? r.model)} accessible</span>`
        : `<span style="color:var(--danger)">${esc(r.reason)}</span>`;
    } catch (err) {
      out.innerHTML = `<span style="color:var(--danger)">${esc(err.message)}</span>`;
    } finally {
      b.disabled = false; b.textContent = 'Tester la clé';
    }
  });

  $('#clearKey')?.addEventListener('click', async () => {
    await saveSettings({ apiKey: '', clearKey: true });
    renderSettings();
    toast('Clé effacée');
  });
  $('#memoryDays')?.addEventListener('change', async e => {
    await saveSettings({ memoryDays: Number(e.target.value) });
    renderSettings();
  });
}

/* --------- import d'un historique tableur --------- */

let IMPORT_CSV = null;

/**
 * Aperçu avant écriture. On montre ce qui va se passer — et surtout combien de
 * journées existantes seraient écrasées — plutôt que de demander de faire
 * confiance à un choix de fichier.
 */
function drawImportPreview(p) {
  const box = $('#importReport');
  if (!box) return;
  box.innerHTML = `
    <div style="border-top:1px solid var(--line-soft);margin-top:14px;padding-top:14px">
      <div class="statgrid" style="margin-bottom:14px">
        <div><div class="k">Journées lues</div><div class="v">${p.total}</div></div>
        <div><div class="k">Nouvelles</div><div class="v" style="color:var(--accent)">${p.added}</div></div>
        <div><div class="k">Écrasées</div><div class="v" style="color:${p.overwrite ? 'var(--warn)' : 'var(--ink)'}">${p.overwrite}</div></div>
        <div><div class="k">Identiques</div><div class="v">${p.unchanged}</div></div>
      </div>
      <p class="sub" style="margin:0 0 10px">
        <span class="mono">${esc(p.first)}</span> → <span class="mono">${esc(p.last)}</span>
      </p>
      <div style="display:flex;flex-direction:column;gap:1px;margin-bottom:12px">
        ${p.years.map(y => `<div style="display:flex;gap:12px;padding:5px 0;border-top:1px solid var(--line-soft);font-size:13px">
          <span class="mono" style="flex:0 0 46px">${esc(y.year)}</span>
          <span class="muted" style="flex:0 0 84px">${y.count} jours</span>
          <span class="mono muted">moyenne ${y.avg}</span>
        </div>`).join('')}
      </div>
      ${p.anchors.length ? `<p class="sub" style="margin:0 0 8px">Repères d'étalonnage trouvés :</p>
        <div class="anchors" style="margin:0 0 14px">
          ${p.anchors.map(a => `<div class="anchor">
            <span class="n" style="background:rgb(${noteScaleRGB(a.note)})">${a.note}</span>
            <span class="l"><b>${esc(a.label)}</b> — ${esc(a.descr)}</span></div>`).join('')}
        </div>` : ''}
      ${p.overwrite ? `<p class="sub" style="color:var(--warn);margin:0 0 12px">
        ${p.overwrite} journée${p.overwrite > 1 ? 's' : ''} déjà notée${p.overwrite > 1 ? 's' : ''} ${p.overwrite > 1 ? 'seront remplacées' : 'sera remplacée'} par la valeur du fichier.</p>` : ''}
      <button class="btn primary" id="doImport">Importer ${p.total} journées</button>
    </div>`;

  $('#doImport').onclick = async e => {
    const b = e.currentTarget;
    b.disabled = true;
    b.textContent = 'Import…';
    try {
      const r = await api('/api/import', { csv: IMPORT_CSV, apply: true });
      S = await api('/api/state');
      syncHeader();
      SERIES = null;                 // la série complète doit être rechargée
      IMPORT_CSV = null;
      renderSettings();
      toast(`${r.imported} journées importées`);
    } catch (err) {
      b.disabled = false;
      b.textContent = 'Réessayer';
      toast(err.message);
    }
  };
}

let NOTES_PASTE = null;

/**
 * Aperçu des notes collées. Même règle que pour le CSV : on montre ce qui va
 * être écrit avant de l'écrire. Ici l'enjeu n'est pas l'écrasement — rien n'est
 * remplacé — mais la date : un bloc rangé sous le mauvais jour ferait rendre au
 * miroir des mots qui n'ont pas été écrits ce jour-là. C'est pour ça que chaque
 * date interprétée est affichée en clair.
 */
function drawNotesPreview(p) {
  const box = $('#notesReport');
  if (!box) return;

  const teinte = { nouvelle: 'var(--accent)', ajout: 'var(--warn)', identique: 'var(--ink-faint)' };
  const mot = { nouvelle: 'nouvelle', ajout: 'ajout', identique: 'déjà là' };

  box.innerHTML = `
    <div style="border-top:1px solid var(--line-soft);margin-top:14px;padding-top:14px">
      <div class="statgrid" style="margin-bottom:14px">
        <div><div class="k">Journées</div><div class="v">${p.total}</div></div>
        <div><div class="k">Nouvelles</div><div class="v" style="color:var(--accent)">${p.nouvelles}</div></div>
        <div><div class="k">Ajouts</div><div class="v" style="color:${p.ajouts ? 'var(--warn)' : 'var(--ink)'}">${p.ajouts}</div></div>
        <div><div class="k">Déjà là</div><div class="v">${p.identiques}</div></div>
      </div>
      <p class="sub" style="margin:0 0 10px">
        <span class="mono">${esc(p.first)}</span> → <span class="mono">${esc(p.last)}</span>
        · ${p.mots} mots
      </p>
      ${p.ignore ? `<p class="sub" style="margin:0 0 10px;color:var(--ink-faint)">
        Ignoré, avant la première date : <i>${esc(p.ignore)}</i></p>` : ''}
      <div style="display:flex;flex-direction:column;gap:1px;margin-bottom:12px;max-height:260px;overflow-y:auto">
        ${p.apercu.map(a => `<div style="display:flex;gap:12px;padding:6px 0;border-top:1px solid var(--line-soft);font-size:13px;align-items:baseline">
          <span class="mono" style="flex:0 0 88px">${esc(a.date)}</span>
          <span style="flex:0 0 60px;font-size:11.5px;color:${teinte[a.etat]}">${mot[a.etat]}</span>
          <span class="muted" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.extrait)}</span>
        </div>`).join('')}
      </div>
      ${p.nouvelles + p.ajouts
        ? `<button class="btn primary" id="doNotes">Ajouter ${p.nouvelles + p.ajouts} journée${p.nouvelles + p.ajouts > 1 ? 's' : ''} au miroir</button>`
        : `<p class="sub" style="margin:0">Tout est déjà dans le miroir. Rien à ajouter.</p>`}
    </div>`;

  $('#doNotes')?.addEventListener('click', async e => {
    const b = e.currentTarget;
    b.disabled = true; b.textContent = 'Ajout…';
    try {
      const r = await api('/api/import-notes', { text: NOTES_PASTE, apply: true });
      S = await api('/api/state');
      syncHeader();
      SERIES = null;
      NOTES_PASTE = null;
      renderSettings();
      toast(`${r.imported.journees} journées ajoutées au miroir`);
    } catch (err) {
      b.disabled = false; b.textContent = 'Réessayer';
      toast(err.message);
    }
  });
}

/* ============================= routage ============================= */

const VIEWS = {
  tonight: renderTonight,
  year: () => renderYear(),
  mirror: () => renderMirror(),
  settings: renderSettings
};

function syncNav() {
  for (const b of document.querySelectorAll('nav button')) {
    b.setAttribute('aria-current', String(b.dataset.view === view));
  }
}

async function go(v) {
  view = v;
  syncNav();
  $('#view').onclick = null;
  PetTalk.stop();
  $('#view').innerHTML = '<div class="empty">…</div>';
  try { await VIEWS[v](); }
  catch (err) { $('#view').innerHTML = `<div class="card"><h2>Erreur</h2><p class="sub">${esc(err.message)}</p></div>`; }
}

/**
 * Ouverture et fermeture de la fenêtre, signalées au serveur.
 *
 * Sans ça, le compagnon traite pareil quelqu'un qui ferme et rouvre deux
 * minutes plus tard et quelqu'un qui revient après trois semaines : dans un cas
 * il redit bonjour au milieu d'une phrase, dans l'autre il enchaîne comme si de
 * rien n'était.
 *
 * La fermeture part par sendBeacon : un fetch classique est annulé quand la
 * page meurt, c'est exactement le moment où on veut l'envoyer. Et sur
 * `pagehide` plutôt que `beforeunload`, seul événement fiable sur mobile — un
 * onglet mis en arrière-plan puis tué ne déclenche jamais `beforeunload`.
 */
function suivreSession() {
  api('/api/session', {}).catch(() => { /* sans effet sur l'usage */ });
  const fermer = () => {
    try {
      navigator.sendBeacon?.('/api/session',
        new Blob([JSON.stringify({ close: true })], { type: 'application/json' }));
    } catch { /* le navigateur part, tant pis */ }
  };
  addEventListener('pagehide', fermer);
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') fermer(); });
}

async function boot() {
  S = await api('/api/state');
  suivreSession();
  document.querySelector('nav').addEventListener('click', e => {
    const b = e.target.closest('button[data-view]');
    if (b) go(b.dataset.view);
  });
  syncHeader();
  syncGauge();

  $('#gauge')?.addEventListener('click', e => { e.stopPropagation(); toggleGauge(); });
  document.addEventListener('click', e => {
    if (!$('#gaugePanel').hidden && !e.target.closest('#gaugePanel') && !e.target.closest('#gauge')) toggleGauge(false);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') toggleGauge(false); });

  go('tonight');
}

boot();
