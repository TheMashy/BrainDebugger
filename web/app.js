import { PETS, petMarkup } from './pets.js';
import { Ambiance } from './ambiance.js';
import { disposer, dessiner, auPoint } from './carte.js';
import { toPNG, PetTalk } from './pet.js';
import { VOICES, Blip } from './blips.js';
import { deltaColor, noteColor, noteScaleRGB, lineChart, dailyChart, bandMarkup, SATURATION } from './charts.js';
import { icone, iconeDe, themeDe, NOMS } from './reperes.js';

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
  // Le compte seul. L'étendue tenait sur deux lignes dans le rail, pour une
  // information qu'on lit une fois : elle passe en infobulle.
  const d = $('#dayline');
  d.textContent = S.stats.days ? `${S.stats.days} jours` : 'aucune journée';
  d.title = S.stats.days ? `${S.stats.firstDate} → ${S.stats.lastDate}` : '';
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
      <div class="thread" id="thread"></div>

      <div class="composer">
        <textarea id="input" rows="1" placeholder="Écris ici…" aria-label="Ton message"></textarea>
        <button class="sendarrow" id="send" aria-label="Envoyer" title="Envoyer">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
               stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 12h15"/><path d="M13 6l6 6-6 6"/>
          </svg>
        </button>
      </div>

      <div id="echoes"></div>

      <div class="notecard">
        <div class="noteline">
          <span class="k">Note avant de te coucher</span>
          ${S.stats.reference !== null
            ? `<span class="ref">référence <b class="mono">${S.stats.reference}</b></span>` : ''}
          <button class="newchat" id="newChat" title="Repartir sur un fil vide. Rien n'est effacé : tes journées restent dans le journal.">Nouveau&nbsp;fil</button>
        </div>

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

/**
 * Le compagnon vit dans le rail, pas dans la vue.
 *
 * Il y était rendu à chaque `renderTonight()`, donc remplacé à chaque note
 * posée et à chaque changement de vue : l'animation de respiration repartait de
 * zéro et la bestiole tressautait. Monté une fois, il respire en continu, et
 * il reste là quand on va regarder l'Année -- ce qui est aussi ce que dit la
 * maquette : le rail ne change pas, c'est le panneau qui change.
 */
function monterPet() {
  const art = $('#art');
  if (!art) return;
  art.innerHTML = petMarkup(S.settings);
  if (art.dataset.lie) return;
  art.dataset.lie = '1';
  art.onclick = () => $('#petPick').click();
  art.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#petPick').click(); } };
  $('#petPick').onchange = async e => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 12 * 1024 * 1024) return toast('Fichier trop lourd (max 12 Mo)');
    try {
      const png = await toPNG(f, 256);
      await saveSettings({ petImage: png, petSprite: 'custom' });
      monterPet();
      toast('Nouveau compagnon');
    } catch (err) { toast(err.message); }
  };
}

/**
 * La dernière phrase du compagnon, sous son portrait.
 *
 * Elle est déjà dans le fil ; elle est ici parce que le regard va d'abord à la
 * bestiole, et qu'une bestiole muette à côté d'une conversation est une image
 * décorative. C'est la seule chose du rail qui bouge.
 */
function syncPetSay() {
  const el = $('#petSay');
  if (!el) return;
  const dernier = [...(S.messages ?? [])].reverse().find(m => m.role === 'pet');
  el.textContent = dernier ? dernier.text : '';
  el.hidden = !dernier;
}

/* Le chiffre porte la couleur, plus le pavé derrière lui. Un bloc vert de
   quatre-vingt-dix pixels était la chose la plus lumineuse de la page, pour
   afficher un nombre à un chiffre. */
const noteFaceStyle = n => n === null || n === undefined
  ? 'color:var(--ink-faint)'
  : `color:rgb(${noteScaleRGB(n)})`;

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
/** Au-delà, on a quitté la conversation et on y est revenu : l'heure compte. */
const PAUSE_MS = 12 * 60 * 1000;

function drawThread() {
  const th = $('#thread');
  if (!th) return;
  if (!S.messages.length) {
    th.innerHTML = `<div class="empty">Ce que tu dis reste.</div>`;
    syncPetSay();
    return;
  }
  let last = null;
  let dernierTs = 0;
  const parMsg = S.motifs?.parMessage ?? {};
  th.innerHTML = S.messages.map((m, i) => {
    const day = m.date ?? m.ts.slice(0, 10);
    const sep = day !== last
      ? `<div class="daysep"><span>${day === S.today ? "aujourd'hui" : fmtDay(day)}</span></div>`
      : '';
    last = day;
    // Ce qui n'est pas d'aujourd'hui est du passé : présent, mais en retrait.
    const passe = day !== S.today ? ' past' : '';

    // L'heure ne s'affiche qu'après une vraie pause. Une horloge sous chaque
    // phrase ne dit rien -- deux messages à la même minute portaient deux fois
    // le même chiffre -- alors qu'un trou de vingt minutes en dit long, et c'est
    // exactement ce qu'on veut voir en relisant une soirée six mois plus tard.
    const ts = Date.parse(m.ts) || 0;
    const pause = i === 0 || sep || (ts - dernierTs) >= PAUSE_MS;
    dernierTs = ts;

    // Les motifs reconnus dans CE message le teintent, lui et pas la
    // conversation : c'est la phrase qui porte le mécanisme, pas la soirée.
    const mots = parMsg[m.id] ?? [];
    const teinte = mots.length ? ` style="--motif:${mots[0].teinte}"` : '';
    const marque = mots.length
      ? `<span class="motifs">${mots.map(x =>
          `<button class="motifchip" data-motif="${x.id}" style="--motif:${x.teinte}"
            title="Motif suivi par le compagnon">${esc(x.nom)}</button>`).join('')}</span>`
      : '';
    return sep + `<div class="msg ${m.role}${passe}${mots.length ? ' teinte' : ''}"${teinte}
      >${pause ? `<span class="t">${fmtTime(m.ts)}</span>` : ''
      }<span class="tx">${esc(m.text)}</span>${marque}</div>`;
  }).join('') + gestesMarkup();
  th.scrollTop = th.scrollHeight;
  th.classList.remove('reading');
  bindThreadReveal(th);
  bindGestes(th);
  syncPetSay();
}

