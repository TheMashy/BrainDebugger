import { PETS, petMarkup } from './pets.js';
import { toPNG, PetTalk } from './pet.js';
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

/* --------- voix (Web Speech API, 100% navigateur) --------- */
const Voice = {
  list: [],
  load() {
    this.list = speechSynthesis.getVoices();
    return this.list;
  },
  speak(text) {
    if (!S?.settings.voiceEnabled || !window.speechSynthesis) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = this.list.find(x => x.voiceURI === S.settings.voiceURI);
    if (v) u.voice = v;
    u.lang = v?.lang ?? 'fr-FR';
    u.rate = S.settings.voiceRate ?? 1;
    u.pitch = S.settings.voicePitch ?? 1;
    speechSynthesis.speak(u);
  }
};
if (window.speechSynthesis) {
  Voice.load();
  speechSynthesis.onvoiceschanged = () => Voice.load();
}

function syncHeader() {
  $('#dayline').textContent = `${S.stats.days} jours · ${S.stats.firstDate} → ${S.stats.lastDate}`;
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
      <div class="card petcard">
        <div class="art" id="art" tabindex="0" role="button"
             aria-label="Changer l'image du compagnon">${petMarkup(s)}</div>
        <input type="file" id="petPick" accept="image/*" hidden>
        <div class="name">${esc(s.petName)}</div>
        <div class="role">il écoute, il ne note pas</div>
        <div style="margin-top:13px;display:flex;flex-direction:column;gap:7px;align-items:center">
          <button class="voicetoggle" id="voiceBtn" aria-pressed="${s.voiceEnabled}">
            <span class="ico"></span>${s.voiceEnabled ? 'il parle' : 'muet'}
          </button>
          <span class="pill">${S.stats.streak} jour${S.stats.streak > 1 ? 's' : ''} d'affilée</span>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <h2>${fmtDay(t)}</h2>
          <p class="sub">Raconte comme ça vient. Tes mots sont enregistrés tels quels.</p>
          <div class="thread" id="thread"></div>
          <div class="composer">
            <textarea id="input" rows="1" placeholder="Écris ici…" aria-label="Ton message"></textarea>
            <button class="btn primary" id="send">Envoyer</button>
          </div>
        </div>

        <div id="echoes"></div>

        <div class="card notecard">
          <div class="head">
            <h2>La note d'aujourd'hui</h2>
            <span class="ritual">Note avant de te coucher.</span>
          </div>
          <p class="sub">C'est dans le lit qu'on voit le mieux la journée entière — et c'est toi qui notes,
            jamais ${esc(s.petName)}.</p>

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
          <div class="scaleends"><span>0 · le pire</span><span>5 · moyen</span><span>10 · le meilleur</span></div>

          ${S.anchors.length ? `<div class="anchors">
            ${S.anchors.map(a => `<div class="anchor">
              <span class="n" style="background:rgb(${noteScaleRGB(a.note)})">${a.note}</span>
              <span class="l"><b>${esc(a.label)}</b> — ${esc(a.descr)}</span></div>`).join('')}
            <p class="faint" style="font-size:11.5px;margin:8px 0 0">
              Tes propres repères. Ils gardent l'échelle stable d'une année sur l'autre.</p>
          </div>` : ''}
        </div>
      </div>
    </div>`;

  drawThread();
  drawEchoes();

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

  $('#voiceBtn').onclick = async e => {
    // capture AVANT le await : le DOM vide currentTarget des que le handler rend
    // la main, ce qui arrive au premier await d'une fonction async.
    const b = e.currentTarget;
    const on = !S.settings.voiceEnabled;
    await saveSettings({ voiceEnabled: on });
    b.setAttribute('aria-pressed', String(on));
    b.innerHTML = `<span class="ico"></span>${on ? 'il parle' : 'muet'}`;
    if (on) Voice.speak(`Bonjour, moi c'est ${S.settings.petName}.`);
    else if (window.speechSynthesis) speechSynthesis.cancel();
  };

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
  ? 'background:var(--panel-3);color:var(--ink-faint)'
  : `background:rgb(${noteScaleRGB(n)});color:#08110c`;

function noteSay(n) {
  if (n === null || n === undefined) return "Tu n'as pas encore noté cette journée.";
  const a = S.anchors.find(x => x.note === n);
  if (a) return `<b>${esc(a.label)}</b> — ${esc(a.descr)}`;
  const near = S.anchors.filter(x => x.note < n).sort((x, y) => y.note - x.note)[0];
  return near ? `Au-dessus de <b>${esc(near.label)}</b> (${near.note}).` : `Noté ${n} sur 10.`;
}

function drawThread() {
  const th = $('#thread');
  if (!th) return;
  if (!S.messages.length) {
    th.innerHTML = `<div class="empty">Rien pour aujourd'hui.<br>Écris un mot, ${esc(S.settings.petName)} répondra.</div>`;
    return;
  }
  th.innerHTML = S.messages.map(m =>
    `<div class="msg ${m.role}"><span class="tx">${esc(m.text)}</span><span class="t">${fmtTime(m.ts)}</span></div>`
  ).join('');
  th.scrollTop = th.scrollHeight;
}

