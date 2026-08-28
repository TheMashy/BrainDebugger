import { PETS, petMarkup } from './pets.js';
import { Ambiance } from './ambiance.js';
import { disposer } from './carte.js';
import { versGraphe, dessinerRelations, noeudAu, journeeAu, cadrer, recadrer,
         vueNeutre, zoomer, NOM_GENRE, TEINTE_GENRE, echelle } from './relations.js';
import { toPNG, PetTalk } from './pet.js';
import { VOICES, Blip } from './blips.js';
import { deltaColor, noteColor, noteScaleRGB, lineChart, dailyChart, bandMarkup, SATURATION } from './charts.js';
import { icone, iconeDe, themeDe, NOMS, ICONES, TEINTES_DECLAREES } from './reperes.js';
import { friseMarkup as friseSVG } from './frise.js';
import { calMarkup, calClic, moisDe } from './calendrier.js';

/* ============================= socle ============================= */

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const MONTHS_FR = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc'];
const fmtDay = d => {
  const [y, m, dd] = d.split('-');
  return `${Number(dd)} ${MONTHS_FR[Number(m) - 1].toLowerCase()} ${y}`;
};
const fmtTime = ts => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const joursEntre = (a, b) => Math.round(
  (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000) + 1;
const dayShift = (d, n) => {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd) + n * 86400000).toISOString().slice(0, 10);
};

/*
 * LE FUSEAU DE CETTE MACHINE, SUR CHAQUE REQUETE.
 *
 * Le serveur ne peut pas le deviner : heberge, il tourne en UTC, et « quel
 * jour sommes-nous ? » y repond faux de deux heures pour quelqu'un a Paris --
 * donc faux d'une JOURNEE entiere pour qui note apres minuit. Le navigateur,
 * lui, le sait de source sure. Il le dit a chaque fois plutot qu'une fois pour
 * toutes : on voyage, on change d'heure deux fois par an, et un fuseau
 * enregistre une fois est un fuseau qui finit par mentir.
 */
const FUSEAU = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
})();

const enTetes = (json = false) => ({
  ...(json ? { 'Content-Type': 'application/json' } : {}),
  ...(FUSEAU ? { 'X-Fuseau': FUSEAU } : {})
});

async function api(path, body) {
  const res = await fetch(path, body
    ? { method: 'POST', headers: enTetes(true), body: JSON.stringify(body) }
    : { headers: enTetes() });
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
  const pct = u.illimitee ? 100 : Math.min(100, Math.round(u.used / u.allowance * 100));
  el.innerHTML = `
    <div class="head">
      ${S.user?.avatar ? `<img src="${esc(S.user.avatar)}" alt="">` : ''}
      <div>
        <b>${esc(S.user?.username ?? 'Toi')}</b>
        <span>connecté${S.user?.id && S.user.id !== 'local' ? ' avec Discord' : ''}</span>
      </div>
      <form method="post" action="/logout" style="margin-left:auto"><button class="btn" type="submit">Déconnexion</button></form>
    </div>

    ${/* Sans enveloppe, la barre n'a plus rien à mesurer : elle deviendrait un
          décor qui bouge sans rien vouloir dire. Reste ce qui se compte encore
          — ce qui a été consommé — parce que le comptage, lui, ne s'arrête pas. */''}
    ${u.illimitee ? `
      <p class="nums"><b>${fmtTok(u.used)}</b> jetons ce mois-ci · <span class="sansenv">sans enveloppe</span></p>
      <p class="sub" style="margin:0 0 12px">
        ${u.calls} échange${u.calls > 1 ? 's' : ''} depuis le début du mois. Le plafond est retiré
        dans Réglages ; le compte, lui, continue.
      </p>` : `
      <div class="bar" data-level="${u.level}"><i style="width:${pct}%"></i></div>
      <p class="nums">
        <b>${fmtTok(u.remaining)}</b> jetons restants sur ${fmtTok(u.allowance)} ce mois-ci
      </p>
      <p class="sub" style="margin:0 0 12px">
        Remise à zéro le ${fmtDay(u.resetsOn)}. ${u.calls} échange${u.calls > 1 ? 's' : ''} depuis le début du mois.
      </p>`}
    ${/* Cette phrase suppose que c'est la clé de l'hébergeur qui règle. Sans
          enveloppe, elle ne le suppose plus : c'est la clé de celui qui lit. */''}
    ${u.illimitee ? '' : `<p class="paid">Tu n'as rien à payer. C'est BrainDebugger qui règle.</p>`}
    ${u.exhausted ? `<p class="sub" style="color:var(--warn);margin:12px 0 0">
      Enveloppe épuisée pour ce mois. Le compagnon continue de répondre, mais hors-ligne —
      il ne se souvient plus de la conversation.
      <br>Tu peux la retirer dans Réglages, section « Modèle ».</p>` : ''}
    ${/* Le mode pudique se declenche ici, et pas seulement dans Reglages : on
          l'allume dans la seconde qui precede un partage d'ecran, et traverser
          trois vues pour le trouver, c'est trois vues de journal a l'ecran. */''}
    ${pudMarkup()}`;
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
  appliquerPudique();
  return settings;
}

/* --------------------------- le mode prive ---------------------------

   « pudique » est le nom de la cle en base et des selecteurs ; « mode prive »
   est ce qui s'affiche. Renommer la cle demanderait une migration pour un mot,
   et une migration qui rate coute un reglage ; le nom visible, lui, se change
   en une ligne.


   Un seul attribut sur la racine ; tout le reste est du CSS. La toile de la
   carte, elle, ne sait pas lire une feuille de style : elle relit le reglage
   au moment de peindre, donc il faut la repeindre nous-memes.              */

function appliquerPudique() {
  const on = !!S.settings?.pudique;
  if (on) document.documentElement.dataset.pudique = '';
  else document.documentElement.removeAttribute('data-pudique');
  for (const b of document.querySelectorAll('[data-bascule-pudique]')) {
    b.setAttribute('aria-pressed', String(on));
    // Le libelle suit l'etat sans re-rendre la vue : le panneau de la jauge
    // n'est redessine qu'a l'ouverture, et un bouton qui dit encore « actif »
    // apres l'avoir coupe est exactement le doute qu'on ne veut pas avoir.
    const l = b.querySelector('.pudlib');
    if (l) l.textContent = on ? 'Mode privé — actif' : 'Mode privé';
  }
  // Les noms des noeuds sont peints, pas ecrits : seule une nouvelle image les
  // remplace. Le bouton de recentrage porte le redessin de la carte.
  RELA_PEINDRE?.();
}

/**
 * Basculer.
 *
 * On bascule d'abord a l'ecran, on enregistre ensuite : ce bouton sert dans la
 * seconde qui precede un partage d'ecran, et attendre un aller-retour serveur
 * pour effacer son journal est exactement le moment ou on ne veut pas attendre.
 */
async function basculerPudique(v = !S.settings?.pudique) {
  S.settings = { ...S.settings, pudique: v };
  appliquerPudique();
  toast(v ? 'Mode privé — les mots sont masqués' : 'Mode privé désactivé');
  try { await saveSettings({ pudique: v }); } catch { /* l'écran a déjà obéi */ }
}

/** Le bouton, identique dans la jauge et dans les réglages. */
const pudMarkup = () => `<button class="pudbtn" data-bascule-pudique aria-pressed="${!!S.settings?.pudique}">
  <span class="pudpuce" aria-hidden="true"></span>
  <span class="pudlib">Mode privé${S.settings?.pudique ? ' — actif' : ''}</span>
  <kbd>Ctrl+Maj+P</kbd>
</button>`;

/* ============================= vue : parler =============================

   Une seule page pour le rituel du soir : tu parles, le compagnon relance,
   tes propres mots d'avant remontent tout seuls, et tu notes.
   La recherche n'est pas un onglet : chercher est une corvee, se voir rappeler
   ses mots ne l'est pas. -- SPEC 2.2
                                                                            */


/*
 * LE JOUR QUE LA CARTE DE NOTE VISE.
 *
 * Aujourd'hui, presque toujours. Mais on note le soir, et un soir on oublie :
 * une semaine sautee restait sautee pour toujours -- la grille gardait ses
 * trous, et la reference glissante comptait avec un mois de moins. Ce n'est pas
 * une lacune d'interface, c'est la seule perte de donnees que ce produit ne
 * savait pas reparer.
 *
 * Le curseur revient a aujourd'hui des qu'on quitte la vue : rattraper est un
 * geste ponctuel, pas un mode dans lequel on reste.
 */
let NOTE_JOUR = null;

async function renderTonight() {
  const t = NOTE_JOUR ?? S.today;
  const hier = t !== S.today;
  // Un jour visé sort de `aNoter` : il est sans note par construction, et
  // aller le demander au serveur serait un aller-retour pour apprendre `null`.
  const note = hier ? null : (S.entry?.note ?? null);
  const s = S.settings;
  const manques = S.stats.aNoter ?? [];
  // Un echec ici ne doit pas empecher d'ecrire : le trombone est un indicateur,
  // la conversation est le produit.
  try { OBJECTIFS = (await api('/api/objectifs')).objectifs ?? []; } catch { OBJECTIFS = []; }

  $('#view').innerHTML = `
    <div class="tonight">
      <div class="thread" id="thread"></div>

      <div class="composer">
        ${/* Le trombone. Il n'ouvre rien qu'on remplisse : c'est un indicateur,
              et il n'apparait que s'il y a quelque chose a indiquer. */''}
        <button class="clip" id="clip" aria-expanded="false" aria-label="Ce que tu tiens"
                title="Ce que tu tiens" ${OBJECTIFS.length ? '' : 'hidden'}>
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
               stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M20.4 11.6 12.3 19.7a5 5 0 0 1-7.1-7.1l8.1-8.1a3.3 3.3 0 0 1 4.7 4.7l-8.1 8.1a1.7 1.7 0 0 1-2.4-2.4l7.5-7.5"/>
          </svg>
          ${OBJECTIFS.some(o => !o.tenu) ? '<i class="clipdot"></i>' : ''}
        </button>
        <div class="pop objpop" id="objpop" hidden>${objectifsMarkup()}</div>
        <textarea id="input" rows="1" placeholder="Écris ici…" aria-label="Ton message"></textarea>
        <button class="sendarrow" id="send" aria-label="Envoyer" title="Envoyer">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
               stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 12h15"/><path d="M13 6l6 6-6 6"/>
          </svg>
        </button>
      </div>

      <div class="notecard${hier ? ' rattrape' : ''}">
        <div class="noteline">
          <span class="k">${hier ? `Tu notes le ${fmtDay(t)}` : 'Note avant de te coucher'}</span>
          ${hier ? `<button class="retourjour" data-notejour="">revenir à aujourd'hui</button>` : ''}
          ${S.stats.reference !== null
            ? `<span class="ref">référence <b class="mono">${S.stats.reference}</b></span>` : ''}
          <button class="newchat" id="newChat" title="Repartir sur un fil vide. Rien n'est effacé : tes journées restent dans le journal.">Nouveau&nbsp;fil</button>
        </div>

        ${/* Les jours manqués. Ils n'apparaissent que s'il y en a — une rangée
              permanente de cases vides serait un reproche quotidien, et ce
              produit ne relance pas les jours de silence. */''}
        ${manques.length ? `<div class="manques">
          <span class="k faint">non notés</span>
          ${manques.map(m => `<button data-notejour="${m.date}"
            aria-pressed="${t === m.date}"
            title="${m.ecrit ? 'Tu as écrit ce jour-là, sans le noter.' : 'Rien pour ce jour-là.'}"
            >${fmtJourCourt(m.date)}${m.ecrit ? '<i></i>' : ''}</button>`).join('')}
        </div>` : ''}

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
    // Une journée rattrapée sort de la liste des manques : on repart sur celle
    // d'après tant qu'il en reste, et sinon on revient à aujourd'hui. Rattraper
    // une semaine devient six clics au lieu de six allers-retours.
    if (hier) {
      const reste = (S.stats.aNoter ?? []).filter(m => m.date !== t);
      NOTE_JOUR = reste.length ? reste[0].date : null;
    }
    renderTonight();
    toast(`${hier ? fmtDay(t) : 'Journée'} notée ${n}/10`);
  };

  /*
   * Choisir le jour que la carte vise.
   *
   * `.onclick` sur la CARTE, pas `addEventListener` sur `#view` : la carte est
   * reconstruite a chaque rendu, `#view` non. Un `addEventListener` posé à
   * chaque rendu empile les écouteurs, et au troisième clic la carte se
   * redessine trois fois — le bouton qu'on venait de viser est détaché du DOM
   * avant que son propre clic soit traité.
   */
  const carte = $('.notecard');
  if (carte) carte.onclick = e => {
    const j = e.target.closest('[data-notejour]');
    if (!j) return;
    NOTE_JOUR = j.dataset.notejour || null;
    renderTonight();
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
  input.oninput = () => autoSize(input);
  input.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
  $('#send').onclick = send;

  const clip = $('#clip'), pop = $('#objpop');
  clip.onclick = () => {
    const ouvert = pop.hidden;
    pop.hidden = !ouvert;
    clip.setAttribute('aria-expanded', String(ouvert));
  };
  pop.onclick = async e => {
    const d = e.target.closest('[data-delobj]');
    if (!d) return;
    OBJECTIFS = (await api('/api/objectifs', { delete: Number(d.dataset.delobj) })).objectifs ?? [];
    if (!OBJECTIFS.length) { pop.hidden = true; clip.hidden = true; return; }
    pop.innerHTML = objectifsMarkup();
  };
  // Un panneau flottant qui ne se ferme qu'en recliquant son bouton reste
  // ouvert par-dessus la conversation qu'on est venu reprendre.
  document.addEventListener('click', e => {
    if (pop.hidden || e.target.closest('#objpop, #clip')) return;
    pop.hidden = true;
    clip.setAttribute('aria-expanded', 'false');
  });

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
  art.innerHTML = petMarkup(S.settings, S.ambiance);
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

/** « lun. 24 » : de quoi reconnaître un jour de la semaine passée, sans plus. */
const fmtJourCourt = d => new Date(d + 'T00:00:00')
  .toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });

/** « 7 h », « 2 j » : une durée qu'on lit d'un coup d'œil, jamais à la minute. */
function dureeCourte(ms) {
  const h = Math.round(ms / 3600000);
  if (h < 48) return `${h} h`;
  const j = Math.round(h / 24);
  return j < 14 ? `${j} jours` : `${Math.round(j / 7)} semaines`;
}

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
    const creux = i > 0 ? ts - dernierTs : 0;
    const pause = i === 0 || sep || creux >= PAUSE_MS;
    dernierTs = ts;

    /*
     * LE SILENCE SE VOIT.
     *
     * Une heure de plus dans un horodatage ne se remarque pas ; « 7 h plus
     * tard », si. Et c'est l'information qu'on cherche en relisant une soirée
     * six mois après : est-ce que ces deux phrases se suivaient, ou est-ce
     * qu'il y a eu une nuit entre les deux.
     *
     * Le seuil est de trois heures et le marqueur ne double jamais le
     * séparateur de journée, qui dit déjà « on a changé de jour ».
     */
    const silence = !sep && creux >= 3 * 3600 * 1000
      ? `<div class="creux"><span>${dureeCourte(creux)} plus tard</span></div>` : '';

    // Les motifs reconnus dans CE message le teintent, lui et pas la
    // conversation : c'est la phrase qui porte le mécanisme, pas la soirée.
    const mots = parMsg[m.id] ?? [];
    const teinte = mots.length ? ` style="--motif:${mots[0].teinte}"` : '';
    const marque = mots.length
      ? `<span class="motifs">${mots.map(x =>
          `<button class="motifchip" data-motif="${x.id}" style="--motif:${x.teinte}"
            title="Motif suivi par le compagnon">${esc(x.nom)}</button>`).join('')}</span>`
      : '';
    return sep + silence + `<div class="msg ${m.role}${passe}${mots.length ? ' teinte' : ''}"${teinte} data-id="${m.id ?? ''}"
      >${pause ? `<span class="t">${fmtTime(m.ts)}</span>` : ''
      }${reflexionMarkup(m)}<span class="tx">${esc(m.text)}</span>${marque}${rembobMarkup(m)}</div>`;
  }).join('') + gestesMarkup();
  // On revient toujours en bas et replié : un rendu du fil est un retour à la
  // conversation, pas une reprise de lecture.
  th.classList.remove('ouvert', 'reading');
  th.scrollTop = th.scrollHeight;
  bindThreadReveal(th);
  majFil(th);
  bindGestes(th);
  syncPetSay();
}