/* ---------- ce que le compagnon a posé pendant qu'il parlait ---------- */

/*
 * Les gestes du tour en cours.
 *
 * Ils ne vivent pas dans le fil : un repère n'est pas une phrase, et l'écrire
 * comme un message ferait croire que le compagnon commente. C'est une carte
 * posée au pied de la conversation, qui dit ce qui a changé dans
 * l'application et donne le moyen d'aller le voir. Elle disparaît au prochain
 * message -- l'endroit où un repère vit pour de bon, c'est la frise.
 */
let GESTES = [];

function gestesMarkup() {
  if (!GESTES.length) return '';
  return `<div class="gestes">${GESTES.map(g => g.type === 'repere'
    ? `<div class="geste repere">
         <span class="gicone">${icone(g.theme, 20)}</span>
         <div class="gtxt">
           <b>Repère posé</b>
           <span>${esc(g.label)} · ${fmtDay(g.date)}</span>
         </div>
         <button class="gbtn" data-voir="${g.date}">voir</button>
       </div>`
    : `<div class="geste motif" style="--motif:${g.teinte}">
         <span class="gpuce"></span>
         <div class="gtxt">
           <b>${g.nouveau ? 'Nouveau motif suivi' : 'Motif reconnu'}</b>
           <span>${esc(g.nom)}${g.nouveau ? ` — ${esc(g.mecanisme)}` : ` · ${g.vues} fois`}</span>
         </div>
         ${g.nouveau ? '<button class="gbtn" data-motifs="1">les voir</button>' : ''}
       </div>`).join('')}</div>`;
}

/**
 * Aller voir le repère qu'on vient de poser.
 *
 * La date passe par sessionStorage et pas par une variable : le Miroir se rend
 * de façon asynchrone, et surtout la demande doit survivre à un rechargement.
 * Elle est consommée à la lecture -- le halo ne se déclenche qu'une fois, sinon
 * ce n'est plus un signal, c'est une décoration permanente.
 */
/**
 * Poser les gestes sans redessiner le fil.
 *
 * drawThread() reconstruit tout le fil et remet le défilement en bas ; l'appeler
 * pendant que le compagnon écrit couperait sa phrase en cours de frappe.
 */
function dessinerGestes() {
  const th = $('#thread');
  if (!th) return;
  th.querySelector('.gestes')?.remove();
  th.insertAdjacentHTML('beforeend', gestesMarkup());
  th.scrollTop = th.scrollHeight;
}

const AURA_CLE = 'bd.aura';
function demanderAura(date) { try { sessionStorage.setItem(AURA_CLE, date); } catch { /* mode privé */ } }

/**
 * La demande n'est consommée QUE si c'est la bonne journée qui s'affiche.
 *
 * Consommer à chaque rendu paraissait plus simple et perdait le halo : le
 * Miroir se rend d'abord sur aujourd'hui, puis sur la date demandée, et le
 * premier rendu mangeait la clé du second. Le halo ne se déclenchait donc
 * jamais — sans erreur, sans trace, juste rien.
 */
