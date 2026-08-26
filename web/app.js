import { PETS, petMarkup } from './pets.js';
import { deltaColor, noteColor, lineChart, bandMarkup, SATURATION } from './charts.js';

/* ============================= socle ============================= */

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const MONTHS_FR = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc'];
const fmtDay = d => {
  const [y, m, dd] = d.split('-');
  return `${Number(dd)} ${MONTHS_FR[Number(m) - 1].toLowerCase()} ${y}`;
};
const fmtTime = ts => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

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

/* ============================= vue : ce soir ============================= */

async function renderTonight() {
  const t = S.today;
  const note = S.entry?.note ?? null;
  const ref = S.stats.reference;
  const anchors = S.anchors;

  $('#view').innerHTML = `
    <div class="tonight">
      <div class="card petcard">
        <div class="art">${petMarkup(S.settings)}</div>
        <div class="name">${esc(S.settings.petName)}</div>
        <div class="role">il écoute, il ne note pas</div>
        <div style="margin-top:14px;display:flex;flex-direction:column;gap:6px;align-items:center">
          <span class="pill">${S.stats.streak} jour${S.stats.streak > 1 ? 's' : ''} d'affilée</span>
          <span class="pill ${S.settings.chatBackend === 'scripted' ? '' : 'warn'}">
            ${S.settings.chatBackend === 'scripted' ? 'hors-ligne · aucun modèle' : esc(S.settings.chatBackend)}
          </span>
        </div>
      </div>

      <div>
        <div class="card">
          <h2>${fmtDay(t)}</h2>
          <p class="sub">Raconte comme ça vient. Tes mots sont enregistrés tels quels.</p>
          <div class="thread" id="thread"></div>
          <div class="composer">
            <textarea id="input" rows="1" placeholder="Écris ici…"></textarea>
            <button class="btn primary" id="send">Envoyer</button>
          </div>
        </div>

        <div class="card">
          <h2>La note du jour</h2>
          <p class="sub">C'est toi qui notes, jamais ${esc(S.settings.petName)}.
            ${ref !== null ? `Ta référence glissante est à <b class="mono">${ref}</b>.` : ''}</p>
          <div class="notestrip" id="notestrip">
            ${Array.from({ length: 11 }, (_, n) => `
              <button data-n="${n}" aria-pressed="${note === n}"
                style="${note === n ? `background:${noteColor(n, ref ?? 6)}` : ''}"
                data-tip="${anchors.find(a => a.note === n) ? esc(anchors.find(a => a.note === n).descr) : `${n}/10`}">${n}</button>`).join('')}
          </div>
          ${anchors.length ? `<div class="anchors">
            ${anchors.map(a => `<div class="anchor">
              <span class="n" style="background:${noteColor(a.note, ref ?? 6)}">${a.note}</span>
              <span class="l"><b style="color:var(--ink)">${esc(a.label)}</b> — ${esc(a.descr)}</span>
            </div>`).join('')}
            <p class="faint" style="font-size:11.5px;margin:8px 0 0">
              Tes propres repères, importés du tableur. Ils gardent l'échelle stable d'une année sur l'autre.
            </p>
          </div>` : ''}
        </div>
      </div>
    </div>`;

  drawThread();

  $('#notestrip').addEventListener('click', async e => {
    const b = e.target.closest('button[data-n]');
    if (!b) return;
    const n = Number(b.dataset.n);
    await api('/api/note', { date: t, note: n });
    S = await api('/api/state');
    syncHeader();
    renderTonight();
    toast(`Journée notée ${n}/10`);
  });

  const input = $('#input');
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  $('#send').addEventListener('click', send);
  input.focus();
}

function drawThread() {
  const th = $('#thread');
  if (!th) return;
  if (!S.messages.length) {
    th.innerHTML = `<div class="empty">Rien pour aujourd'hui.<br>Écris un mot, ${esc(S.settings.petName)} répondra.</div>`;
    return;
  }
  th.innerHTML = S.messages.map(m => `
    <div class="msg ${m.role}">${esc(m.text)}<span class="t">${fmtTime(m.ts)}</span></div>`).join('');
  th.scrollTop = th.scrollHeight;
}