/*
 * CE QU'IL S'EST DIT AVANT DE REPONDRE.
 *
 * Replie par defaut, et ce n'est pas de la timidite d'interface : une
 * reflexion est un BROUILLON. Elle hesite, elle se reprend, elle formule
 * parfois de travers ce que la reponse dira correctement. Depliee d'office,
 * elle se lirait comme un deuxieme avis -- souvent plus cru que le premier, et
 * sur cette application-la, lu par quelqu'un qui vient de raconter sa soiree.
 *
 * Elle reste montrable, et c'est tout l'interet : quand une reponse tombe a
 * cote, la premiere question est « qu'est-ce qu'il a compris ? », et la
 * reponse est ici.
 */
const PENSEES_OUVERTES = new Set();

function reflexionMarkup(m) {
  if (m.role !== 'pet' || !m.reflexion) return '';
  const ouvert = PENSEES_OUVERTES.has(m.id);
  return `<div class="pensee${ouvert ? ' ouverte' : ''}">
    <button class="penseetete" data-pensee="${m.id}" aria-expanded="${ouvert}">
      <span class="lueur" aria-hidden="true"></span>
      <span>${ouvert ? 'ce qu\'il s\'est dit' : 'il a réfléchi avant de répondre'}</span>
    </button>
    ${ouvert ? `<p class="penseetx">${esc(m.reflexion)}</p>` : ''}
  </div>`;
}

/*
 * REVENIR ICI.
 *
 * Le geste manquait, et il manquait exactement aux moments ou l'on tient le
 * moins a se battre avec une interface : le compagnon vient de retomber
 * hors-ligne et repond a cote, ou l'on se relit une faute une seconde trop
 * tard. Sans lui, il ne restait qu'a ecrire un deuxieme message pour corriger
 * le premier -- et les deux entraient dans la journee.
 *
 * Il n'est propose que sur ses propres messages : rembobiner depuis une reponse
 * du compagnon laisserait la question sans reponse, ce qui n'est pas un etat
 * dans lequel on veut se retrouver.
 */