async function send() {
  const input = $('#input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  $('#send').disabled = true;
  PetTalk.stop();

  // affichage optimiste : ce que tu ecris apparait tout de suite
  S.messages.push({ ts: new Date().toISOString(), role: 'user', text });
  drawThread();
  refreshEchoes(text);

  try {
    const r = await api('/api/message', { text, date: S.today });
    S.messages = r.messages;
    drawThread();
    if (r.degraded) toast(`Modèle injoignable — repli hors-ligne (${r.degraded.slice(0, 60)})`);

    const last = r.messages[r.messages.length - 1];
    if (last?.role === 'pet') {
      const bubble = $('#thread')?.lastElementChild?.querySelector('.tx');
      const art = $('#art');
      if (bubble) {
        bubble.textContent = '';
        await PetTalk.say(art, bubble, last.text, { speak: S.settings.voiceEnabled, voice: Voice });
        $('#thread').scrollTop = $('#thread').scrollHeight;
      }
    }
  } catch (err) {
    toast(String(err.message));
  } finally {
    const b = $('#send');
    if (b) b.disabled = false;
    $('#input')?.focus();
  }
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
    <p class="sub">Remonté tout seul pendant que tu écris. La bande montre les 14 jours qui ont suivi,
      tels qu'ils ont été. Le jour cerclé est le retour à la référence.</p>
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
          <span style="margin-left:12px">écart à la référence glissante, saturé à ±${SATURATION}</span>
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
        <p class="sub">Ta formule <span class="mono">signe(n−5)·(n−5)²/2,5</span>, jour par jour.
          Une journée à 6 pèse <span class="mono">0,4</span>, une journée à 9 pèse <span class="mono">6,4</span> :
          l'expansion quadratique écrase le milieu et fait sortir les extrêmes. Pas de cumul ici.</p>
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
        <p class="sub">Somme courante de <span class="mono">note − étalon</span> — l'écart <b>linéaire</b>, pas le carré.
          La pente se lit directement : elle monte quand la période est au-dessus de l'étalon.</p>
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
        <p class="sub">Déménagement, rupture, nouveau boulot, arrêt d'un traitement. Ils apparaissent en pointillés
          sur les deux courbes. Sans eux, une inflexion n'est qu'une inflexion.</p>
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
        <p class="sub">Sans commentaire, sans résumé.</p>
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
          <button class="btn" id="backToChat">Parler à ${esc(S.settings.petName)}</button>
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
        Les <b>${ep.comparableCount}</b> fois où tu es descendu à ${ep.note}/10 ou moins, voilà combien de temps
        il a fallu pour remonter au-dessus de ta référence — et pour y rester ${ep.sustain} jours.
        ${ep.censoredCount ? `<br><span class="faint">L'épisode en cours n'est pas compté : il n'a pas encore assez de recul pour être jugé.</span>` : ''}
      </p>
      <div class="statgrid">
        <div class="s"><div class="k">Médiane</div><div class="v">${ep.medianDays}<span class="u"> jours</span></div></div>
        <div class="s"><div class="k">Sous 4 jours</div><div class="v">${Math.round(ep.shareUnder4 * 100)}<span class="u">%</span></div></div>
        <div class="s"><div class="k">Le plus long</div><div class="v">${ep.maxDays}<span class="u"> jours</span></div></div>
        <div class="s"><div class="k">Jamais remonté à ${ep.horizon}j</div>
          <div class="v" style="color:${ep.unresolvedCount ? 'var(--warn)' : 'var(--accent)'}">${ep.unresolvedCount}</div></div>
      </div>
      <p class="sub" style="margin:16px 0 0;font-size:12px">
        La dernière colonne est la moitié honnête du chiffre. Sans elle, on ne montrerait que les fois où ça s'est arrangé.
        ${ep.beyondHorizonDays?.length ? `Parmi elles, ${ep.beyondHorizonDays.length} sont finalement remontées, au bout de ${ep.beyondHorizonDays.join(', ')} jours.` : ''}
      </p>
    </div>`;
  }

  const sim = m.similar;
  let simCard = '';
  if (sim?.items?.length) {
    simCard = `<div class="card">
      <h2>${sim.mode === 'text' ? 'Tu as déjà écrit ça' : 'Les autres fois à ' + m.note + '/10'}</h2>
      <p class="sub">${sim.mode === 'text'
        ? 'Recherche sur ton propre corpus. La bande montre les 14 jours qui ont suivi, tels qu\'ils ont été. Le jour cerclé est le retour à la référence.'
        : 'Pas encore assez de texte écrit pour comparer les mots — je compare les chiffres. La bande montre les 14 jours qui ont suivi. Le jour cerclé est le retour à la référence.'}</p>
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
  const voices = Voice.load();

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
        <p class="sub">Synthèse du navigateur. Rien n'est envoyé nulle part.</p>
        <label class="field"><span>
          <input type="checkbox" id="voiceEnabled" ${s.voiceEnabled ? 'checked' : ''} style="width:auto;margin-right:7px">
          Lire les réponses à voix haute</span></label>
        <label class="field"><span>Voix (${voices.length} disponibles)</span>
          <select id="voiceURI">
            <option value="">— par défaut —</option>
            ${voices.map(v => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === s.voiceURI ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('')}
          </select></label>
        <div class="row" style="gap:11px">
          <label class="field"><span>Débit <b class="mono" id="rv">${s.voiceRate}</b></span>
            <input type="range" id="voiceRate" min=".6" max="1.6" step=".05" value="${s.voiceRate}"></label>
          <label class="field"><span>Hauteur <b class="mono" id="pv">${s.voicePitch}</b></span>
            <input type="range" id="voicePitch" min=".5" max="1.8" step=".05" value="${s.voicePitch}"></label>
        </div>
        <button class="btn" id="tryVoice">Essayer</button>
      </div>
    </div>

    <div class="card">
      <h2>Le modèle</h2>
      <p class="sub">Par défaut, aucun modèle : les relances sont scriptées et rien ne quitte cette machine.</p>
      <label class="field"><span>Backend</span>
        <select id="chatBackend">
          <option value="scripted" ${s.chatBackend === 'scripted' ? 'selected' : ''}>Aucun modèle — relances scriptées (hors-ligne)</option>
          <option value="ollama" ${s.chatBackend === 'ollama' ? 'selected' : ''}>Ollama local</option>
          <option value="openai" ${s.chatBackend === 'openai' ? 'selected' : ''}>API distante (compatible OpenAI)</option>
        </select></label>
      <div id="backendCfg"></div>
      <p class="sub" style="margin:4px 0 0;font-size:12px">
        En « API distante », le texte de tes journées est envoyé à un serveur tiers. C'est le seul mode où tes données sortent d'ici.
      </p>
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
        <p class="sub">Combien de jours consécutifs au-dessus de la référence comptent comme une vraie remontée.
          À 1 jour, un simple rebond suffit : avec la majorité de tes journées au-dessus de la référence,
          le chiffre devient flatteur et ne dit plus rien.</p>
        <label class="field"><span>Tenue exigée <b class="mono" id="sv">${s.sustain}</b> jour${s.sustain > 1 ? 's' : ''}</span>
          <input type="range" id="sustain" min="1" max="5" step="1" value="${s.sustain}"></label>
      </div>

      <div class="card">
        <h2>Tes données</h2>
        <p class="sub">${S.stats.days} journées notées · ${S.stats.textDays} avec du texte · ${esc(S.stats.firstDate)} → ${esc(S.stats.lastDate)}</p>
        <p class="sub" style="font-size:12.5px">
          Tout est dans un fichier SQLite sur ce disque. Aucun compte, aucun serveur, aucune synchro.
        </p>
        <button class="btn" id="export">Exporter en JSON</button>
      </div>
    </div>`;

  renderBackendCfg();

  const bind = (id, key, ev = 'change', get = el => el.value) =>
    $('#' + id)?.addEventListener(ev, async e => { await saveSettings({ [key]: get(e.target) }); });

  bind('petName', 'petName', 'change');
  bind('voiceURI', 'voiceURI');
  bind('floorMode', 'floorMode');
  bind('floor', 'floor', 'change', el => Number(el.value));
  bind('voiceEnabled', 'voiceEnabled', 'change', el => el.checked);
  $('#sustain')?.addEventListener('change', async e => { await saveSettings({ sustain: Number(e.target.value) }); renderSettings(); });
  $('#voiceRate').addEventListener('input', async e => { $('#rv').textContent = e.target.value; await saveSettings({ voiceRate: Number(e.target.value) }); });
  $('#voicePitch').addEventListener('input', async e => { $('#pv').textContent = e.target.value; await saveSettings({ voicePitch: Number(e.target.value) }); });
  $('#tryVoice').addEventListener('click', () => Voice.speak(`Bonjour, moi c'est ${S.settings.petName}. Raconte-moi ta journée.`));

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

function renderBackendCfg() {
  const s = S.settings;
  const el = $('#backendCfg');
  if (!el) return;
  if (s.chatBackend === 'ollama') {
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

  for (const id of ['ollamaUrl', 'ollamaModel', 'apiUrl', 'apiModel', 'apiKey']) {
    $('#' + id)?.addEventListener('change', async e => { await saveSettings({ [id]: e.target.value }); });
  }
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

async function boot() {
  S = await api('/api/state');
  document.querySelector('nav').addEventListener('click', e => {
    const b = e.target.closest('button[data-view]');
    if (b) go(b.dataset.view);
  });
  syncHeader();
  go('tonight');
}

boot();