async function send() {
  const input = $('#input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  $('#send').disabled = true;

  // affichage optimiste : ce que tu écris apparait tout de suite
  S.messages.push({ ts: new Date().toISOString(), role: 'user', text });
  drawThread();

  try {
    const r = await api('/api/message', { text, date: S.today });
    S.messages = r.messages;
    drawThread();
    const last = r.messages[r.messages.length - 1];
    if (last?.role === 'pet') Voice.speak(last.text);
    if (r.degraded) toast(`Modèle injoignable — repli hors-ligne (${r.degraded.slice(0, 60)})`);
  } catch (err) {
    toast(String(err.message));
  } finally {
    $('#send').disabled = false;
    input.focus();
  }
}

/* ============================= vue : année ============================= */

let CENTER = 'relative';
let SERIES = null;

const CENTERS = {
  fixed:    { key: 'cumFixed',    label: 'centre 5 (ta formule)' },
  global:   { key: 'cumGlobal',   label: 'centre médiane globale' },
  relative: { key: 'cumRelative', label: 'centre référence glissante' }
};

async function renderYear(year) {
  year = year ?? Number(S.stats.lastDate.slice(0, 4));
  SERIES ??= await api('/api/series');
  const grid = await api(`/api/year?year=${year}`);
  const years = S.stats.years;

  const drift = k => SERIES[k][SERIES[k].length - 1] / SERIES[k].length;
  const fmtDrift = k => (drift(k) > 0 ? '+' : '') + drift(k).toFixed(3);

  $('#view').innerHTML = `
    <div class="card">
      <div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:16px">
        <h2 style="margin:0">Grille</h2>
        <div class="centerpick" style="margin:0 0 0 auto">
          ${years.map(y => `<button data-year="${y}" aria-pressed="${Number(y) === year}">${y}</button>`).join('')}
        </div>
      </div>
      <div class="gridwrap">${gridMarkup(grid)}</div>
      <div class="legend">
        <span>pire</span>
        ${Array.from({ length: 17 }, (_, i) => {
          const d = -SATURATION + (i / 16) * 2 * SATURATION;
          return `<i style="background:${deltaColor(d)}"></i>`;
        }).join('')}
        <span>meilleur</span>
        <span style="margin-left:14px">écart à la référence glissante, saturé à ±${SATURATION}</span>
        <span style="margin-left:auto" class="mono">${grid.count} jours · moyenne ${grid.avg ?? '—'}</span>
      </div>
    </div>

    <div class="card">
      <h2>Cumul du contraste</h2>
      <p class="sub">
        Ta formule <span class="mono">signe(x)·x²/2,5</span> appliquée jour après jour, puis cumulée.
        Ce qui change entre les trois, c'est uniquement <b>x</b> — l'écart à quoi.
      </p>
      <div class="centerpick">
        ${Object.entries(CENTERS).map(([k, c]) => `
          <button data-center="${k}" aria-pressed="${CENTER === k}">
            ${c.label}<span class="drift">${fmtDrift(c.key)}/j</span>
          </button>`).join('')}
      </div>
      ${lineChart(SERIES.date, SERIES[CENTERS[CENTER].key], { height: 230, events: SERIES.events })}
      ${CENTER === 'fixed' ? `<p class="sub" style="margin:12px 0 0;color:var(--warn)">
        Avec un centre figé à 5 et une moyenne réelle à ${(SERIES.note.reduce((a,b)=>a+b,0)/SERIES.note.length).toFixed(2)},
        la courbe monte de <b class="mono">${drift('cumFixed').toFixed(3)}</b> point par jour sans que rien ne s'améliore.
        La pente ne veut rien dire — c'est le biais décrit au §6 du spec.</p>` : ''}
      ${CENTER === 'global' ? `<p class="sub" style="margin:12px 0 0">
        Centre correct, dérive résiduelle de <b class="mono">${fmtDrift('cumGlobal')}</b>/j :
        le carré signé amplifie ta queue basse plus que ta queue haute.</p>` : ''}
      ${CENTER === 'relative' ? `<p class="sub" style="margin:12px 0 0">
        La pente ne monte que si la période est meilleure que tes 365 derniers jours.
        Dérive résiduelle <b class="mono">${fmtDrift('cumRelative')}</b>/j — c'est la seule des trois qui soit lisible.</p>` : ''}
    </div>`;

  // onclick (et non addEventListener) : chaque rendu remplace l'ecouteur
  // au lieu de l'empiler. #view survit aux rendus, contrairement a son contenu.
  $('#view').onclick = async e => {
    const y = e.target.closest('[data-year]');
    if (y) return renderYear(Number(y.dataset.year));
    const c = e.target.closest('[data-center]');
    if (c) { CENTER = c.dataset.center; return renderYear(year); }
    const cell = e.target.closest('td.cell.has');
    if (cell) { view = 'mirror'; syncNav(); return renderMirror(cell.dataset.date); }
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
        const col = has ? deltaColor(d.delta) : null;
        return `<td class="cell${has ? ' has' : ''}${d.date === today ? ' today' : ''}"
          ${col ? `style="background:${col}"` : ''}
          ${has ? `data-date="${d.date}" data-tip="${fmtDay(d.date)}\n${d.note}/10 · écart ${d.delta > 0 ? '+' : ''}${d.delta}"` : ''}></td>`;
      }).join('')}
      <td class="avg">${mo.avg ?? ''}</td>
    </tr>`).join('')}
  </table>`;
}

/* ============================= vue : miroir ============================= */

async function renderMirror(date) {
  date = date ?? S.today;
  const m = await api(`/api/mirror?date=${date}`);

  /* --- SPEC 4.1 : sous le plancher, aucune statistique. --- */
  if (m.floored) {
    $('#view').innerHTML = `
      <div class="card floorbox">
        <h2>Aujourd'hui, pas de chiffres</h2>
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
    $('#backToChat')?.addEventListener('click', () => go('tonight'));
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
      <p class="sub">Seulement ${ep.count} journée${ep.count > 1 ? 's' : ''} comparable${ep.count > 1 ? 's' : ''} dans ton historique.
      En dessous de ${ep.minComparable}, je n'ai rien à en tirer.</p></div>`;
  } else {
    epCard = `<div class="card">
      <h2>Preuve de résolution</h2>
      <p class="sub">
        Les <b>${ep.count}</b> fois où tu es descendu à ${ep.note}/10 ou moins, voilà combien de temps
        il a fallu pour remonter au-dessus de ta référence — et pour y rester ${ep.sustain} jours.
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
      </p>
    </div>`;
  }

  const sim = m.similar;
  let simCard = '';
  if (sim?.items?.length) {
    simCard = `<div class="card">
      <h2>${sim.mode === 'text' ? 'Tu as déjà écrit ça' : 'Les autres fois à ' + m.note + '/10'}</h2>
      <p class="sub">${sim.mode === 'text'
        ? 'Recherche sur ton propre corpus. La bande montre les 14 jours qui ont suivi, tels qu\'ils ont été.'
        : 'Pas encore assez de texte écrit pour comparer les mots — je compare les chiffres. La bande montre les 14 jours qui ont suivi.'}</p>
      ${sim.items.map(it => `<div class="simitem">
        <div class="hd">
          <span class="d">${fmtDay(it.date)}</span>
          <span class="pill">${it.note}/10</span>
          ${it.terms?.length ? `<span class="faint" style="font-size:11.5px">${it.terms.map(esc).join(' · ')}</span>` : ''}
        </div>
        ${it.text ? `<p class="q">${esc(it.text.slice(0, 260))}${it.text.length > 260 ? '…' : ''}</p>` : ''}
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
      <div class="statgrid" style="flex:1">
        <div class="s"><div class="k">Référence glissante</div><div class="v">${m.reference ?? '—'}</div></div>
        <div class="s"><div class="k">Écart</div><div class="v">${m.delta > 0 ? '+' : ''}${m.delta ?? '—'}</div></div>
        <div class="s"><div class="k">Corpus texte</div><div class="v">${m.textCount ?? 0}<span class="u"> jours</span></div></div>
      </div>
    </div>
    ${epCard}${simCard}${yCard}`;
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

const VIEWS = { tonight: renderTonight, year: () => renderYear(), mirror: () => renderMirror(), settings: renderSettings };

function syncNav() {
  for (const b of document.querySelectorAll('nav button')) {
    b.setAttribute('aria-current', String(b.dataset.view === view));
  }
}

async function go(v) {
  view = v;
  syncNav();
  $('#view').onclick = null;
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