function rembobMarkup(m) {
  if (m.role !== 'user' || !m.id) return '';
  return `<button class="rembob" data-rembob="${m.id}"
    title="Revenir à ce message : ce qui suit est effacé, et cette phrase revient dans le champ.">revenir ici</button>`;
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
/* ===================== ce qu'il tient =====================
 *
 * C'EST UN INDICATEUR, PAS UN SUIVI.
 *
 * Pas de case a cocher, pas de rappel, pas de pourcentage : la liste dit ce
 * qu'il a decide, depuis combien de jours ca tient, et si c'est rompu en ce
 * moment. Rien d'autre. Une resolution qu'on ne tient pas n'est pas un echec a
 * signaler, et une application qui la note transforme un appui en jugement.
 *
 * Les objectifs se posent et se mettent a jour dans la CONVERSATION -- c'est la
 * qu'on dit « il faudrait vraiment que j'arrete » et « j'ai craque samedi ».
 * Le seul geste ici est de retirer.
 */
let OBJECTIFS = [];

const joursTenus = d => Math.max(0, joursEntre(d, S.today) - 1);

function objectifsMarkup() {
  if (!OBJECTIFS.length) return '';
  return `<div class="objliste">${OBJECTIFS.map(o => {
    const n = joursTenus(o.depuis);
    const duree = n === 0 ? "aujourd'hui" : `${n} jour${n > 1 ? 's' : ''}`;
    return `<div class="objitem${o.tenu ? '' : ' rompu'}">
      <span class="objico">${icone(o.genre, 18)}</span>
      <div class="objtxt">
        <b>${esc(o.quoi)}</b>
        <span>${o.tenu ? `tenu · ${duree}` : `rompu · ${duree} avant`}${
          o.reprises ? ` · ${o.reprises}<sup>e</sup> reprise` : ''}</span>
      </div>
      <button class="repdel" data-delobj="${o.id}" title="Retirer" aria-label="Retirer ${esc(o.quoi)}">×</button>
    </div>`;
  }).join('')}</div>`;
}

let GESTES = [];

function gestesMarkup() {
  if (!GESTES.length) return '';
  return `<div class="gestes">${GESTES.map(g => g.type === 'objectif'
    ? `<div class="geste objectif${g.tenu ? '' : ' rompu'}">
         <span class="gicone">${icone(g.genre, 20)}</span>
         <div class="gtxt">
           <b>${g.nouveau ? 'Objectif noté' : g.tenu ? 'Ça repart' : 'Rompu'}</b>
           <span>${esc(g.quoi)}</span>
         </div>
         <button class="gbtn" data-clip="1">voir</button>
       </div>`
    : g.type === 'note'
    ? `<div class="geste note">
         <span class="gicone">${icone('pensee', 20)}</span>
         <div class="gtxt">
           <b>Rangé dans tes notes</b>
           ${/* Le compte de signes, parce que c'est la seule chose qui dit
                 ce qui vient d'etre range sans le recopier dans le fil. */''}
           <span>${g.taille} signes${g.jour ? ` · ${fmtDay(g.jour)}` : g.quand ? ` · ${esc(g.quand)}` : ' · sans date'}
             — ne compte pas comme une journée écrite</span>
         </div>
         ${g.jour ? `<button class="gbtn" data-voir="${g.jour}">voir</button>` : ''}
       </div>`
    : g.type === 'repere'
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
  majFil(th);
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
  th.addEventListener('click', async e => {
    // Déplier ou replier une réflexion. Sur la bulle en cours, la boîte n'a pas
    // encore d'identifiant : on bascule la classe sur place.
    const pv = e.target.closest('[data-pensee-live]');
    if (pv) {
      pv.closest('.pensee').classList.toggle('ouverte');
      pv.setAttribute('aria-expanded', String(pv.closest('.pensee').classList.contains('ouverte')));
      return;
    }
    const pe = e.target.closest('[data-pensee]');
    if (pe) {
      const id = Number(pe.dataset.pensee);
      if (PENSEES_OUVERTES.has(id)) PENSEES_OUVERTES.delete(id); else PENSEES_OUVERTES.add(id);
      return drawThread();
    }
    const rb = e.target.closest('[data-rembob]');
    if (rb) return rembobiner(Number(rb.dataset.rembob));

    const v = e.target.closest('[data-voir]');
    if (v) {
      demanderAura(v.dataset.voir);
      return ouvrirJour(v.dataset.voir);
    }
    /*
     * UN MECANISME MENE A « MA CARTE », PLUS AUX REGLAGES.
     *
     * Il y menait parce que les motifs y vivaient. Ils ont demenage -- ils sont
     * maintenant a cote de la carte et de la synthese, avec les themes, dans la
     * seule liste de mecanismes -- et ce lien-la etait reste en arriere. Cliquer
     * « urgence a eteindre » sous une phrase qu'on vient d'ecrire ouvrait donc
     * l'onglet des preferences : la reponse a « qu'est-ce qu'il entend par la ? »
     * arrivait entre le timbre des bips et la cle d'API.
     *
     * Et il ne mene pas seulement a la vue : il OUVRE le mecanisme en question.
     * Atterrir sur une liste de huit lignes en ayant clique sur l'une d'elles
     * fait recommencer le geste.
     */
    const m = e.target.closest('[data-motifs]') || e.target.closest('[data-motif]');
    if (m) {
      MIR_THEME = m.dataset.motif ? `motif:${m.dataset.motif}` : null;
      MIRROR_DATE = null;
      view = 'mirror'; syncNav();
      await renderLecture();
      // Après le rendu : la liste peut être sous le pli sur un écran court, et
      // un mécanisme déplié qu'on ne voit pas est un clic sans réponse.
      $('#view').querySelector('.meca.ouvert')
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    // « voir » sur un objectif ouvre le trombone, pas une autre vue : ce qu'on
    // vient de poser est a deux centimetres, sous le composeur.
    const c = e.target.closest('[data-clip]');
    if (c) {
      const pop = $('#objpop');
      if (pop) { pop.hidden = false; $('#clip')?.setAttribute('aria-expanded', 'true'); }
    }
  });
}

/**
 * Le fil : replié sur sa fin, ouvert quand on remonte.
 *
 * DEUX SEUILS, PAS UN. Ouvrir demande d'avoir remonté de quarante pixels ;
 * refermer demande d'être revenu au bas exact. Avec un seuil unique, ouvrir
 * fait grandir la boîte, ce qui rapproche mécaniquement du bas, ce qui referme,
 * ce qui rétrécit — le fil clignote sous le curseur.
 *
 * Et on garde l'ancrage : `scrollHeight − scrollTop` avant, restauré après.
 * Sans ça, la boîte grandit sous le texte qu'on était en train de lire et il
 * saute de trois cents pixels au moment précis où on le lisait.
 */
function majFil(th) {
  const deborde = th.scrollHeight > th.clientHeight + 4;
  const duBas = th.scrollHeight - th.scrollTop - th.clientHeight;
  const ouvert = th.classList.contains('ouvert');

  if (!ouvert && duBas > 40) {
    const ancre = th.scrollHeight - th.scrollTop;
    th.classList.add('ouvert');
    th.scrollTop = th.scrollHeight - ancre;
  } else if (ouvert && duBas < 4) {
    th.classList.remove('ouvert');
    th.scrollTop = th.scrollHeight;
  }
  th.classList.toggle('fondu', deborde && !th.classList.contains('ouvert'));
  th.classList.toggle('reading', duBas >= 24);
}

function bindThreadReveal(th) {
  if (th.dataset.reveal) return;      // un seul écouteur, pas un par rendu
  th.dataset.reveal = '1';
  th.addEventListener('scroll', () => majFil(th), { passive: true });
}

/*
 * La bulle en cours d'ecriture. Elle vit hors de `S.messages` : ce message
 * n'existe pas encore en base, et le mettre dans l'etat obligerait chaque
 * redessin du fil a savoir qu'un de ses elements est en train d'etre tape.
 */
let EN_COURS = null;

/** Le point qui pulse s'arrete des la premiere lettre : il a dit ce qu'il avait a dire. */
function finAttente(el) {
  const a = el?.querySelector('.attente');
  if (a) a.remove();
  el?.querySelector('.penseeetat')?.replaceChildren(document.createTextNode('ce qu\'il s\'est dit'));
  el?.querySelector('.pensee')?.classList.remove('vivante');
}

/** Le composeur grandit avec le texte, jusqu'à 160 px. */
function autoSize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
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

  let typing = null;

  try {
    const res = await fetch('/api/message/stream', {
      method: 'POST',
      headers: enTetes(true),
      body: JSON.stringify({ text, date: S.today })
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    await readSSE(res, (ev, data) => {
      if (ev === 'error') { toast(data.error); return; }

      if (ev === 'user') {
        S.messages = data.messages;
        drawThread();
        /*
         * LA BULLE EXISTE AVANT LA PREMIERE LETTRE.
         *
         * Elle s'ouvre sur un point qui pulse. Entre l'envoi et le premier mot
         * il peut s'ecouler plusieurs secondes -- davantage quand le compagnon
         * pose un repere en chemin -- et ce blanc-la, sur une application ou
         * l'on vient de raconter quelque chose de difficile, se lit comme
         * « il n'a rien reçu ». Un signe qui bouge dit « il est là », ce qui
         * est le minimum qu'on doive a quelqu'un qui attend.
         */
        const th = $('#thread');
        const el = document.createElement('div');
        el.className = 'msg pet encours';
        el.innerHTML = `<div class="pensee vivante" hidden>
            <button class="penseetete" data-pensee-live aria-expanded="false">
              <span class="lueur" aria-hidden="true"></span><span class="penseeetat">il réfléchit</span>
            </button>
            <p class="penseetx"></p>
          </div>
          <span class="attente" aria-label="Il réfléchit"><i></i><i></i><i></i></span>
          <span class="tx"></span>`;
        th.appendChild(el);
        EN_COURS = el;
        th.scrollTop = th.scrollHeight;
        majFil(th);
        Blip.reset();
        typing = PetTalk.startStream($('#art'), el.querySelector('.tx'),
                                     { onChar: speakChar, onPremier: () => finAttente(el) });
        return;
      }

      /*
       * La reflexion arrive AVANT la reponse, et se pousse toute seule vers le
       * bas : on suit la derniere ligne comme on suit un curseur, sans avoir a
       * la lire -- c'est le fait qu'elle bouge qui informe, pas son contenu.
       */
      if (ev === 'pense') {
        if (!EN_COURS) return;
        const box = EN_COURS.querySelector('.pensee');
        const tx = EN_COURS.querySelector('.penseetx');
        box.hidden = false;
        tx.textContent += data.text;
        if (!box.classList.contains('ouverte')) tx.scrollTop = tx.scrollHeight;
        $('#thread').scrollTop = $('#thread').scrollHeight;
        return;
      }

      // Un geste arrive pendant que le compagnon parle : la marque apparaît
      // en même temps que la phrase qui la mentionne, pas plusieurs secondes
      // après, où elle aurait l'air d'être tombée toute seule.
      if (ev === 'geste') {
        GESTES.push(data);
        // Le trombone suit le geste immediatement : voir apparaitre « objectif
        // note » et trouver un trombone vide en cliquant serait une panne.
        if (data.type === 'objectif') {
          OBJECTIFS = [data, ...OBJECTIFS.filter(o => o.id !== data.id)]
            .sort((a, b) => (a.tenu - b.tenu) || b.depuis.localeCompare(a.depuis));
          const clip = $('#clip'), pop = $('#objpop');
          if (clip) clip.hidden = false;
          if (pop) pop.innerHTML = objectifsMarkup();
        }
        dessinerGestes();
        return;
      }

      if (ev === 'delta') {
        PetTalk.feed(data.text);
        $('#thread').scrollTop = $('#thread').scrollHeight;
        return;
      }

      if (ev === 'done') {
        PetTalk.endStream();
        finAttente(EN_COURS);
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
    EN_COURS = null;
    drawThread();                       // repose les horodatages définitifs
  } catch (err) {
    PetTalk.stop();
    EN_COURS = null;
    toast(String(err.message));
  } finally {
    const b = $('#send');
    if (b) b.disabled = false;
    $('#input')?.focus();
  }
}

/*
 * REMBOBINER.
 *
 * Deux choses la rendent sure sans qu'elle ait besoin d'une boite de dialogue :
 * on dit combien de messages partent, et le message vise revient dans le
 * composeur. Ce qui disparait de la base reapparait donc dans le champ ou l'on
 * ecrit -- il n'y a pas d'instant ou la phrase n'existe nulle part.
 *
 * L'etat entier est relu apres coup. Le rembobinage change le texte d'une
 * journee, donc le compte des journees ecrites, donc la reference, donc le
 * decor : recoller ces morceaux un par un cote client, c'est se garantir qu'un
 * d'entre eux finira par mentir.
 */
async function rembobiner(id) {
  const msg = S.messages.find(m => m.id === id);
  if (!msg) return;
  const apres = S.messages.filter(m => (Date.parse(m.ts) || 0) > (Date.parse(msg.ts) || 0)).length;
  if (apres && !confirm(
      `Revenir à ce message ?\n\n${apres} message${apres > 1 ? 's' : ''} qui ${apres > 1 ? 'suivent' : 'suit'} `
      + `${apres > 1 ? 'seront effacés' : 'sera effacé'}. Ta phrase revient dans le champ pour que tu la réécrives.`)) {
    return;
  }
  PetTalk.stop();
  try {
    const r = await api('/api/message/rembobiner', { id });
    S = await api('/api/state');
    GESTES = [];
    drawThread();
    syncHeader();
    syncGauge();
    syncAmbiance();
    const input = $('#input');
    if (input && r.texte) {
      input.value = r.texte;
      autoSize(input);
      input.focus();
      // Le curseur au bout : on revient corriger la fin d'une phrase bien plus
      // souvent qu'on ne revient la reecrire depuis le debut.
      input.setSelectionRange(r.texte.length, r.texte.length);
    }
    toast(r.supprimes > 1 ? `${r.supprimes} messages retirés.` : 'Message retiré.');
  } catch (err) {
    toast(err.message);
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

/* ---------------------------------------------------------------------
 * IL N'Y A PLUS DE PANNEAU « TU AS DEJA ECRIT CA » DANS « PARLER ».
 *
 * Il cherchait dans le corpus pendant la frappe et posait sous le composeur les
 * journees qui ressemblaient a ce qu'on etait en train d'ecrire. C'etait juste,
 * et c'etait au mauvais endroit : on raconte sa soiree a quelqu'un, et
 * l'application affiche par-dessous « tu as deja ecrit ca » avec les dates. La
 * remarque est vraie et personne ne l'a demandee — c'est le ton d'une machine
 * qui coche, pas de quelqu'un en face.
 *
 * La recherche existe toujours, a l'identique. Elle part maintenant vers le
 * COMPAGNON, dans son contexte, et c'est lui qui decide s'il la rend — quand
 * quelqu'un dit que ca n'arrive jamais, quand il croit que c'est la premiere
 * fois, quand il cherche ce qui avait marche. Voir echoBlock() dans chat.js.
 *
 * Le Miroir garde son « tu as deja ecrit ca » : c'est une surface de
 * restitution, on y va pour ca.
 * ------------------------------------------------------------------- */

/**
 * Premier lancement : aucune donnée. On ne montre pas une page vide avec des
 * tirets — on dit ce qui manque et par où commencer.
 */
function renderNoData(why) {
  $('#view').innerHTML = `<div class="card" style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
    <div style="width:84px;height:84px;flex:none">${petMarkup(S.settings, S.ambiance)}</div>
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
let CARNET = { notes: [], compte: { total: 0, datees: 0, libres: 0 } };
let FRISE = null;
// « journal » par defaut : c'est le cadre qui partage l'axe de la courbe, donc
// celui ou un repere tombe sur l'inflexion qu'il explique. « vie » reste a un
// clic pour aller voir l'avant-journal.
let FRISE_CADRE = 'journal';
/*
 * LE CUMUL DEMARRE EN REFERENCE GLISSANTE.
 *
 * L'etalon fixe compare quatre ans de journees a une meme constante : c'est la
 * formule du tableur d'origine, et elle a le defaut de son epoque -- quelqu'un
 * dont la vie a change en 2024 lit encore ses journees de 2026 a l'aune de
 * 2022. La mediane glissante des 365 jours precedents compare chaque journee a
 * la periode qui l'entoure, ce qui est la question qu'on se pose vraiment.
 *
 * L'etalon reste accessible : c'est la meme serie, lue autrement, et l'ancienne
 * lecture n'est pas fausse.
 */
let CUMMODE = 'reference';

/*
 * LA FENETRE DU CUMUL.
 *
 * Le cumul est une somme depuis le premier jour. Sur quatre ans, sa pente dit
 * une chose vraie mais lointaine, et la derniere saison y est invisible : elle
 * fait trois pixels au bout d'une courbe qui en fait mille.
 *
 * Une fenetre repart de zero a son debut. « Sur les trente derniers jours, ou
 * est-ce que je suis par rapport a mon etalon » est une question differente de
 * « sur quatre ans », et c'est celle qu'on se pose le plus souvent.
 *
 * La soustraction est exacte : cumul[i] - cumul[i0-1] EST la somme sur la
 * fenetre, parce que c'est la meme somme. On ne recalcule rien cote navigateur
 * -- deux arithmetiques pour le meme chiffre finissent toujours par diverger.
 *
 * Les bornes sont en JOURS CALENDAIRES, pas en indices : « 30 j » doit vouloir
 * dire trente jours, pas trente journees ecrites, sinon la fenetre s'etire
 * silencieusement sur six mois quand on a peu ecrit.
 */
const FENETRES = [['7j', 7, '7 j'], ['30j', 30, '30 j'], ['365j', 365, '1 an'], ['tout', null, 'tout']];
let CUMWIN = 'tout';

/** Le libellé humain de la fenêtre courante. */
function libFenetre() {
  const f = FENETRES.find(x => x[0] === CUMWIN) ?? FENETRES.at(-1);
  return f[1] === null ? 'tout le journal' : `les ${f[1]} derniers jours`;
}

function fenetreCumul() {
  const f = FENETRES.find(x => x[0] === CUMWIN) ?? FENETRES.at(-1);
  if (f[1] === null) return { i0: 0, jours: null };
  const depuis = dayShift(SERIES.date.at(-1), -(f[1] - 1));
  const i0 = SERIES.date.findIndex(d => d >= depuis);
  return { i0: i0 < 0 ? SERIES.date.length - 1 : i0, jours: f[1] };
}

async function renderYear(year) {
  if (!S.stats.days) return renderNoData('Les courbes ont besoin de journées notées.');
  year = year ?? Number(S.stats.lastDate.slice(0, 4));
  SERIES ??= await api('/api/series');
  CARNET = await api('/api/carnet');
  FRISE = await api('/api/frise');
  const grid = await api(`/api/year?year=${year}`);
  const eta = SERIES.etalon;

  const cumKey = CUMMODE === 'etalon' ? 'cumEtalon' : 'cumDeltaRef';
  const { i0: CUM0 } = fenetreCumul();
  const base = CUM0 > 0 ? SERIES[cumKey][CUM0 - 1] : 0;
  const cumX = SERIES.date.slice(CUM0);
  const cumY = SERIES[cumKey].slice(CUM0).map(v => Math.round((v - base) * 1000) / 1000);
  const drift = cumY.length ? cumY.at(-1) / cumY.length : 0;

  /*
   * Les annees que la fenetre couvre, et rien d'autre. C'est ce qui empeche la
   * grille de contredire les deux courbes en dessous : sur « 30 j », proposer
   * 2022 laisserait regarder une grille de 2022 au-dessus d'un cumul du mois
   * dernier, en croyant lire la meme periode.
   */
  const anneesFenetre = [...new Set(cumX.map(d => d.slice(0, 4)))];
  if (!anneesFenetre.includes(String(year))) year = Number(anneesFenetre.at(-1) ?? year);

  $('#view').innerHTML = `
    <div class="stack">
      ${/*
         * UNE SEULE FENETRE POUR LES TROIS.
         *
         * Il y en avait trois : les annees au-dessus de la grille, « annee /
         * tout » au-dessus du quotidien, et « 7 j / 30 j / 1 an / tout »
         * au-dessus du cumul. Trois reglages du meme parametre, a trois
         * endroits, avec trois vocabulaires -- et rien n'empechait de regarder
         * un quotidien de 2026 au-dessus d'un cumul sur quatre ans en croyant
         * lire la meme periode.
         *
         * Les annees restent, mais elles ont change de metier : ce ne sont plus
         * des fenetres concurrentes, c'est la page de la grille A L'INTERIEUR de
         * la fenetre, et elles disparaissent quand la fenetre n'en couvre qu'une.
         */''}
      <div class="fenetrebar">
        <span class="k faint">Fenêtre</span>
        <div class="centerpick">
          ${FENETRES.map(([id, , lib]) => `<button data-win="${id}"
            aria-pressed="${CUMWIN === id}">${lib}</button>`).join('')}
        </div>
        <span class="faint mono fenmeta">${cumX.length} journée${cumX.length > 1 ? 's' : ''} · ${libFenetre()}</span>
      </div>

      <div class="card">
        <div class="cardhead" style="margin-bottom:15px">
          <h2>Grille</h2>
          ${anneesFenetre.length > 1 ? `<div class="centerpick" style="margin-left:auto">
            ${anneesFenetre.map(y => `<button data-year="${y}" aria-pressed="${Number(y) === year}">${y}</button>`).join('')}
          </div>` : ''}
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
        <div class="cardhead" style="margin-bottom:4px">
          <h2>Écart quotidien</h2>
          <span class="faint mono" style="font-size:11.5px">${libFenetre()}</span>
        </div>
        ${dailyChart(cumX, cumX.map((_, i) => SERIES.contrastFixed[CUM0 + i]),
                     { height: 240, events: SERIES.events })}
      </div>

      <div class="card">
        ${/* Une seule rangee de commandes. Il y en avait trois empilees :
              la fenetre, le cadre, puis le mode et l'etalon -- soixante pixels
              de hauteur avant d'atteindre la courbe qu'on est venu voir. */''}
        <div class="cardhead cumhead">
          <h2>Cumul</h2>
          ${/* « vie » n'a de sens que sur tout : une fenetre de sept jours n'a
                pas d'avant-journal a montrer. */''}
          ${CUMWIN === 'tout' && FRISE?.etendue?.journal && FRISE.etendue.debut < FRISE.etendue.journal.debut
            ? `<div class="centerpick">
                 <button data-cadre="journal" aria-pressed="${FRISE_CADRE === 'journal'}">journal</button>
                 <button data-cadre="vie" aria-pressed="${FRISE_CADRE === 'vie'}">vie</button>
               </div>` : ''}
          <div class="centerpick" style="margin-left:auto">
            <button data-cum="etalon" aria-pressed="${CUMMODE === 'etalon'}"
              title="Somme des écarts à un étalon fixe.">étalon</button>
            <button data-cum="reference" aria-pressed="${CUMMODE === 'reference'}"
              title="Somme des écarts à la médiane glissante des 365 jours précédents.">glissante</button>
          </div>
          <label class="field etalonfield"
                 title="Ta moyenne réelle : ${SERIES.mean}. Médiane : ${SERIES.globalMedian}. Dérive sur la fenêtre : ${drift > 0 ? '+' : ''}${drift.toFixed(3)}/jour.">
            <input type="number" id="etalon" min="0" max="10" step="0.1" value="${eta}"
                   aria-label="étalon">
          </label>
        </div>
        ${lineChart(cumX, cumY, { height: 250, events: SERIES.events, colore: true })}

        ${/* La frise se pose sous la courbe et partage EXACTEMENT son axe : les
              marges de lineChart, à l'unité près. Un repère tombe alors sur
              l'inflexion qu'il explique, ce qu'aucune légende n'aurait obtenu. */''}
        ${/* Le cadre ne s'ouvre que si la frise a quelque chose a dessiner :
              sous une fenetre de sept jours, elle peut etre vide. */''}
        ${(() => {
          const svg = FRISE ? friseSVG(FRISE, icone, {
            mg: 46, md: 12,
            domaine: (CUMWIN === 'tout' && FRISE_CADRE === 'vie') ? FRISE.etendue
                   : { debut: cumX[0], fin: cumX.at(-1) }
          }) : '';
          return svg ? `<div class="frisewrap" id="frisewrap">${svg}
            <div class="frisetip" id="frisetip" hidden></div></div>` : '';
        })()}
      </div>

      ${/*
         * LES NOTES RANGEES, DANS ANNEE.
         *
         * Elles vivaient dans Reglages, ou personne ne va chercher ce qu'il a
         * ecrit. Leur place est ici, avec le reste du journal -- et surtout a
         * cote de la frise et de la grille, puisque la plupart portent une date
         * et renvoient a une journee.
         *
         * L'INVARIANT TIENT ENCORE : elles sont dans Annee, elles ne sont
         * toujours pas des journees. Aucun compte de cette page ne les inclut,
         * et le bloc le dit en toutes lettres plutot que de compter sur le fait
         * que personne ne se posera la question.
         */''}
      ${/* LES DEUX LISTES SONT REPLIEES PAR DEFAUT.
             On vient ici pour REGARDER son annee ; ecrire une note ou poser un
             repere est un geste rare, et il occupait le tiers de la page avec
             un formulaire toujours deplie. Ce qui se fait souvent reste a
             l'ecran, ce qui se fait une fois par mois passe derriere un
             bouton. */''}
      <div class="card">
        <div class="cardhead">
          <h2 title="Des notes prises ailleurs, rangées depuis la conversation. Elles ne comptent jamais comme des journées écrites.">Notes rangées</h2>
          <span class="faint mono" style="font-size:11.5px">${CARNET?.compte?.total ?? 0}</span>
          <button class="ajoutbtn" data-ajout="note" aria-expanded="${NOTE_OUVERT}"
                  style="margin-left:auto">${NOTE_OUVERT ? 'fermer' : '+ une note'}</button>
        </div>
        ${NOTE_OUVERT ? noteFormMarkup() : ''}
        ${CARNET?.notes?.length
          ? `<div class="cnliste">${CARNET.notes.slice().reverse().map(carnetItemMarkup).join('')}</div>`
          : `<p class="sub" style="margin:0">Rien de rangé. Colle-les au compagnon dans <b>Parler</b>, ou écris-en une ici.</p>`}
      </div>

      <div class="card" id="reperescard">
        <div class="cardhead">
          <h2>Repères</h2>
          <span class="faint mono" style="font-size:11.5px">${SERIES.events.length}</span>
          <button class="ajoutbtn" data-ajout="repere" aria-expanded="${REP_OUVERT}"
                  style="margin-left:auto">${REP_OUVERT ? 'fermer' : '+ un repère'}</button>
          <button class="repdatebtn" id="naissbtn" aria-expanded="false"
                  title="Donne une origine à la frise. Aucun âge n'est calculé."
                  style="font-size:12.5px;padding:7px 11px">
            <span class="fl">naissance</span>${S.settings.naissance ? fmtDay(S.settings.naissance) : '—'}
          </button>
        </div>
        ${REP_OUVERT || EV ? composeurMarkup() : ''}
        ${SERIES.events.length
          ? `<div class="frise">${friseMarkup(SERIES.events)}</div>`
          : `<p class="sub" style="margin:0">Aucun repère. Le compagnon en pose aussi de lui-même.</p>`}
      </div>
    </div>`;

  $('#view').onclick = async e => {
    const y = e.target.closest('[data-year]');
    if (y) return renderYear(Number(y.dataset.year));
    const c = e.target.closest('[data-cum]');
    if (c) { CUMMODE = c.dataset.cum; return renderYear(year); }
    const w = e.target.closest('[data-win]');
    if (w) { CUMWIN = w.dataset.win; return renderYear(year); }
    const cell = e.target.closest('td.cell.has');
    if (cell) return ouvrirJour(cell.dataset.date);
    const cad = e.target.closest('[data-cadre]');
    if (cad) { FRISE_CADRE = cad.dataset.cadre; return renderYear(year); }
    // Une note s'ouvre sur place : le repli est l'état par défaut, et ouvrir
    // une note ne doit pas coûter un changement de page.
    // Les deux boutons d'ajout. Ouvrir l'un ferme l'autre : deux formulaires
    // dépliés en même temps, c'est ce qu'on venait de retirer.
    const aj = e.target.closest('[data-ajout]');
    if (aj) {
      if (aj.dataset.ajout === 'note') { NOTE_OUVERT = !NOTE_OUVERT; REP_OUVERT = false; }
      else { REP_OUVERT = !REP_OUVERT; NOTE_OUVERT = false; if (!REP_OUVERT) EV = null; }
      await renderYear(year);
      ($('#cntxt') ?? $('#evlabel'))?.focus();
      return;
    }
    const cno = e.target.closest('[data-cnouvre]');
    if (cno) {
      const id = Number(cno.dataset.cnouvre);
      if (CN_OUVERTES.has(id)) CN_OUVERTES.delete(id); else CN_OUVERTES.add(id);
      return renderYear(year);
    }
    const dcn = e.target.closest('[data-delcn]');
    if (dcn) {
      CARNET = await api('/api/carnet', { delete: Number(dcn.dataset.delcn) });
      CN_OUVERTES.delete(Number(dcn.dataset.delcn));
      toast('Note retirée');
      return renderYear(year);
    }
    // Une note datée ouvre sa journée dans le Miroir.
    const gto = e.target.closest('.cndate[data-goto]');
    if (gto) return ouvrirJour(gto.dataset.goto);
  };

  wireFrise();
  wireReperes(year);

  // Une note rangée, écrite ici plutôt que collée au compagnon. La date est
  // facultative — et même datée, elle ne comptera jamais comme une journée
  // écrite : c'est l'invariant du carnet, et il tient côté serveur.
  const nf = $('#cnnew');
  if (nf) nf.onsubmit = async e => {
    e.preventDefault();
    const texte = $('#cntxt').value.trim();
    if (!texte) return;
    const jour = $('#cnjour').value || null;
    try {
      CARNET = await api('/api/carnet', { texte, jour });
      NOTE_OUVERT = false;
      await renderYear(year);
      toast(jour ? `Note rangée sur le ${fmtDay(jour)}` : 'Note rangée');
    } catch (err) { toast(err.message); }
  };

  $('#etalon').onchange = async e => {
    const v = Number(e.target.value);
    if (!Number.isFinite(v) || v < 0 || v > 10) return toast('Étalon hors 0..10');
    await saveSettings({ etalon: v });
    SERIES = await api('/api/series');
    CUMMODE = 'etalon';
    renderYear(year);
  };

}

/**
 * Le composeur, câblé.
 *
 * Il se redessine à chaque changement d'état plutôt que de muter le DOM :
 * l'icône, la couleur, les dates et le libellé des boutons dépendent tous du
 * même objet, et six mutations coordonnées finissent toujours par se
 * désynchroniser sur un chemin qu'on n'a pas prévu.
 *
 * Le libellé, lui, est préservé à la main avant chaque redessin : il vit dans
 * un champ non contrôlé, et le perdre en ouvrant le calendrier serait la pire
 * des surprises.
 */
function wireReperes(year) {
  /*
   * LA CARTE, PAS LE FORMULAIRE.
   *
   * Le cablage partait de `#evform` : depuis que le composeur est replie par
   * defaut, il n'existe plus la plupart du temps -- et avec lui partaient la
   * LISTE des reperes (ouvrir, supprimer) et le bouton « naissance », qui
   * n'ont rien a voir avec le fait d'en poser un nouveau. Tout ce qui touche
   * au formulaire est donc garde, le reste marche sans lui.
   */
  const carte = $('#reperescard');
  if (!carte) return;
  const ouvert = !!$('#evform');

  const saisi = () => { const c = $('#evlabel'); if (c && EV) EV.label = c.value; };
  /*
   * `lire` = faut-il reprendre le libelle du champ avant de redessiner ?
   *
   * Presque toujours oui : le champ n'est pas controle, et le perdre en
   * ouvrant le calendrier serait la pire des surprises. Mais quand on vient de
   * remplacer EV en entier -- ouvrir un repere existant -- le champ contient
   * encore l'ancien etat, et le relire ecrasait le libelle qu'on venait de
   * charger. Le champ s'ouvrait vide sur le repere qu'on voulait corriger.
   */
  const redessiner = (lire = true) => {
    // Composeur ferme : il n'y a rien a redessiner sur place. On repasse par la
    // vue entiere -- et SANS forcer l'ouverture : le calendrier de naissance
    // vit hors du composeur, et le faire apparaitre au passage refermait
    // ensuite le composeur au clic suivant sur « + un repere ».
    if (!$('#evform')) return renderYear(year);
    if (lire) saisi();
    $('#evform').outerHTML = composeurMarkup();
    wireReperes(year);
    const c = $('#evlabel');
    if (c && !POP) { c.focus(); c.setSelectionRange(c.value.length, c.value.length); }
  };

  if (ouvert) EV ??= evVide();

  // L'icône se décide pendant la frappe, tant qu'on ne l'a pas choisie à la
  // main. C'est la raison d'être du module partagé : le classement tourne dans
  // le navigateur, et c'est exactement celui que le serveur appliquera.
  const champ = $('#evlabel');
  if (champ) champ.oninput = () => {
    EV.label = champ.value;
    if (EV.theme != null) return;                 // choisi à la main : on n'y touche plus
    const t = themeDe(champ.value);
    const ic = $('#evicone');
    ic.innerHTML = icone(t, 22);
    ic.dataset.theme = t;
  };

  const ico = $('#evicone');
  if (ico) ico.onclick = () => { POP = POP === 'app' ? null : 'app'; redessiner(); };

  const bdate = $('#evdate');
  if (bdate) bdate.onclick = () => {
    if (POP === 'date') { POP = null; return redessiner(); }
    ouvrirCal('date', { debut: EV.debut, fin: EV.fin, plage: !!EV.fin,
                        min: '1900-01-01', max: S.today });
    redessiner();
  };

  $('#naissbtn').onclick = () => {
    if (POP === 'naiss') { POP = null; return redessiner(); }
    ouvrirCal('naiss', { debut: S.settings.naissance ?? '1990-01-01', fin: null,
                         plage: false, min: '1900-01-01', max: S.today });
    redessiner();
  };
  // Le panneau de naissance vit hors du formulaire : on le pose à côté du bouton.
  if (POP === 'naiss') {
    const anc = $('#naissbtn');
    anc.parentElement.style.position ||= 'relative';
    anc.insertAdjacentHTML('afterend', calPopMarkup(false).replace('class="pop"', 'class="pop droite"'));
  }

  carte.onclick = async e => {
    const t = e.target;

    // --- le calendrier ---
    const c = t.closest('[data-cal]');
    if (c) {
      CAL = calClic(CAL, c.dataset);
      if (POP === 'naiss') {
        if (c.dataset.cal === 'jour') {
          POP = null;
          try {
            await saveSettings({ naissance: CAL.debut });
            FRISE = null;
            toast('Naissance enregistrée');
            return renderYear(year);
          } catch (err) { toast(err.message); }
        }
      } else if (POP === 'date') {
        EV.debut = CAL.debut; EV.fin = CAL.plage ? CAL.fin : null;
        // Une plage se ferme quand elle est complète ; un jour, tout de suite.
        if (c.dataset.cal === 'jour' && (!CAL.plage || CAL.fin)) POP = null;
      }
      return redessiner();
    }
    const dur = t.closest('[data-plage]');
    if (dur) {
      CAL.plage = !CAL.plage;
      if (!CAL.plage) { CAL.fin = null; EV.fin = null; }
      return redessiner();
    }

    // --- l'apparence ---
    const ic = t.closest('[data-ico]');
    if (ic) { EV.theme = ic.dataset.ico || null; return redessiner(); }
    const te = t.closest('.evt[data-teinte]');
    if (te) { EV.teinte = te.dataset.teinte ? Number(te.dataset.teinte) : null; return redessiner(); }

    // --- la liste ---
    const del = t.closest('[data-delev]');
    if (del) {
      const id = Number(del.dataset.delev);
      const { events } = await api('/api/events', { delete: id });
      SERIES.events = events;
      if (EV?.id === id) EV = null;
      FRISE = null;
      return renderYear(year);
    }
    const ed = t.closest('[data-edev]');
    if (ed) {
      const ev = SERIES.events.find(x => x.id === Number(ed.dataset.edev));
      if (!ev) return;
      // Une période ouverte n'a pas de fin en base : on ne s'en invente pas une.
      EV = { id: ev.id, label: ev.label, theme: ev.theme ?? null, teinte: ev.teinte ?? null,
             debut: ev.date, fin: ev.fin ?? null };
      POP = null;
      // Modifier, c'est le seul chemin qui DOIT ouvrir le composeur.
      REP_OUVERT = true;
      return redessiner(false);
    }
  };

  // Annuler ferme le composeur pour de bon : on l'avait ouvert pour modifier un
  // repere, et sortir de la modification sans sortir du formulaire laisserait
  // un champ vide ouvert sous la liste, sans qu'on l'ait demande.
  $('#evannul')?.addEventListener('click', () => {
    EV = null; POP = null; REP_OUVERT = false; renderYear(year);
  });

  const form = $('#evform');
  if (form) form.onsubmit = async e => {
    e.preventDefault();
    saisi();
    const label = (EV.label ?? '').trim();
    if (!label || !EV.debut) return;
    try {
      const { events } = await api('/api/events', {
        id: EV.id ?? undefined, date: EV.debut, fin: EV.fin ?? null, label,
        // `theme` reste NULL tant qu'on ne l'a pas choisi : la colonne dit
        // « NULL = deduit du libelle ». Y ecrire le theme deduit fige l'icone,
        // et renommer le repere ne la ferait plus suivre.
        theme: EV.theme, teinte: EV.teinte
      });
      SERIES.events = events;
      const quoi = EV.id ? 'Repère modifié' : EV.fin ? 'Période posée' : 'Repère posé';
      EV = null; POP = null; FRISE = null; REP_OUVERT = false;
      await renderYear(year);
      toast(quoi);
    } catch (err) { toast(err.message); }
  };
}

/* ===================== le composeur de repères =====================
 *
 * UN SEUL COMPOSEUR, QUI POSE ET QUI MODIFIE.
 *
 * Il y en avait un pour poser, et rien pour modifier : une date fausse se
 * corrigeait en supprimant le repère et en le reposant. Un repère mal daté
 * déplace toute une lecture, et c'est précisément celui qu'on veut corriger.
 *
 * Le formulaire tenait sur sept éléments en ligne — icône, libellé, date, case
 * « ça a duré », seconde date, six pastilles, bouton. Il en reste quatre :
 * l'apparence est passée sous l'icône, la durée sous la date, là où on les
 * cherche. Ce n'est pas du rangement : une commande visible en permanence dit
 * qu'on aura à s'en servir à chaque fois, et neuf fois sur dix on n'a rien à
 * changer ni à l'icône ni à la couleur.
 */

/** null = on pose ; un objet = on modifie ce repère-là. */
let EV = null;

/*
 * Les deux formulaires d'ajout, replies par defaut.
 *
 * Ils etaient deplies en permanence, et prenaient a eux deux le tiers de la
 * page pour des gestes qu'on fait une fois par mois. On vient dans « Annee »
 * pour REGARDER son annee ; ecrire une note ou poser un repere est un
 * detour, et un detour se range derriere un bouton.
 */
let NOTE_OUVERT = false, REP_OUVERT = false;

/** Le formulaire d'une note rangee : le texte, et une date facultative. */
function noteFormMarkup() {
  return `<form id="cnnew" class="noteform">
    <textarea id="cntxt" rows="3" maxlength="4000" required
              placeholder="Ce que tu as écrit ailleurs, ou ce qu'on t'a écrit…"></textarea>
    <div class="noteform-pied">
      ${/* La date est facultative, et c'est le point : une note peut parler
             d'un jour precis, ou de nulle part. Elle ne compte JAMAIS comme
             une journee ecrite -- ni datee, ni libre. */''}
      <label class="fl">de quel jour ?
        <input type="date" id="cnjour" max="${S.today}">
      </label>
      <span class="sub" style="margin:0;flex:1;min-width:180px">Sans date, elle est rangée à part. Elle ne comptera jamais comme une journée écrite.</span>
      <button class="btn primary" type="submit">Ranger</button>
    </div>
  </form>`;
}
/** 'date' | 'app' | 'naiss' | null — un seul panneau ouvert à la fois. */
let POP = null;
let CAL = null;

const evVide = () => ({ id: null, label: '', theme: null, teinte: null,
                        debut: S.today, fin: null, plage: false });

/** Le thème effectif : celui qu'on a choisi, sinon celui que le libellé dicte. */
const evTheme = e => e.theme ?? themeDe(e.label);

function ouvrirCal(cle, { debut, fin, plage, min, max }) {
  POP = cle;
  CAL = { vue: 'jour', curseur: moisDe(debut, S.today.slice(0, 7)),
          debut, fin, plage, min, max };
}

/** « 10 mai 2020 → 20 nov 2022 », ou « 27 août 2026 ». */
const quandLisible = e => e.fin ? `${fmtDay(e.debut)} <span class="fl">→</span> ${fmtDay(e.fin)}`
                                : fmtDay(e.debut);

function calPopMarkup(avecDuree) {
  return `<div class="pop" id="calpop">
    ${calMarkup({ ...CAL, aujourdhui: S.today })}
    ${avecDuree ? `<div class="calpied">
      ${/* Le pied dit l'etat, pas la fonction : « du debut a la fin » ne
            distingue pas une plage commencee d'une plage finie, et c'est
            exactement ce qu'on a besoin de savoir a ce moment-la. */''}
      <span>${!CAL.plage ? 'un jour'
              : !CAL.fin ? "clique l'autre borne"
              : `${joursEntre(CAL.debut, CAL.fin)} jours`}</span>
      <button type="button" class="caltog" data-plage aria-pressed="${CAL.plage}"
              title="Une addiction, un contrat, une relation : deux bornes au lieu d'une.">ça a duré</button>
    </div>` : ''}
  </div>`;
}

function composeurMarkup() {
  const e = EV ?? evVide();
  const th = evTheme(e);
  return `<form id="evform" class="repform">
    <span class="anc">
      <button type="button" class="repapercu" id="evicone" data-theme="${th}"
              ${e.teinte != null ? `data-teinte style="--t:${e.teinte}"` : ''}
              aria-expanded="${POP === 'app'}" title="Icône et couleur">${icone(th, 22)}</button>
      ${POP === 'app' ? `<div class="pop apparence" id="apppop">
        <div class="appgrid">
          ${Object.keys(ICONES).map(t => `<button type="button" data-ico="${t}"
            aria-pressed="${t === th}" title="${NOMS[t] ?? t}">${icone(t, 18)}</button>`).join('')}
        </div>
        <div class="evteintes" style="margin-top:9px;justify-content:center"
             title="La teinte ne touche que le contour : le remplissage vient de tes journées.">
          <button type="button" class="evt" data-teinte="" aria-pressed="${e.teinte == null}" title="sans couleur"></button>
          ${TEINTES_DECLAREES.map(t => `<button type="button" class="evt" data-teinte="${t}"
            aria-pressed="${e.teinte === t}" style="--t:${t}" title="teinte ${t}°"></button>`).join('')}
        </div>
        <button type="button" class="appauto" data-ico="">choisir d'après le libellé</button>
      </div>` : ''}
    </span>

    <input type="text" id="evlabel" required maxlength="60" autocomplete="off"
           value="${esc(e.label)}" placeholder="changement de boulot, déménagement…">

    <span class="anc">
      <button type="button" class="repdatebtn" id="evdate" aria-expanded="${POP === 'date'}"
        >${quandLisible(e)}</button>
      ${POP === 'date' ? calPopMarkup(true) : ''}
    </span>

    <button class="btn primary" type="submit">${e.id ? 'Enregistrer' : 'Poser'}</button>
    ${e.id ? `<button type="button" class="btn" id="evannul">Annuler</button>` : ''}
  </form>`;
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
        const jm = d => `${Number(d.slice(8))} ${MONTHS_FR[Number(d.slice(5, 7)) - 1].toLowerCase()}`;
        // Une période affiche ses DEUX bornes : la liste en montrait une seule,
        // et rien ne distinguait un instant d'une addiction de trois ans.
        const quand = ev.fin ? `${jm(ev.date)} → ${jm(ev.fin)}` : jm(ev.date);
        return `<div class="repligne${EV?.id === ev.id ? ' ouvert' : ''}" data-theme="${t}"
                     data-edev="${ev.id}" role="button" tabindex="0"
                     title="Modifier ce repère">
          <span class="ricone-box"${ev.teinte != null ? ` style="color:hsl(${ev.teinte} 62% 62%)"` : ''}>${icone(t, 18)}</span>
          <span class="repdate mono faint">${quand}</span>
          <span class="replabel">${esc(ev.label)}</span>
          <button class="repdel" data-delev="${ev.id}" title="Retirer ce repère" aria-label="Retirer ${esc(ev.label)}">×</button>
        </div>`;
      }).join('')}
    </div>`).join('');
}

/**
 * Le survol de la frise, et le clic.
 *
 * L'infobulle native met une seconde et demie a apparaitre, se pose ou le
 * navigateur veut et disparait au moindre mouvement : sur une bande ou les
 * marques font deux pixels de haut, elle est inutilisable. Celle-ci suit le
 * curseur, apparait immediatement, et donne ce qu'on cherche a ce moment-la --
 * quoi, quand, et ce que valait la journee.
 *
 * Le clic ouvre le jour dans le Miroir. Pour une periode, son premier jour :
 * c'est celui qu'on cherche quand on clique sur une barre, pas son milieu.
 */
function wireFrise() {
  const wrap = $('#frisewrap');
  const tip = $('#frisetip');
  if (!wrap || !tip) return;

  const montrer = (g, ev) => {
    const d = g.dataset;
    const th = d.theme || 'jalon';
    const periode = d.fin && d.fin !== 'null';
    const quand = periode
      ? `${fmtDay(d.date)} → ${fmtDay(d.fin)}`
      : fmtDay(d.date);
    const dessous = periode
      ? `${d.duree} journée${Number(d.duree) > 1 ? 's' : ''} écrite${Number(d.duree) > 1 ? 's' : ''}`
      : (d.note ? `${d.note}/10` : 'pas de journée écrite');

    tip.innerHTML = `<span class="ft-ico">${icone(th, 16)}</span>
      <span class="ft-txt"><b>${esc(d.label)}</b><span>${quand} · ${dessous}</span></span>`;
    tip.hidden = false;

    const r = wrap.getBoundingClientRect();
    const w = tip.offsetWidth;
    // Bornée à l'intérieur du cadre : une bulle qui déborde à droite force un
    // défilement horizontal sur la page entière.
    const x = Math.max(4, Math.min(r.width - w - 4, ev.clientX - r.left - w / 2));
    tip.style.left = `${x}px`;
    tip.style.top = `${Math.max(2, ev.clientY - r.top - tip.offsetHeight - 12)}px`;
  };

  wrap.addEventListener('mousemove', e => {
    const g = e.target.closest('[data-ev]');
    if (g) montrer(g, e); else tip.hidden = true;
  }, { passive: true });
  wrap.addEventListener('mouseleave', () => { tip.hidden = true; }, { passive: true });

  wrap.addEventListener('click', e => {
    const g = e.target.closest('[data-ev]');
    if (!g) return;
    ouvrirJour(g.dataset.date);
  });
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

/* ==================== les notes, en lecture ====================
 *
 * IL N'Y A PLUS DE FORMULAIRE.
 *
 * Il y en avait un, replie, dans trois vues : « + une note apportee », une
 * zone de texte, trois boutons radio pour dire de quand ca parle. Personne
 * n'ouvre un formulaire pour deposer un souvenir. On le raconte.
 *
 * Les notes arrivent donc par la conversation : on colle son texte, le
 * compagnon reconnait que ce n'est pas la journee du jour et le range avec
 * ranger_notes. Ce qui est stocke reste le texte de la personne, mot pour mot
 * -- le compagnon declenche le rangement, il ne dicte jamais ce qui est range.
 *
 * Ce qui reste ici : de quoi RELIRE ce qu'il a rangé, et le retirer.
 */

/**
 * Les notes rattachées à la journée ouverte, en lecture.
 *
 * Rien si elle n'en porte aucune — une carte vide qui dit « rien ici » sur
 * quatre vues sur cinq apprend seulement qu'il existe un endroit où il ne se
 * passe rien.
 */
function notesDuJourMarkup(notes) {
  if (!notes?.length) return '';
  return `<div class="card carnetcard">
    <div class="cardhead">
      <h2 title="Des notes prises ailleurs, rangées depuis la conversation. Elles ne comptent jamais comme des journées écrites.">Notes rangées ici</h2>
    </div>
    <div class="cnliste">${notes.map(carnetItemMarkup).join('')}</div>
  </div>`;
}

/*
 * UNE NOTE EST REPLIEE JUSQU'A CE QU'ON L'OUVRE.
 *
 * Une note collee fait souvent trois mille signes. Deroulees, dix d'entre elles
 * remplissent quinze ecrans, et l'on ne peut plus retrouver celle qu'on
 * cherche : une liste ou rien ne se distingue n'est pas une liste, c'est un mur.
 *
 * Repliee, elle tient sur une pastille : l'icone de ce dont elle parle, sa
 * date, et sa taille. Ce n'est pas un resume -- un resume serait une
 * reformulation, et ses mots lui appartiennent. C'est de quoi savoir laquelle
 * ouvrir.
 *
 * Une note ne doit jamais pouvoir se lire comme une journee : lisere a gauche,
 * fond en retrait, et la date d'apport affichee quand elle differe du jour dont
 * la note parle. Une note ecrite quatre ans apres le jour qu'elle raconte n'a
 * pas le meme statut qu'une note du soir meme, et le cacher serait un
 * deplacement silencieux.
 */
const CN_OUVERTES = new Set();

/** « 3 200 signes » plutôt qu'un extrait : un extrait promet un résumé. */
const tailleNote = n => n >= 1000 ? `${Math.round(n / 100) / 10} k signes` : `${n} signes`;

function carnetItemMarkup(n) {
  const ouvert = CN_OUVERTES.has(n.id);
  const apporte = n.cree_le?.slice(0, 10);
  const decale = n.jour && apporte && apporte !== n.jour;
  const situe = n.jour ? fmtDay(n.jour)
              : n.quand ? `sans date · ${n.quand}`
              : 'sans date';
  return `<div class="cnitem${ouvert ? ' ouverte' : ''}">
    <button class="cnpuce" data-cnouvre="${n.id}" aria-expanded="${ouvert}">
      <span class="cnicone">${icone(n.theme ?? 'jalon', 15)}</span>
      <span class="cnquand">${esc(situe)}</span>
      <span class="cntaille mono">${tailleNote(n.texte.length)}</span>
    </button>
    ${ouvert ? `<div class="cncorps">
      <div class="cnmeta">
        ${n.jour ? `<button class="cndate" data-goto="${n.jour}">ouvrir le ${fmtDay(n.jour)}</button>` : ''}
        ${apporte ? `<span class="faint">${decale ? 'apportée le' : 'donnée le'} ${fmtDay(apporte)}</span>` : ''}
        <button class="repdel" data-delcn="${n.id}" title="Retirer cette note"
                aria-label="Retirer cette note">retirer</button>
      </div>
      ${n.termes?.length ? `<div class="cntermes">${n.termes.map(t =>
        `<span>${esc(motLisible(t))}</span>`).join('')}</div>` : ''}
      <p class="cntexte">${esc(n.texte)}</p>
    </div>` : ''}
  </div>`;
}

/* ============================== vue : moi ==============================

   Le tableau de bord. Il repond a « ou j'en suis », pas a « qu'est-ce que je
   comprends de moi » -- cette question-la est celle de Ma carte, et elle
   demande de lire. Ici on regarde.

   Trois etages, du plus large au plus proche :
     1. LES PISTES : les deux ou trois grandes directions que dessinent les
        themes ensemble. Peu nombreuses par construction, et jamais un verdict.
     2. LE MOIS : un calendrier ou l'on se balade de jour en jour, avec la
        journee ouverte juste dessous. Annee montre quatre ans d'un coup ;
        ici on voit UN mois, en grand, et on clique.
     3. LES ECARTS : ce qui distingue une journee de sa propre moyenne. Mesures
        par le serveur, phrase comprise -- aucun de ces nombres n'a traverse un
        modele.
                                                                            */

let MOI = null;                 // la reponse de /api/moi
let MOI_PISTE = null;           // la piste depliee, par son nom
let MOI_ECARTS = false;         // les ecarts, replies par defaut

/*
 * OU S'AFFICHE LA JOURNEE OUVERTE.
 *
 * Le meme rendu sert dans « Ma carte » (on ouvre une journee depuis une preuve)
 * et dans « Moi » (on la choisit dans le calendrier). Ce qui change est ce
 * qu'il y a AUTOUR et ou ramene le retour -- pas la journee elle-meme. Deux
 * copies du meme ecran finiraient par diverger sur la note, et la note est ce
 * qu'on ne peut pas se permettre de rendre deux fois differemment.
 */
let JOUR_DANS = 'mirror';

/** La porte unique vers une journee, depuis n'importe ou dans l'application. */
async function ouvrirJour(date) {
  view = 'moi'; syncNav();
  return renderMoi(date);
}

const FORCE_MOT = { 1: 'une direction possible', 2: 'net', 3: 'partout' };

/**
 * UNE PISTE. Le seul endroit de l'application ou un mot lourd peut s'ecrire.
 *
 * Ce qui l'empeche de devenir une etiquette n'est pas le ton, c'est la forme :
 * le cadre dit « une piste, du cote de » AVANT le mot, chaque piste porte ce
 * qui va CONTRE elle, et les themes qu'elle regroupe sont la, cliquables, avec
 * leurs journees datees derriere. On peut donc toujours aller verifier.
 *
 * Le cadre est dans l'interface et pas dans la phrase du modele : une consigne
 * de formulation s'oublie, une structure non.
 */
function pisteMarkup(p, i) {
  const ouvert = MOI_PISTE === p.nom;
  const teinte = TEINTES_DECLAREES[i % TEINTES_DECLAREES.length];
  return `<div class="piste${ouvert ? ' ouvert' : ''}" style="--p:${teinte}">
    <button class="ptete" data-piste="${esc(p.nom)}" aria-expanded="${ouvert}">
      <span class="pcadre">une piste, du côté de</span>
      <span class="pnom">${esc(p.nom)}</span>
      <span class="pforce" data-f="${p.force}" title="${FORCE_MOT[p.force] ?? ''}">
        <i></i><i></i><i></i></span>
    </button>
    ${ouvert ? `<div class="pcorps">
      <p class="pquoi">${esc(p.quoi)}</p>
      ${/* CE QUI VA CONTRE. Obligatoire, et affiche aussi visiblement que le
            reste : une hypothese dont on cache ce qui l'affaiblit est un
            verdict deguise. */''}
      <p class="pcontre"><span class="k">ce qui va contre</span>${esc(p.contre)}</p>
      <div class="pthemes">
        ${p.themes.map(t => `<button data-piste-theme="${esc(t)}"
          title="Voir ce mécanisme et ses journées">${esc(t)}</button>`).join('')}
      </div>
    </div>` : ''}
  </div>`;
}

function pistesMarkup() {
  if (!MOI) return '';
  const p = MOI.pistes ?? [];
  if (!p.length) {
    return `<div class="card pistescard">
      <div class="moihead"><h2>Ce vers quoi ça pointe</h2></div>
      <p class="sub" style="margin:0">${MOI.lue
        ? `Aucune grande direction ne se dégage de ton journal — et c'est une réponse,
           pas une panne. Il y a ${MOI.themes?.length ?? 0} mécanisme${(MOI.themes?.length ?? 0) > 1 ? 's' : ''}
           dans <b>Ma carte</b>, mais rien qui les regroupe assez pour porter un nom.`
        : `Ton journal n'a pas encore été lu. Les pistes viennent de la lecture — elle se lance
           dans <b>Ma carte</b>, bouton « relire ».`}</p>
    </div>`;
  }

  return `<div class="card pistescard">
    <div class="moihead"><h2>Ce vers quoi ça pointe</h2></div>
    <p class="sub">
      Chacune regroupe plusieurs mécanismes de <b>Ma carte</b>. Ce sont des directions à
      explorer, pas des états : clique pour voir ce qui va dans ce sens, ce qui va contre,
      et les mécanismes qui les portent.
    </p>
    <div class="pistes">${p.map(pisteMarkup).join('')}</div>
    ${/* Une fois, en bas du bloc, et pas sous chaque piste : repete trois fois
          la phrase devient une decharge de responsabilite au lieu d'un conseil. */''}
    <p class="prenvoi">
      Un mot posé ici n'est pas un diagnostic — c'est une hypothèse tirée de ce que tu as
      écrit. Trancher, c'est le métier d'un psychiatre ou d'un psychologue, et ça vaut la
      peine de leur en parler.
    </p>
  </div>`;
}

/** L'en-tete de « Moi » : les pistes, et rien d'autre au-dessus du calendrier. */
function moiEntete() {
  const r = MOI?.resume;
  return `<div class="moiresume">
    ${r ? `<span><b>${r.jours}</b> journées notées</span>
      <span><b>${r.ecrites}</b> avec du texte</span>
      ${r.reference !== null ? `<span>référence <b>${r.reference}</b></span>` : ''}
      ${r.serie ? `<span><b>${r.serie}</b> jour${r.serie > 1 ? 's' : ''} de suite</span>` : ''}` : ''}
  </div>
  ${pistesMarkup()}`;
}

/**
 * LES ECARTS : ce qui distingue une journee de ta propre moyenne.
 *
 * Aucun de ces nombres n'a traverse un modele : le serveur les mesure et ecrit
 * la phrase. C'est pour ca qu'ils s'affichent meme quand aucune lecture n'a
 * tourne -- ils ne coutent rien et ne dependent de personne.
 */
function ecartsMarkup() {
  const e = MOI?.ecarts ?? [];
  if (!e.length) return '';
  const montres = MOI_ECARTS ? e : e.slice(0, 3);
  return `<div class="card ecartscard">
    <h2>Ce qui te distingue de ta propre moyenne</h2>
    <p class="sub">Mesuré sur tes notes, pas déduit. Il faut au moins huit journées de chaque côté pour qu'une comparaison s'affiche.</p>
    <div class="ecarts">
      ${montres.map(c => `<div class="ecart" data-signe="${c.ecart > 0 ? 'plus' : 'moins'}">
        <span class="ebarre"><i style="width:${Math.min(100, Math.abs(c.ecart) / 2 * 100)}%"></i></span>
        <span class="etxt">${esc(c.phrase)}</span>
        <span class="enum mono">${c.ecart > 0 ? '+' : ''}${c.ecart}</span>
      </div>`).join('')}
    </div>
    ${e.length > 3 ? `<button class="btn" data-moi-ecarts style="margin-top:12px">
      ${MOI_ECARTS ? 'en montrer moins' : `voir les ${e.length - 3} autres`}</button>` : ''}
  </div>`;
}

async function renderMoi(date, { garderCal = false, rafraichir = false } = {}) {
  JOUR_DANS = 'moi';
  if (!MOI || rafraichir) {
    try { MOI = await api('/api/moi'); }
    catch { MOI = null; }
  }
  return renderMirror(date ?? MIRROR_DATE ?? S.today, { garderCal });
}

/* ============================= vue : miroir ============================= */

let MIRROR_DATE = null;
/* L'échelle de la journée ouverte, repliée par défaut : on relit une journée
   cent fois pour une fois qu'on la renote. */
let DAY_NOTE_OUVERT = false;
let MIRROR_CARNET = null;   // les notes du jour ouvert, pour le message de suppression
/*
 * Le curseur du calendrier, distinct du jour ouvert.
 *
 * L'ancien calendrier naviguait avec des liens vers le 1er du mois voisin : on
 * ne pouvait pas regarder mars sans ouvrir le 1er mars. Feuilleter et choisir
 * sont deux gestes differents, et les confondre fait perdre la journee qu'on
 * etait en train de lire.
 */
let MIR_CAL = { vue: 'jour', curseur: null };

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

/* ===================== la lecture =====================
 *
 * CE QUE LE MIROIR MONTRE MAINTENANT.
 *
 * Il montrait une journee : son texte, sa note, celles qui lui ressemblaient.
 * C'etait utile et ca reste la -- mais ce n'etait pas une vue d'ensemble, et
 * une vue d'ensemble est exactement ce qu'un journal de quatre ans ne donne
 * jamais tout seul.
 *
 * La lecture est faite par le compagnon, sur tout le corpus, et elle n'est PAS
 * une carte de mots. La carte compte des co-occurrences : elle sait dire que
 * « fatigue » et « boulot » tombent la meme semaine, et elle s'arrete la. Un
 * fonctionnement comme « les remontees ne tiennent pas trois jours » n'a aucun
 * mot en commun d'une occurrence a l'autre.
 *
 * TROIS FENETRES, UN CURSEUR. Court, moyen, long : la meme question posee a
 * trois distances. Ce qui domine le mois n'est pas ce qui structure quatre ans,
 * et lire l'un pour l'autre est l'erreur qu'une seule fenetre garantit.
 */

let MIR_THEME = null;          // le theme deplie
let LECTURE = null;
let LECTURE_EN_COURS = false;
/*
 * LA DERNIERE ERREUR DE LECTURE, GARDEE A L'ECRAN.
 *
 * Elle partait en `toast()` : deux secondes, puis la page retombait sur
 * « Lancer la lecture » -- exactement l'ecran qu'on voit quand on n'a jamais
 * rien lance. Quelqu'un dont la lecture echoue a chaque fois voit donc un
 * bouton qui ne fait rien, sans jamais savoir pourquoi, et finit par conclure
 * qu'il n'a pas acces a la fonctionnalite. C'est ce qui s'est passe.
 *
 * Une panne qui ne se dit pas est pire qu'une panne : elle se lit comme une
 * absence.
 */
let LECTURE_ERR = null;


/** Une barre par période. Petite, sans axe : c'est une forme, pas un graphe. */
function serieMarkup(serie) {
  if (!serie?.length) return '';
  return `<span class="tserie" aria-hidden="true">${serie.map(p =>
    `<i style="height:${[2, 34, 66, 100][p.valeur]}%" title="${esc(p.periode)} · ${p.valeur}/3"></i>`
  ).join('')}</span>`;
}

/*
 * UNE SEULE LISTE DE MECANISMES, ET ELLE EST COLOREE.
 *
 * Il y en avait deux, l'une au-dessus de l'autre. Les MOTIFS -- ce que le
 * compagnon reconnait en conversation, tout de suite, avec un compte -- en
 * cartes colorees. Les THEMES -- ce qu'il tire d'une relecture de tout le
 * corpus, avec des preuves datees et une evolution -- en lignes grises en
 * dessous. Deux formes, deux couleurs, deux endroits, pour deux facons de
 * repondre a la meme question : « qu'est-ce qui revient chez moi ? »
 *
 * Une seule liste maintenant, et une seule forme. Ce qui les distingue reste
 * visible, mais dans le contenu et pas dans le decor : un motif s'ouvre sur les
 * journees ou il a ete reconnu, un theme sur les extraits qui le montrent.
 *
 * LA COULEUR EST DECLAREE, ET ELLE LE DIT. Toutes les teintes viennent de la
 * bande 232-336, disjointe de la rampe des notes. Un mecanisme est ce que le
 * compagnon comprend, pas ce que les journees mesurent : il ne peut donc pas
 * emprunter le vert d'une bonne journee, meme par accident.
 */

/** La teinte d'un thème : stable dans une lecture, prise dans la bande déclarée. */
const teinteTheme = (t, i) => TEINTES_DECLAREES[i % TEINTES_DECLAREES.length];

/**
 * Un mécanisme, quelle que soit sa provenance.
 *
 * @param {object} m  { cle, nom, teinte, intensite, serie, quoi, compte, corps }
 */
function mecaMarkup(m) {
  const ouvert = MIR_THEME === m.cle;
  return `<div class="meca${ouvert ? ' ouvert' : ''}" style="--m:${m.teinte}"
       data-meca="${esc(m.cle)}">
    <button class="mhead" aria-expanded="${ouvert}">
      <span class="tpuce" data-i="${m.intensite}"></span>
      <span class="tnom">${esc(m.nom)}</span>
      ${m.compte ? `<span class="mcompte mono">${m.compte}<small>×</small></span>` : ''}
      ${serieMarkup(m.serie)}
    </button>
    ${ouvert ? `<div class="tcorps">${m.corps}</div>` : ''}
  </div>`;
}

/** Un thème de la lecture : ses preuves datées, son chiffre, ses liens. */
function themeMeca(t, i) {
  return {
    cle: t.nom, nom: t.nom, teinte: teinteTheme(t, i),
    intensite: t.intensite, serie: t.serie, compte: null,
    corps: `
      <p class="tquoi">${esc(t.quoi)}</p>
      ${/* Le chiffre. Il ne vient PAS du modèle : il a choisi lequel des faits
            déjà calculés porte ce thème, et le serveur a mis la phrase. C'est
            pour ça qu'on peut l'afficher tel quel — il n'a traversé personne
            qui aurait pu l'arrondir. */''}
      ${t.chiffre ? `<p class="tchiffre">${esc(t.chiffre)}</p>` : ''}
      <div class="tpreuves">${t.preuves.map(p => `<button class="tpreuve" data-jour="${p.date}">
        <span class="mono">${fmtDay(p.date)}</span>
        <span>${esc(p.extrait)}</span>
      </button>`).join('')}</div>
      ${t.liens?.length ? `<p class="tliens">avec ${t.liens.map(l =>
        `<button data-theme-aller="${esc(l)}">${esc(l)}</button>`).join(' · ')}</p>` : ''}`
  };
}

/**
 * Un motif suivi par le compagnon.
 *
 * Son intensité vient de la HAUTEUR DE SA DERNIERE BARRE, pas de son compte
 * total : la pastille dit « où il en est », la série dit « d'où il vient ».
 * Un motif reconnu vingt fois il y a deux ans et plus jamais depuis ne doit pas
 * s'afficher aussi gros que celui de la semaine dernière.
 */
function motifMeca(m) {
  const lie = (carteCourante()?.noeuds ?? []).find(x => {
    const a = x.nom.toLowerCase(), b = m.nom.toLowerCase();
    return a === b || a.includes(b) || b.includes(a);
  }) ?? null;
  return {
    cle: `motif:${m.id}`, nom: m.nom, teinte: m.teinte,
    intensite: m.serie?.at(-1)?.valeur ?? 1,
    serie: m.serie, compte: m.vues,
    corps: `
      <p class="tquoi">${esc(m.mecanisme)}</p>
      <p class="mmeta">
        Reconnu <b>${m.vues}</b> fois, la dernière le ${fmtDay(m.vu_le.slice(0, 10))}.
        ${lie ? `Sur la carte : <b>${esc(lie.nom)}</b>.` : ''}
      </p>
      <div class="mpalette">
        ${TEINTES_DECLAREES.map(t => `<button data-teinte="${t}" data-pour="${m.id}"
          style="--t:${t}" aria-pressed="${m.teinte === t}" aria-label="Teinte ${t}"></button>`).join('')}
        <button class="repdel" data-delmotif="${m.id}"
                title="Ne plus suivre" aria-label="Ne plus suivre ${esc(m.nom)}">ne plus suivre</button>
      </div>`
  };
}

/**
 * Les deux sources dans une seule liste, triées par ce qu'elles pèsent
 * MAINTENANT — l'intensité d'abord, la longueur de la série ensuite. Un
 * mécanisme qui vient d'être reconnu remonte donc au-dessus d'un thème calme,
 * ce qui est l'ordre dans lequel on veut les lire.
 */
function mecanismes(lecture) {
  const t = (lecture?.themes ?? []).map(themeMeca);
  const m = (S.motifs?.liste ?? []).map(motifMeca);
  return [...t, ...m].sort((a, b) =>
    (b.intensite - a.intensite) || ((b.serie?.length ?? 0) - (a.serie?.length ?? 0)));
}

/**
 * LES MECANISMES, RANGES SOUS LEURS PISTES.
 *
 * La meme lecture se presentait de deux facons : des ilots nommes sur la carte,
 * et une liste a plat en dessous. On voyait donc « depression » sur la toile
 * sans jamais savoir lesquels de ces douze mecanismes la portaient.
 *
 * Ils sont maintenant groupes, avec la teinte de leur ilot -- la meme que sur la
 * carte et la meme que dans « Moi ». Trois vues, un seul code couleur : un nom
 * lu quelque part se retrouve partout ailleurs sans qu'on le cherche.
 *
 * Ce qui n'appartient a aucune piste vient a la fin, sans titre. Ce n'est pas un
 * reste : c'est ce qui n'entre pas dans une case, et tout n'a pas a y entrer.
 */
function mecaGroupes(lecture) {
  const tous = mecanismes(lecture);
  const pistes = lecture?.pistes ?? [];
  if (!pistes.length) return tous.map(mecaMarkup).join('');

  const restant = new Set(tous.map(m => m.cle));
  const bloc = [];
  pistes.forEach((p, i) => {
    const noms = new Set((p.themes ?? []).map(t => String(t).toLowerCase()));
    const dedans = tous.filter(m => restant.has(m.cle) && noms.has(String(m.nom).toLowerCase()));
    if (!dedans.length) return;
    for (const m of dedans) restant.delete(m.cle);
    const teinte = TEINTES_DECLAREES[i % TEINTES_DECLAREES.length];
    bloc.push(`<div class="mecagroupe" style="--p:${teinte}">
      <div class="mecatitre"><span></span>${esc(p.nom)}</div>
      ${dedans.map(mecaMarkup).join('')}
    </div>`);
  });
  const seuls = tous.filter(m => restant.has(m.cle));
  if (seuls.length) {
    bloc.push(`<div class="mecagroupe seuls">
      ${pistes.length ? '<div class="mecatitre"><span></span>hors des pistes</div>' : ''}
      ${seuls.map(mecaMarkup).join('')}
    </div>`);
  }
  return bloc.join('');
}

/** La carte de la lecture affichée, pour rapprocher un motif d'un nœud. */
const carteCourante = () => LECTURE?.lecture?.carte ?? null;

/**
 * La carte organique.
 *
 * Elle est DESSINEE, pas disposee a la main : seize choses reliees dans tous les
 * sens n'ont pas de bonne place fixe, et le placement en cercle qui suffisait a
 * quatre themes donne ici une roue ou tous les traits passent par le centre.
 * On reprend donc le moteur de la carte des mots -- repulsion, ressorts,
 * regroupement par amas -- avec les GENRES comme amas.
 *
 * Le placement est reproductible (graine fixe, depart en spirale) : une carte
 * qui se redispose differemment a chaque ouverture ne se memorise pas, et on
 * perd le seul benefice d'une carte, qui est de reconnaitre sa forme.
 */
let RELA = null, RELA_DISPO = null, RELA_SURVOL = -1;

function carteMarkup(carte) {
  if (!carte?.noeuds?.length) return '';
  return `<div class="cartewrap">
    <canvas id="cartec" aria-label="La carte de ce qui revient et de ce qui le relie"></canvas>
    ${/* Trois commandes, et le point du milieu est celle qui compte : après
          trois glissades on ne sait plus où l'on est, et sans lui il faudrait
          changer d'onglet pour revenir. */''}
    <div class="cartecmd">
      <button data-carte="plus" aria-label="Zoomer" title="Zoomer">+</button>
      <button data-carte="centre" aria-label="Revenir au centre" title="Revenir au centre"><i></i></button>
      <button data-carte="moins" aria-label="Dézoomer" title="Dézoomer">−</button>
    </div>
    <div class="cartelegende">${
      [...new Set(carte.noeuds.map(n => n.genre))].map(g =>
        `<span><i style="--g:${TEINTE_GENRE[g]}"></i>${esc(NOM_GENRE[g] ?? g)}</span>`).join('')}
      ${/* Sans cette ligne, la couronne se lit comme une décoration. Elle dit
            aussi la règle de couleur en une phrase : le contour est déclaré, le
            plein est mesuré. */''}
      ${carte.noeuds.some(n => n.jours?.length)
        ? `<span class="cartepoints">un point&nbsp;= une journée</span>` : ''}
    </div>
  </div>`;
}

/*
 * ON SE PROMENE DEDANS.
 *
 * La carte tenait dans son cadre et n'en bougeait pas. Sur seize noeuds
 * regroupes par genre, l'amas le plus dense est justement celui qu'on veut
 * regarder de pres -- et c'est celui ou tout se chevauche. S'approcher ne rend
 * pas la carte plus jolie : ca la rend lisible la ou elle ne l'etait pas.
 *
 * Et chaque point est une journee, avec sa date : une carte qui dit « ces
 * trente-quatre fois » sans jamais dire lesquelles s'arrete a mi-chemin. Un
 * clic sur un point ouvre la journee.
 *
 * Le glisse et le clic se distinguent a la DISTANCE, pas au temps : quatre
 * pixels. Sur un ecran tactile, le doigt bouge toujours un peu -- au seuil
 * temporel, un appui pose devient une glissade et le point ne s'ouvre jamais.
 */
let RELA_VUE = null, RELA_JOUR = null;
/* Le pinceau de la carte courante, garde a portee pour que le mode pudique
   puisse redemander une image : les noms des noeuds sont peints, pas ecrits. */
let RELA_PEINDRE = null;
const GLISSE_MIN = 4;

function monterCarte(carte, pistes = []) {
  const cv = $('#cartec');
  if (!cv || !carte?.noeuds?.length) return;
  // Les pistes font les ILOTS : les noeuds qu'elles nomment se regroupent, et
  // leur nom se lit de loin, la ou seize noms de noeuds ne se lisent pas.
  RELA = versGraphe(carte, pistes);
  RELA_SURVOL = -1;
  RELA_JOUR = null;
  RELA_VUE = vueNeutre();

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let L = 0, H = 0;

  const poser = () => {
    L = cv.clientWidth; H = cv.clientHeight;
    if (!L || !H) return;
    cv.width = L * dpr; cv.height = H * dpr;
    RELA_DISPO = disposer(RELA, L, H);
    // Plus de marge en haut dès qu'il y a des îlots : leur nom se pose
    // AU-DESSUS de l'enveloppe, et le cadrage ne réserve de la place que pour
    // les nœuds — le titre du plus haut sortait par le bord.
    cadrer(RELA_DISPO.pts, L, H, 62, RELA.ilots?.length ? 66 : 38);
    RELA_VUE = vueNeutre();
    peindre();
  };
  let attente = 0;
  const peindre = () => {
    // La carte est redessinee a chaque passage dans « Ma carte » : sans cette
    // sortie, un pinceau garde d'une vue precedente peindrait sur une toile
    // detachee du document.
    if (!cv.isConnected) { if (RELA_PEINDRE === peindre) RELA_PEINDRE = null; return; }
    if (!RELA_DISPO || attente) return;
    // Une image par rafraichissement : molette et glisse produisent plus
    // d'evenements que l'ecran n'a de trames, et repeindre a chaque evenement
    // fait ramer une carte qui n'a rien de lourd a dessiner.
    attente = requestAnimationFrame(() => {
      attente = 0;
      dessinerRelations(cv.getContext('2d'), RELA, RELA_DISPO,
        { largeur: L, hauteur: H, survol: RELA_SURVOL, dpr, vue: RELA_VUE, jourSurvol: RELA_JOUR,
          pudique: !!S.settings?.pudique });
    });
  };

  RELA_PEINDRE = peindre;

  const pos = e => {
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const viser = (x, y) => {
    const ech = echelle(L, H);
    const j = journeeAu(RELA_DISPO?.pts ?? [], RELA, x, y, ech, RELA_VUE);
    const i = j ? j.noeud : noeudAu(RELA_DISPO?.pts ?? [], RELA, x, y, ech, RELA_VUE);
    const memeJour = (RELA_JOUR?.date ?? null) === (j?.date ?? null)
                  && (RELA_JOUR?.noeud ?? -1) === (j?.noeud ?? -1);
    if (i === RELA_SURVOL && memeJour) return;
    RELA_SURVOL = i; RELA_JOUR = j;
    // La main ouverte partout, le doigt UNIQUEMENT sur une journee. Un noeud
    // survole s'allume mais ne s'ouvre pas : lui donner le curseur du clic
    // promet quelque chose qui n'arrive pas.
    cv.style.cursor = j ? 'pointer' : 'grab';
    peindre();
  };

  /* ---- le glissé ---- */
  let tire = null;
  cv.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button !== 0) return;
    const p = pos(e);
    tire = { x0: p.x, y0: p.y, vx: RELA_VUE.x, vy: RELA_VUE.y, bouge: false, id: e.pointerId };
    cv.setPointerCapture?.(e.pointerId);
  });

  cv.addEventListener('pointermove', e => {
    const p = pos(e);
    if (!tire) return viser(p.x, p.y);
    const dx = p.x - tire.x0, dy = p.y - tire.y0;
    if (!tire.bouge && Math.hypot(dx, dy) < GLISSE_MIN) return;
    tire.bouge = true;
    cv.style.cursor = 'grabbing';
    RELA_VUE = { ...RELA_VUE, x: tire.vx + dx, y: tire.vy + dy };
    RELA_SURVOL = -1; RELA_JOUR = null;
    peindre();
  });

  const relacher = e => {
    if (!tire) return;
    const p = pos(e);
    const bouge = tire.bouge;
    cv.releasePointerCapture?.(tire.id);
    tire = null;
    if (bouge) { cv.style.cursor = 'grab'; return viser(p.x, p.y); }
    // Un vrai clic : on ouvre la journée visée.
    const j = journeeAu(RELA_DISPO?.pts ?? [], RELA, p.x, p.y, echelle(L, H), RELA_VUE);
    if (j) ouvrirJour(j.date);
  };
  cv.addEventListener('pointerup', relacher);
  cv.addEventListener('pointercancel', () => { tire = null; cv.style.cursor = 'grab'; });
  cv.addEventListener('mouseleave', () => {
    if (tire) return;
    RELA_SURVOL = -1; RELA_JOUR = null; peindre();
  }, { passive: true });

  /* ---- la molette ---- */
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const p = pos(e);
    // `deltaMode` : certaines souris comptent en lignes, pas en pixels, et un
    // cran de molette y vaut 3 au lieu de 100 — sans ça le zoom est trente
    // fois plus lent sur ces machines-là.
    const d = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    RELA_VUE = zoomer(RELA_VUE, p.x, p.y, Math.exp(-d * 0.0016));
    viser(p.x, p.y);
    peindre();
  }, { passive: false });

  /* ---- le pincement, à deux doigts ---- */
  const doigts = new Map();
  let ecartInitial = 0, vueInitiale = null;
  cv.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    doigts.set(e.pointerId, pos(e));
    if (doigts.size === 2) {
      tire = null;                      // deux doigts : ce n'est plus un glissé
      const [a, b] = [...doigts.values()];
      ecartInitial = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      vueInitiale = RELA_VUE;
    }
  });
  cv.addEventListener('pointermove', e => {
    if (e.pointerType !== 'touch' || !doigts.has(e.pointerId)) return;
    doigts.set(e.pointerId, pos(e));
    if (doigts.size !== 2 || !vueInitiale) return;
    const [a, b] = [...doigts.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    RELA_VUE = zoomer(vueInitiale, mx, my, d / ecartInitial);
    peindre();
  });
  const oublier = e => {
    doigts.delete(e.pointerId);
    if (doigts.size < 2) vueInitiale = null;
  };
  cv.addEventListener('pointerup', oublier);
  cv.addEventListener('pointercancel', oublier);

  /* ---- les commandes ---- */
  const cmd = cv.parentElement?.querySelector('.cartecmd');
  if (cmd) {
    cmd.onclick = e => {
      const b = e.target.closest('button');
      if (!b) return;
      const centre = { x: L / 2, y: H / 2 };
      if (b.dataset.carte === 'plus')  RELA_VUE = zoomer(RELA_VUE, centre.x, centre.y, 1.35);
      if (b.dataset.carte === 'moins') RELA_VUE = zoomer(RELA_VUE, centre.x, centre.y, 1 / 1.35);
      if (b.dataset.carte === 'centre') RELA_VUE = recadrer(RELA_DISPO?.pts ?? [], L, H, RELA?.ilots?.length ? 96 : 74);
      peindre();
    };
  }

  cv.style.cursor = 'grab';
  cv.style.touchAction = 'none';        // sinon le navigateur fait défiler la page

  // Un seul observateur, retire avec le canvas : sans ca, changer d'horizon
  // trois fois laisse trois observateurs qui repeignent un canvas detache.
  const ro = new ResizeObserver(() => poser());
  ro.observe(cv);
  poser();
}

async function renderLecture() {
  // La vue d'ensemble de « Ma carte » : ce qui s'ouvrira ensuite s'y encadre.
  JOUR_DANS = 'mirror';
  MIRROR_DATE = null;
  if (!LECTURE) LECTURE = await api('/api/lecture');
  const L = LECTURE;

  /*
   * UNE LECTURE EXISTANTE PASSE AVANT TOUT LE RESTE.
   *
   * Les conditions (assez de journées, une clé) disent s'il est possible d'en
   * FAIRE une, pas s'il faut en montrer une. Testées d'abord, elles cachaient
   * une lecture parfaitement valide derrière « il faut au moins 12 journées » à
   * la première fois qu'on retire sa clé.
   */
  let corps;
  if (L.lecture) {
    // La carte d'abord : c'est la forme qu'on vient reconnaitre. La synthese la
    // dit en mots, les themes la detaillent -- l'ordre va du coup d'oeil au
    // detail, et pas l'inverse.
    /*
     * LA CARTE ET CE QU'ELLE DIT, COTE A COTE.
     *
     * Ils se suivaient : la carte, puis la synthese sous elle, puis les
     * comportements dans un autre onglet. Trois vues d'une meme lecture, qu'on
     * ne pouvait jamais regarder ensemble -- alors que la seule question qu'on
     * se pose devant un noeud est « qu'est-ce qu'il en dit ? », et qu'il fallait
     * faire defiler pour le savoir.
     *
     * Sous 1080 px la colonne passe dessous : deux colonnes de 300 px ne
     * servent personne.
     */
    corps = `
      <div class="lectgrille">
        <div class="lectcarte">${carteMarkup(L.lecture.carte)}</div>
        <div class="lectdit">
          <p class="synthese">${esc(L.lecture.synthese)}</p>
          <div class="themes">${mecaGroupes(L.lecture)}</div>
        </div>
      </div>`;
  } else if (LECTURE_EN_COURS) {
    corps = `<div class="lectvide"><span class="spin"></span>
      <p>Il relit ton journal.</p>
      <p class="sub">Ça prend un moment — il lit tout, pas un résumé.</p></div>`;
  } else if (!L.possible) {
    corps = `<div class="lectvide">
      <p>Il faut au moins ${L.minimum} journées écrites.</p>
      <p class="sub">Tu en as ${L.ecrites}. En dessous, ce qui ressortirait serait du bruit.</p></div>`;
  } else if (!L.cle) {
    corps = `<div class="lectvide">
      <p>Cette lecture demande une clé Claude.</p>
      <p class="sub">Compter des mots, l'application sait le faire seule. Reconnaître un fonctionnement
      qui ne se dit jamais deux fois avec les mêmes mots, non.</p>
      <button class="btn" data-aller-reglages>Réglages</button></div>`;
  } else if (LECTURE_ERR) {
    corps = `<div class="lectvide">
      <p>La lecture n'a pas abouti.</p>
      <p class="sub lecterr">${esc(LECTURE_ERR)}</p>
      <button class="btn primary" data-lire>Réessayer</button></div>`;
  } else {
    corps = `<div class="lectvide">
      <p>Ton journal n'a pas encore été lu.</p>
      <button class="btn primary" data-lire>Lancer la lecture</button></div>`;
  }

  $('#view').innerHTML = `<div class="lecture">
    <div class="lechead">
      ${L.lecture ? `<span class="lecmeta faint">${L.jours} journées · ${fmtDay(L.fait_le.slice(0, 10))}${
        L.perime ? ` · <b>${L.retard} journée${L.retard > 1 ? 's' : ''} depuis</b>` : ''}</span>` : ''}
      ${L.lecture ? (LECTURE_EN_COURS
        ? `<span class="lecmeta faint"><span class="spin petit"></span> il relit</span>`
        : `<button class="btn ghost" data-lire title="Refait la lecture sur tout le corpus.">relire</button>`) : ''}
    </div>
    ${/* Une relecture qui échoue par-dessus une lecture existante ne peut pas
          prendre l'écran — l'ancienne vaut mieux que rien — mais elle ne peut
          pas non plus se taire : sinon ce qu'on regarde est vieux sans qu'on le
          sache, et « relire » a l'air de ne rien faire. */''}
    ${L.lecture && LECTURE_ERR ? `<p class="sub lecterr lecterrhaut">La relecture n'a pas abouti — ceci est la lecture précédente. ${esc(LECTURE_ERR)}</p>` : ''}
    ${corps}
  </div>`;

  wireLecture();
  monterCarte(L.lecture?.carte, L.lecture?.pistes ?? []);

  // « elle doit toujours faire de l'analyse de fond » : si elle manque, on la
  // lance en arrivant, sans rien demander. Si elle existe mais a pris du
  // retard, on ne relance que quand le retard compte vraiment — le serveur en
  // décide, fenêtre par fenêtre. Sinon écrire tous les soirs relancerait une
  // relecture complète tous les soirs, pour un thème qui n'aura pas bougé.
  // L'ancienne reste affichée pendant ce temps : une lecture d'hier vaut mieux
  // qu'un écran d'attente.
  //
  // `!LECTURE_ERR` N'EST PAS UNE PRECAUTION, C'EST L'ARRET D'UNE BOUCLE.
  // `lancerLecture()` re-rend en sortant, quoi qu'il arrive. Sans ce garde-fou,
  // une lecture qui echoue re-rend, le re-rendu relance, la relance echoue :
  // l'ecran tourne en rond et l'API est appelee en continu tant que l'onglet
  // est ouvert. On ne relance donc jamais tout seul apres un echec -- le bouton
  // « Réessayer » est la pour ca, et lui sait qu'on l'a demande.
  if (!LECTURE_EN_COURS && !LECTURE_ERR && L.possible && L.cle && L.arelire) lancerLecture();
}

async function lancerLecture() {
  if (LECTURE_EN_COURS) return;
  LECTURE_EN_COURS = true;
  LECTURE_ERR = null;
  const avait = !!LECTURE?.lecture;
  if (!avait) await renderLecture();       // l'attente ne s'affiche que s'il n'y a rien à montrer
  try {
    const r = await api('/api/lecture', {});
    LECTURE = r;
    // Les pistes viennent de CETTE lecture : celles gardees pour « Moi »
    // parlent d'une fenetre qui vient d'etre relue, et il faut les redemander.
    MOI = null;
    if (r.usage) { S.usage = r.usage; syncGauge(); }
  } catch (err) {
    // Le toast pour celui qui regarde, l'écran pour celui qui revient.
    LECTURE_ERR = err.message;
    toast(err.message);
  } finally {
    LECTURE_EN_COURS = false;
    if (view === 'mirror' && !MIRROR_DATE) await renderLecture();
  }
}

function wireLecture() {
  $('#view').onclick = async e => {
    // La palette d'un comportement : ouverte sur place, pas dans un panneau.
    // Cinq pastilles n'ont pas besoin d'une fenêtre pour se poser.
    const tc = e.target.closest('[data-teinte][data-pour]');
    if (tc) {
      e.stopPropagation();                    // sans ça le clic replierait le mécanisme
      const item = tc.closest('.meca');
      // La couleur change à l'écran avant la réponse du serveur : c'est un
      // choix esthétique immédiat, pas une écriture qu'on attend.
      item.style.setProperty('--m', tc.dataset.teinte);
      for (const b of item.querySelectorAll('.mpalette [data-teinte]')) {
        b.setAttribute('aria-pressed', String(b === tc));
      }
      try {
        S.motifs = await api('/api/motifs', { id: Number(tc.dataset.pour), teinte: Number(tc.dataset.teinte) });
      } catch (err) { toast(err.message); }
      return;
    }
    const dm = e.target.closest('[data-delmotif]');
    if (dm) {
      try {
        S.motifs = await api('/api/motifs', { delete: Number(dm.dataset.delmotif) });
        return renderLecture();
      } catch (err) { return toast(err.message); }
    }

    if (e.target.closest('[data-lire]')) return lancerLecture();
    if (e.target.closest('[data-aller-reglages]')) { view = 'settings'; syncNav(); return renderSettings(); }
    const j = e.target.closest('[data-jour]');
    if (j) return ouvrirJour(j.dataset.jour);
    const a = e.target.closest('[data-theme-aller]');
    if (a) { MIR_THEME = a.dataset.themeAller; return renderLecture(); }
    const t = e.target.closest('[data-meca]');
    if (t) {
      MIR_THEME = MIR_THEME === t.dataset.meca ? null : t.dataset.meca;
      return renderLecture();
    }
  };
}

/* ===================== le jour ===================== */

/**
 * @param {string|null} date
 * @param {{garderCal?: boolean}} [opt]
 *   `garderCal` : on vient de feuilleter le calendrier, le curseur ne doit PAS
 *   se recaler sur la journée ouverte — c'est tout l'intérêt du geste. Partout
 *   ailleurs il se recale : ouvrir une preuve de 2023 en laissant le calendrier
 *   sur août 2026 montre un mois qui n'a rien à voir avec ce qu'on lit.
 */
async function renderMirror(date, { garderCal = false } = {}) {
  if (!S.stats.days) return renderNoData('Le miroir a besoin de journées passées pour te montrer quoi que ce soit.');
  // Sans date, on est sur la lecture. C'est elle, la vue d'ensemble ; le jour
  // s'ouvre depuis une preuve, un repère, la frise ou le calendrier.
  if (!date) return renderLecture();
  if (!garderCal) MIR_CAL = { vue: 'jour', curseur: date.slice(0, 7) };
  MIRROR_DATE = date;
  const m = await api(`/api/mirror?date=${date}&mois=${MIR_CAL.curseur}`);
  MIRROR_CARNET = m.carnet ?? [];
  const prev = dayShift(date, -1), next = dayShift(date, 1);
  const nav = `<div class="daynav">
      <button class="wide" data-lecture title="Revenir à la vue d'ensemble">‹ ma carte</button>
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

      ${/* L'API renvoyait déjà `reperes` dans cette branche, et le markup ne
            l'affichait jamais : le champ était reçu et jeté. Le plancher retire
            des chiffres, pas des faits qu'on a soi-même posés. */''}
      ${reperesMarkup(m.reperes, date)}
      ${notesDuJourMarkup(m.carnet)}

      ${m.yesterday.text ? `<div class="card hier">
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
        <div style="width:76px;height:76px;flex:none">${petMarkup(S.settings, S.ambiance)}</div>
        <div>
          <p style="margin:0 0 4px">Il n'y a rien d'écrit à te remontrer pour l'instant.</p>
          <p class="sub" style="margin:0 0 12px">Le miroir a besoin de tes mots pour servir à quelque chose. Il n'en a pas encore.</p>
          <button class="btn" id="backToChat">Écrire</button>
        </div>
      </div>` : ''}`;
    const f = $('#cnForm'); if (f) f.dataset.jour = date;
    wireMirror();
    return;
  }

  /*
   * CE QUE LA JOURNEE OUVERTE NE MONTRE PLUS.
   *
   * Elle portait « Tu as deja ecrit ca » -- les journees qui ressemblent a
   * celle-ci -- , une reference, un ecart, et une preuve de resolution. Quatre
   * blocs de statistiques poses a cote d'un texte que quelqu'un vient de
   * rouvrir pour le relire.
   *
   * Le rapprochement n'a pas disparu du produit : il a change de bouche. C'est
   * le compagnon qui dit « ce n'est pas la premiere fois », dans Parler, quand
   * il juge que ca sert -- pas une colonne qui l'affiche a chaque ouverture,
   * qu'on ait demande ou non. La difference est celle entre quelqu'un qui te le
   * rappelle et une machine qui te le ressort.
   *
   * Reste ce qu'on venait chercher : la note, ce qui a ete ecrit, et le repere
   * de ce jour-la s'il y en a un.
   */
  const moi = JOUR_DANS === 'moi';
  /*
   * LA BARRE DE NAVIGATION D'UN JOUR A L'AUTRE.
   *
   * Dans « Ma carte » elle est EN TETE : on arrive d'une preuve, et la premiere
   * chose dont on a besoin est la porte du retour. Dans « Moi » elle est SOUS
   * LE CALENDRIER, collee a la journee qu'elle fait defiler -- posee en haut,
   * elle annoncerait une date avant qu'on ait vu de quel mois on parle, et
   * repeterait celle que la journee affiche deja trois lignes plus bas.
   */
  const barre = `<div class="retourlect${moi ? ' souscal' : ''}">
      ${moi ? '' : '<button data-lecture>‹ ma carte</button>'}
      <span class="faint">${fmtDay(date)}${date === S.today ? " · aujourd'hui" : ''}</span>
      <button data-goto="${prev}" aria-label="Jour précédent">‹</button>
      <button data-goto="${next}" ${next > S.today ? 'disabled' : ''} aria-label="Jour suivant">›</button>
      ${date !== S.today ? `<button data-goto="${S.today}">aujourd'hui</button>` : ''}
    </div>`;
  $('#view').innerHTML = `
    ${moi ? moiEntete() : barre}
    <div class="jourseul${moi ? ' dansmoi' : ''}">
      ${calendarMarkup(m, date)}
      ${moi ? barre : ''}

      ${reperesMarkup(m.reperes, date)}

      <div class="card dayread">
        <div class="dayhead">
          <div>
            <div class="k faint">${fmtDay(date)}${date === S.today ? " \u00b7 aujourd'hui" : ''}</div>
            <button class="bignum${m.note !== null ? ' noted' : ''}" id="dayNote"
                 aria-expanded="${DAY_NOTE_OUVERT}"
                 title="${m.note !== null ? 'Changer cette note' : 'Noter cette journée'}"
                 style="${m.note !== null ? `color:${deltaColor(m.delta)};--halo:${deltaColor(m.delta)}` : 'color:var(--ink-faint)'}">
              ${m.note ?? '\u2014'}<span class="sl">/10</span>
            </button>
          </div>
          <button class="daydrop" data-erase="${date}" title="Effacer cette journée">effacer</button>
        </div>

        ${/*
           * ON PEUT CHANGER LA NOTE D'UNE JOURNEE, ICI ET NULLE PART AILLEURS.
           *
           * Elle ne se posait que sur aujourd'hui : une note mise trop vite le
           * restait pour toujours, et une journee sautee gardait son trou. Sur
           * une serie de quatre ans, une note fausse pese autant qu'une vraie.
           *
           * Le geste est ici parce qu'on y est deja : on relit la journee, on
           * voit ce qu'on avait ecrit, et c'est le seul endroit ou l'on a de
           * quoi juger. Un formulaire de rattrapage ailleurs demanderait de
           * noter des journees qu'on ne relit pas.
           *
           * Il est REPLIE : on ouvre une journee pour la relire cent fois pour
           * une fois qu'on la renote, et une echelle deployee en permanence
           * invite a bouger ce qui n'a pas besoin de bouger.
           */''}
        ${DAY_NOTE_OUVERT ? `<div class="notestrip jourstrip" id="dayStrip">
          ${Array.from({ length: 11 }, (_, n) => {
            const c = noteScaleRGB(n);
            return `<button data-jn="${n}" aria-pressed="${m.note === n}" style="background:rgb(${c})"
              data-tip="${esc(S.anchors.find(a => a.note === n)?.descr ?? `${n}/10`)}">${n}</button>`;
          }).join('')}
          ${m.note !== null ? `<button class="jourdenote" data-jn="">retirer</button>` : ''}
        </div>` : ''}
        ${amplitudeMarkup(m.amplitude)}

        ${m.jour?.text
          ? `<p class="serif dayText">${esc(m.jour.text)}</p>`
          : `<p class="sub" style="margin:0">${m.note !== null ? 'Notée, sans texte.' : "Rien pour cette journée."}</p>`}
      </div>

      ${notesDuJourMarkup(m.carnet)}
    </div>
    ${moi ? ecartsMarkup() : ''}`;
  const form = $('#cnForm'); if (form) form.dataset.jour = date;
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
 * Le repère de la journée ouverte, s'il y en a un.
 *
 * Il y en avait deux sortes. Ce qui est POSE CE JOUR-LA, et le dernier repere
 * AVANT -- « voila ou tu en etais ». Le second partait d'une bonne idee et
 * donnait, sur une journee ordinaire, un encart permanent titre « Reperes »
 * pour annoncer quelque chose d'il y a onze mois. Un bloc qui ne se tait jamais
 * finit par ne plus rien dire, et il occupait la place au-dessus de la note.
 *
 * Le bloc ne parle donc plus que quand ce jour-la porte vraiment un repere.
 * Pour retrouver le precedent, il y a la frise, dont c'est le metier.
 */
/*
 * DE COMBIEN LA JOURNEE A BOUGE.
 *
 * Le compagnon releve, pendant la conversation, ou quelqu'un SEMBLE etre quand
 * le ton bascule. Ce n'est pas une note et ca ne doit pas pouvoir se lire comme
 * une : on n'affiche donc jamais la moyenne de ces releves -- une moyenne
 * ressemblerait a une note, se lirait comme une note, et finirait comparee a la
 * vraie, alors qu'elles ne mesurent pas la meme chose et n'ont pas ete posees
 * par le meme juge.
 *
 * On affiche l'ECART. « De 3 a 8 dans la meme soiree » ne prononce aucun
 * verdict sur la soiree : c'est un fait sur son amplitude, verifiable, et c'est
 * exactement ce qu'on cherche quand on se demande si une journee a tenu.
 *
 * CONTOURE, JAMAIS REMPLI. « Ce qui est rempli est mesure, ce qui est contoure
 * est declare » : ces bornes sont dites par le compagnon, la note de la journee
 * est mesuree par la personne. Les deux ne peuvent pas se confondre a l'oeil.
 */
function amplitudeMarkup(a) {
  if (!a) return '';
  const g = (a.bas / 10) * 100, d = ((10 - a.haut) / 10) * 100;
  return `<div class="amplitude" title="${a.n} relevés pendant la conversation">
    <span class="k faint">dans la journée</span>
    <span class="ampbar" aria-hidden="true"><i style="left:${g}%;right:${d}%"></i></span>
    <span class="ampval mono">${a.bas} → ${a.haut}</span>
    <span class="ampdit">${a.ecart >= 5 ? 'ça a beaucoup bougé' : a.ecart >= 3 ? 'ça a bougé' : 'assez stable'}</span>
  </div>`;
}

function reperesMarkup(rep, date) {
  const jour = rep?.jour ?? [];
  if (!jour.length) return '';
  const aura = prendreAura(date);

  return `<div class="card reperes${aura ? ' aura' : ''}">
    <div class="k faint repk">${jour.length > 1 ? 'Repères' : 'Repère'}</div>
    <div class="repliste">
      ${jour.map(r => `<div class="rep pose">
        <span class="ricone-box">${icone(r.theme, 22)}</span>
        <div class="reptxt"><b>${esc(r.label)}</b><span class="faint">${esc(NOMS[r.theme] ?? 'jalon')}</span></div>
      </div>`).join('')}
    </div>
  </div>`;
}

function calendarMarkup(m, date) {
  const cases = m.calendrier ?? [];
  if (!cases.length) return '';
  const par = new Map(cases.map(c => [c.date, c]));
  return `<div class="card calcard">${calMarkup({
    vue: MIR_CAL.vue,
    curseur: MIR_CAL.curseur ?? date.slice(0, 7),
    debut: date,
    min: '1900-01-01', max: S.today, aujourdhui: S.today,
    /*
     * Une journée notée porte la couleur de son écart, exactement celle de sa
     * case dans la grille de l'Année. Une journée écrite mais non notée porte
     * un point : dans un journal, un trou est une information, et le masquer
     * ferait croire qu'il ne s'est rien passé.
     */
    jour: d => {
      const c = par.get(d);
      if (!c) return null;
      if (c.note !== null && c.note !== undefined) {
        return { couleur: deltaColor(c.delta ?? 0), ecrit: c.texte };
      }
      return c.texte ? { ecrit: true } : null;
    }
  })}</div>`;
}

function wireMirror() {
  // Rejouer la journee la ou l'on est. Sans ca, cliquer une case du calendrier
  // depuis « Moi » renverrait la vue de « Ma carte », onglet inchange : la page
  // change sous les pieds sans que rien ne dise pourquoi.
  const rejouer = (d, o) => (JOUR_DANS === 'moi' ? renderMoi(d, o) : renderMirror(d, o));

  $('#view').onclick = async e => {
    /* --- les pistes, propres a « Moi » --- */
    const pi = e.target.closest('[data-piste]');
    if (pi) {
      MOI_PISTE = MOI_PISTE === pi.dataset.piste ? null : pi.dataset.piste;
      return renderMoi(MIRROR_DATE, { garderCal: true });
    }
    // Un mecanisme cite par une piste mene a « Ma carte », deplie : c'est la
    // qu'il porte ses journees, et une piste ne vaut que si on peut descendre
    // jusqu'aux dates qui la portent.
    const pt = e.target.closest('[data-piste-theme]');
    if (pt) {
      MIR_THEME = pt.dataset.pisteTheme; MIRROR_DATE = null;
      view = 'mirror'; syncNav();
      await renderLecture();
      $('#view').querySelector('.meca.ouvert')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (e.target.closest('[data-moi-ecarts]')) {
      MOI_ECARTS = !MOI_ECARTS;
      return renderMoi(MIRROR_DATE, { garderCal: true });
    }

    // La note de la journée ouverte : l'échelle s'ouvre, puis se pose.
    if (e.target.closest('#dayNote')) {
      DAY_NOTE_OUVERT = !DAY_NOTE_OUVERT;
      return rejouer(MIRROR_DATE, { garderCal: true });
    }
    const jn = e.target.closest('[data-jn]');
    if (jn) {
      const v = jn.dataset.jn === '' ? null : Number(jn.dataset.jn);
      await api('/api/note', { date: MIRROR_DATE, note: v });
      // L'état global porte le compte de journées et la référence : les deux
      // viennent de bouger, et le rail les affiche.
      S = await api('/api/state');
      syncHeader();
      DAY_NOTE_OUVERT = false;
      toast(v === null ? 'Note retirée' : `Journée notée ${v}/10`);
      return rejouer(MIRROR_DATE, { garderCal: true });
    }

    // AVANT [data-goto] : une note datée porte les deux (sa date ouvre le
    // Miroir, sa croix la retire), et [data-goto] fait un return immédiat.
    const dcn = e.target.closest('[data-delcn]');
    if (dcn) {
      await api('/api/carnet', { delete: Number(dcn.dataset.delcn) });
      toast('Note retirée');
      return rejouer(MIRROR_DATE);
    }

    // Le calendrier : feuilleter ne change pas le jour ouvert ; cliquer une
    // case, si. Deux gestes, deux effets.
    const c = e.target.closest('[data-cal]');
    if (c) {
      if (c.dataset.cal === 'jour') { MIR_CAL.curseur = c.dataset.d.slice(0, 7); return rejouer(c.dataset.d); }
      MIR_CAL = calClic({ ...MIR_CAL, debut: MIRROR_DATE }, c.dataset);
      return rejouer(MIRROR_DATE, { garderCal: true });
    }
    if (e.target.closest('[data-lecture]')) { MIRROR_DATE = null; return renderLecture(); }
    const g = e.target.closest('[data-goto]');
    if (g) return rejouer(g.dataset.goto);
    if (e.target.closest('#backToChat')) return go('tonight');

    const del = e.target.closest('[data-erase]');
    if (del) {
      const d = del.dataset.erase;
      // Une seule journée : pas de mot à retaper, mais une confirmation quand
      // même. Le geste est petit, la perte ne l'est pas.
      // Ce que le geste ne détruit PAS doit être dit : une note apportée n'a pas
      // été écrite ce jour-là, elle a été rangée là, et elle survit.
      const n = (MIRROR_CARNET ?? []).length;
      const garde = n ? `\n\n${n} note${n > 1 ? 's' : ''} apportée${n > 1 ? 's' : ''} sur ce jour rester${n > 1 ? 'ont' : 'a'} dans ton carnet.` : '';
      if (!confirm(`Effacer la journée du ${fmtDay(d)} — sa note et son texte ?${garde}`)) return;
      try {
        await api('/api/delete-day', { date: d });
        S = await api('/api/state');
        SERIES = null;
        syncHeader();
        rejouer(d);
        toast('Journée effacée');
      } catch (err) { toast(err.message); }
    }
  };
}

/* ============================= vue : carte =============================

   Ce que quatre ans de journal contiennent et qu'aucune courbe ne montre : ce
   dont on parle, et ce qui revient avec quoi. Rien n'est généré — on compte des
   mots déjà écrits, on les colore par les notes déjà posées.            */

/* ---------------------------------------------------------------------
 * « JE REMARQUE » N'EST PLUS UN ONGLET.
 *
 * Il portait la carte des MOTS : des co-occurrences, un trait quand deux mots
 * tombent la meme journee. Elle savait dire que « fatigue » et « boulot » vont
 * ensemble, et rien de plus -- un trait sans verbe ne dit pas ce qui se passe
 * entre deux choses. Elle vivait a cote d'une autre vue qui, elle, comprenait
 * quelque chose, et il fallait choisir un onglet sans savoir lequel repondait.
 *
 * Un seul onglet maintenant : « Ma carte ». La synthese, la carte organique, et
 * les themes -- une seule lecture, un seul endroit. Le jour reste dessous.
 *
 * Le calcul des mots n'est PAS supprime : server/graph.js et ses routes vivent
 * toujours, testes, avec l'invariant du carnet qu'ils portent. Ce qui a disparu
 * est l'onglet qui les affichait.
 * ------------------------------------------------------------------- */


/* ============================= vue : réglages ============================= */

async function renderSettings() {
  const s = S.settings;

  $('#view').innerHTML = `
    ${/* « Ce qui revient » vit maintenant dans Ma carte, à côté de la carte et
          de la synthèse — c'est là qu'on va pour savoir ce que le compagnon
          comprend. Et les notes rangées se retrouvent dans Année, avec le reste
          du journal. Ce qui restait ici obligeait à venir chercher une lecture
          dans l'onglet des préférences. */''}
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

      ${/* L'heure est un REGLAGE INVISIBLE : personne ne pense a la verifier, et
             quand elle est fausse le symptome se lit des mois plus tard, sous la
             forme d'un trou dans la grille. On la montre donc telle que le
             SERVEUR la voit, a cote de l'horloge du navigateur. */''}
      <div class="card">
        <h2>L'heure</h2>
        <p class="sub">
          « Aujourd'hui » est ta journée à toi, pas celle du serveur. Ton navigateur annonce
          ton fuseau à chaque requête ; voici ce que le serveur en fait.
        </p>
        <div class="fuseau" id="fuseau"><span>vérification…</span></div>
        <p class="sub" style="margin:0;font-size:12.5px">
          Si les deux heures ne concordent pas, une note posée après minuit tombe sur la veille.
          Rien à régler à la main : c'est détecté tout seul, et ça suit tes voyages
          comme le changement d'heure.
        </p>
      </div>

      ${/* Le mode pudique est un reglage de VUE, pas de donnees : rien n'est
             efface, rien n'est chiffre, rien ne quitte l'ecran autrement. Il
             tient donc juste au-dessus de « Tes donnees », la ou on vient
             quand on se demande qui voit quoi. */''}
      <div class="card">
        <h2>Montrer l'écran</h2>
        <p class="sub">
          Partager son écran, c'est montrer à quelqu'un d'autre un journal écrit pour soi.
          Le mode privé éteint les <b>mots</b> et garde les <b>formes</b> : tes messages,
          tes journées, tes notes rangées, les noms des mécanismes et des repères deviennent
          des traces illisibles ; les notes, la grille, les couleurs, les courbes et les amas
          de ta carte restent. L'application se montre entière, sans que personne puisse la lire.
        </p>
        ${pudMarkup()}
        <p class="sub" style="margin:0;font-size:12.5px">
          Ça ne change rien à ce qui est enregistré — c'est un rideau, pas une gomme.
          <b>Toi non plus</b> tu ne peux plus lire pendant ce temps : c'est ce qui fait
          qu'il n'y a rien à oublier de recacher.
        </p>
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
  montrerFuseau();

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
        SERIES = null;
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
    </p>
    <label class="field" style="margin-top:14px"><span>
      <input type="checkbox" id="carnetMemoire" ${s.carnetMemoire !== false ? 'checked' : ''}
             style="width:auto;margin-right:7px">
      Lui transmettre les notes que tu lui as données</span></label>
    <p class="sub" style="margin:0;font-size:12px">
      ${CARNET.compte?.total
        ? `Les ${Math.min(12, CARNET.compte.total)} dernières des ${CARNET.compte.total} notes rangées sont transmises, tronquées.`
        : "Tu ne lui as encore rien donné à ranger."}
      Il peut aller chercher les autres lui-même quand la conversation y touche.
      Décocher les retire du contexte sans rien effacer.
      <br>Hors ligne, le compagnon n'a ni tes journées ni tes notes.
    </p>
    <label class="field" style="margin-top:14px"><span>
      <input type="checkbox" id="sansEnveloppe" ${s.sansEnveloppe ? 'checked' : ''}
             style="width:auto;margin-right:7px">
      Retirer l'enveloppe de jetons</span></label>
    <p class="sub" style="margin:0;font-size:12px">
      L'enveloppe existe parce que d'habitude c'est la clé de l'hébergeur qui règle : à zéro,
      le compagnon retombe hors-ligne au lieu de couper quelqu'un au milieu d'une phrase.
      Sur ton propre journal, avec ta propre clé, elle ne protège de rien.
      <br>Décochée, il n'y a plus de plafond et plus de repli.
      <b>Le compte des jetons continue</b> — c'est même tout ce qu'il reste pour savoir
      ce que ça coûte.
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
  $('#carnetMemoire')?.addEventListener('change', async e => {
    await saveSettings({ carnetMemoire: e.target.checked });
    toast(e.target.checked ? 'Carnet transmis' : 'Carnet retiré du contexte — rien n\'est effacé');
  });

  // L'état de l'enveloppe se lit dans la jauge, pas dans les réglages : elle est
  // rafraîchie tout de suite, sinon on coche et rien ne bouge à l'écran.
  $('#sansEnveloppe')?.addEventListener('change', async e => {
    await saveSettings({ sansEnveloppe: e.target.checked });
    try { S.usage = (await api('/api/state')).usage; syncGauge(); } catch { /* la jauge suivra */ }
  });
  $('#memoryDays')?.addEventListener('change', async e => {
    await saveSettings({ memoryDays: Number(e.target.value) });
    renderSettings();
  });
}