function prendreAura(date) {
  try {
    if (sessionStorage.getItem(AURA_CLE) !== date) return false;
    sessionStorage.removeItem(AURA_CLE);
    return true;
  } catch { return false; }
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
/**
 * Les boutons des gestes. Un seul écouteur sur le fil, posé une fois : les
 * cartes vont et viennent à chaque tour, un écouteur par carte fuirait.
 */
function bindGestes(th) {
  if (th.dataset.gestes) return;
  th.dataset.gestes = '1';
  th.addEventListener('click', e => {
    const v = e.target.closest('[data-voir]');
    if (v) {
      demanderAura(v.dataset.voir);
      view = 'mirror'; syncNav();
      return renderMirror(v.dataset.voir);
    }
    const m = e.target.closest('[data-motifs]') || e.target.closest('[data-motif]');
    if (m) { view = 'settings'; syncNav(); return renderSettings(); }
  });
}

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

  GESTES = [];                        // les gestes du tour précédent ont fait leur temps
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

      // Un geste arrive pendant que le compagnon parle : la marque apparaît
      // en même temps que la phrase qui la mentionne, pas plusieurs secondes
      // après, où elle aurait l'air d'être tombée toute seule.
      if (ev === 'geste') { GESTES.push(data); dessinerGestes(); return; }

      if (ev === 'delta') { PetTalk.feed(data.text); $('#thread').scrollTop = $('#thread').scrollHeight; return; }

      if (ev === 'done') {
        PetTalk.endStream();
        if (data.usage) { S.usage = data.usage; syncGauge(); }
        if (data.exhausted) toast("Enveloppe de jetons épuisée — le compagnon répond hors-ligne.");
        S.messages = data.messages;
        if (data.motifs) S.motifs = data.motifs;

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
        <span class="faint" style="font-size:11.5px">${termesMarkup(it)}</span>
      </div>
      <p class="q">${highlight(it.text.slice(0, 240), it.terms, it.forts)}${it.text.length > 240 ? '…' : ''}</p>
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
        <form id="evform" class="repform">
          <span class="repapercu" id="evicone">${icone('jalon', 22)}</span>
          <input type="text" id="evlabel" required maxlength="60" autocomplete="off"
                 placeholder="changement de boulot, déménagement, début d'un traitement…">
          <input type="date" id="evdate" required min="${S.stats.firstDate}" max="${S.today}" value="${S.today}">
          <button class="btn primary" type="submit">Poser</button>
        </form>
        ${SERIES.events.length
          ? `<div class="frise">${friseMarkup(SERIES.events)}</div>`
          : `<p class="sub" style="margin:0">Aucun repère pour l'instant. Le compagnon en pose
             aussi de lui-même, quand tu lui racontes quelque chose qui change le sol sous tes journées.</p>`}
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

  // L'icône se décide pendant la frappe. C'est la raison d'être du module
  // partagé : le classement tourne dans le navigateur, sans aller-retour, et
  // c'est exactement celui que le serveur appliquera.
  const champ = $('#evlabel');
  champ.oninput = () => {
    const t = themeDe(champ.value);
    $('#evicone').innerHTML = icone(t, 22);
    $('#evicone').dataset.theme = t;
    $('#evicone').title = NOMS[t] ?? 'jalon';
  };

  $('#evform').onsubmit = async e => {
    e.preventDefault();
    const date = $('#evdate').value, label = champ.value.trim();
    if (!date || !label) return;
    try {
      const { events } = await api('/api/events', { date, label });
      SERIES.events = events;
      champ.value = '';
      await renderYear(year);
      toast('Repère posé');
    } catch (err) { toast(err.message); }
  };
}

/**
 * La frise, groupée par année.
 *
 * Une liste plate de quarante repères sur quatre ans ne se lit pas : on n'y
 * trouve rien et on n'y voit aucun rythme. Groupée, elle montre d'un coup
 * d'œil l'année où tout a bougé et celle où rien n'a bougé — ce qui est
 * précisément l'information qu'une frise doit porter.
 */
function friseMarkup(events) {
  const parAn = new Map();
  for (const ev of events.slice().sort((a, b) => b.date.localeCompare(a.date))) {
    const an = ev.date.slice(0, 4);
    if (!parAn.has(an)) parAn.set(an, []);
    parAn.get(an).push(ev);
  }
  return [...parAn].map(([an, liste]) => `
    <div class="frisean">
      <div class="frisetitre"><span class="mono">${an}</span><i></i><span class="faint">${liste.length}</span></div>
      ${liste.map(ev => {
        const t = ev.theme ?? themeDe(ev.label);
        return `<div class="repligne" data-theme="${t}">
          <span class="ricone-box">${icone(t, 18)}</span>
          <span class="repdate mono faint">${Number(ev.date.slice(8))} ${MONTHS_FR[Number(ev.date.slice(5, 7)) - 1].toLowerCase()}</span>
          <span class="replabel">${esc(ev.label)}</span>
          <button class="repdel" data-delev="${ev.id}" title="Retirer ce repère" aria-label="Retirer ${esc(ev.label)}">×</button>
        </div>`;
      }).join('')}
    </div>`).join('');
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

/**
 * Surligne les termes qui ont fait matcher. Montrer POURQUOI ca ressort.
 *
 * Deux pieges, tous deux visibles a l'oeil sur un journal francais :
 *
 *  - Les termes arrivent normalises (sans accent) et le texte, lui, en a. Une
 *    recherche litterale de « fatigue » ne trouve jamais « fatigué » -- et
 *    « fatigué » est precisement le genre de mot qu'on veut voir surligne. On
 *    cherche donc sur une copie aplatie de meme longueur, et on decoupe le
 *    texte d'origine aux positions trouvees.
 *  - Certains termes sont des expressions (« me_faire_du_mal »). On les
 *    surligne entieres : dans « envie de me faire du mal », designer « envie »
 *    designe la mauvaise moitie de la phrase.
 *
 * `forts` sont les termes qui nomment un etat ou un mecanisme plutot qu'une
 * circonstance ; ils recoivent un surlignage plus appuye.
 */
function aplat(s) {
  // Longueur preservee : une unite entre, une unite sort. Les index restent
  // valides sur le texte d'origine.
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const d = s[i].normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += d.length === 1 ? d : s[i];
  }
  return out;
}

const echapRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function highlight(text, terms = [], forts = []) {
  if (!terms.length) return esc(text);
  const fort = new Set(forts);
  const plat = aplat(text);
  const spans = [];

  // Les plus longs d'abord : une expression doit gagner contre ses morceaux.
  const ordre = [...new Set(terms)].sort((a, b) => b.length - a.length);
  for (const t of ordre) {
    const parts = t.split('_').map(w => echapRe(w) + '[a-z0-9]*');
    const re = new RegExp(`(?<![a-z0-9])(${parts.join('[^a-z0-9]+')})`, 'gi');
    let m;
    while ((m = re.exec(plat)) !== null) {
      const a = m.index, b = a + m[1].length;
      if (spans.some(s => a < s.b && b > s.a)) continue;   // pas de chevauchement
      spans.push({ a, b, fort: fort.has(t) });
    }
  }
  if (!spans.length) return esc(text);

  spans.sort((x, y) => x.a - y.a);
  let out = '', cur = 0;
  for (const s of spans) {
    out += esc(text.slice(cur, s.a));
    out += `<mark${s.fort ? ' class="fort"' : ''}>${esc(text.slice(s.a, s.b))}</mark>`;
    cur = s.b;
  }
  return out + esc(text.slice(cur));
}

/** « me_faire_du_mal » se lit « me faire du mal ». */
const motLisible = t => String(t).replace(/_/g, ' ');

/** L'etiquette « voici pourquoi ca ressort », les mots qui pesent en tete. */
function termesMarkup(it) {
  const fort = new Set(it.forts ?? []);
  return (it.terms ?? [])
    .map(t => `<span class="${fort.has(t) ? 'tfort' : ''}">${esc(motLisible(t))}</span>`)
    .join(' · ');
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
      ${sim.mode === 'text' ? '' : `<p class="sub">${sim.reason === 'no_theme'
        ? "Rien de commun dans les mots aujourd'hui. Comparaison sur les notes."
        : 'Comparaison sur les notes, pas sur les mots.'}</p>`}
      ${sim.items.map(it => `<div class="simitem">
        <div class="hd">
          <span class="d">${fmtDay(it.date)}</span>
          <span class="pill">${it.note}/10</span>
          ${it.terms?.length ? `<span class="faint" style="font-size:11.5px">${termesMarkup(it)}</span>` : ''}
        </div>
        ${it.text ? `<p class="q">${highlight(it.text.slice(0, 260), it.terms, it.forts)}${it.text.length > 260 ? '…' : ''}</p>` : ''}
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
    <div class="mirror">
      <div class="mcol">
        ${calendarMarkup(m, date)}

        ${reperesMarkup(m.reperes, date)}

        <div class="card dayread">
          <div class="dayhead">
            <div>
              <div class="k faint">${fmtDay(date)}${date === S.today ? " · aujourd'hui" : ''}</div>
              <div class="bignum${m.note !== null ? ' noted' : ''}"
                   style="${m.note !== null ? `color:${deltaColor(m.delta)};--halo:${deltaColor(m.delta)}` : 'color:var(--ink-faint)'}">
                ${m.note ?? '—'}<span class="sl">/10</span>
              </div>
            </div>
            <div class="statgrid tight">
              <div class="s"><div class="k">Référence</div><div class="v">${m.reference ?? '—'}</div></div>
              <div class="s"><div class="k">Écart</div><div class="v">${m.delta > 0 ? '+' : ''}${m.delta ?? '—'}</div></div>
            </div>
            <button class="daydrop" data-erase="${date}" title="Effacer cette journée">effacer</button>
          </div>
          ${m.jour?.text
            ? `<p class="serif dayText">${esc(m.jour.text)}</p>`
            : `<p class="sub" style="margin:0">${m.note !== null ? 'Notée, sans texte.' : "Rien pour cette journée."}</p>`}
        </div>

        ${epCard}
      </div>

      <div class="mcol">
        ${simCard || `<div class="card"><h2>Tu as déjà écrit ça</h2>
          <p class="sub" style="margin:0">Rien d'assez proche pour l'instant.</p></div>`}
        ${yCard}
      </div>
    </div>`;
  wireMirror();
}

/**
 * Le calendrier du mois. Le point du Miroir n'etait pas evident : on y navigue
 * dans son passe, un jour a la fois, mais rien ne le montrait -- deux fleches
 * et un titre. Une grille de mois rend le deplacement visible et donne le
 * contexte immediat : ou tombe ce jour dans la semaine, ce qu'il y avait autour,
 * quelles journees portent du texte.
 *
 * Les journees non notees restent affichees, en creux. Dans un journal, un trou
 * est une information -- pas une case a masquer.
 */
const JOURS_COURT = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/**
 * Les repères de la journée ouverte.
 *
 * Deux choses distinctes, et le bloc les sépare parce qu'elles ne répondent pas
 * à la même question. Ce qui est POSÉ CE JOUR-LÀ dit « voilà ce qui s'est passé ».
 * Le dernier repère AVANT dit « voilà où tu en étais » — c'est celui qu'on
 * cherche vraiment en rouvrant une journée d'il y a deux ans, et il n'apparaît
 * nulle part ailleurs dans l'application.
 */
function reperesMarkup(rep, date) {
  const jour = rep?.jour ?? [];
  const avant = rep?.avant ?? null;
  if (!jour.length && !avant) return '';
  const aura = prendreAura(date);

  return `<div class="card reperes${aura ? ' aura' : ''}">
    <div class="k faint repk">Repères</div>
    ${jour.length ? `<div class="repliste">
      ${jour.map(r => `<div class="rep pose">
        <span class="ricone-box">${icone(r.theme, 22)}</span>
        <div class="reptxt"><b>${esc(r.label)}</b><span class="faint">${esc(NOMS[r.theme] ?? 'jalon')}</span></div>
      </div>`).join('')}
    </div>` : ''}
    ${avant ? `<button class="rep avant" data-goto="${avant.date}">
      <span class="ricone-box">${icone(avant.theme, 18)}</span>
      <div class="reptxt">
        <b>${esc(avant.label)}</b>
        <span class="faint">${avant.jours === 0 ? 'le jour même'
          : avant.jours === 1 ? 'la veille'
          : avant.jours < 62 ? `${avant.jours} jours plus tôt`
          : `${Math.round(avant.jours / 30.4)} mois plus tôt`}</span>
      </div>
    </button>` : ''}
  </div>`;
}

function calendarMarkup(m, date) {
  const cases = m.calendrier ?? [];
  if (!cases.length) return '';
  const mois = date.slice(0, 7);
  const [an, mo] = mois.split('-').map(Number);
  // Lundi en premiere colonne : getUTCDay() rend 0 pour dimanche.
  const premier = (new Date(Date.UTC(an, mo - 1, 1)).getUTCDay() + 6) % 7;

  const moisPrec = new Date(Date.UTC(an, mo - 2, 1)).toISOString().slice(0, 10);
  const moisSuiv = new Date(Date.UTC(an, mo, 1)).toISOString().slice(0, 10);
  const suivDispo = moisSuiv.slice(0, 7) <= S.today.slice(0, 7);

  const nom = new Date(Date.UTC(an, mo - 1, 1))
    .toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return `<div class="card cal">
    <div class="calhead">
      <button data-goto="${moisPrec}" aria-label="Mois précédent">‹</button>
      <span class="calmois">${esc(nom)}</span>
      <button data-goto="${moisSuiv}" ${suivDispo ? '' : 'disabled'} aria-label="Mois suivant">›</button>
      <button class="calnow" data-goto="${S.today}" ${date === S.today ? 'disabled' : ''}>aujourd'hui</button>
    </div>
    <div class="calgrid">
      ${JOURS_COURT.map(j => `<span class="cald">${j}</span>`).join('')}
      ${'<span></span>'.repeat(premier)}
      ${cases.map(c => {
        const sel = c.date === date;
        // Deux reperes distincts, et c'est volontaire : « on » dit ou on
        // regarde, « auj » dit ou on est. Les confondre fait perdre le nord des
        // qu'on s'eloigne de quelques jours -- on ne sait plus si le cadre
        // blanc est la date du jour ou celle qu'on a ouverte.
        const auj = c.date === S.today;
        const futur = c.date > S.today;
        const fond = c.note !== null ? `background:${deltaColor(c.delta ?? 0)}` : '';
        return `<button class="calcase${sel ? ' on' : ''}${auj ? ' auj' : ''}${c.note === null ? ' vide' : ''}${c.texte ? ' texte' : ''}"
          data-goto="${c.date}" ${futur ? 'disabled' : ''} style="${fond}"
          data-tip="${esc(fmtDay(c.date))}${auj ? " · aujourd'hui" : ''}${c.note !== null ? ` · ${c.note}/10` : ' · non notée'}"
          >${Number(c.date.slice(-2))}</button>`;
      }).join('')}
    </div>
  </div>`;
}

function wireMirror() {
  $('#view').onclick = async e => {
    const g = e.target.closest('[data-goto]');
    if (g) return renderMirror(g.dataset.goto);
    if (e.target.closest('#backToChat')) return go('tonight');

    const del = e.target.closest('[data-erase]');
    if (del) {
      const d = del.dataset.erase;
      // Une seule journée : pas de mot à retaper, mais une confirmation quand
      // même. Le geste est petit, la perte ne l'est pas.
      if (!confirm(`Effacer la journée du ${fmtDay(d)} — sa note et son texte ?`)) return;
      try {
        await api('/api/delete-day', { date: d });
        S = await api('/api/state');
        SERIES = null;
        syncHeader();
        renderMirror(d);
        toast('Journée effacée');
      } catch (err) { toast(err.message); }
    }
  };
}

/* ============================= vue : carte =============================

   Ce que quatre ans de journal contiennent et qu'aucune courbe ne montre : ce
   dont on parle, et ce qui revient avec quoi. Rien n'est généré — on compte des
   mots déjà écrits, on les colore par les notes déjà posées.            */

let CARTE_FENETRE = 'tout';
let CARTE = null, CARTE_DISPO = null, CARTE_SURVOL = -1;

async function renderCarte() {
  const G = await api(`/api/graph?fenetre=${CARTE_FENETRE}`);

  if (G.floored) {
    $('#view').innerHTML = `
      <div class="card floorbox">
        <h2>Pas de carte aujourd'hui</h2>
        <p class="sub" style="color:#c9a19b">
          Tu as noté ${G.floor.note ?? ''}/10. En dessous de ${G.floor.threshold}, cet outil ne sort
          aucune statistique — et une carte en est une. Une très jolie, ce qui la rend plus
          dangereuse qu'un chiffre, pas moins.
        </p>
        <div class="helpline">
          Si tu as besoin de parler à quelqu'un maintenant : <b>3114</b>, gratuit, 24h/24, partout en France.
        </div>
      </div>`;
    return;
  }

  const choix = [['30', '30 j'], ['90', '90 j'], ['365', '1 an'], ['tout', 'tout']]
    .map(([v, l]) => `<button data-fen="${v}" aria-pressed="${CARTE_FENETRE === v}">${l}</button>`).join('');

  if (!G.assez) {
    $('#view').innerHTML = `
      <div class="card">
        <div class="cardhead"><h2>Carte de tes mots</h2>
          <div class="centerpick" style="margin-left:auto">${choix}</div></div>
        <p class="sub">
          ${G.jours} journée${G.jours > 1 ? 's' : ''} écrite${G.jours > 1 ? 's' : ''} sur cette période.
          Il en faut au moins ${G.minimum} pour qu'un mot qui revient veuille dire quelque chose —
          en dessous, ce ne sont que des mots isolés.
        </p>
      </div>`;
    $('#view').onclick = e => {
      const b = e.target.closest('[data-fen]');
      if (b) { CARTE_FENETRE = b.dataset.fen; renderCarte(); }
    };
    return;
  }

  CARTE = G;
  $('#view').innerHTML = `
    <div class="carte">
      <div class="card cartebox">
        <div class="cardhead">
          <h2>Carte de tes mots</h2>
          <span class="sub" style="margin:0">${G.jours} journées écrites · ${G.noeuds.length} mots qui reviennent</span>
          <div class="centerpick" style="margin-left:auto">${choix}</div>
        </div>
        <div class="cartewrap"><canvas id="carteCv"></canvas>
          <div class="cartetip" id="carteTip" hidden></div>
        </div>
        <p class="sub cartelegende">
          La taille dit combien de journées portent ce mot. La couleur est celle de leur note,
          sur la même échelle que la grille. Un anneau marque tes repères d'étalonnage.
        </p>
      </div>

      <div class="mcol">
        <div class="card">
          <h2>Ce qui revient</h2>
          ${G.faits.length
            ? G.faits.map(f => `<p class="fait">${esc(f.texte)}</p>`).join('')
            : `<p class="sub" style="margin:0">Rien qui ressorte assez nettement pour être compté.</p>`}
          <p class="sub" style="margin:14px 0 0;font-size:11.5px">
            Des comptes sur tes propres journées, rien de plus. L'application ne dit pas ce
            qu'ils veulent dire — le lien, c'est toi qui le fais.
          </p>
        </div>

        <div class="card">
          <h2>Les groupes</h2>
          <div class="amaslist">
            ${G.amas.filter(a => a.taille >= 2).map(a => `
              <div class="amasrow">
                <span class="pastille" style="background:${a.note !== null ? deltaColor(a.note - G.moyenneGlobale) : 'var(--line)'}"></span>
                <b>${esc(a.nom)}</b>
                <span class="muted">${a.taille} mots</span>
                <span class="mono muted" style="margin-left:auto">${a.note !== null ? a.note : '—'}</span>
              </div>`).join('')}
          </div>
        </div>
      </div>
    </div>`;

  monterCarte();
}

function monterCarte() {
  const cv = $('#carteCv');
  const tip = $('#carteTip');
  if (!cv || !CARTE) return;
  const ctx = cv.getContext('2d');

  const redimensionner = () => {
    const r = cv.parentElement.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    cv.style.width = r.width + 'px';
    cv.style.height = r.height + 'px';
    // La disposition est recalculée à chaque taille : les forces dépendent du
    // cadre, et une carte simplement étirée se lit mal.
    CARTE_DISPO = disposer(CARTE, r.width, r.height);
    dessiner(ctx, CARTE, CARTE_DISPO, { largeur: r.width, hauteur: r.height, survol: CARTE_SURVOL, dpr });
  };
  redimensionner();

  cv.onmousemove = e => {
    const r = cv.getBoundingClientRect();
    const i = auPoint(CARTE_DISPO.pts, CARTE, e.clientX - r.left, e.clientY - r.top);
    if (i !== CARTE_SURVOL) {
      CARTE_SURVOL = i;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      dessiner(ctx, CARTE, CARTE_DISPO, { largeur: r.width, hauteur: r.height, survol: i, dpr });
    }
    if (i >= 0) {
      const nd = CARTE.noeuds[i];
      tip.innerHTML = `<b>${esc(nd.mot)}</b><br>${nd.jours} journées`
        + (nd.note !== null ? ` · moyenne <b class="mono">${nd.note}</b>` : '')
        + (nd.ecart !== null && Math.abs(nd.ecart) >= 0.3
            ? `<br><span class="faint">${nd.ecart > 0 ? '+' : ''}${nd.ecart} par rapport à ta moyenne</span>` : '')
        + `<br><span class="faint">clique pour ouvrir le Miroir</span>`;
      tip.hidden = false;
      tip.style.left = Math.min(r.width - 190, CARTE_DISPO.pts[i].x + 14) + 'px';
      tip.style.top = (CARTE_DISPO.pts[i].y + 14) + 'px';
      cv.style.cursor = 'pointer';
    } else { tip.hidden = true; cv.style.cursor = 'default'; }
  };
  cv.onmouseleave = () => { tip.hidden = true; };

  cv.onclick = () => {
    if (CARTE_SURVOL < 0) return;
    const d = CARTE.noeuds[CARTE_SURVOL].dates?.slice(-1)[0];
    if (d) { MIRROR_DATE = d; go('mirror'); }
  };

  addEventListener('resize', redimensionner, { passive: true });

  $('#view').onclick = e => {
    const b = e.target.closest('[data-fen]');
    if (b) { CARTE_FENETRE = b.dataset.fen; CARTE_SURVOL = -1; renderCarte(); }
  };
}

/* ============================= vue : réglages ============================= */

/**
 * Les motifs, tels que le compagnon les a nommés.
 *
 * Ce panneau ne dit pas ce qu'ils veulent dire — c'est la même règle que
 * partout : on montre, on ne qualifie pas. Il montre le nom que le compagnon a
 * choisi, ce à quoi il dit le reconnaître, et combien de fois. Le compte est la
 * seule mesure honnête d'un motif : dix fois en un an et dix fois en un mois ne
 * sont pas la même chose, et c'est à la personne d'en faire quelque chose.
 *
 * Le bouton « retirer » n'est pas une politesse. Un mécanisme mal nommé, posé
 * sur quelqu'un par une machine, doit pouvoir disparaître d'un clic — sinon
 * c'est une étiquette, et ce produit n'en pose pas.
 */
function motifsMarkup() {
  const liste = S.motifs?.liste ?? [];
  if (!liste.length) return '';
  return `<div class="card motifcard">
    <h2>Ce qui revient</h2>
    <p class="sub">Des mécanismes que le compagnon a repérés tout seul et suit dans la durée.
    Ce sont ses mots, pas un diagnostic — et tu peux en retirer un à tout moment.</p>
    <div class="motiflist">
      ${liste.map(m => `<div class="motifitem" style="--motif:${m.teinte}">
        <span class="motifpuce"></span>
        <div class="motiftxt">
          <b>${esc(m.nom)}</b>
          <span class="faint">${esc(m.mecanisme)}</span>
        </div>
        <span class="motifn mono">${m.vues}<small>×</small></span>
        <button class="repdel" data-delmotif="${m.id}" title="Ne plus suivre" aria-label="Ne plus suivre ${esc(m.nom)}">×</button>
      </div>`).join('')}
    </div>
  </div>`;
}

async function renderSettings() {
  const s = S.settings;

  $('#view').innerHTML = `
    ${motifsMarkup()}
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

      <div class="card danger">
        <h2>Effacer</h2>
        <p class="sub">Sans retour. Exporte d'abord si tu hésites — c'est le bouton juste au-dessus.</p>
        <div class="wipepick" id="wipePick">
          <button data-portee="notes" aria-pressed="false">
            <b>Les notes</b><span>les chiffres partent, le texte reste</span></button>
          <button data-portee="texte" aria-pressed="false">
            <b>Le texte</b><span>les mots partent, la courbe reste</span></button>
          <button data-portee="tout" aria-pressed="false">
            <b>Tout</b><span>journées, texte, repères, jalons</span></button>
        </div>
        <div id="wipeConfirm"></div>
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

  $('.motiflist')?.addEventListener('click', async e => {
    const b = e.target.closest('[data-delmotif]');
    if (!b) return;
    S.motifs = await api('/api/motifs', { delete: Number(b.dataset.delmotif) });
    drawThread();                       // le fil perd la teinte du motif retiré
    renderSettings();
  });

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
  $('#wipePick')?.addEventListener('click', e => {
    const b = e.target.closest('button[data-portee]');
    if (!b) return;
    const portee = b.dataset.portee;
    for (const x of $('#wipePick').querySelectorAll('button')) {
      x.setAttribute('aria-pressed', String(x === b));
    }
    const quoi = { notes: 'toutes tes notes', texte: 'tout ton texte', tout: 'tout ton journal' }[portee];
    // Un mot à retaper, pas une case à cocher : c'est la seule action de
    // l'application qui détruise des années sans retour, et un bouton seul se
    // clique par réflexe.
    $('#wipeConfirm').innerHTML = `
      <div class="wipeask">
        <p>Pour effacer <b>${quoi}</b>, tape <b class="mono">SUPPRIMER</b> ci-dessous.</p>
        <div class="wipefield">
          <input type="text" id="wipeWord" autocomplete="off" spellcheck="false" placeholder="SUPPRIMER">
          <button class="btn danger" id="wipeGo" disabled>Effacer</button>
        </div>
      </div>`;
    const mot = $('#wipeWord'), go = $('#wipeGo');
    mot.focus();
    mot.addEventListener('input', () => { go.disabled = mot.value.trim() !== 'SUPPRIMER'; });
    go.addEventListener('click', async () => {
      go.disabled = true; go.textContent = 'Effacement…';
      try {
        const r = await api('/api/wipe', { portee, confirm: mot.value.trim() });
        S = await api('/api/state');
        SERIES = null; ECHOES = { items: [], textCount: 0 };
        syncHeader();
        renderSettings();
        const n = Object.values(r.compte).reduce((a, b) => a + b, 0);
        toast(n ? `${n} lignes effacées · ${r.restant.days} journées restantes` : 'Rien à effacer');
      } catch (err) {
        go.disabled = false; go.textContent = 'Réessayer';
        toast(err.message);
      }
    });
  });

  $('#chatBackend').addEventListener('change', async e => {
    await saveSettings({ chatBackend: e.target.value });
    renderBackendCfg();
  });

  $('#spritepick').addEventListener('click', async e => {
    const b = e.target.closest('[data-sprite]');
    if (!b) return;
    await saveSettings({ petSprite: b.dataset.sprite });
    monterPet();                        // le compagnon vit dans le rail, pas dans la vue
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
      syncAmbiance();
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
      syncAmbiance();
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
  carte: renderCarte,
  year: () => renderYear(),
  mirror: () => renderMirror(),
  settings: renderSettings
};

const NOM_VUE = { tonight: 'Parler', year: 'Année', mirror: 'Miroir', carte: 'Carte', settings: 'Réglages' };

function syncNav() {
  for (const b of document.querySelectorAll('nav button')) {
    b.setAttribute('aria-current', String(b.dataset.view === view));
  }
  const t = $('#viewName');
  if (t) t.innerHTML = `${esc(NOM_VUE[view] ?? '')}<span class="glyphe" id="viewGlyphe"></span>`;
  syncAmbianceRail();
}

/*
 * Le décor, nommé.
 *
 * Il porte le nom du DÉCOR, pas celui d'une humeur. « Brume » décrit la pièce ;
 * « mélancolique » décrirait la personne, et l'application ne qualifie jamais
 * personne -- c'est la règle qui tient depuis le premier jour. La différence
 * n'est pas cosmétique : un décor, on le regarde ; une étiquette, on la porte.
 */
const NOM_SCENE = {
  drift: 'Neutre', brume: 'Brume', abyss: 'Abysse', eclipse: 'Éclipse',
  voidwell: 'Vide', monolith: 'Monolithe', grain: 'Grain', mandel: 'Récursif'
};

/* Un glyphe par scène. Dessiné au trait, jamais rempli : c'est une marque, pas
   une icône de statut. */
const GLYPHE_SCENE = {
  drift:    '<circle cx="9" cy="9" r="6"/>',
  brume:    '<path d="M2.5 7.5h13"/><path d="M4 11h10"/>',
  abyss:    '<path d="M9 3 16 15H2z"/>',
  eclipse:  '<circle cx="9" cy="9" r="6"/><path d="M12 4a6 6 0 0 0 0 10" fill="currentColor" stroke="none" opacity=".55"/>',
  voidwell: '<circle cx="9" cy="9" r="6"/><circle cx="9" cy="9" r="1.6"/>',
  monolith: '<rect x="6" y="2.5" width="6" height="13" rx="1"/>',
  grain:    '<path d="M2.5 9h2l1.5-4 2 8 2-6 1.5 3h4"/>',
  mandel:   '<circle cx="7.5" cy="9" r="4.6"/><circle cx="12.6" cy="9" r="2.3"/><circle cx="15.6" cy="9" r="1.1"/>'
};

function glypheMarkup(scene) {
  const d = GLYPHE_SCENE[scene] ?? GLYPHE_SCENE.drift;
  return `<svg viewBox="0 0 18 18" width="12" height="12" fill="none" stroke="currentColor"
    stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

function syncAmbianceRail() {
  const scene = S?.ambiance?.scene ?? 'drift';
  const g = $('#viewGlyphe');
  if (g) g.innerHTML = glypheMarkup(scene);

  const el = $('#ambianceRead');
  if (!el) return;
  el.hidden = false;
  el.innerHTML = `<span class="k">Ambiance</span>
    <span class="v">${esc(NOM_SCENE[scene] ?? 'Neutre')}${glypheMarkup(scene)}</span>`;
  el.title = "Le décor du fond, pas une lecture de ta journée : l'application ne qualifie jamais une journée.";
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

/** Applique la scène choisie par le serveur. Sans effet si le fond est absent. */
function syncAmbiance() {
  const a = S.ambiance;
  if (a) Ambiance.set(a.scene, a.energie);
  syncAmbianceRail();
}

async function boot() {
  S = await api('/api/state');
  suivreSession();
  // Le fond démarre après l'état : il doit savoir quelle scène poser d'entrée,
  // sinon on voit la scène par défaut céder la place trois secondes plus tard.
  monterPet();
  if (Ambiance.start()) syncAmbiance();
  else syncAmbianceRail();
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