/**
 * L'heure du serveur, mise face a celle du navigateur.
 *
 * On compare les deux HORLOGES, pas les deux fuseaux : deux identifiants
 * differents peuvent dire la meme heure, et c'est l'heure qui decide sur
 * quelle case de la grille tombe une note. On tolere une minute d'ecart --
 * l'aller-retour reseau peut tomber pile sur un changement de minute.
 */
async function montrerFuseau() {
  const el = $('#fuseau');
  if (!el) return;
  try {
    const t = await api('/api/temps');
    const ici = new Date();
    const hhmm = `${String(ici.getHours()).padStart(2, '0')}:${String(ici.getMinutes()).padStart(2, '0')}`;
    const ecart = Math.abs(
      (Number(t.heure.slice(0, 2)) * 60 + Number(t.heure.slice(3))) -
      (ici.getHours() * 60 + ici.getMinutes()));
    const ok = Math.min(ecart, 1440 - ecart) <= 1;
    el.innerHTML = `
      <span class="horloge">${esc(t.heure)}</span>
      <span>chez le serveur · <b>${esc(t.zone)}</b> ${esc(t.decalage)}</span>
      <span>${hhmm} ici · <b>${esc(FUSEAU || 'fuseau inconnu')}</b></span>
      <span class="verdict ${ok ? 'ok' : 'ko'}">${ok
        ? '✓ à ton heure'
        : "⚠ le serveur n'est pas à ton heure"}</span>`;
  } catch {
    el.innerHTML = '<span>l\'heure du serveur est injoignable</span>';
  }
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
  moi: () => renderMoi(),
  year: () => renderYear(),
  mirror: () => renderMirror(),
  settings: renderSettings
};

const NOM_VUE = { tonight: 'Parler', moi: 'Moi', year: 'Année', mirror: 'Ma carte', settings: 'Réglages' };

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
  // Rattraper est un geste ponctuel, pas un mode dans lequel on reste : le
  // curseur de note revient à aujourd'hui dès qu'on change de vue.
  NOTE_JOUR = null;
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
  // Le chaton suit le decor, pas la note. Il vit dans le rail et n'est pas
  // redessine par les vues : c'est ici, et nulle part ailleurs, qu'il change
  // de visage.
  const art = $('#art');
  if (art && S.settings?.petSprite !== 'custom') art.innerHTML = petMarkup(S.settings, a);
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
    // Le bouton pudique vit dans le panneau de la jauge ET dans les reglages :
    // un seul ecouteur a la racine, plutot qu'un par endroit qui le dessine.
    // On vise la CLASSE et pas l'attribut : `data-pudique` est pose sur la
    // racine quand le mode est actif, et un `closest('[data-pudique]')`
    // remontait jusqu'a elle -- le moindre clic dans la page rebasculait.
    if (e.target.closest('[data-bascule-pudique]')) { basculerPudique(); return; }
    if (!$('#gaugePanel').hidden && !e.target.closest('#gaugePanel') && !e.target.closest('#gauge')) toggleGauge(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') toggleGauge(false);
    // Ctrl+Maj+P : le raccourci existe parce que le geste est urgent -- on
    // partage son ecran dans la seconde, pas apres avoir cherche un bouton.
    // Avec Maj, il ne peut pas partir d'une frappe dans la zone de saisie.
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
      e.preventDefault();
      basculerPudique();
    }
  });
  appliquerPudique();

  go('tonight');
}

boot();
