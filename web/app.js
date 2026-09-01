import { PETS, petMarkup } from './pets.js';
import { Ambiance } from './ambiance.js';
import { disposer } from './carte.js';
import { versGraphe, dessinerRelations, noeudAu, journeeAu, cadrer, recadrer,
         vueNeutre, zoomer, poidsDuNoeud, ilotDesNoeuds, contour,
         NOM_GENRE, TEINTE_GENRE, echelle } from './relations.js';
import { toPNG, PetTalk } from './pet.js';
import { VOICES, Blip } from './blips.js';
import { deltaColor, noteColor, noteScaleRGB, lineChart, dailyChart, bandMarkup, SATURATION, CADRE } from './charts.js';
import { icone, iconeDe, themeDe, teinteDe, NOMS, ICONES, TEINTES_DECLAREES } from './reperes.js';
import { ico, ICO_VUE } from './icones.js';
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

/**
 * @param {string} msg
 * @param {{duree?: number}} [opts]  combien de temps il reste. Voir ci-dessous.
 *
 * DEUX SECONDES SUFFISENT POUR « Clé copiée », PAS POUR UNE PANNE.
 *
 * Un message d'erreur doit se lire ET se retenir : il nomme un réglage à
 * changer. À 2,2 s, on voit qu'il s'est passé quelque chose et on a déjà perdu
 * ce que c'était — il ne reste qu'à refaire le geste pour le relire.
 */
function toast(msg, { duree = 2200 } = {}) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('on'), duree);
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
      <form method="post" action="/logout" style="margin-left:auto"><button class="btn" type="submit">${ico('partir')}Déconnexion</button></form>
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

/*
 * PARLER NE MONTRE QUE CE QU'IL FAUT MONTRER MAINTENANT.
 *
 * L'ecran portait en permanence : le fil, le composeur, « note avant de te
 * coucher », la reference, la rangee des journees non notees, le bouton
 * « nouveau fil », et une echelle de onze pastilles colorees en bas. Plus, dans
 * le rail, le nom du produit, le compte de jours, la derniere phrase du
 * compagnon recopiee sous son portrait, et le nom du decor.
 *
 * C'est un ecran ou l'on vient PARLER. Tout le reste est du mobilier : chaque
 * element se justifiait seul, et ensemble ils formaient un tableau de bord
 * autour d'une conversation. L'echelle de notes surtout -- onze pavés de
 * couleur, la chose la plus lumineuse de la page, sous une conversation
 * eventuellement difficile.
 *
 * La regle appliquee ici : rien ne reste a l'ecran pour le cas ou l'on en
 * aurait besoin. Ce qui a quelque chose a dire APPARAIT, puis s'en va.
 */

/** L'heure a laquelle « avant de te coucher » commence a vouloir dire quelque chose. */
const HEURE_DU_SOIR = 20;

/*
 * Combien de temps « c'est note » reste a l'ecran.
 *
 * Assez pour lire une phrase ET decider d'aller changer sa note : le lien
 * qu'elle porte doit pouvoir etre clique, sinon autant ne pas le mettre. Six
 * secondes suffisaient a la lire et pas a s'en servir.
 */
const DUREE_NOTEDITE = 11000;

/*
 * OU VA LA NOTE QUAND ELLE QUITTE CET ECRAN.
 *
 * Retirer l'echelle de Parler n'a de sens que si l'on dit ou elle se retrouve.
 * Sans ca on ne l'a pas simplifie, on l'a cache -- et quelqu'un qui voudrait
 * corriger sa note chercherait sans savoir ou.
 *
 * La grille est le dessin d'Annee : des journees en cases, chacune de la
 * couleur de sa note. C'est litteralement ce qu'on va y voir, donc l'icone n'a
 * rien a apprendre a personne.
 */
const GLYPHE_ANNEE = ico('annee', 12);

const lienAnnee = () =>
  `<button class="versannee" data-vers-annee>${GLYPHE_ANNEE}Année</button>`;

/**
 * La note se demande quand elle est EN RETARD, pas en permanence.
 *
 * Trois cas, et un seul d'entre eux est frequent :
 *   - on vise expressement une journee passee (on est venu pour ca) ;
 *   - des journees passees n'ont pas ete notees -- c'est le vrai retard ;
 *   - c'est le soir et aujourd'hui n'est pas notee.
 *
 * En dehors de ca, l'ecran ne demande rien. Une echelle de notes affichee tout
 * l'apres-midi n'est pas un rappel, c'est un meuble.
 */
function noteEnRetard({ hier, manques, note, heure }) {
  if (hier) return true;
  if (manques.length) return true;
  return note === null && heure >= HEURE_DU_SOIR;
}

/* Ce qui vient d'etre note : de quoi remplacer la carte par une phrase, le
   temps qu'on la lise. Remis a zero a chaque rendu complet de la vue. */
let NOTE_DITE = null;

async function renderTonight() {
  const t = NOTE_JOUR ?? S.today;
  const hier = t !== S.today;
  // Un jour visé sort de `aNoter` : il est sans note par construction, et
  // aller le demander au serveur serait un aller-retour pour apprendre `null`.
  const note = hier ? null : (S.entry?.note ?? null);
  const s = S.settings;
  const manques = S.stats.aNoter ?? [];
  const demande = noteEnRetard({ hier, manques, note, heure: new Date().getHours() });
  $('#view').innerHTML = `
    <div class="tonight">
      <div class="thread" id="thread"></div>

      ${/* Ce qu'on s'apprete a joindre, au-dessus du champ : une piece qu'on
             ne voit pas est une piece qu'on envoie sans le savoir. */''}
      <div class="jointes" id="jointes" hidden></div>

      <div class="composer">
        ${/* LE TROMBONE JOINT UN FICHIER. Il indiquait « ce que tu tiens » --
              les objectifs -- et n'ouvrait rien : un bouton qui ne fait rien
              occupait la seule place ou l'on cherche a joindre quelque chose. */''}
        <button class="clip" id="clip" aria-label="Joindre un fichier"
                data-tip="Une image, un PDF, un texte — lu pour cette réponse">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
               stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M20.4 11.6 12.3 19.7a5 5 0 0 1-7.1-7.1l8.1-8.1a3.3 3.3 0 0 1 4.7 4.7l-8.1 8.1a1.7 1.7 0 0 1-2.4-2.4l7.5-7.5"/>
          </svg>
        </button>
        <input type="file" id="fichiers" multiple hidden
               accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/markdown,text/csv,application/json,.md,.txt,.csv,.json">
        <textarea id="input" rows="1" placeholder="Écris ici…" aria-label="Ton message"></textarea>
        <button class="sendarrow" id="send" aria-label="Envoyer" title="Envoyer">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
               stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 12h15"/><path d="M13 6l6 6-6 6"/>
          </svg>
        </button>
      </div>

      ${/* LE PIED : trois etats, et deux d'entre eux sont vides ou presque.
             Il ne porte JAMAIS les trois en meme temps. */''}
      <div class="pied">
        ${NOTE_DITE ? `<p class="notedite">
          <b>${esc(NOTE_DITE)}</b> — c'est noté. Pour la changer : ${lienAnnee()}
        </p>` : demande ? `<div class="notecard${hier ? ' rattrape' : ''}">
          ${/*
             * TROIS CAS, ET L'ECHELLE N'APPARAIT QUE DANS DEUX.
             *
             * Elle s'affichait toujours, et sur une journee deja notee au
             * milieu d'un rattrapage elle disait la note d'AUJOURD'HUI sous un
             * titre qui parlait d'hier : onze pastilles pour un jour dont il
             * n'etait pas question. Le retard se dit donc d'abord en journees,
             * et l'echelle n'arrive qu'une fois qu'on a designe laquelle.
             */''}
          ${hier || !manques.length ? `<div class="noteline">
            <span class="k">${hier ? `Tu notes le ${fmtDay(t)}` : 'Note avant de te coucher'}</span>
            ${hier ? `<button class="retourjour" data-notejour="">${ico('point', 12)}revenir à aujourd'hui</button>` : ''}
          </div>

          <div class="notestrip" id="notestrip">
            ${Array.from({ length: 11 }, (_, n) => {
              const c = noteScaleRGB(n);
              const on = note === n;
              return `<button data-n="${n}" aria-pressed="${on}" style="background:rgb(${c})"
                data-tip="${esc(S.anchors.find(a => a.note === n)?.descr ?? `${n}/10`)}">${n}</button>`;
            }).join('')}
          </div>` : `<div class="manques">
            ${/* Le retard, en une ligne de jours. On en designe un, l'echelle
                  arrive dessous, et elle repart avec lui. Ce produit ne relance
                  pas les jours de silence : la ligne dit ce qui manque, elle ne
                  demande rien. */''}
            <span class="k faint">non notés</span>
            ${manques.map(m => `<button data-notejour="${m.date}"
              title="${m.ecrit ? 'Tu as écrit ce jour-là, sans le noter.' : 'Rien pour ce jour-là.'}"
              >${fmtJourCourt(m.date)}${m.ecrit ? '<i></i>' : ''}</button>`).join('')}
          </div>`}
        </div>` : ''}

        ${/* « Nouveau fil » n'est plus une ligne de tableau de bord : c'est un
              mot, en retrait, qui n'existe que s'il y a un fil a quitter. */''}
        <button class="newchat" id="newChat"${S.messages?.length ? '' : ' hidden'}
                title="Repartir sur un fil vide. Rien n'est effacé : tes journées restent dans le journal."
        >${ico('plus', 12)}nouveau fil</button>
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

  const strip = $('#notestrip');
  if (strip) strip.onclick = async e => {
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
    /*
     * LA NOTE POSEE, LA CARTE S'EN VA.
     *
     * Elle est remplacee par une phrase, le temps qu'on la lise, qui dit ou la
     * note est allee et par ou la changer. Sans cette phrase on n'aurait pas
     * simplifie l'ecran, on aurait cache une commande -- et il n'y a pas de
     * pire simplification que celle qui laisse quelqu'un chercher.
     *
     * Elle ne s'affiche pas s'il reste des journees a rattraper : ce serait
     * annoncer la fin d'un geste qu'on est en train de faire.
     */
    const reste = (S.stats.aNoter ?? []).length || (NOTE_JOUR !== null);
    NOTE_DITE = reste ? null : `${hier ? fmtDay(t) : "Aujourd'hui"} · ${n}/10`;
    renderTonight();
    if (!reste) {
      // Puis elle part aussi. L'ecran redevient une conversation et rien d'autre.
      setTimeout(() => {
        if (NOTE_DITE === null || view !== 'tonight') return;
        // On relit l'element au moment ou l'on s'en sert : celui capture avant
        // le rendu appartient au DOM d'avant, et poser une classe dessus ne
        // ferait rien du tout.
        $('.notedite')?.classList.add('sen-va');
        setTimeout(() => { NOTE_DITE = null; if (view === 'tonight') renderTonight(); }, 700);
      }, DUREE_NOTEDITE);
    } else {
      toast(`${hier ? fmtDay(t) : 'Journée'} notée ${n}/10`);
    }
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
  const pied = $('.pied');
  if (pied) pied.onclick = e => {
    if (e.target.closest('[data-vers-annee]')) { NOTE_DITE = null; return go('year'); }
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

  $('#clip').onclick = () => $('#fichiers').click();
  $('#fichiers').onchange = async e => {
    await joindre(e.target.files);
    e.target.value = '';     // rejoindre deux fois le meme fichier reste possible
  };
  // Coller une capture d'ecran est le geste le plus courant, et il ne passe
  // par aucun bouton : Ctrl+V dans le champ suffit.
  input.onpaste = e => {
    const fs = [...(e.clipboardData?.files ?? [])];
    if (fs.length) { e.preventDefault(); joindre(fs); }
  };
  $('#jointes').onclick = e => {
    const d = e.target.closest('[data-dejoindre]');
    if (d) { JOINTES.splice(Number(d.dataset.dejoindre), 1); dessinerJointes(); }
  };

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

/*
 * « [sam. 29/08 07:07] » en tete d'une reponse du compagnon.
 *
 * Le marqueur est pose par l'application sur ce que la PERSONNE ecrit, pour
 * que le modele sache l'heure qu'il est. Il n'a jamais eu a le recopier -- et
 * il le faisait, parce qu'il voyait le sien dans tout son historique. Le
 * defaut est repare a la source, mais les tours ou il l'a recopie sont dans la
 * base : sans ce nettoyage a l'affichage, ils gardent leur crochet pour
 * toujours, en double avec l'horodatage que la bulle porte deja.
 */
const MARQUEUR = /^\s*\[\p{L}{2,4}\.?\s+\d{2}\/\d{2}\s+\d{2}:\d{2}\]\s*/u;
const sansMarqueur = t => String(t ?? '').replace(MARQUEUR, '');

/*
 * Les motifs reconnus PENDANT ce tour-ci. Ce sont les seuls dont la puce
 * s'anime : une apparition qui rejoue a chaque rendu du fil n'annonce plus
 * rien, elle scintille. L'ensemble se vide au message suivant, comme les
 * gestes.
 */
let FRAIS = new Set();

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
    /*
     * LA RECONNAISSANCE SE DIT UNE FOIS, ET LA OU ELLE A LIEU.
     *
     * Elle se disait deux fois : une puce sous la phrase, et un bandeau
     * « MOTIF RECONNU · 2 fois » au-dessus du composeur. Le bandeau etait le
     * plus visible des deux et le moins utile -- il annoncait, detache de la
     * phrase, un mecanisme qu'on ne pouvait pas relier a ce qui venait d'etre
     * ecrit. Il est parti ; la puce reste, et c'est elle qui s'anime.
     *
     * Ce qui vient d'etre reconnu apparait : le nom d'abord, le compte juste
     * apres. Les deux d'un coup feraient une etiquette qui tombe ; en deux
     * temps, on lit ce qui a ete reconnu, puis depuis combien de fois. Les
     * anciennes puces, elles, sont deja la et ne bougent pas -- une animation
     * qui rejoue a chaque rendu du fil devient un tic.
     */
    const marque = mots.length
      ? `<span class="motifs">${mots.map(x => {
          const frais = FRAIS.has(x.id) ? ' frais' : '';
          return `<button class="motifchip${frais}" data-motif="${x.id}" style="--motif:${x.teinte}"
            title="${esc(x.mecanisme ?? 'Motif suivi par le compagnon')}${
              x.vues > 1 ? ` — reconnu ${x.vues} fois` : ''}"
            >${esc(x.nom)}${x.vues > 1
              ? `<span class="mvues">${x.vues}<small>×</small></span>` : ''}</button>`;
        }).join('')}</span>`
      : '';
    return sep + silence + `<div class="msg ${m.role}${passe}${mots.length ? ' teinte' : ''}"${teinte} data-id="${m.id ?? ''}"
      >${pause ? `<span class="t">${fmtTime(m.ts)}</span>` : ''
      }${reflexionMarkup(m)}<span class="tx">${esc(
        m.role === 'pet' ? sansMarqueur(m.text) : m.text
      )}</span>${marque}${rembobMarkup(m)}</div>`;
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
/*
 * LES OBJECTIFS ONT ETE RETIRES.
 *
 * Le trombone « ce que tu tiens » n'ouvrait rien qu'on remplisse : il listait
 * des resolutions posees dans la conversation, sans case a cocher ni rappel.
 * L'idee etait juste -- et elle reste : ce dont on a du mal a se passer est
 * maintenant un NOEUD de la carte, avec son genre « dependance », relie au
 * reste. Un suivi separe disait « voila ce que tu as decide » ; la carte dit
 * « voila a quoi ca tient », ce qui est la question qu'on se pose vraiment.
 *
 * Rien n'est efface en base : la table `objectifs` et sa route restent, et ce
 * qui y a ete ecrit s'exporte toujours. On retire l'interface et l'outil, pas
 * les donnees -- supprimer est irreversible, cacher ne l'est pas.
 */

let GESTES = [];

/**
 * Ce qu'une correction remplace -- et RIEN D'AUTRE.
 *
 * Une correction de date seule affichait « au lieu de arrêt du traitement · 21
 * août », en recopiant un label identique de part et d'autre du « au lieu de ».
 * L'oeil doit alors comparer deux chaines pour trouver le seul mot qui a bouge.
 * On ne montre donc que le champ qui a change : la date, le label, ou les deux
 * quand les deux ont bouge.
 */
function avantDe(g) {
  const a = g?.avant;
  if (!a) return '';
  const dateAutre = a.date && a.date !== g.date;
  const labelAutre = a.label && a.label !== g.label;
  if (dateAutre && labelAutre) return `au lieu de ${esc(a.label)} · ${fmtDay(a.date)}`;
  if (dateAutre) return `au lieu du ${fmtDay(a.date)}`;
  if (labelAutre) return `au lieu de « ${esc(a.label)} »`;
  return '';
}

function gestesMarkup() {
  if (!GESTES.length) return '';
  /*
   * PAS DE BANDEAU POUR UN MOTIF : il se dit sur la phrase, pas au-dessus du
   * composeur. Detache de ce qui vient d'etre ecrit, « MOTIF RECONNU · 2 fois »
   * annoncait un mecanisme sans dire lequel de ses mots l'avait declenche --
   * alors que la puce, elle, est posee exactement dessous. Deux annonces pour
   * un seul fait, et la plus voyante etait la moins situee.
   */
  return `<div class="gestes">${GESTES.filter(g => g.type !== 'objectif' && g.type !== 'motif').map(g => g.type === 'note'
    ? `<div class="geste note">
         <span class="gicone">${icone('pensee', 20)}</span>
         <div class="gtxt">
           <b>Rangé dans tes notes</b>
           ${/* Le compte de signes, parce que c'est la seule chose qui dit
                 ce qui vient d'etre range sans le recopier dans le fil. */''}
           <span>${g.taille} signes${g.jour ? ` · ${fmtDay(g.jour)}` : g.quand ? ` · ${esc(g.quand)}` : ' · sans date'}
             — ne compte pas comme une journée écrite</span>
         </div>
         ${g.jour ? `<button class="gbtn" data-voir="${g.jour}">${ico('oeil', 12)}voir</button>` : ''}
       </div>`
    : `<div class="geste repere">
         <span class="gicone">${icone(g.theme, 20)}</span>
         <div class="gtxt">
           ${/* UNE CORRECTION DIT CE QU'ELLE CORRIGE. Sans l'état d'avant, elle
                 est indistinguable d'une pose — et on ne peut pas savoir si le
                 compagnon a compris la rectification ou posé un deuxième
                 repère à côté du premier. */''}
           <b>${g.corrige ? 'Repère corrigé' : 'Repère posé'}</b>
           <span>${esc(g.label)} · ${fmtDay(g.date)}${g.corrige && avantDe(g)
             ? ` <span class="gavant">${avantDe(g)}</span>` : ''}</span>
         </div>
         <button class="gbtn" data-voir="${g.date}">${ico('oeil', 12)}voir</button>
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
    const m = e.target.closest('[data-motif]');
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

/* ---------------------------- les pièces jointes ----------------------------

   Une image ou un PDF ne se résume pas en texte sans perdre ce qui compte : une
   ordonnance, un compte rendu, une capture. Ils partent tels quels et le
   compagnon les lit.

   Ils ne sont PAS enregistrés. Le journal est un fichier SQLite qu'on exporte
   et qu'on emporte ; y coller des mégaoctets de binaire le rendrait
   intransportable pour rien -- ce qui compte dans un compte rendu, le compagnon
   peut le RANGER dans le carnet avec l'outil qu'il a déjà, et c'est là, en
   texte, que ça sert ensuite.

   Les fichiers TEXTE, eux, sont lus ici et collés dans le message : ils sont
   donc gardés comme tout ce qu'on écrit.                                     */

let JOINTES = [];
const PIECE_MAX = 8 * 1024 * 1024;
const BINAIRES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);
const estTexte = f => /^text\//.test(f.type) || f.type === 'application/json'
  || /\.(md|txt|csv|json|log)$/i.test(f.name);

const lireBase64 = f => new Promise((ok, ko) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1] ?? '');
  r.onerror = () => ko(new Error(`« ${f.name} » n'a pas pu être lu.`));
  r.readAsDataURL(f);
});

async function joindre(liste) {
  for (const f of [...(liste ?? [])]) {
    if (JOINTES.length >= 5) { toast('Cinq pièces au maximum.'); break; }
    if (f.size > PIECE_MAX) { toast(`« ${f.name} » dépasse 8 Mo.`); continue; }
    try {
      if (estTexte(f)) {
        JOINTES.push({ nom: f.name, media: 'texte', texte: (await f.text()).slice(0, 40000) });
      } else if (BINAIRES.has(f.type)) {
        JOINTES.push({ nom: f.name, media: f.type, donnees: await lireBase64(f) });
      } else {
        toast(`« ${f.name} » : format non lu (images, PDF, texte).`);
      }
    } catch (err) { toast(err.message); }
  }
  dessinerJointes();
}

function dessinerJointes() {
  const el = $('#jointes');
  if (!el) return;
  el.hidden = !JOINTES.length;
  el.innerHTML = JOINTES.map((p, i) => `<span class="jointe" data-t="${p.media === 'texte' ? 'texte' : p.media === 'application/pdf' ? 'pdf' : 'image'}">
    <b>${esc(p.nom)}</b>
    <button data-dejoindre="${i}" aria-label="Retirer ${esc(p.nom)}">×</button>
  </span>`).join('');
}

async function send() {
  const input = $('#input');
  let text = input.value.trim();
  if (!text && !JOINTES.length) return;

  /*
   * Le texte des fichiers texte est COLLE au message.
   *
   * C'est ce qui fait qu'un compte rendu reste lisible dans le fil six mois
   * plus tard, alors qu'une image du meme compte rendu n'aurait laisse qu'un
   * nom de fichier. Les fichiers texte n'ont aucune raison d'etre traites comme
   * des pieces : ce sont des mots, et ce produit garde les mots.
   */
  const textes = JOINTES.filter(p => p.media === 'texte');
  if (textes.length) {
    text = [text, ...textes.map(p => `\n\n— ${p.nom} —\n${p.texte}`)].join('').trim();
  }
  const pieces = JOINTES.filter(p => p.media !== 'texte')
    .map(p => ({ nom: p.nom, media: p.media, donnees: p.donnees }));
  const noms = pieces.map(p => p.nom);
  JOINTES = [];
  dessinerJointes();

  input.value = '';
  input.style.height = 'auto';
  $('#send').disabled = true;
  PetTalk.stop();

  GESTES = [];                        // les gestes du tour précédent ont fait leur temps
  FRAIS = new Set();                  // et les motifs qu'il avait reconnus aussi
  // affichage optimiste : ce que tu écris apparaît tout de suite
  S.messages.push({ ts: new Date().toISOString(), date: S.today, role: 'user',
                    text: text || noms.map(n => `[${n}]`).join(' ') });
  drawThread();

  let typing = null;

  try {
    const res = await fetch('/api/message/stream', {
      method: 'POST',
      headers: enTetes(true),
      /*
       * PAS DE DATE : C'EST LE SERVEUR QUI SAIT QUELLE JOURNEE ON EST.
       *
       * Elle commence au lever, pas a minuit, et l'onglet peut etre reste
       * ouvert toute la nuit. La date envoyee d'ici serait celle du chargement
       * de la page — et un message ecrit a 9 h se rangerait dans la soiree de
       * la veille. Le serveur renvoie celle qu'il a retenue, dans `done`.
       */
      body: JSON.stringify({ text, pieces })
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
        // Un motif reconnu ne pose plus de bandeau : il marque sa puce, qui
        // apparaitra sur la phrase au rendu du fil, en fin de tour.
        if (data.type === 'motif') { if (data.id) FRAIS.add(data.id); return; }
        GESTES.push(data);
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
        // La journée que le serveur a retenue pour ce message. Elle peut avoir
        // changé depuis l'ouverture de la page : « aujourd'hui » commence au
        // lever, et on a pu se lever pendant que l'onglet était ouvert.
        if (data.jour) S.today = data.jour;
        // Le décor suit la conversation. Il ne changeait qu'au rechargement de
        // la page : on pouvait parler d'un deuil pendant une heure devant le
        // même fond neutre, et découvrir la pyramide le lendemain, sur une
        // conversation qui n'avait plus rien à voir.
        if (data.ambiance) { S.ambiance = data.ambiance; syncAmbiance(); }

        if (data.refused) {
          toast('Le modèle a décliné — le compagnon hors-ligne a pris la main.');
          showHelpline();
        } else if (data.degraded) {
          /*
           * PAS DE TRONCATURE. Elle coupait à soixante signes, c'est-à-dire
           * pile avant la phrase utile : on lisait
           * « (400 {"type":"error","error":{"type":"invalid_request_error", »
           * et pas un mot de ce que l'API reprochait. Le serveur envoie
           * maintenant une phrase française déjà lisible — la couper serait
           * refaire la même chose sur un texte plus court.
           */
          toast(`Modèle injoignable — repli hors-ligne. ${data.degraded}`, { duree: 9000 });
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
    FRAIS = new Set();
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
        <button class="btn primary" data-goview="tonight">${ico('crayon')}Noter aujourd'hui</button>
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
 * LE CUMUL SE COMPTE CONTRE LA REFERENCE GLISSANTE, ET RIEN D'AUTRE.
 *
 * Il y avait le choix : etalon fixe, ou mediane glissante des 365 jours
 * precedents. L'etalon fixe compare quatre ans de journees a une meme
 * constante -- c'est la formule du tableur d'origine, avec le defaut de son
 * epoque : quelqu'un dont la vie a change en 2024 lit encore ses journees de
 * 2026 a l'aune de 2022. Personne ne choisissait jamais ce mode-la, et le
 * proposer demandait deux boutons et un champ de nombre au-dessus de la courbe.
 *
 * Le choix est retire. La glissante repond a la question qu'on se pose --
 * « ou j'en suis par rapport a la periode qui m'entoure » -- et une commande
 * qu'on n'utilise pas n'est pas une liberte, c'est trois objets de plus a
 * comprendre avant d'atteindre le dessin.
 */
const CUM_KEY = 'cumDeltaRef';

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

/**
 * LA FENÊTRE, EN INDICE ET EN DATES.
 *
 * L'indice sert à couper les séries ; les DATES servent à cadrer les dessins.
 * Les deux ne disent pas la même chose et c'est tout le sujet : sur « 30 j »
 * avec douze journées écrites, l'indice donne douze points et les bornes
 * donnent trente jours. Cadrer sur les points faisait mentir le libellé — on
 * lisait « les 30 derniers jours » au-dessus d'un dessin qui en couvrait douze,
 * étalés sur toute la largeur — et surtout, la frise en dessous cadrait, elle,
 * sur de vraies dates : les deux ne pouvaient pas s'aligner.
 *
 * Les bornes gagnent. Trente jours font trente jours, les trous se voient, et
 * les trois dessins reçoivent le même domaine.
 */
function fenetreCumul() {
  const f = FENETRES.find(x => x[0] === CUMWIN) ?? FENETRES.at(-1);
  /*
   * LA FENÊTRE FINIT AUJOURD'HUI, PAS À LA DERNIÈRE NOTE.
   *
   * « Les 30 derniers jours » veut dire les trente derniers jours. Finir à la
   * dernière journée notée décalait la fenêtre en arrière dès qu'on avait deux
   * jours de retard — et un repère posé aujourd'hui tombait hors du cadre, donc
   * disparaissait d'Année sans rien dire. La queue vide, elle, se voit : c'est
   * exactement l'information « tu n'as pas noté depuis deux jours ».
   */
  const dernier = SERIES.date.at(-1);
  const fin = S?.today && S.today > dernier ? S.today : dernier;
  if (f[1] === null) {
    return { i0: 0, jours: null, debut: SERIES.date[0], fin };
  }
  const depuis = dayShift(fin, -(f[1] - 1));
  const i0 = SERIES.date.findIndex(d => d >= depuis);
  return { i0: i0 < 0 ? SERIES.date.length - 1 : i0, jours: f[1], debut: depuis, fin };
}

async function renderYear(year) {
  if (!S.stats.days) return renderNoData('Les courbes ont besoin de journées notées.');
  year = year ?? Number(S.stats.lastDate.slice(0, 4));
  SERIES ??= await api('/api/series');
  CARNET = await api('/api/carnet');
  FRISE = await api('/api/frise');
  const grid = await api(`/api/year?year=${year}`);

  const FEN = fenetreCumul();
  const CUM0 = FEN.i0;
  const base = CUM0 > 0 ? SERIES[CUM_KEY][CUM0 - 1] : 0;
  const cumX = SERIES.date.slice(CUM0);
  const cumY = SERIES[CUM_KEY].slice(CUM0).map(v => Math.round((v - base) * 1000) / 1000);
  const drift = cumY.length ? cumY.at(-1) / cumY.length : 0;
  /*
   * LE DOMAINE PARTAGÉ. Un seul objet, passé aux trois dessins : le quotidien,
   * le cumul, la frise. C'est lui qui fait que le 1er juin est au même endroit
   * dans les trois — pas la chance, pas trois réglages à garder d'accord.
   */
  const DOM = { debut: FEN.debut, fin: FEN.fin };

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
                     { height: 240, events: SERIES.events, domaine: DOM })}
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
          ${/* Ce qui reste du bandeau : ce que la courbe DIT, pas comment on
                la calcule. La dérive était cachée dans l'infobulle d'un champ de
                nombre qu'on retirait ; c'est pourtant le seul chiffre que cette
                courbe produise. */''}
          <span class="faint mono cumderive" style="margin-left:auto"
                title="Écart à la médiane glissante des 365 jours précédents, cumulé sur la fenêtre. Ta moyenne réelle : ${SERIES.mean}. Médiane : ${SERIES.globalMedian}.">
            ${drift > 0 ? '+' : ''}${drift.toFixed(2)} <span class="faint">par jour</span>
          </span>
        </div>
        ${lineChart(cumX, cumY, { height: 250, events: SERIES.events, colore: true, domaine: DOM })}

        ${/* La frise se pose sous la courbe et partage EXACTEMENT son axe : les
              marges de lineChart, à l'unité près. Un repère tombe alors sur
              l'inflexion qu'il explique, ce qu'aucune légende n'aurait obtenu. */''}
        ${/* Le cadre ne s'ouvre que si la frise a quelque chose a dessiner :
              sous une fenetre de sept jours, elle peut etre vide. */''}
        ${(() => {
          const svg = FRISE ? friseSVG(FRISE, icone, {
            // Les marges viennent du cadre des graphes, pas d'un nombre recopié :
            // douze pixels d'écart sur mille font trois jours de décalage sur un an.
            mg: CADRE.PL, md: CADRE.PR,
            domaine: (CUMWIN === 'tout' && FRISE_CADRE === 'vie') ? FRISE.etendue : DOM
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
                        min: '1900-01-01', max: jourCivil() });
    redessiner();
  };

  $('#naissbtn').onclick = () => {
    if (POP === 'naiss') { POP = null; return redessiner(); }
    ouvrirCal('naiss', { debut: S.settings.naissance ?? '1990-01-01', fin: null,
                         plage: false, min: '1900-01-01', max: jourCivil() });
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
        <input type="date" id="cnjour" max="${jourCivil()}">
      </label>
      <span class="sub" style="margin:0;flex:1;min-width:180px">Sans date, elle est rangée à part. Elle ne comptera jamais comme une journée écrite.</span>
      <button class="btn primary" type="submit">${ico('ranger')}Ranger</button>
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
        <button type="button" class="appauto" data-ico="">${ico('loupe', 12)}choisir d'après le libellé</button>
      </div>` : ''}
    </span>

    <input type="text" id="evlabel" required maxlength="60" autocomplete="off"
           value="${esc(e.label)}" placeholder="changement de boulot, déménagement…">

    <span class="anc">
      <button type="button" class="repdatebtn" id="evdate" aria-expanded="${POP === 'date'}"
        >${quandLisible(e)}</button>
      ${POP === 'date' ? calPopMarkup(true) : ''}
    </span>

    <button class="btn primary" type="submit">${e.id ? ico('valider') + 'Enregistrer' : ico('epingle') + 'Poser'}</button>
    ${e.id ? `<button type="button" class="btn" id="evannul">${ico('fermer')}Annuler</button>` : ''}
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
          ${/* La même règle que sur la frise : la teinte choisie d'abord, celle
                du thème ensuite. Une liste grise sous une frise colorée obligeait
                à reconnaître deux fois le même repère. */''}
          <span class="ricone-box"${teinteDe({ ...ev, theme: t }) != null
            ? ` style="color:hsl(${teinteDe({ ...ev, theme: t })} 62% 62%)"` : ''}>${icone(t, 18)}</span>
          <span class="repdate mono faint">${quand}</span>
          <span class="replabel">${esc(ev.label)}</span>
          <button class="repdel" data-delev="${ev.id}" title="Retirer ce repère" aria-label="Retirer ${esc(ev.label)}">${ico('fermer', 11)}</button>
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
        ${n.jour ? `<button class="cndate" data-goto="${n.jour}">${ico('fleche', 12)}ouvrir le ${fmtDay(n.jour)}</button>` : ''}
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
/**
 * « MOI » NE MONTRE PLUS QU'UN MOIS, ET LA JOURNEE QU'ON Y CHOISIT.
 *
 * Il portait quatre choses avant d'arriver au calendrier : un compte de
 * journées, un compte de textes, une référence, une série — puis trois cartes
 * de pistes, puis une phrase d'avertissement. Cinq écrans de haut pour un onglet
 * dont le geste est « ouvrir un jour ». Les pistes n'ont pas disparu du
 * produit : elles vivent dans « Ma carte », sous la carte qui les porte, où
 * elles sont à leur place.
 *
 * Le mois se lit de gauche à droite, une case par jour. Une grille de sept
 * colonnes range les journées par jour de semaine — utile pour voir « tous mes
 * lundis », inutile ici : ce qu'on suit dans un journal, c'est une SUITE, et
 * une suite se lit sur une ligne.
 */
function moisRuban(m, date) {
  const cases = m.calendrier ?? [];
  if (!cases.length) return '';
  const mois = (MIR_CAL.curseur ?? date.slice(0, 7));
  const [an, mo] = mois.split('-').map(Number);
  const precedent = mo === 1 ? `${an - 1}-12` : `${an}-${String(mo - 1).padStart(2, '0')}`;
  const suivant = mo === 12 ? `${an + 1}-01` : `${an}-${String(mo + 1).padStart(2, '0')}`;
  const apresAujourdhui = suivant > jourCivil().slice(0, 7);

  return `<div class="moisbar">
    <button class="moisfl" data-mois="${precedent}" aria-label="Mois précédent">‹</button>
    <span class="moisnom">${MOIS_LONG[mo - 1]} <span class="faint mono">${an}</span></span>
    <button class="moisfl" data-mois="${suivant}" ${apresAujourdhui ? 'disabled' : ''} aria-label="Mois suivant">›</button>
  </div>
  <div class="moisruban" style="--n:${cases.length}">
    ${cases.map(c => {
      const note = c.note !== null && c.note !== undefined;
      const futur = c.date > jourCivil();
      return `<button class="mjour${c.date === date ? ' ouvert' : ''}${futur ? ' futur' : ''}"
        data-cal="jour" data-d="${c.date}" ${futur ? 'disabled' : ''}
        ${note ? `style="background:${deltaColor(c.delta ?? 0)}"` : ''}
        title="${esc(fmtDay(c.date))}${note ? ` · ${c.note}/10` : ''}${c.texte ? ' · écrit' : ''}">
        <span class="mjn">${Number(c.date.slice(8))}</span>
        ${c.texte ? '<span class="mjpt"></span>' : ''}
      </button>`;
    }).join('')}
  </div>`;
}

const MOIS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
                   'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

async function renderMoi(date, { garderCal = false, rafraichir = false } = {}) {
  JOUR_DANS = 'moi';
  if (!MOI || rafraichir) {
    try { MOI = await api('/api/moi'); }
    catch { MOI = null; }
  }
  const vue = renderMirror(date ?? MIRROR_DATE ?? S.today, { garderCal });
  /*
   * LE QUANTIFIED SELF SE CHARGE TOUT SEUL, ET APRÈS LA JOURNÉE.
   *
   * Il vivait derrière un bouton, donc il ne partait que si on le demandait. Il
   * est maintenant toujours à l'écran — et il se charge SANS attendre, pour que
   * la journée s'affiche tout de suite : elle est en haut, on la lit d'abord,
   * et le panneau se remplit dessous quand il arrive.
   */
  chargerQS();
  return vue;
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

/**
 * LA TEINTE SUIT LE NOM, PAS LE RANG.
 *
 * Elle etait prise a l'index. Une piste qui passait de la deuxieme a la
 * premiere place changeait donc de couleur, et avec elle son ilot sur la carte
 * et tous ses mecanismes en dessous -- alors que rien de ce qu'elle disait
 * n'avait bouge. Sur la carte, la couleur est ce qu'on reconnait AVANT d'avoir
 * lu le titre : la faire tourner revient a rendre la carte etrangere.
 *
 * Une piste porte maintenant SA teinte, posee par le serveur et reconduite
 * d'une lecture a l'autre. L'index ne sert plus que de repli pour les lectures
 * enregistrees avant ce changement.
 */
const teintePiste = (p, i) => TEINTES_DECLAREES.includes(p?.teinte)
  ? p.teinte : TEINTES_DECLAREES[i % TEINTES_DECLAREES.length];

/**
 * La teinte d'un thème : celle de la piste qui le regroupe.
 *
 * Trois vues, un seul code couleur — l'îlot sur la carte, son titre dans
 * « Moi », ses mécanismes dans « Année » — sinon la même chose se présente en
 * trois couleurs et il faut la rechercher à chaque écran. Un thème hors de
 * toute piste tire la sienne de son propre nom : rien à quoi la rattacher,
 * mais au moins elle ne bouge plus quand un autre thème apparaît avant lui.
 */
function teinteTheme(t, i, pistes = []) {
  const nom = String(t?.nom ?? '').toLowerCase();
  const j = pistes.findIndex(p => (p.themes ?? []).some(x => String(x).toLowerCase() === nom));
  if (j >= 0) return teintePiste(pistes[j], j);
  let h = 2166136261;
  for (let k = 0; k < nom.length; k++) { h ^= nom.charCodeAt(k); h = Math.imul(h, 16777619); }
  return TEINTES_DECLAREES[(h >>> 0) % TEINTES_DECLAREES.length];
}

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
function themeMeca(t, i, pistes = []) {
  return {
    cle: t.nom, nom: t.nom, teinte: teinteTheme(t, i, pistes),
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
  const t = (lecture?.themes ?? []).map((x, i) => themeMeca(x, i, lecture?.pistes ?? []));
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
/**
 * UNE PASTILLE DE NOEUD : ce que la carte porte, en liste.
 *
 * Elle dit ce que le noeud dit sur la toile -- son genre par la couleur du
 * point, son nom, et le nombre de journees qu'il porte. Cliquer l'ouvre dans le
 * meme panneau que cliquer le noeud lui-meme : deux chemins, une seule reponse.
 */
function noeudChip(n) {
  const j = (n.jours ?? []).length;
  const ouvert = NOEUD_OUVERT && String(NOEUD_OUVERT).toLowerCase() === String(n.nom).toLowerCase();
  return `<button class="ncarte${ouvert ? ' ouvert' : ''}" data-noeud-ouvrir="${esc(n.nom)}"
      style="--g:${TEINTE_GENRE[n.genre] ?? TEINTE_GENRE.activite}"
      title="${esc(n.quoi || NOM_GENRE[n.genre] || '')}">
    <span class="ncpuce"></span>
    <span class="ncnomc">${esc(n.nom)}</span>
    ${j ? `<span class="ncn mono">${j}</span>` : ''}
  </button>`;
}

/**
 * LES CHOSES D'UN GROUPE, DERRIERE UN CLIC.
 *
 * Sous la carte s'affichaient les MECANISMES et les NOEUDS, tous ouverts. Trois
 * pistes de douze noeuds chacune, ce sont trente-six pastilles a lire avant
 * d'arriver au deuxieme titre — et les noeuds, on les a deja sous les yeux :
 * ils sont sur la carte, juste au-dessus, dessines.
 *
 * Ce qui n'est nulle part ailleurs, c'est le MECANISME : « minimiser ce qui
 * vient de se passer » ne se dessine pas. Il reste donc ouvert, et les choses
 * se replient derriere leur compte.
 *
 * Sauf quand le groupe n'a AUCUN mecanisme : replier le seul contenu d'un
 * groupe donnerait un titre suivi de rien, et on croirait le groupe vide.
 */
function chosesMarkup(noeuds, ouvert = false) {
  if (!noeuds.length) return '';
  const n = noeuds.length;
  return `<details class="ncdetails"${ouvert ? ' open' : ''}>
    <summary>${n} chose${n > 1 ? 's' : ''} sur la carte</summary>
    <div class="ncartes">${noeuds.map(noeudChip).join('')}</div>
  </details>`;
}

/**
 * SOUS LA CARTE, CE QUE LA CARTE CONTIENT.
 *
 * On y listait les MECANISMES pendant que la toile montrait des NOEUDS. Les
 * deux venaient de la meme lecture, portaient les memes titres d'ilots, et ne
 * contenaient pas les memes choses : la zone « dependance » de la toile tenait
 * la weed et les anxios, la colonne « dependance » d'en dessous tenait « l'acte
 * t'est retire ». Rien ne se repondait, et il fallait deviner que c'etait
 * pourtant le meme groupe.
 *
 * La liste est donc devenue celle des NOEUDS, groupes par le meme calcul que
 * les enveloppes -- `ilotDesNoeuds`, une seule fois, partagee. Les deux ne
 * peuvent plus diverger : c'est la meme appartenance, affichee deux fois.
 *
 * Les mecanismes ne disparaissent pas pour autant : ils vivent sous les noeuds
 * de leur piste, en retrait. Un noeud est une CHOSE de sa vie, un mecanisme est
 * ce qu'elle fait -- et l'un explique l'autre.
 */
function mecaGroupes(lecture) {
  const tous = mecanismes(lecture);
  const pistes = lecture?.pistes ?? [];
  const noeuds = lecture?.carte?.noeuds ?? [];
  if (!pistes.length && !noeuds.length) return tous.map(mecaMarkup).join('');

  const ilotDe = ilotDesNoeuds(lecture?.carte, pistes);
  const restant = new Set(tous.map(m => m.cle));
  const places = new Set();
  const bloc = [];

  /*
   * UN MECANISME QUI PORTE LE NOM D'UN NOEUD APPARTIENT A SON ILOT.
   *
   * « les nuits blanches » est un noeud d'« autodestruction » ET un motif suivi
   * dans la conversation. Range par ses seuls themes, le motif tombait dans
   * « pas encore regroupe » -- le meme nom ecrit deux fois sur la meme page,
   * dans deux groupes differents, sans que rien n'explique pourquoi. Les
   * themes gardent la priorite (premier tour), le nom de noeud rattrape le
   * reste (second tour).
   */
  const parTheme = new Map();
  pistes.forEach((p, i) => {
    for (const t of p.themes ?? []) if (!parTheme.has(String(t).toLowerCase())) parTheme.set(String(t).toLowerCase(), i);
  });
  const ilotDuMeca = m => {
    const k = String(m.nom).toLowerCase();
    return parTheme.get(k) ?? ilotDe.get(k) ?? null;
  };

  pistes.forEach((p, i) => {
    const dedans = noeuds.filter(n => ilotDe.get(String(n.nom).toLowerCase()) === i);
    const meca = tous.filter(m => restant.has(m.cle) && ilotDuMeca(m) === i);
    if (!dedans.length && !meca.length) return;
    for (const m of meca) restant.delete(m.cle);
    for (const n of dedans) places.add(n.nom);
    const teinte = teintePiste(p, i);
    /*
     * `data-ilot` : le NUMERO de la piste, celui que la carte emploie pour ses
     * enveloppes. C'est le fil qui relie les deux moities de la page — survoler
     * ce groupe allume son ilot sur la toile, et survoler un noeud de la toile
     * allume ce groupe. Sans lui, la couleur commune est une coincidence qu'il
     * faut croire sur parole.
     */
    bloc.push(`<div class="mecagroupe" style="--p:${teinte}" data-ilot="${i}">
      <button class="mecatitre" data-ilot-voir="${i}"
              title="Le montrer sur la carte"><span></span>${esc(p.nom)}</button>
      ${meca.length ? `<div class="mecasous">${meca.map(mecaMarkup).join('')}</div>` : ''}
      ${chosesMarkup(dedans, !meca.length)}
    </div>`);
  });

  /*
   * CE QUI N'A PAS ENCORE DE NOM. Ni un reste ni un echec : des choses qui
   * reviennent sans entrer dans une case, et tout n'a pas a y entrer. Elles ont
   * leur enveloppe pale sur la toile, sans titre, et leur colonne ici.
   */
  const libres = noeuds.filter(n => !places.has(n.nom));
  const seuls = tous.filter(m => restant.has(m.cle));
  if (libres.length || seuls.length) {
    bloc.push(`<div class="mecagroupe seuls">
      <div class="mecatitre"><span></span>pas encore regroupé</div>
      ${seuls.length ? `<div class="mecasous">${seuls.map(mecaMarkup).join('')}</div>` : ''}
      ${chosesMarkup(libres, !seuls.length)}
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

/** Le nœud dont on regarde le poids, ou null. Vidé en quittant « Ma carte ». */
let NOEUD_OUVERT = null;

/*
 * L'ÎLOT VISÉ : ce qui rattache la carte à la liste d'en dessous.
 *
 * Elles avaient l'air de deux mondes. En haut des CHOSES — « Londres », « la
 * weed » — en bas des MÉCANISMES, et rien qui montre que « dépendance » écrit
 * sur la toile et « dépendance » écrit sous la carte désignent le même groupe.
 * Même couleur, même nom, et pourtant deux listes.
 *
 * Survoler l'un allume l'autre, dans les deux sens. C'est le seul geste qui
 * prouve qu'ils parlent de la même chose : on le voit, on n'a pas à le croire.
 */
let ILOT_VISE = null;

function viserIlot(i) {
  if (ILOT_VISE === i) return;
  ILOT_VISE = i;
  RELA_PEINDRE?.();
  refleterIlotVise();
}

/**
 * REPOSER L'ÎLOT VISÉ SUR UNE LISTE QUI VIENT D'ÊTRE REFAITE.
 *
 * Les classes vivent sur le DOM, et « Ma carte » se redessine entièrement dès
 * qu'on ouvre un nœud. Après ce redessin, `ILOT_VISE` disait encore « la
 * dépendance » pendant que plus aucun groupe n'était éteint — et le garde
 * `if (ILOT_VISE === i) return;` refusait alors de le remettre, puisque de son
 * point de vue c'était déjà fait. Cliquer le titre ne faisait plus rien, une
 * fois sur deux, sans rien pour l'expliquer.
 */
function refleterIlotVise() {
  // La liste répond au même signal que la carte : le groupe visé garde son
  // encre, les autres s'effacent — exactement ce que fait la toile au-dessus.
  const v = $('#view');
  if (!v) return;
  v.classList.toggle('ilotvise', ILOT_VISE != null);
  for (const g of v.querySelectorAll('.mecagroupe')) {
    g.classList.toggle('eteint', ILOT_VISE != null && Number(g.dataset.ilot) !== ILOT_VISE);
  }
}

/*
 * CE QU'UN NOEUD PESE, quand on clique dessus.
 *
 * La carte porte des CHOSES -- « Londres », « la weed », « le dimanche soir » --
 * et juste dessous s'affichent des MECANISMES. Deux vocabulaires, deux listes,
 * et rien qui disait comment l'un touche l'autre : on regardait « Londres »
 * sans pouvoir savoir si ca comptait dans ce qui avait ete compris de soi, ou
 * si c'etait juste un endroit ou l'on etait alle.
 *
 * On aurait pu renommer les noeuds d'apres les mecanismes. On y aurait tout
 * perdu : une carte de mecanismes n'est plus une carte, c'est la meme liste
 * dessinee deux fois -- et ce qui fait la valeur de « Londres » sur une carte,
 * c'est justement que ce soit un lieu.
 *
 * Le lien passe donc par les JOURNEES, qui sont deja la des deux cotes. « Sur
 * les 51 journees ou Londres apparait, 34 portent aussi cette piste » est un
 * fait, pas une interpretation -- et le rapport a cote dit si c'est plus que ce
 * que le hasard expliquerait, sans quoi une piste presente partout paraitrait
 * peser sur tout.
 */
const RAPPORT_MOT = r => r >= 1.6 ? 'bien plus souvent qu’ailleurs'
                       : r >= 1.15 ? 'plus souvent qu’ailleurs'
                       : r <= 0.7 ? 'moins souvent qu’ailleurs' : 'autant qu’ailleurs';

function noeudMarkup() {
  if (!NOEUD_OUVERT) return '';
  const p = poidsDuNoeud(LECTURE?.lecture, NOEUD_OUVERT);
  if (!p) return '';
  const t = p.ilot?.teinte;
  return `<aside class="noeudcarte"${t != null ? ` style="--p:${t}"` : ''}>
    <div class="ncdessus">
      <span class="ncgenre" style="--g:${TEINTE_GENRE[p.genre] ?? TEINTE_GENRE.activite}">${
        esc(NOM_GENRE[p.genre] ?? p.genre)}</span>
      <button class="ncfermer" data-noeud-fermer aria-label="Fermer">${ico('fermer', 12)}</button>
    </div>
    <h3 class="ncnom">${esc(p.nom)}</h3>
    <p class="ncjours">${p.jours.length} journée${p.jours.length > 1 ? 's' : ''}${
      p.ilot ? ` · dans <b>${esc(p.ilot.nom)}</b>` : ' · hors des pistes'}</p>

    ${/*
       * UN NŒUD SE PRÉSENTE COMME UN MÉCANISME.
       *
       * Il n'avait qu'un nom, un compte et des chiffres. Un mécanisme, juste en
       * dessous, dit ce qu'il est en une phrase puis montre ses journées avec
       * ce qui y était écrit — et c'est exactement ce qu'on veut savoir d'un
       * nœud aussi : pourquoi cette chose est là, et à quoi ça ressemblait.
       *
       * La phrase vient du modèle, les extraits du journal. Les deux manquent
       * aux lectures faites avant ce changement, et le panneau s'en passe sans
       * rien casser — il faut une relecture pour les voir apparaître.
       */''}
    ${p.quoi ? `<p class="ncquoi">${esc(p.quoi)}</p>` : ''}

    ${p.extraits.length ? `<div class="ncbloc">
      <span class="nck">Là où ça revient</span>
      <div class="ncjours-liste">${p.extraits.map(x => `<button class="ncjour" data-jour="${x.date}">
        <span class="mono">${fmtDay(x.date)}</span>
        <span>${esc(x.extrait)}</span>
      </button>`).join('')}</div>
      ${p.jours.length > p.extraits.length
        ? `<span class="ncreste">et ${p.jours.length - p.extraits.length} autre${
            p.jours.length - p.extraits.length > 1 ? 's' : ''} journée${
            p.jours.length - p.extraits.length > 1 ? 's' : ''} — les points autour du nœud</span>` : ''}
    </div>` : ''}

    ${p.pesees.length ? `<div class="ncbloc">
      <span class="nck">Ce que ça pèse</span>
      ${p.pesees.map(x => `<button class="ncpese" data-piste-voir="${esc(x.nom)}"
          style="--p:${x.teinte ?? 258}" title="Voir ce que cette piste regroupe">
        <span class="ncligne">
          <span class="ncnomp">${esc(x.nom)}${x.sien ? '<i>son îlot</i>' : ''}</span>
          <span class="ncpart mono">${Math.round(x.part * 100)}<small>%</small></span>
        </span>
        ${/* La barre dit la part, le texte dit ce qu'elle vaut. Une part seule
              ferait passer une piste présente partout pour une piste qui pèse. */''}
        <span class="ncbarre"><i style="width:${Math.round(x.part * 100)}%"></i></span>
        <span class="ncsous">${x.partage} de ses ${x.sur} journées — ${RAPPORT_MOT(x.rapport)}</span>
      </button>`).join('')}
    </div>` : `<p class="ncrien">Aucune piste ne partage ses journées. Ça arrive, et ça
      veut dire quelque chose : cette chose-là revient sans entrer dans ce qui a été compris.</p>`}

    ${p.liens.length ? `<div class="ncbloc">
      <span class="nck">Ce qui le relie</span>
      ${p.liens.map(l => `<button class="nclien" data-noeud-aller="${esc(l.autre)}">
        ${l.sortant ? '' : `<b>${esc(l.autre)}</b> `}<span>${esc(l.quoi)}</span>${
          l.sortant ? ` <b>${esc(l.autre)}</b>` : ''}
      </button>`).join('')}
    </div>` : ''}
  </aside>`;
}

function carteMarkup(carte) {
  /*
   * UNE CARTE VIDE LE DIT. Elle disparaissait en silence : la page s'ouvrait
   * sur les mécanismes seuls, et rien ne distinguait « cette lecture n'a pas
   * fait de carte » de « il n'y a pas de carte ici ». C'est le défaut le plus
   * désagréable qu'une vue puisse avoir — elle a l'air normale, et il manque
   * la moitié.
   *
   * Ça arrive pour de vraies raisons : une lecture enregistrée avant que la
   * carte existe, ou un modèle qui a rendu des nœuds sans nom. Dans les deux
   * cas, la réparation est la même et elle tient en un bouton.
   */
  if (!carte?.noeuds?.length) {
    return `<div class="cartevide">
      <p>Cette lecture n'a pas de toile — soit elle est plus vieille que la carte,
         soit la relecture n'a rendu aucun nœud.</p>
      <p class="sub">Les mécanismes ci-dessous viennent bien d'elle. Retisser en refait une.</p>
    </div>`;
  }
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
    cadrer(RELA_DISPO.pts, L, H, 62, RELA.ilots?.length ? 96 : 38);
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
          pudique: !!S.settings?.pudique, ilotVise: ILOT_VISE });
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
    // Survoler une chose allume le groupe auquel elle appartient, en bas de
    // page : c'est la même lecture, vue de deux façons.
    viserIlot(i >= 0 ? (RELA?.noeuds?.[i]?.ilot ?? null) : null);
    // Le doigt sur une journee ET sur un noeud : les deux s'ouvrent maintenant.
    // Un noeud qui s'allume au survol sans rien promettre etait l'inverse du
    // probleme -- il avait l'air cliquable et ne l'etait pas.
    cv.style.cursor = (j || i >= 0) ? 'pointer' : 'grab';
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
    // Un vrai clic. Une journée d'abord : c'est la cible la plus fine, et celle
    // qu'on vise expressément quand on tombe dessus.
    const ech = echelle(L, H);
    const j = journeeAu(RELA_DISPO?.pts ?? [], RELA, p.x, p.y, ech, RELA_VUE);
    if (j) return ouvrirJour(j.date);
    // Sinon le nœud : il ouvre ce qu'il pèse dans les pistes d'en dessous.
    const i = noeudAu(RELA_DISPO?.pts ?? [], RELA, p.x, p.y, ech, RELA_VUE);
    const nom = i >= 0 ? RELA?.noeuds?.[i]?.nom : null;
    NOEUD_OUVERT = nom && nom !== NOEUD_OUVERT ? nom : null;
    renderLecture();
  };
  cv.addEventListener('pointerup', relacher);
  cv.addEventListener('pointercancel', () => { tire = null; cv.style.cursor = 'grab'; });
  cv.addEventListener('mouseleave', () => {
    if (tire) return;
    RELA_SURVOL = -1; RELA_JOUR = null; viserIlot(null); peindre();
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
     * LA CARTE AU CENTRE, LE TEXTE SUR LE COTE.
     *
     * Ils etaient a parite : la carte dans une colonne, et dans l'autre la
     * synthese POSEE SUR les ilots. Un paragraphe de dix lignes prenait donc le
     * haut de la moitie droite, et ce qu'on venait voir -- les groupes detectes
     * et ce qu'ils contiennent -- commencait sous la ligne de flottaison.
     *
     * Or ce qui se regarde et ce qui se lit ne demandent pas la meme place. Une
     * carte a besoin de surface : c'est une forme, elle se reconnait d'un coup
     * d'oeil ou pas du tout. Un paragraphe a besoin d'une colonne etroite et de
     * rien d'autre -- au-dela de soixante caracteres par ligne, l'oeil perd sa
     * ligne en revenant a gauche.
     *
     * La carte prend donc toute la largeur utile, les ilots se rangent juste en
     * dessous, et la synthese passe en rail a droite, ou elle suit le defilement
     * sans jamais disputer la place a ce qu'elle commente.
     *
     * Sous 1180 px le rail passe dessous : une colonne de texte de 200 px ne
     * sert personne.
     */
    corps = `
      <div class="lectgrille">
        <div class="lectcarte">${carteMarkup(L.lecture.carte)}</div>
        <div class="lectmeca">${mecaGroupes(L.lecture)}</div>
        <aside class="lectdit">
          ${/* Le nœud ouvert prend la place de la synthèse : c'est une réponse à
                un geste qu'on vient de faire, elle passe devant un texte qui,
                lui, ne bouge pas. La synthèse revient dès qu'on referme. */''}
          ${NOEUD_OUVERT ? noeudMarkup() : `<p class="synthese">${esc(L.lecture.synthese)}</p>`}
        </aside>
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
      <button class="btn" data-aller-reglages>${ico('reglages')}Réglages</button></div>`;
  } else if (LECTURE_ERR) {
    corps = `<div class="lectvide">
      <p>La lecture n'a pas abouti.</p>
      <p class="sub lecterr">${esc(LECTURE_ERR)}</p>
      <button class="btn primary" data-lire>${ico('refaire')}Réessayer</button></div>`;
  } else {
    corps = `<div class="lectvide">
      <p>Ton journal n'a pas encore été lu.</p>
      <button class="btn primary" data-lire>${ico('oeil')}Lancer la lecture</button></div>`;
  }

  $('#view').innerHTML = `<div class="lecture">
    <div class="lechead">
      ${L.lecture ? `<span class="lecmeta faint">${L.jours} journées · ${fmtDay(L.fait_le.slice(0, 10))}${
        L.perime ? ` · <b>${L.retard} journée${L.retard > 1 ? 's' : ''} depuis</b>` : ''}</span>` : ''}
      ${/* UN LOT EN COURS SE DIT. Il rend en une heure au lieu de deux minutes :
             sans cette ligne, l'écran affiche « relire » pendant qu'une lecture
             est déjà partie, et cliquer en lancerait une deuxième — payante, sur
             le même corpus, pour le même résultat. */''}
      ${L.lecture ? (LECTURE_EN_COURS || L.enLot
        ? `<span class="lecmeta faint" title="${L.enLot
             ? 'Partie en tâche de fond, à moitié prix. Elle arrive dans l’heure.' : ''}">
             <span class="spin petit"></span> il relit${L.enLot ? ' — en fond' : ''}</span>`
        : `<button class="btn ghost" data-lire title="Refait la lecture sur tout le corpus, tout de suite.">${ico('refaire')}relire</button>`) : ''}
      ${/* RETISSER : la même lecture, mais REGARDÉE. Deux fois par jour, parce
             que rien ne change en une heure, et qu'une toile qu'on rejoue
             jusqu'à ce qu'elle plaise n'est plus une lecture. */''}
      ${L.lecture && !LECTURE_EN_COURS && !L.enLot ? (L.retissage > 0
        ? `<span class="lecmeta faint" title="Deux fois par jour, pas plus.">retisser — dans ${enClair(L.retissage)}</span>`
        : `<button class="btn" id="retisser" title="Tout est relu, et tu regardes la toile se refaire.">${ico('carte', 13)}retisser</button>`) : ''}
    </div>
    ${/* Une relecture qui échoue par-dessus une lecture existante ne peut pas
          prendre l'écran — l'ancienne vaut mieux que rien — mais elle ne peut
          pas non plus se taire : sinon ce qu'on regarde est vieux sans qu'on le
          sache, et « relire » a l'air de ne rien faire. */''}
    ${L.lecture && LECTURE_ERR ? `<p class="sub lecterr lecterrhaut">La relecture n'a pas abouti — ceci est la lecture précédente. ${esc(LECTURE_ERR)}</p>` : ''}
    ${/* Un lot qui a échoué doit le dire, sinon la seule façon de s'en
          apercevoir est de remarquer que la date ne bouge plus. */''}
    ${!LECTURE_ERR && L.lotErreur ? `<p class="sub lecterr lecterrhaut">La lecture de fond n'a pas abouti — ${esc(L.lotErreur)} Tu peux relancer avec « relire ».</p>` : ''}
    ${corps}
  </div>${tissageMarkup()}`;

  wireLecture();
  wireIlots();
  refleterIlotVise();   // la liste vient d'être refaite : elle a perdu l'îlot visé
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
  if (!LECTURE_EN_COURS && !LECTURE_ERR && L.possible && L.cle && L.arelire) lancerLecture({ fond: true });
}

/**
 * @param {{fond?: boolean}} opts  `fond` : c'est la relance automatique, pas un
 *   clic. Elle part en LOT, à moitié prix : personne ne la regarde apparaître,
 *   l'écran garde la lecture précédente, et une heure d'attente ne coûte rien à
 *   qui n'attend pas. Un clic sur « relire », lui, veut une réponse.
 */
async function lancerLecture({ fond = false } = {}) {
  if (LECTURE_EN_COURS) return;
  LECTURE_EN_COURS = true;
  LECTURE_ERR = null;
  const avait = !!LECTURE?.lecture;
  if (!avait) await renderLecture();       // l'attente ne s'affiche que s'il n'y a rien à montrer
  try {
    const r = await api('/api/lecture', { fond });
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

/**
 * LES DEUX MOITIES DE LA PAGE SE REPONDENT.
 *
 * On survole un groupe de mecanismes : son ilot s'allume sur la carte, les
 * autres s'eteignent. On survole un noeud de la carte : son groupe s'allume en
 * bas. C'est le meme signal dans les deux sens, et c'est ce qui fait qu'on
 * arrete de voir deux listes pour voir une seule lecture.
 *
 * Sur `#view` et non sur chaque groupe : la vue est reconstruite a chaque
 * rendu, et poser un ecouteur par groupe a chaque fois les empile.
 */
function wireIlots() {
  const v = $('#view');
  if (!v) return;
  const lire = e => {
    const g = e.target.closest?.('.mecagroupe[data-ilot]');
    viserIlot(g ? Number(g.dataset.ilot) : null);
  };
  v.addEventListener('pointerover', lire);
  // Le clavier suit la souris : c'est la meme information, et une carte qu'on
  // ne peut allumer qu'au survol n'existe pas pour qui navigue au clavier.
  v.addEventListener('focusin', lire);
  v.addEventListener('pointerleave', () => viserIlot(null));
}

function wireLecture() {
  $('#view').onclick = async e => {
    // Le panneau d'un nœud : le refermer, aller à un nœud voisin, ou descendre
    // sur la piste dont il vient de dire le poids.
    if (e.target.closest('[data-noeud-fermer]')) { NOEUD_OUVERT = null; return renderLecture(); }
    const na = e.target.closest('[data-noeud-aller]') || e.target.closest('[data-noeud-ouvrir]');
    if (na) {
      const nom = na.dataset.noeudAller ?? na.dataset.noeudOuvrir;
      // Recliquer celui qui est ouvert le referme : c'est le geste attendu
      // d'une liste, et sans lui on ne peut plus revenir a la synthese.
      NOEUD_OUVERT = NOEUD_OUVERT === nom ? null : nom;
      return renderLecture();
    }
    const iv = e.target.closest('[data-ilot-voir]');
    if (iv) {
      // Le titre d'un groupe renvoie a la carte : c'est le meme ilot, et le
      // geste evident quand on lit un nom en bas est de vouloir le voir en haut.
      viserIlot(Number(iv.dataset.ilotVoir));
      $('#view').querySelector('.cartewrap')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    const pv = e.target.closest('[data-piste-voir]');
    if (pv) {
      // On ne referme PAS le panneau : on veut pouvoir lire les mécanismes en
      // gardant sous les yeux le chiffre qui vient de nous y envoyer.
      const nom = pv.dataset.pisteVoir.toLowerCase();
      const g = [...$('#view').querySelectorAll('.mecagroupe')]
        .find(x => x.querySelector('.mecatitre')?.textContent.trim().toLowerCase() === nom);
      g?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      g?.classList.add('vise');
      setTimeout(() => g?.classList.remove('vise'), 1600);
      return;
    }

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
    if (e.target.closest('#retisser')) return retisser();
    if (e.target.closest('#tsfin')) return fermerTissage();
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
      <button data-goto="${next}" ${next > jourCivil() ? 'disabled' : ''} aria-label="Jour suivant">›</button>
      ${date !== S.today ? `<button class="wide" data-goto="${S.today}">${ico('point', 12)}aujourd'hui</button>` : ''}
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
      ${/* MEME RAISON POUR LES MESURES, et le même piège : le serveur les envoie
            dans cette branche, et il suffirait de ne pas écrire cette ligne pour
            qu'elles soient reçues et jetées, comme les repères l'ont été.

            Ce qui les accompagne d'habitude — « les journées au-dessus de 6,2 h
            sont notées 2,2 points plus haut » — n'arrive pas jusqu'ici : le
            serveur le retire sous le plancher. Une durée de sommeil est un fait
            qu'une montre a relevé ; la phrase qui l'explique est ce que le
            plancher existe pour retenir. */''}
      ${m.mesures?.length ? `<div class="card">${mesuresMarkup(m.mesures)}</div>` : ''}
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
          <button class="btn" id="backToChat">${ico('crayon')}Écrire</button>
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
      <button data-goto="${next}" ${next > jourCivil() ? 'disabled' : ''} aria-label="Jour suivant">›</button>
      ${date !== S.today ? `<button data-goto="${S.today}">aujourd'hui</button>` : ''}
    </div>`;
  $('#view').innerHTML = `
    ${moi ? '' : barre}
    <div class="jourseul${moi ? ' dansmoi' : ''}">
      ${/* Dans « Moi », le mois est un RUBAN : une case par jour, de gauche à
            droite. Ailleurs (une journée ouverte depuis « Ma carte ») c'est la
            grille de sept colonnes, parce qu'on y arrive d'une preuve et qu'on
            veut voir où ce jour tombe dans sa semaine. */''}
      ${moi ? moisRuban(m, date) : calendarMarkup(m, date)}
      ${moi ? barre : ''}
      ${/* Le bouton vit dans « Moi » parce que c'est la page de ce qu'on SAIT
            de soi. Réglages garde le branchement et le journal des envois :
            deux questions différentes, deux endroits. */''}
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
          <button class="daydrop" data-erase="${date}" title="Effacer cette journée">${ico('corbeille', 12)}effacer</button>
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
          ${m.note !== null ? `<button class="jourdenote" data-jn="">${ico('moins', 12)}retirer</button>` : ''}
        </div>` : ''}
        ${/* LA BARRE « DANS LA JOURNÉE » A ÉTÉ RETIRÉE.
              Elle disait « 1 → 8, ça a beaucoup bougé » ; le graphe de la
              fenêtre de volatilité, deux colonnes plus loin, dit la même chose
              en montrant QUAND ça a bougé et il porte déjà le même « 1 → 8 »
              sous lui. Deux affichages du même fait, dont le plus voyant était
              le moins situé. La fonction qui la dessinait est partie avec :
              c'était son seul appel, et une fonction gardée « au cas où » est
              du code mort qu'on relit à chaque passage. */''}
        ${journeeMarkup(m)}
      </div>

      ${/* SOUS LA JOURNÉE, PAS AU-DESSUS.
             Il s'ouvrait entre le ruban du mois et la note, c'est-à-dire entre
             la question et sa réponse : on cherchait « comment j'allais » et on
             tombait d'abord sur des chiffres de machine. Ce qu'on mesure de soi
             éclaire la journée, il ne la précède pas. */''}
      ${moi ? `<div id="qspanneau">${qsPanneauMarkup(QS_DATA)}</div>` : ''}

      ${notesDuJourMarkup(m.carnet)}
    </div>`;
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
/* ==================== LA JOURNÉE, HEURE PAR HEURE ====================

   On ouvrait une journée et on y trouvait sa note, son texte, et rien de ce qui
   s'était PASSÉ dedans. Or une journée notée 8 peut contenir « juste envie de
   mourir » écrit le soir : c'est la bascule qui la raconte, pas le niveau moyen.

   Trois colonnes, et chacune répond à une question différente :
     — CE QUI S'EST DIT : l'heure, et la phrase de ce moment-là. Sa phrase,
       choisie, jamais réécrite — une paraphrase de ce qu'on a écrit un mauvais
       soir n'a aucune raison d'être plus juste que la phrase.
     — CE QUI A BOUGÉ : la volatilité, et de quoi on a parlé.
     — CE QUE TU AS ÉCRIT : la note du soir, telle quelle.
   ==================================================================== */

/** Le point d'un moment : la couleur de sa scène, l'opacité de sa force. */
function pointMoment(m) {
  const t = TEINTE_SCENE[m.scene] ?? TEINTE_SCENE.drift;
  const f = Math.min(1, (m.force ?? 0) / 3);
  return `style="--s:${t};--f:${(0.28 + 0.72 * f).toFixed(2)}"`;
}

/*
 * LA TEINTE D'UNE SCÈNE.
 *
 * Les mêmes huit que la passerelle envoie à une lampe, en HSL parce qu'ici on
 * module la clarté au survol. Elles ne sortent pas de la rampe des notes : un
 * moment déduit de mots ne doit jamais pouvoir se lire comme une note posée.
 */
const TEINTE_SCENE = {
  drift: 224, brume: 205, abyss: 28, eclipse: 268,
  voidwell: 218, monolith: 220, grain: 78, mandel: 312
};

/** Un moment : son heure, son point, sa phrase. Cliquer ouvre le fil à ce moment. */
/**
 * L'ESTIMATION D'UN MOMENT — ET CE QUI LA DISTINGUE D'UNE NOTE.
 *
 * Le produit ne note personne à sa place. Une estimation lue dans des mots
 * n'est donc pas affichée comme une note : elle porte un « ≈ », elle est en
 * trait et non pleine, et le survol dit d'où elle vient. Un relevé posé à la
 * main, lui, est une MESURE — il s'affiche plein, sans tilde, et il l'emporte
 * sur la déduction. « Ce qui est rempli est mesuré, ce qui est contouré est
 * déclaré » : la règle du produit tient jusqu'ici.
 *
 * Rien du tout quand le lexique n'a rien à dire. Afficher la référence « par
 * défaut » sur la moitié des moments ferait passer un chiffre constant pour
 * une lecture, ce qui est pire que le silence.
 */
function estimeMarkup(e) {
  if (!e) return '';
  const mesure = e.dApres === 'releve';
  const v = String(e.valeur).replace('.', ',');
  return `<span class="jest ${mesure ? 'mesure' : 'lu'}"
    style="--c:${noteColor(e.valeur, 6)}"
    title="${mesure ? 'relevé à la main, à ce moment-là' : 'estimation lue dans tes mots — personne ne l’a posée'}"
    >${mesure ? '' : '≈'}${v}</span>`;
}

/**
 * CLIQUER UN MOMENT MONTRE SON PASSAGE, À DROITE.
 *
 * Les deux colonnes racontent la même journée par deux bouts : à gauche ce
 * qu'on a ressenti, heure par heure ; à droite ce qu'on a écrit. Elles se
 * lisaient côte à côte sans jamais se répondre — pour retrouver la phrase
 * derrière « 05:43 · De quoi le suicide est mauvais ? » il fallait relire tout
 * le pavé de droite en cherchant l'endroit.
 *
 * Le lien se fait par les MESSAGES, pas par l'heure affichée : un moment et un
 * passage sont exactement les mêmes messages. Rapprocher par l'heure marcherait
 * presque, et « presque » veut dire qu'un jour ça désignerait le mauvais
 * passage sans que rien ne le dise.
 *
 * C'est une désignation, pas une sélection : re-cliquer éteint, cliquer
 * ailleurs éteint. Rien n'est enregistré, rien ne change de place.
 */
function montrerLePassage(moment) {
  const dejaLa = moment?.classList.contains('vise');
  for (const el of document.querySelectorAll('.jmoment.vise, .jsujet.vise, .dayText.vise'))
    el.classList.remove('vise');
  if (!moment || dejaLa) return;

  const ids = new Set((moment.dataset.ids ?? '').split(',').filter(Boolean));
  if (!ids.size) return;
  moment.classList.add('vise');

  const vus = [];
  for (const s of document.querySelectorAll('.jsujet[data-ids]')) {
    if ((s.dataset.ids ?? '').split(',').some(x => ids.has(x))) { s.classList.add('vise'); vus.push(s); }
  }
  /*
   * Une journée d'un seul tenant n'a pas de passages découpés : il n'y a qu'un
   * pavé, et le désigner en entier ne montre rien. On ne fait alors rien plutôt
   * que d'allumer tout l'écran.
   */
  if (!vus.length) return;
  // On amène le premier sous les yeux, sans brutalité : le texte peut être long
  // et le passage visé se trouver hors de la fenêtre.
  const doux = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  vus[0].scrollIntoView({ block: 'nearest', behavior: doux ? 'smooth' : 'auto' });
}

function momentMarkup(m) {
  return `<li class="jmoment" data-moment="${esc(m.ts)}"
      ${m.ids?.length ? `data-ids="${esc(m.ids.join(','))}" tabindex="0" role="button"
      aria-label="Montrer ce passage dans ce que tu as écrit"` : ''}
      title="${esc(m.sens ?? NOM_SCENE[m.scene] ?? '')}">
    <span class="jheure mono">${esc(m.heure)}</span>
    <span class="jpoint" ${pointMoment(m)}></span>
    <span class="jcoeur">${esc(m.coeur)}</span>
    ${estimeMarkup(m.estime)}
  </li>`;
}

/**
 * CE QUI A BOUGÉ DANS LA JOURNÉE.
 *
 * Deux couches, et il ne faut pas les confondre. Les RELEVÉS sont posés à la
 * main, sur dix, à une heure connue : c'est une mesure, elle se dessine PLEINE.
 * La charge des moments est déduite de mots : c'est une lecture, elle se dessine
 * en trait. « Ce qui est rempli est mesuré, ce qui est contouré est déclaré » —
 * la règle du produit vaut jusqu'ici.
 */
function volatiliteMarkup(v) {
  /*
   * CHAQUE POINT EST UNE HUMEUR QUE L'IA A ÉVALUÉE, sur dix, à un moment. C'est
   * la même valeur que la pastille ≈ du fil à gauche : la courbe colle donc à
   * l'humeur de la journée au lieu de tracer une charge abstraite. Un point
   * PLEIN est une note relevée à la main ; un point CONTOURÉ est lu dans les
   * mots — « ce qui est rempli est mesuré, ce qui est contouré est déclaré ».
   */
  const hum = v?.humeurs ?? [];
  if (hum.length < 2) return '';
  const W = 200, H = 46, PB = 6;
  const xs = n => n <= 1 ? [W / 2] : Array.from({ length: n }, (_, i) => 2 + (i / (n - 1)) * (W - 4));
  const y = val => PB + (1 - val / 10) * (H - PB * 2);
  const px = xs(hum.length);

  const ligne = `<path d="${hum.map((h, i) => `${i ? 'L' : 'M'}${px[i].toFixed(1)} ${y(h.valeur).toFixed(1)}`).join('')}"
       fill="none" stroke="var(--line-soft)" stroke-width="1.2" stroke-linejoin="round"/>`;
  const points = hum.map((h, i) => {
    const c = noteColor(h.valeur, 6);
    const mesure = h.dApres === 'releve';
    const vtxt = String(h.valeur).replace('.', ',');
    return `<circle cx="${px[i].toFixed(1)}" cy="${y(h.valeur).toFixed(1)}" r="3"
       fill="${mesure ? c : 'none'}" stroke="${c}" stroke-width="${mesure ? 0 : 1.5}"
       ><title>${esc(h.heure)} · ${mesure ? '' : '≈'}${vtxt}/10</title></circle>`;
  }).join('');

  // L'amplitude vient des mêmes points que la courbe, pas des seuls relevés :
  // « 3 → 8 » doit se lire directement sur ce qu'on voit tracé.
  const vals = hum.map(h => h.valeur);
  const bas = Math.min(...vals), haut = Math.max(...vals);
  const fmt = n => String(n).replace('.', ',');
  const surMesure = hum.some(h => h.dApres === 'releve');
  return `<div class="jvol">
    <div class="k faint">Ce qui a bougé</div>
    ${/* MINIMALISTE, ET LE CADRE EST PARTI AVEC. Il ne reste que la médiane
          pointillée, la ligne et les points — c'est tout ce qui porte
          l'information. */''}
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="jvsvg" aria-hidden="true">
      <line x1="0" y1="${(H / 2).toFixed(1)}" x2="${W}" y2="${(H / 2).toFixed(1)}"
            stroke="var(--line-soft)" stroke-dasharray="2 4"/>
      ${ligne}${points}
    </svg>
    <div class="jvpied">
      <span class="jvchiffre mono">${fmt(bas)} <span class="faint">→</span> ${fmt(haut)}</span>
      <span class="faint">${surMesure ? 'relevé à la main' : 'lu dans tes mots'}</span>
    </div>
  </div>`;
}

/** De quoi on a parlé, en icônes — les mêmes que sur la frise. */
/* ==================================================================
   CE QU'UNE MACHINE A MESURE CE JOUR-LA.

   Une journée notée 4 avec quatre heures de sommeil derrière n'est pas la même
   journée qu'une journée notée 4 après huit heures. C'est exactement ce dont
   personne ne se souvient en relisant — et c'est ce que le journal seul ne
   pourra jamais dire.
   ================================================================== */

/** `sommeil_h` a été normalisé à l'entrée ; on lui rend ses espaces pour le lire. */
const nomMesure = cle => String(cle ?? '').replace(/_/g, ' ');

const valMesure = m => m.valeur == null
  ? (m.texte ?? '—')
  : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(m.valeur);

/* Une espace insécable fine avant l'unité : « 8,2 h », pas « 8,2h ». Collée,
   l'unité se lit comme une décimale de plus. Insécable, parce qu'un retour à la
   ligne entre le nombre et son unité les sépare définitivement. */
const uniteDe = m => m.unite ? `\u202f${esc(m.unite)}` : '';

/**
 * LA PHRASE D'UN LIEN — ET LE MOT QU'ELLE N'EMPLOIE JAMAIS.
 *
 * Un lien entre le sommeil et l'humeur ne dit pas lequel des deux mène : dormir
 * peu peut abîmer la journée, une journée qui s'annonce mal peut aussi tenir
 * éveillé la nuit d'avant. On dit donc « vont avec », jamais « à cause de ».
 *
 * Et on donne l'écart EN POINTS, pas le coefficient : « r = 0,42 » ne veut rien
 * dire pour personne, alors que « 1,8 point plus bas » se vérifie contre son
 * propre souvenir — ce qu'on veut justement que la personne fasse.
 */
function phraseLien(l) {
  if (!l?.moitie) return '';
  const e = Math.abs(l.moitie.ecart);
  if (e < 0.3) return '';
  const quand = l.decalage === 1 ? 'le lendemain sont notées' : 'sont notées';
  // Le seuil passe par le MÊME formateur que les valeurs juste au-dessus :
  // « au-dessus de 6.2 » à côté de « 8,2 h » donne deux conventions décimales
  // dans trois centimètres, et l'œil bute avant de comprendre pourquoi.
  return `Les journées au-dessus de ${valMesure({ valeur: l.moitie.seuil })}${uniteDe(l)} ${quand}
    <b>${e.toFixed(1).replace('.', ',')} point${e >= 2 ? 's' : ''}
    ${l.moitie.ecart > 0 ? 'plus haut' : 'plus bas'}</b> — sur ${l.n} journées.`;
}

/**
 * CE QUI A ÉTÉ MESURÉ — ET CE QUI SE REPLIE.
 *
 * Sur un traqueur qui compte par titre de fenêtre, cette colonne affichait
 * quarante lignes de `titres discord #meme-review`. Chacune vraie, aucune
 * cherchée : ce sont les rouages qui produisent la nuit et l'archétype, dits en
 * une ligne juste en dessous.
 *
 * Ils ne disparaissent pas — une donnée arrivée a le droit d'être vue, et la
 * cacher sans le dire ferait croire qu'elle n'est pas arrivée. Ils se replient,
 * ce qui n'est pas la même chose. Reste ouvert ce qui se mesure sur un CORPS,
 * et tout ce qui va avec les journées notées : un rouage qui bouge avec la
 * personne n'est plus un rouage, c'est une trouvaille.
 */
function mesuresMarkup(mesures) {
  if (!mesures?.length) return '';
  const ligne = m => {
    const phrase = phraseLien(m.lien);
    return `<li class="jm${m.lien ? ' lie' : ''}">
          <span class="jmnom">${esc(nomMesure(m.cle))}</span>
          <span class="jmval">${esc(valMesure(m))}${m.unite ? `<i>${esc(m.unite)}</i>` : ''}</span>
          ${/* Le côté, et pas seulement la valeur : « 5,4 » ne dit ni si c'est
                beaucoup ni par rapport à quoi. La médiane de SA série épargne à
                la personne d'avoir à retenir ses propres normales.

                TROIS ÉTATS ET PAS DEUX. Avec un simple `>=`, la valeur qui EST
                la médiane s'annonçait « au-dessus de » suivi d'elle-même —
                « 8 562 ↑ au-dessus de 8 562 ». Ça arrive à chaque série impaire
                dont on ouvre le jour du milieu, c'est-à-dire souvent. */''}
          ${m.cote ? `<span class="jmcote ${m.cote}">${m.cote === 'pile' ? '=' : m.cote === 'haut' ? '↑' : '↓'}
            <span class="faint">${m.cote === 'pile'
              ? 'ta médiane'
              : `${m.cote === 'haut' ? 'au-dessus de' : 'sous'} ${valMesure({ valeur: m.mediane })}`}</span></span>` : ''}
          ${phrase ? `<span class="jmlien">${phrase}</span>` : ''}
        </li>`;
  };

  const ouvertes = mesures.filter(m => !m.detail || m.lien);
  const rouages = mesures.filter(m => m.detail && !m.lien);

  return `<div class="jmesures">
    <div class="k faint">Ce qui a été mesuré</div>
    ${ouvertes.length ? `<ul class="jmlist">${ouvertes.map(ligne).join('')}</ul>` : ''}
    ${rouages.length ? `<details class="jmrouages">
      <summary>${rouages.length} mesure${rouages.length > 1 ? 's' : ''} derrière ces chiffres</summary>
      <ul class="jmlist">${rouages.map(ligne).join('')}</ul>
    </details>` : ''}
  </div>`;
}

function thematiquesMarkup(ts) {
  if (!ts?.length) return '';
  return `<div class="jthemes">
    <div class="k faint">De quoi tu as parlé</div>
    <div class="jtlist">
      ${ts.map(t => `<span class="jtheme" title="${esc(t.extrait)}">
        <span class="jticone">${icone(t.theme, 15)}</span>
        <span class="jtnom">${esc(NOMS[t.theme] ?? t.theme)}</span>
        ${t.n > 1 ? `<span class="jtn mono">${t.n}</span>` : ''}
      </span>`).join('')}
    </div>
  </div>`;
}

/**
 * LE CORPS DE LA JOURNÉE OUVERTE.
 *
 * Sans fil ce jour-là, on retombe sur ce qui existait : le texte, seul, en
 * pleine largeur. Trois colonnes dont deux vides seraient un tableau de bord
 * qui annonce des choses qu'il n'a pas.
 */
/**
 * LE TEXTE DU SOIR, DÉCOUPÉ EN SUJETS.
 *
 * Ce qu'on écrit le soir arrive d'un bloc : six cents mots où l'on passe de sa
 * nuit à son ex, de son ex à sa mère, sans un alinéa. Relu trois mois plus
 * tard, ce bloc ne se relit pas — on le survole.
 *
 * ON NE RÉÉCRIT RIEN, ET ON N'ENLÈVE RIEN. Le texte est là mot pour mot, dans
 * son ordre ; on pose des coupures là où le sujet change, une icône en face, et
 * l'estimation du passage à droite. Une paraphrase de ce qu'on a écrit un
 * mauvais soir n'a aucune raison d'être plus juste que la phrase — le découpage
 * est la seule façon de structurer sans toucher au texte.
 *
 * Le serveur rend une liste VIDE quand il n'a trouvé qu'un seul sujet : une
 * icône posée au-dessus de toute une journée serait une étiquette, pas un
 * repère. On retombe alors sur le texte tel quel, ce qui est le bon défaut.
 */
function sujetsMarkup(sujets) {
  if (!sujets?.length) return '';
  /* PAS D'ESTIMATION ICI. Cette colonne sert à VOIR LES SUJETS, pas à relire une
     note : le chiffre du passage se lit déjà dans les moments à gauche et dans
     la note de la journée. L'icône, plus grande, porte le sujet ; la survoler en
     donne le nom — c'est tout ce qu'on vient chercher ici. */
  return `<div class="jsujets">${sujets.map(s => `
    <div class="jsujet"${s.ids?.length ? ` data-ids="${esc(s.ids.join(','))}"` : ''}>
      <span class="jsmarque">
        <span class="jsico" data-tip="${esc(NOMS[s.theme] ?? s.theme)}">${icone(s.theme, 20)}</span>
        ${s.heure ? `<span class="jsheure mono">${esc(s.heure)}</span>` : ''}
      </span>
      <p class="serif jstexte">${esc(s.texte)}</p>
    </div>`).join('')}</div>`;
}

/**
 * LA JOURNÉE EN TROIS COLONNES — TOUJOURS LES MÊMES, TOUJOURS À LA MÊME PLACE.
 *
 * Elles se repliaient quand elles n'avaient rien : une journée sans relevé
 * perdait sa colonne du milieu, et le texte glissait dessous. D'une journée à
 * l'autre, la page changeait donc de forme — et on cherchait l'humeur à
 * gauche là où elle venait d'être, avant de comprendre que tout avait bougé
 * d'un cran.
 *
 * Une colonne vide est une INFORMATION : elle dit qu'il n'y a rien eu, à
 * l'endroit où il y aurait pu y avoir quelque chose. La retirer efface la
 * question au lieu d'y répondre.
 *
 * L'ordre est fixe et se lit de gauche à droite comme la journée elle-même :
 * ce qu'on a ressenti, ce dont on a parlé et ce qui a bougé, ce qu'on a écrit.
 */
function journeeMarkup(m) {
  const j = m.journee ?? {};
  const moments = j.moments ?? [];
  const decoupe = sujetsMarkup(j.sujets);
  const texte = decoupe || (m.jour?.text
    ? `<p class="serif dayText">${esc(m.jour.text)}</p>`
    : `<p class="jvide">${m.note !== null ? 'Notée, sans texte.' : 'Rien d’écrit ce jour-là.'}</p>`);
  const cote = `${volatiliteMarkup(j.volatilite)}${mesuresMarkup(m.mesures)}${thematiquesMarkup(j.thematiques)}`;

  return `<div class="jgrille">
    <div class="jcol jfil">
      <div class="k faint">Humeurs de la journée</div>
      ${moments.length
        ? `<ol class="jmoments">${moments.map(momentMarkup).join('')}</ol>`
        : '<p class="jvide">Rien n’a été dit ce jour-là.</p>'}
    </div>
    ${/* Vide, la colonne du milieu prend le titre que ses blocs portent
          d'habitude eux-mêmes : sans lui, son texte flottait plus bas que les
          deux autres colonnes et la rangée de titres était bancale. */''}
    <div class="jcol jcote">
      ${cote || `<div class="k faint">Ce qui a bougé</div>
                 <p class="jvide">Rien de mesuré, rien de relevé.</p>`}
    </div>
    <div class="jcol jecrit">
      <div class="k faint">Ce que tu as écrit</div>
      ${texte}
    </div>
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
        <span class="ricone-box"${teinteDe(r) != null
          ? ` style="color:hsl(${teinteDe(r)} 62% 62%)"` : ''}>${icone(r.theme, 22)}</span>
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
    min: '1900-01-01', max: jourCivil(), aujourdhui: S.today,
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
    /* Le mois : une case par jour, de gauche à droite. */
    const mb = e.target.closest('[data-mois]');
    if (mb) { MIR_CAL.curseur = mb.dataset.mois; return renderMoi(MIRROR_DATE, { garderCal: true }); }

    /*
     * UN MOMENT DÉSIGNE SON PASSAGE. C'est de la désignation, pas de la
     * navigation : rien n'est enregistré, rien ne change de place, et cliquer
     * ailleurs éteint. On ne redessine donc PAS la journée — la reconstruire
     * effacerait justement ce qu'on vient d'allumer.
     */
    const mom = e.target.closest('.jmoment[data-ids]');
    if (mom) { montrerLePassage(mom); return; }
    if (e.target.closest('.jgrille')) return;   // dans la grille, sans cible : on laisse
    montrerLePassage(null);                     // ailleurs : on éteint


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
      if (c.dataset.cal === 'jour') {
        MIR_CAL.curseur = c.dataset.d.slice(0, 7);
        await rejouer(c.dataset.d);
        /*
         * LA JOURNÉE VIENT À L'ÉCRAN.
         *
         * Dans « Moi », le calendrier arrive après les pistes : cliquer une
         * case chargeait la journée SOUS le pli, et il fallait faire défiler
         * pour voir ce qu'on venait de demander — l'écran ne bougeait pas, on
         * pouvait croire que le clic n'avait rien fait.
         *
         * On amène la journée en haut, pas au centre : le calendrier reste
         * juste au-dessus, à portée pour en ouvrir une autre.
         */
        $('#view').querySelector('.jourseul')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return;
      }
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

/* ==================================================================
   QUANTIFIED SELF : CE QU'UNE AUTRE APPLICATION A ENVOYE.
   ================================================================== */

let QSVUE = 'series';

/** Un nombre lisible d'un coup d'oeil : 8410 devient « 8 410 », 6.2 reste « 6,2 ». */
const qsNombre = v => v == null ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(v);

/**
 * « aujourd'hui 14:07 » plutôt qu'une date complète.
 *
 * On regarde ce journal quand on vient de brancher quelque chose, c'est-à-dire
 * dans les minutes qui suivent. Une date absolue oblige alors à calculer si
 * c'est bien l'envoi qu'on vient de déclencher.
 */
function qsQuand(iso) {
  const d = new Date(iso);
  const jour = d.toISOString().slice(0, 10);
  const auj = new Date().toISOString().slice(0, 10);
  const q = jour === auj ? "aujourd'hui" : jour === dayShift(auj, -1) ? 'hier' : fmtDay(jour);
  return `${q} ${fmtTime(iso)}`;
}

/*
 * L'EXEMPLE EST DANS LA PAGE, PAS DANS UNE DOC.
 *
 * Ce qu'on cherche en arrivant ici est « qu'est-ce que je colle dans l'autre
 * application ? ». La route, la clé et une charge qui marche répondent en une
 * fois ; un lien vers un fichier README fait ouvrir un deuxième onglet pour
 * apprendre trois lignes.
 */
const qsExemple = cle => `curl -X POST ${location.origin}/api/qs \\
  -H "Authorization: Bearer ${cle || '<ta-clé>'}" \\
  -H "Content-Type: application/json" \\
  -d '{"source":"montre","date":"${new Date().toISOString().slice(0, 10)}",
       "mesures":{"sommeil_h":6.2,"pas":8410,"cafe":3}}'`;

function qsSeriesMarkup(series) {
  if (!series.length) return `<p class="faint" style="font-size:12.5px;margin:14px 0 0">
    Rien n'est encore arrivé. Envoie la commande ci-dessus : la série apparaîtra ici.</p>`;
  return `<div class="tblwrap"><table class="tbl qstbl">
    <thead><tr>
      <th>Série</th><th>Source</th><th class="n">Points</th><th>Étendue</th><th>Dernière</th><th></th>
    </tr></thead><tbody>
    ${series.map(x => `<tr>
      <td class="mono">${esc(x.cle)}${x.unite ? ` <span class="faint">${esc(x.unite)}</span>` : ''}</td>
      <td class="faint">${esc(x.source)}</td>
      <td class="n">${x.n}</td>
      ${/* Une série entièrement textuelle n'a pas d'étendue, et en afficher une
            calculée sur zéro nombre donnerait « 0 – 0 », qu'on lirait comme une
            mesure plate au lieu d'une absence de mesure. */''}
      <td class="faint">${x.sansNombre === x.n ? 'texte'
        : `${qsNombre(x.bas)} – ${qsNombre(x.haut)}`}</td>
      <td>${x.derniere
        ? `${qsNombre(x.derniere.valeur) === '—' ? esc(x.derniere.texte ?? '') : qsNombre(x.derniere.valeur)}
           <span class="faint" style="font-size:11.5px">· ${fmtDay(x.derniere.date)}</span>`
        : '—'}</td>
      <td><button class="btn qsoubli" data-source="${esc(x.source)}" data-cle="${esc(x.cle)}"
            style="padding:2px 8px;font-size:11px" data-tip="oublier cette série">${ico('corbeille', 11)}</button></td>
    </tr>`).join('')}
    </tbody></table></div>`;
}

function qsJournalMarkup(journal) {
  if (!journal.length) return `<p class="faint" style="font-size:12.5px;margin:14px 0 0">
    Aucun envoi reçu pour l'instant.</p>`;
  return `<div class="tblwrap"><table class="tbl qstbl">
    <thead><tr>
      <th>Quand</th><th>Source</th><th class="n">Reçues</th><th class="n">Gardées</th><th>Ce qui a été laissé</th>
    </tr></thead><tbody>
    ${journal.map(l => `<tr class="${l.statut >= 400 ? 'qsko' : l.gardees < l.recues ? 'qspartiel' : ''}">
      <td class="mono">${qsQuand(l.quand)}</td>
      <td class="faint">${esc(l.source ?? '—')}
        ${l.apercu ? `<span class="qsapercu">${esc(l.apercu)}</span>` : ''}</td>
      <td class="n">${l.recues}</td>
      <td class="n">${l.gardees}</td>
      ${/* La raison EN TOUTES LETTRES. Un code d'erreur renverrait au code
            source, et personne ne lit le code source de son journal intime. */''}
      <td>${l.refus ? esc(l.refus) : '<span class="faint">—</span>'}</td>
    </tr>`).join('')}
    </tbody></table></div>`;
}

function qsMarkup(qs) {
  const s = S.settings;
  return `
    <h2>${ico('antenne', 15)}Quantified self</h2>
    <p class="sub">
      Une application qui mesure — une montre, un téléphone, une balance, un tracker de sommeil —
      pousse ici ce qu'elle relève. Elle utilise <b>la même clé que la passerelle</b> : un seul secret
      à coller, un seul à révoquer. <b>Rien de ce qui arrive ici ne compte comme une journée écrite</b> —
      une mesure est relevée par une machine, une journée est vécue et notée à la main.
    </p>
    ${!s.passerelleCle ? `<p class="warn" style="font-size:12.5px;margin:0 0 12px">
      Aucune clé : crée-la dans <b>La passerelle</b>, juste au-dessus. Sans elle, rien ne peut envoyer.</p>` : ''}
    <pre class="qscode">${esc(qsExemple(s.passerelleCle))}</pre>
    <p class="faint" style="font-size:11.5px;margin:8px 0 16px">
      La forme du JSON est libre : à plat, dans une enveloppe, en lot, ou avec un niveau d'imbrication.
      Les noms sont normalisés — <span class="mono">Sommeil (h)</span> et <span class="mono">sommeil_h</span>
      sont la même série. Un même jour renvoyé deux fois <b>remplace</b>, il ne s'additionne pas.
      <span class="mono">source · date · at · ts · mesures</span> décrivent l'envoi : ce ne sont jamais des mesures.
    </p>
    <div class="horizons qsonglets">
      <button data-qsvue="series" aria-pressed="${QSVUE === 'series'}">Séries ${qs.series.length || ''}</button>
      <button data-qsvue="journal" aria-pressed="${QSVUE === 'journal'}">Journal ${qs.journal.length || ''}</button>
    </div>
    <div id="qspan">${QSVUE === 'series' ? qsSeriesMarkup(qs.series) : qsJournalMarkup(qs.journal)}</div>
    ${QSVUE === 'journal' && qs.journal.length ? `<button class="btn" id="qsvider"
      style="margin-top:12px;padding:3px 10px;font-size:11.5px">${ico('corbeille', 11)}vider le journal</button>` : ''}`;
}

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

    <div class="card">
      <h2>La passerelle</h2>
      <p class="sub">
        Une application qui tourne sur ta machine — une guirlande, une lampe, un widget — peut venir
        demander au site ce qu'il a en attente. Elle lit une couleur, une note sur dix, un titre de
        repère. <b>Jamais le journal</b> : pas une phrase écrite, pas un message, pas une lecture.
      </p>
      <div class="field">
        <span>Clé</span>
        <div class="keystate ${s.passerelleCle ? 'stored' : 'none'}" id="passState">
          ${s.passerelleCle
            ? `<b class="mono" id="passCle">${esc(s.passerelleCle)}</b>
               <button class="btn" id="passRefaire" style="padding:2px 9px;font-size:11.5px;margin-left:6px">${ico('refaire', 11)}la remplacer</button>
               <button class="btn" id="passRetirer" style="padding:2px 9px;font-size:11.5px;margin-left:6px">${ico('corbeille', 11)}la retirer</button>`
            : `<b>Aucune clé</b> — rien ne peut interroger le site.
               <button class="btn" id="passCreer" style="padding:2px 9px;font-size:11.5px;margin-left:6px">${ico('plus', 11)}en créer une</button>`}
        </div>
        <p class="faint" style="font-size:11.5px;margin:8px 0 0">
          ${/* La route est nommee ici parce que c'est ce qu'on doit recopier, et
                qu'aller la chercher ailleurs veut dire ouvrir le code. */''}
          L'application interroge <span class="mono">GET /api/machitool/attente</span> et présente la clé
          en <span class="mono">Authorization: Bearer</span>, en <span class="mono">X-Machitool-Cle</span>
          ou en <span class="mono">?cle=</span> — les trois marchent.
          La retirer coupe l'accès tout de suite, sans toucher à ta session.
        </p>
      </div>
    </div>

    ${/* Juste sous la passerelle, parce que c'est le MEME tuyau dans l'autre
          sens et la même clé. Les séparer ferait chercher la clé deux fois. */''}
    <div class="card qscard" id="qscard"><p class="faint" style="font-size:12.5px;margin:0">Quantified self…</p></div>

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
          <button class="btn" id="scanNotes">${ico('loupe')}Analyser</button>
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
          <button class="btn" id="export">${ico('sortir')}Exporter en JSON</button>
          <form method="post" action="/logout" style="margin:0"><button class="btn" type="submit">${ico('partir')}Se déconnecter</button></form>
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
          <button class="btn danger" id="wipeGo" disabled>${ico('corbeille')}Effacer</button>
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
    const choix = (id, valeur) => `<select id="${id}">
      ${info.models.map(m => `<option value="${esc(m.id)}" ${m.id === valeur ? 'selected' : ''}>${esc(m.label)} — ${esc(m.note)}</option>`).join('')}
    </select>`;
    el.innerHTML = `<div class="row">
      ${/* DEUX MODÈLES, PARCE QUE C'EST DEUX MÉTIERS. Le compagnon tient une
            conversation du soir, quarante fois par jour ; la lecture relit
            quatre ans de journal, une fois par semaine. C'est la seule tâche du
            produit où l'intelligence se voit vraiment, et la seule qui mérite
            le modèle le plus cher. */''}
      <label class="field"><span>Le compagnon</span>${choix('anthropicModelChat', s.anthropicModelChat)}</label>
      <label class="field"><span>La lecture de fond</span>${choix('anthropicModel', s.anthropicModel)}</label>
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
               <button class="btn" id="clearKey" style="padding:2px 9px;font-size:11.5px;margin-left:6px">${ico('corbeille', 11)}l'effacer</button>` : ''}`
          : s.keySource === 'stored'
            ? `<b>Enregistrée dans l'app</b> — elle n'est jamais renvoyée au navigateur.
               <button class="btn" id="clearKey" style="padding:2px 9px;font-size:11.5px;margin-left:6px">${ico('corbeille', 11)}effacer</button>`
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
        <button class="btn" id="testKey">${ico('cle')}Tester la clé</button>
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
      <input type="checkbox" id="lectureEnLot" ${s.lectureEnLot !== false ? 'checked' : ''}
             style="width:auto;margin-right:7px">
      La lecture de fond part en tâche de fond</span></label>
    <p class="sub" style="margin:0;font-size:12px">
      Elle tourne toute seule une fois par semaine, l'écran garde la lecture précédente affichée, et
      personne ne la regarde apparaître. En tâche de fond elle rend <b>dans l'heure</b> au lieu de deux
      minutes, et coûte <b>moitié moins</b>.
      <br>« relire » reste immédiat quoi qu'il arrive : quand tu cliques, tu attends une réponse.
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
  } else { el.innerHTML = ''; }

  /*
   * PAS DE `return` ICI, ET C'EST UNE CORRECTION.
   *
   * Il y en avait un dans la branche « aucun modèle », et il quittait
   * renderSettings() tout entier -- pas seulement le bloc du backend. Tout ce
   * qui suit dans cette fonction restait donc SANS GESTIONNAIRE dans le mode
   * hors-ligne : la clé de la passerelle ne se créait pas, la lecture en lot ne
   * se cochait pas, le carnet ne se retirait pas du contexte. Les boutons
   * s'affichaient normalement et ne faisaient rien -- la panne la plus longue à
   * comprendre, parce qu'il n'y a rien à voir.
   *
   * Et c'était le mode exactement le plus concerné : quelqu'un qui tient à ce
   * que rien ne sorte de sa machine est le premier à vouloir brancher une
   * application locale.
   *
   * Tous les branchements ci-dessous passent par `?.`, donc l'absence des
   * champs du backend ne casse rien.
   */
  for (const id of ['ollamaUrl', 'ollamaModel', 'anthropicModel', 'anthropicModelChat', 'anthropicEffort']) {
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
      b.disabled = false; b.innerHTML = ico('cle') + 'Tester la clé';
    }
  });

  $('#clearKey')?.addEventListener('click', async () => {
    await saveSettings({ apiKey: '', clearKey: true });
    renderSettings();
    toast('Clé effacée');
  });

  /*
   * LA CLÉ DE LA PASSERELLE. Elle est CRÉÉE par le serveur, jamais choisie ici :
   * une clé tapée à la main est une clé devinable, et celle-ci ouvre une route
   * qui répond sans session.
   *
   * Elle reste affichée en clair après création — contrairement à la clé
   * Anthropic, qui ne revient jamais au navigateur. Il faut pouvoir la recopier
   * dans l'application qui s'en sert, et le seul navigateur qui la reçoit est
   * celui de la session déjà ouverte.
   */
  const poserPasserelle = async () => {
    await api('/api/passerelle/cle', {});
    S.settings = (await api('/api/state')).settings;
    renderSettings();
    toast('Clé créée — colle-la dans ton application');
  };
  $('#passCreer')?.addEventListener('click', poserPasserelle);
  $('#passRefaire')?.addEventListener('click', poserPasserelle);
  $('#passRetirer')?.addEventListener('click', async () => {
    await fetch('/api/passerelle/cle', { method: 'DELETE', headers: enTetes() });
    S.settings = (await api('/api/state')).settings;
    renderSettings();
    toast('Clé retirée — l’application ne peut plus interroger le site');
  });
  // Un clic sur la clé la copie : la recopier à la main, c'est trente-deux
  // caractères et une faute de frappe.
  $('#passCle')?.addEventListener('click', async e => {
    try {
      await navigator.clipboard.writeText(e.target.textContent.trim());
      toast('Clé copiée');
    } catch { /* pas de presse-papiers : elle est lisible à l'écran, ça suffit */ }
  });
  /*
   * LA CARTE QUANTIFIED SELF SE REMPLIT APRÈS COUP.
   *
   * Elle interroge une route à elle, et pas /api/state : brancher son inventaire
   * sur l'état général le ferait recalculer à chaque note posée, à chaque
   * message envoyé, pour une carte qu'on ouvre trois fois dans sa vie. Elle
   * arrive donc en différé, et la page ne l'attend pas pour s'afficher.
   */
  const peindreQS = async () => {
    const carte = $('#qscard');
    if (!carte) return;
    try {
      const qs = await api('/api/qs');
      carte.innerHTML = qsMarkup(qs);
      carte.querySelectorAll('[data-qsvue]').forEach(b => b.addEventListener('click', () => {
        QSVUE = b.dataset.qsvue;
        peindreQS();
      }));
      carte.querySelectorAll('.qsoubli').forEach(b => b.addEventListener('click', async () => {
        // Une série s'oublie sans confirmation à rallonge : c'est une série
        // mesurée par une machine, elle repartira au prochain envoi. Ce qui ne
        // se récupère pas, ce sont les journées — et elles ne sont pas ici.
        const { retirees } = await api('/api/qs/oublier', { source: b.dataset.source, cle: b.dataset.cle });
        toast(`${retirees} mesure${retirees > 1 ? 's' : ''} oubliée${retirees > 1 ? 's' : ''}`);
        peindreQS();
      }));
      carte.querySelector('#qsvider')?.addEventListener('click', async () => {
        await api('/api/qs/journal/vider', {});
        peindreQS();
      });
    } catch (err) {
      carte.innerHTML = `<h2>${ico('antenne', 15)}Quantified self</h2>
        <p class="warn" style="font-size:12.5px;margin:0">${esc(err.message)}</p>`;
    }
  };
  peindreQS();

  $('#lectureEnLot')?.addEventListener('change', async e => {
    await saveSettings({ lectureEnLot: e.target.checked });
    toast(e.target.checked ? 'La lecture de fond partira en tâche de fond' : 'La lecture de fond sera immédiate');
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
      <button class="btn primary" id="doImport">${ico('ranger')}Importer ${p.total} journées</button>
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
        ? `<button class="btn primary" id="doNotes">${ico('plus')}Ajouter ${p.nouvelles + p.ajouts} journée${p.nouvelles + p.ajouts > 1 ? 's' : ''} au miroir</button>`
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

/*
 * LA VUE « SUIVI » A ÉTÉ RETIRÉE — l'interface, pas le travail.
 *
 * Elle montrait les séances et le compte rendu à emporter chez un praticien.
 * Elle ne sert pas pour l'instant, et un onglet qu'on n'ouvre jamais est un
 * onglet de plus à traverser pour atteindre les quatre autres.
 *
 * CE QUI RESTE, ET POURQUOI : la table `seances`, `server/compte-rendu.js` et
 * ses routes sont intacts, avec leurs tests. Même règle que pour les objectifs
 * en leur temps — on retire l'interface, pas les données ni le calcul.
 * Remettre l'onglet est alors une ligne dans `VIEWS` ; l'avoir supprimé aurait
 * voulu dire le réécrire.
 */

/* ==================================================================
   LE VISUALISEUR DES DONNÉES REÇUES.

   Réglages répond « est-ce que ça rentre » : les noms des séries, le journal
   des envois, les refus. C'est une console de branchement. Elle ne répond pas
   à la question de quelqu'un qui regarde SES données — « qu'est-ce qu'il y a
   dedans ? » — et les digests d'activité, eux, n'étaient visibles nulle part :
   ils ne se lisaient que par la clé, c'est-à-dire depuis l'application qui les
   envoie.

   ON NE REFORMATE PAS LE DIGEST. Sa forme appartient à l'application qui
   l'écrit et elle bougera ; la figer ici voudrait dire la casser à chaque
   version de leur côté. Le rendu est donc GÉNÉRIQUE — il descend dans ce qu'on
   lui donne, quelle que soit sa forme.
   ================================================================== */

let QS_DATA = null;

const qsNb = v => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(v);

/**
 * L'unité est portée par le NOM de la clé : un segment `s` des secondes, `min`
 * des minutes.
 *
 * Elle n'est pas toujours À LA FIN. L'aplatissement d'un objet imbriqué la
 * met AU MILIEU : `temps_par_contexte_s` + `navigateur` donne
 * `temps_par_contexte_s_navigateur`, et une règle ancrée sur la fin y lit un
 * nombre de secondes brut — « 2 087 » au lieu de « 35 min ». On cherche donc le
 * segment où qu'il soit.
 *
 * `h` n'en est pas : la valeur reste un nombre d'heures, rien à convertir, et
 * le « h » du nom est alors la seule chose qui dise l'unité.
 */
const UNITES = new Set(['s', 'min']);
const segmentsDe = k => String(k ?? '').split('_').filter(Boolean);
const uniteDuNom = k => {
  const seg = segmentsDe(k);
  // Une clé qui n'est QUE « s » est un nom, pas une unité : on ne la vide pas.
  return seg.length > 1 ? seg.find(x => UNITES.has(x)) ?? null : null;
};

/**
 * Les secondes en durée lisible. `temps_par_contexte_s` est un nom qui dit son
 * unité : 4830 ne se lit pas, « 1 h 22 » se lit. La convention `_s` vient des
 * données elles-mêmes, on ne la choisit pas.
 *
 * Elle est portée par le nom du BLOC autant que par celui de la valeur :
 * `temps_par_contexte_s: { code: 4938 }` n'a d'unité que sur le parent, et
 * « code : 4 938 » ne veut rien dire. La clé parente descend donc comme
 * repli — la clé propre gagne toujours si elle dit elle-même son unité.
 */
function qsValeur(cle, v, herite = '') {
  if (v == null) return '—';
  if (typeof v === 'boolean') return v ? 'oui' : 'non';
  if (typeof v !== 'number') return String(v);
  const u = uniteDuNom(cle) ?? uniteDuNom(herite);
  if (u === 's' && v >= 60) {
    const h = Math.floor(v / 3600), m = Math.round((v % 3600) / 60);
    return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
  }
  if (u === 'min' && v >= 60) return `${Math.floor(v / 60)} h ${String(Math.round(v % 60)).padStart(2, '0')}`;
  return qsNb(v);
}

/**
 * Le nom d'une clé, lisible.
 *
 * Le `s` n'est pas un mot, c'est l'unité — et elle est déjà dans la valeur en
 * face (« 1 h 22 ») : l'afficher deux fois donne « temps par contexte s
 * navigateur », qui se lit comme une faute de frappe. On retire donc le segment
 * qu'on a pris pour unité, et LUI SEUL : ce qui n'a pas servi à formater la
 * valeur reste écrit, parce que cacher un morceau du nom que la personne a
 * choisi n'est pas à nous.
 */
function qsNom(k) {
  const u = uniteDuNom(k);
  const seg = segmentsDe(k);
  if (!u) return seg.join(' ');
  const i = seg.indexOf(u);
  return [...seg.slice(0, i), ...seg.slice(i + 1)].join(' ');
}

/** Descend dans un objet de forme inconnue. Deux niveaux, puis on replie. */
function qsArbre(obj, profondeur = 0, herite = '') {
  if (obj == null) return '<span class="qsnul">—</span>';
  if (Array.isArray(obj)) {
    if (!obj.length) return '<span class="qsnul">vide</span>';
    if (obj.every(x => typeof x !== 'object')) {
      return `<span class="qsliste">${obj.map(x => esc(String(x))).join(' · ')}</span>`;
    }
    return `<div class="qsniv">${obj.map(x => qsArbre(x, profondeur + 1, herite)).join('')}</div>`;
  }
  if (typeof obj !== 'object') return esc(String(obj));

  const lignes = Object.entries(obj).map(([k, v]) => {
    const feuille = v == null || typeof v !== 'object';
    const suivante = uniteDuNom(k) ? k : herite;
    return `<div class="qsl">
      <span class="qsk">${esc(qsNom(k))}</span>
      ${feuille ? `<span class="qsv">${esc(qsValeur(k, v, herite))}</span>`
                : `<div class="qsv">${qsArbre(v, profondeur + 1, suivante)}</div>`}
    </div>`;
  });
  return `<div class="qsniv${profondeur ? ' dedans' : ''}">${lignes.join('')}</div>`;
}

/**
 * Une série en courbe, avec sa médiane.
 *
 * La courbe seule dit la forme et rien d'autre : montée, descente, dents de
 * scie. Ce qu'on veut savoir en la regardant, c'est OU ON EN EST par rapport à
 * d'habitude — donc le trait de la médiane, en pointillé, et le dernier point
 * marqué. Sans lui, il faut compter les crêtes pour trouver la droite.
 *
 * Le dernier point est PLEIN, comme partout ailleurs dans l'application : ce
 * qui est rempli est mesuré, ce qui est contouré est déclaré. Une mesure venue
 * d'une montre est mesurée.
 */
function qsCourbe(points, { mediane = null } = {}) {
  const pts = points.filter(p => p.valeur != null);
  if (pts.length < 2) return '';
  const v = pts.map(p => p.valeur);
  const W = 260, H = 44, M = 4;
  const bas = Math.min(...v, mediane ?? Infinity), haut = Math.max(...v, mediane ?? -Infinity);
  const etendue = haut - bas || 1;
  const yDe = val => H - M - ((val - bas) / etendue) * (H - M * 2);
  const xDe = i => (i / Math.max(1, pts.length - 1)) * W;

  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${xDe(i).toFixed(1)} ${yDe(p.valeur).toFixed(1)}`).join(' ');
  const yMed = mediane == null ? null : yDe(mediane).toFixed(1);
  const dx = xDe(pts.length - 1).toFixed(1), dy = yDe(pts.at(-1).valeur).toFixed(1);

  return `<svg class="qssvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    ${yMed != null ? `<line class="qsmed" x1="0" y1="${yMed}" x2="${W}" y2="${yMed}"
                            stroke-dasharray="3 4" stroke-width="1"/>` : ''}
    <path d="${d}" fill="none" stroke="currentColor" stroke-width="1.3"
          stroke-linejoin="round" stroke-linecap="round"/>
    <circle class="qspoint" cx="${dx}" cy="${dy}" r="2.6"/>
  </svg>`;
}

/**
 * LE DIGEST D'UN JOUR, LU.
 *
 * Le serveur a regroupé ce qui allait ensemble : quatorze titres de pages ne
 * sont pas quatorze mesures, c'est une mesure découpée. On rend donc les
 * familles en une ligne chacune — leur poids, les plus grosses nommées, et le
 * reste COMPTÉ, jamais effacé en silence — puis tout ce qui n'a pas été
 * regroupé, tel quel.
 *
 * Le brut reste accessible en dessous. On ne remplace pas la donnée par son
 * résumé : on met le résumé devant.
 */
function qsLuMarkup(lu) {
  if (!lu || (!lu.familles?.length && !lu.lignes?.length)) return '';
  const fam = (lu.familles ?? []).map(f => `<div class="qsfam">
    <div class="qsfamtete">
      <span class="qsfamnom">${esc(qsNom(f.nom))}</span>
      <span class="qsfamn faint">${f.n} entrées</span>
      <span class="qsfamtot mono">${esc(qsValeur(f.nom, f.total))}</span>
    </div>
    <div class="qsfamt">
      ${f.tetes.map(t => `<span class="qsfamx"><b>${esc(t.nom)}</b>
        <span class="mono">${esc(qsValeur(t.cle, t.valeur, f.nom))}</span></span>`).join('')}
      ${f.reste ? `<span class="qsfamx reste">+ ${f.reste} autres
        <span class="mono">${esc(qsValeur(f.nom, f.resteTotal))}</span></span>` : ''}
    </div>
  </div>`).join('');

  /*
   * EN CELLULES, PAS EN RANGEES PLEINE LARGEUR.
   *
   * Une rangee qui traverse mille pixels met le nom a gauche et sa valeur a
   * l'autre bout : l'oeil doit traverser le vide pour les rapprocher, six fois
   * de suite. Six cellules cote a cote se lisent d'un coup.
   */
  const lignes = (lu.lignes ?? []).map(l => `<div class="qscell">
    <span class="qscv mono">${esc(qsValeur(l.cle, l.valeur))}</span>
    <span class="qsck">${esc(qsNom(l.chemin.join(' ')))}</span>
  </div>`).join('');

  return `${lignes ? `<div class="qscells">${lignes}</div>` : ''}${fam}`;
}

/**
 * Une série, sa dernière valeur, son côté, et son lien s'il en a un.
 *
 * L'ORDRE DE LECTURE EST VOULU : le nom, puis la dernière valeur — c'est la
 * seule qu'on ait en tête —, puis où elle tombe par rapport à d'habitude, puis
 * la forme, puis les bornes. Le lien vient en dernier parce qu'il est la seule
 * ligne qui parle du JOURNAL, et qu'on ne le lit qu'après avoir compris le
 * chiffre.
 */
function qsSerieMarkup(s, fin = null) {
  const phrase = phraseLien(s.lien);
  const numerique = s.bas != null;
  /*
   * LA DATE NE S'AFFICHE QUE QUAND ELLE APPREND QUELQUE CHOSE.
   *
   * Écrite sur chaque carte, c'est treize fois « 1 sep 2026 » : du bruit, et
   * une ligne de plus qui passait à la ligne sur les noms longs. Écrite quand
   * la série s'arrête AVANT la fin de la fenêtre, c'est la seule chose qui
   * distingue « la montre n'a rien envoyé depuis trois semaines » de « tout va
   * bien » — et cette différence, aucune courbe ne la montre.
   */
  const arretee = s.dernier && fin && s.dernier.date < fin;
  return `<div class="qsserie${s.lien ? ' lie' : ''}">
    <div class="qsstete">
      <span class="qsnom"><b>${esc(qsNom(s.cle))}</b>
        <span class="faint">${esc(s.source)}</span></span>
      <span class="qsn mono">${s.n} pts</span>
    </div>

    ${s.dernier ? `<div class="qsdernier">
      <span class="qsval mono">${numerique
        ? `${esc(qsValeur(s.cle, s.dernier.valeur))}${s.unite ? `<i>${esc(s.unite)}</i>` : ''}`
        : esc(String(s.dernier.texte ?? '—'))}</span>
      ${s.cote ? `<span class="jmcote ${s.cote}">${s.cote === 'pile' ? '=' : s.cote === 'haut' ? '↑' : '↓'}
        <span class="faint">${s.cote === 'pile' ? 'ta médiane'
          : `${s.cote === 'haut' ? 'au-dessus de' : 'sous'} ${esc(qsValeur(s.cle, s.mediane))}`}</span></span>` : ''}
      ${arretee ? `<span class="qsquand mono">jusqu'au ${fmtDay(s.dernier.date)}</span>` : ''}
    </div>` : ''}

    ${qsCourbe(s.points, { mediane: s.mediane })}

    ${/* Une série de texte n'a ni courbe ni bornes. Ce qu'elle a, c'est sa
          dernière valeur et le nombre de valeurs DIFFÉRENTES : « 08:23, une
          seule valeur sur 40 jours » dit tout de suite que la mesure est
          constante, donc qu'elle n'apprend rien — et le dire vaut mieux que
          l'écrire « texte », qui n'est pas une information. */''}
    <div class="qsbornes mono">
      ${numerique ? `${esc(qsValeur(s.cle, s.bas))} → ${esc(qsValeur(s.cle, s.haut))}${s.unite ? ` ${esc(s.unite)}` : ''}
        ${/* La moyenne passe par le MÊME formateur que les bornes : « 22 min →
              1 h 58 · moy. 4 139,88 » donne deux unités dans la même ligne, et
              l'œil bute avant de comprendre pourquoi. */''}
        <span class="faint">· moy. ${esc(qsValeur(s.cle, s.moyenne))}</span>`
      : `<span class="faint">${s.distinctes === 1 ? 'toujours la même valeur'
          : `${s.distinctes} valeurs différentes`}</span>`}
    </div>

    ${phrase ? `<p class="qslien">${phrase}</p>` : ''}
  </div>`;
}

/**
 * LA NUIT ET LA FORME DU JOUR, EN UNE LIGNE CHACUNE.
 *
 * C'était deux cartes côte à côte : trois grands chiffres, trois puces, un nom
 * d'archétype avec ses preuves en trois lignes et une note en bas. Sur un écran
 * qui parle déjà de la journée juste au-dessus, ça faisait un deuxième bloc
 * aussi gros que le premier pour dire deux choses.
 *
 * Une lune, une durée, deux heures : la nuit. Une icône et un mot : la forme du
 * jour. Ce qui les explique — les écarts, les chiffres qui ont produit
 * l'archétype — passe en `title`, à portée de curseur, et ne prend plus de
 * place tant qu'on ne le demande pas.
 *
 * L'ARCHÉTYPE GARDE SES CHIFFRES, et ce n'est pas négociable : une étiquette
 * posée par une machine qu'on ne peut pas contester s'installe dans la tête.
 * Ils sont dans l'infobulle, pas supprimés.
 */
const ICO_ARCH = { doomscroll: 'doomscroll', curieux: 'curieux', productif: 'productif',
                   social: 'social', repose: 'repose' };

function qsNuitMarkup(nuit) {
  if (!nuit) return '';
  const h = v => (v == null ? '—' : v);

  // Les écarts ne s'écrivent plus : ils colorent l'heure, et se lisent au
  // survol. « couché 2 h 15 plus tard que d'habitude » sur trois lignes disait
  // la même chose que ce point orange, en trois fois plus de place.
  const ecart = quoi => nuit?.dit?.find(p => p.quoi === quoi) ?? null;
  // Le sens de l'écart se dit par une flèche, comme partout ailleurs dans
  // l'application (↑ ↓ =) : la couleur seule ne dit pas de quel côté.
  const FLECHE = { plus: '↑', moins: '↓', tard: '↑', tot: '↓' };
  const bout = (v, cle, quoi, icone) => {
    const e = ecart(quoi);
    return `<span class="qsbout${e ? ' ecarte' : ''}"${e ? ` title="${esc(e.texte)}"` : ''}>
      ${icone ? ico(icone, 12) : ''}<b class="mono">${esc(v)}</b><i>${esc(cle)}</i>${
      e ? `<u>${FLECHE[e.sens] ?? ''}</u>` : ''}</span>`;
  };

  return `<div class="qsligne">
    ${nuit ? `<div class="qsnuitmini">
      ${nuit.duree != null ? bout(qsDuree(nuit.duree),
          nuit.dureeDeduite ? 'au lit' : 'de sommeil', 'duree', 'lune') : ''}
      ${nuit.coucher != null ? bout(h(nuit.coucher),
          nuit.coucherMesure ? 'couché' : 'dernière activité', 'coucher',
          nuit.duree != null ? null : 'lune') : ''}
      ${nuit.lever != null ? bout(h(nuit.lever),
          nuit.leverMesure ? 'levé' : 'première activité', 'lever', 'lever') : ''}
    </div>` : ''}
  </div>`;
}

/** « 6 h 20 », « 45 min ». Les minutes du serveur, lisibles. */
function qsDuree(min) {
  const m = Math.abs(Math.round(min ?? 0));
  if (m < 60) return `${m} min`;
  const r = m % 60;
  return r ? `${Math.floor(m / 60)} h ${String(r).padStart(2, '0')}` : `${Math.floor(m / 60)} h`;
}

/**
 * =====================================================================
 * LE PANNEAU, EN QUELQUES LIGNES.
 *
 * Il montrait treize cartes de séries avec leurs courbes et leurs bornes,
 * derrière un bouton, avec un sélecteur de fenêtre. Sur des données réelles ça
 * donnait quarante lignes de titres de pages : tout était là, rien ne se
 * lisait, et il fallait deux clics pour y arriver.
 *
 * Il ne reste que ce qu'on vient chercher, et ça tient en trois blocs :
 *
 *   1. LA NUIT — combien de temps, couché quand, levé quand, et l'écart à SA
 *      propre normale.
 *   2. LA FORME DE LA JOURNÉE — un archétype, avec les chiffres qui l'ont
 *      produit, parce qu'une étiquette sans ses chiffres ne se conteste pas.
 *   3. QUELQUES PUCES — le temps d'écran, où il est passé, le rythme.
 *
 * Le reste — les séries, les journées d'avant, le digest brut — se replie. Il
 * n'est pas supprimé : une donnée arrivée a le droit d'être vue, et la cacher
 * sans le dire ferait croire qu'elle n'est pas arrivée.
 * =====================================================================
 */
function qsPanneauMarkup(d) {
  if (!d) return '<div class="card qspan"><p class="jvide">…</p></div>';

  const rien = !d.series.length && !d.activite.length;
  if (rien) {
    return `<div class="card qspan">
      <div class="qstete"><h2>${ico('antenne', 15)}Quantified self</h2></div>
      <p class="sub" style="margin:0">Rien n'est arrivé. Le branchement est dans
      <b>Réglages › Quantified self</b>.</p></div>`;
  }

  const series = [...d.series].sort((a, b) =>
    (b.lien ? 1 : 0) - (a.lien ? 1 : 0) || b.n - a.n || a.cle.localeCompare(b.cle));
  const lies = series.filter(s => s.lien).length;
  const dernier = d.activite?.[0] ?? null;

  return `
    <div class="card qspan">
      <div class="qstete">
        <h2>${ico('antenne', 15)}Quantified self</h2>
      </div>

      ${/* Deux lignes, et pas une de plus : la nuit, puis l'usage de la machine.
             L'archétype ferme la seconde — il est la lecture de ce qui la
             précède, pas une carte à côté. */''}
      ${qsNuitMarkup(d.nuit)}
      ${qsPucesMarkup(d, d.archetype)}

      ${/* TOUT LE RESTE SE REPLIE. Les séries répondent à « comment ça
            évolue », le brut à « qu'est-ce qui est arrivé exactement » : deux
            questions qu'on ne pose pas en ouvrant. */''}
      ${dernier?.digest ? `<details class="qsbrutd">
        <summary>ce qui est arrivé le ${fmtDay(dernier.date)} · ${dernier.lu?.champs ?? Object.keys(dernier.digest).length} champs</summary>
        ${qsLuMarkup(dernier.lu)}
        <details class="qsbrutd"><summary>tel quel</summary>${qsArbre(dernier.digest)}</details>
      </details>` : ''}

      ${series.length ? `<details class="qsseriesd">
        <summary>${series.length} série${series.length > 1 ? 's' : ''} de mesures${
          lies ? ` · ${lies} qui ${lies > 1 ? 'vont' : 'va'} avec tes journées` : ''}</summary>
        <div class="qsseries">${series.map(x => qsSerieMarkup(x, d.jusqu_au)).join('')}</div>
        ${lies ? `<p class="qsnote">Les séries en couleur vont avec tes journées notées — pas
          « à cause de », <b>avec</b>. Le sens, s'il y en a un, t'appartient.</p>` : ''}
      </details>` : ''}
    </div>`;
}

/**
 * QUELQUES PUCES, ET PAS UNE DE PLUS.
 *
 * Une valeur, ce qu'elle est, et son écart à SA normale quand on en a une. Pas
 * de courbe, pas de bornes, pas de moyenne : ce sont des réponses à d'autres
 * questions, et elles sont repliées plus bas.
 *
 * Une puce ne s'écrit que si son chiffre existe. Une ligne vide, un tiret, un
 * zéro qui veut dire « on ne sait pas » : chacun apprend à ne plus lire.
 */
/**
 * L'USAGE DE LA MACHINE, SUR UNE LIGNE, AVEC SES ICÔNES.
 *
 * C'était une grille de grosses puces — une valeur en 21 pixels par ligne — au
 * milieu d'un écran qui parle déjà de la journée juste au-dessus. Elle pesait
 * plus lourd que ce qu'elle disait.
 *
 * Même forme que la nuit : une icône, un chiffre, un mot. Ce qui explique
 * — l'écart à sa normale — passe au survol et se signale par une flèche.
 * L'archétype ferme la ligne : il est la lecture de tout ce qui la précède.
 */
function qsPucesMarkup(d, archetype) {
  const j = d.jour ?? {};
  const p = [];

  const puce = (v, cle, icone, note, sens) =>
    `<span class="qsbout${sens ? ' ecarte' : ''}"${note ? ` title="${esc(note)}"` : ''}>
      ${ico(icone, 12)}<b class="mono">${esc(v)}</b><i>${esc(cle)}</i>${
      sens ? `<u>${sens > 0 ? '↑' : '↓'}</u>` : ''}</span>`;

  if (j.ecran != null) {
    const e = j.ecranEcart;
    const notable = e != null && Math.abs(e) >= 30;
    p.push(puce(qsDuree(Math.round(j.ecran / 60)), 'd’écran', 'ecran',
                notable ? `${qsDuree(Math.abs(e))} de ${e > 0 ? 'plus' : 'moins'} que d'habitude` : null,
                notable ? Math.sign(e) : 0));
  }
  if (j.ou?.part != null) {
    p.push(puce(`${Math.round(j.ou.part * 100)} %`, j.ou.nom.replace(/^(de |sur des |d')/, ''),
                ICO_ARCH[j.ou.cle] ?? 'point', `${qsDuree(Math.round(j.ou.sec / 60))} sur la journée`, 0));
  }
  if (j.bascules != null) {
    const f = j.basculesFois;
    const notable = f != null && (f > 1.15 || f < 0.85);
    p.push(puce(qsNb(j.bascules), 'bascules', 'bascule',
                f != null ? `${f.toFixed(1).replace('.', ',')}× ta normale` : null,
                notable ? (f > 1 ? 1 : -1) : 0));
  }
  if (j.pauses != null) p.push(puce(qsNb(j.pauses), 'pauses', 'pause', null, 0));

  const preuves = archetype?.preuves?.map(x => `${x.quoi} : ${x.valeur}`).join(' · ') ?? '';
  const badge = archetype
    ? `<span class="qsarchmini" title="${esc(preuves)} — ça décrit ta journée d'ordinateur, pas toi.">
        ${ico(ICO_ARCH[archetype.cle] ?? 'point', 14)}${esc(archetype.nom)}</span>`
    : '';

  if (!p.length && !badge) return '';
  return `<div class="qsligne">${p.join('')}${badge}</div>`;
}

/**
 * QUATRE-VINGT-DIX JOURS, ET PLUS DE SÉLECTEUR.
 *
 * Il y en avait trois — 30 j, 90 j, 1 an — et ils réglaient quelque chose que
 * personne ne vient régler : ce qu'on regarde ici est SA JOURNÉE, pas une
 * tendance. La fenêtre ne sert plus qu'à donner aux médianes de quoi être des
 * médianes, et quatre-vingt-dix jours suffisent pour ça.
 */
const QS_FENETRE = 90;

async function chargerQS() {
  const vide = !QS_DATA;
  const hote = $('#qspanneau');
  // Au premier chargement seulement : ensuite on garde ce qui est affiché
  // plutôt que de le faire clignoter pour le remettre identique.
  if (hote && vide) hote.innerHTML = qsPanneauMarkup(null);
  try { QS_DATA = await api(`/api/qs/contenu?jours=${QS_FENETRE}`); }
  catch (err) { QS_DATA = null;
    const h = $('#qspanneau');
    if (h) h.innerHTML = `<div class="card"><p class="warn">${esc(err.message)}</p></div>`;
    return; }
  const h = $('#qspanneau');
  if (h) h.innerHTML = qsPanneauMarkup(QS_DATA);
}

/* ============================= routage ============================= */

/**
 * LA BORNE CIVILE, LA OU « AUJOURD'HUI » NE SUFFIT PAS.
 *
 * `S.today` est la journée VÉCUE : à 2 h du matin, c'est encore la veille, et
 * c'est ce qu'on veut partout où l'on parle de sa journée. Mais une date
 * MAXIMALE — celle d'un repère, celle d'une note de carnet, le jour suivant
 * dans la navigation — est celle du calendrier : bornée à la journée vécue, la
 * journée d'après deviendrait injoignable toutes les nuits.
 *
 * Le repli sur `S.today` couvre un état servi par une version d'avant.
 */
const jourCivil = () => S?.jourCivil ?? S?.today;

const VIEWS = {
  tonight: renderTonight,
  moi: () => renderMoi(),
  year: () => renderYear(),
  mirror: () => renderMirror(),
  settings: renderSettings
};

const NOM_VUE = { tonight: 'Parler', moi: 'Moi', year: 'Année', mirror: 'Ma carte', settings: 'Réglages' };

/**
 * LES ONGLETS PRENNENT LEUR ICÔNE, UNE FOIS.
 *
 * Le dessin vit dans `icones.js` et pas en double dans le HTML : une icône
 * corrigée l'est partout où elle sert. Posée au démarrage plutôt qu'à chaque
 * `syncNav`, parce qu'elle ne change jamais — seul le nom à côté bouge.
 */
function monterNav() {
  for (const b of document.querySelectorAll('nav button[data-view]')) {
    const c = b.querySelector('.navico');
    if (c && !c.firstChild) c.innerHTML = ico(ICO_VUE[b.dataset.view] ?? 'point', 15);
  }
}

function syncNav() {
  monterNav();
  for (const b of document.querySelectorAll('nav button')) {
    b.setAttribute('aria-current', String(b.dataset.view === view));
  }
  const t = $('#viewName');
  if (t) t.innerHTML = `${esc(NOM_VUE[view] ?? '')}<span class="glyphe" id="viewGlyphe"></span>`;
  /*
   * LE RAIL SE TAIT DANS PARLER.
   *
   * Il était « constant d'une vue à l'autre », et c'était la bonne règle tant
   * qu'il ne portait qu'une identité. Il a fini par porter le nom du produit,
   * le compte de jours, la dernière phrase du compagnon RECOPIÉE sous son
   * portrait, et le nom du décor — quatre choses à lire à gauche d'un écran où
   * l'on vient écrire une phrase.
   *
   * Dans Parler il ne reste que la bestiole. Ailleurs, tout revient : ce sont
   * des vues qu'on lit, pas des vues où l'on parle.
   */
  document.querySelector('.shell')?.setAttribute('data-vue', view);
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
/* La derniere scene affichee, et le minuteur qui la fait disparaitre. */
let AMB_VUE = null, AMB_MINUTEUR = 0;

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
  /*
   * « drift » a deux vies. C'est la scène par DÉFAUT — celle qu'on affiche
   * quand rien ne ressort — et c'est aussi celle d'un état, être perdu, qui a
   * ses mots à lui. La force les sépare, et le nom doit suivre : « Neutre »
   * posé sur « être perdu — des étoiles, aucun cap » se contredisait à voix
   * haute.
   */
  const nom = scene === 'drift' && (S?.ambiance?.force ?? 0) > 0
    ? 'Dérive' : (NOM_SCENE[scene] ?? 'Neutre');
  const g = $('#viewGlyphe');
  if (g) g.innerHTML = glypheMarkup(scene);

  const el = $('#ambianceRead');
  if (!el) return;
  el.hidden = false;
  /*
   * DANS PARLER, LE NOM DU DÉCOR N'APPARAÎT QUE QUAND IL CHANGE.
   *
   * C'est le fond lui-même qu'on est censé regarder ; sa légende affichée en
   * permanence à côté est une étiquette collée sur un tableau. Elle sert
   * pourtant, une fois : au moment où la scène bascule, pour qu'on sache que ce
   * n'est pas le hasard. Elle se montre donc quelques secondes, puis s'en va —
   * et reste affichée en clair dans les autres vues, où rien ne se joue.
   */
  if (view === 'tonight') {
    const neuf = scene !== AMB_VUE;
    AMB_VUE = scene;
    el.classList.toggle('passager', true);
    el.classList.toggle('la', neuf);
    if (neuf) {
      clearTimeout(AMB_MINUTEUR);
      AMB_MINUTEUR = setTimeout(() => el.classList.remove('la'), 7000);
    }
  } else {
    el.classList.remove('passager', 'la');
  }
  const sens = S?.ambiance?.sens ?? null;
  el.innerHTML = `<span class="k">Ambiance</span>
    <span class="v">${esc(nom)}${glypheMarkup(scene)}</span>
    ${/* CE QUE LE DÉCOR REPRÉSENTE. Sans ça, le fond change et personne ne sait
          pourquoi : c'est une décoration. Nommé, ça devient une lecture — mais
          une lecture qu'on peut contredire, et c'est ce qui la rend acceptable.
          La phrase dit ce que la SCÈNE porte, jamais ce que la personne est. */''}
    ${sens ? `<span class="sens">${esc(sens)}</span>` : ''}`;
  el.title = "Le décor du fond, pas une lecture de ta journée : l'application ne qualifie jamais une journée.";
}

async function go(v) {
  view = v;
  // Le panneau d'un nœud répond à un geste fait dans « Ma carte » : le garder
  // ouvert en revenant plus tard afficherait une réponse à une question qu'on
  // ne se souvient pas d'avoir posée.
  if (v !== 'mirror') NOEUD_OUVERT = null;
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


/* ==========================================================================
   RETISSER LA TOILE — ET LA REGARDER SE FAIRE.

   « Relire » existait : un bouton, deux minutes de sablier, une carte qui
   apparaît d'un coup. Or ce qui se passe entre les deux est ce que cette
   application fait de plus rare — tout le journal est relu, et une forme en
   sort. Le cacher derrière un sablier, c'est jeter la seule chose qu'elle a de
   spectaculaire.

   TROIS TEMPS, ET AUCUN N'EST DÉCORATIF.

   1. On rassemble. Une lueur par journée relue — pas « des particules », le
      nombre exact des journées, et leur écart donne leur couleur. Regarder
      quatre ans de sa vie s'allumer point par point est déjà quelque chose.

   2. Il lit. Les lueurs respirent, et un compteur dit combien de signes le
      modèle a écrits. Pas de barre de progression : on ne sait pas quand ça
      s'arrête, et une barre qui avance vers une fin inventée ment à chaque
      seconde.

   3. Ça se tisse. Chaque lueur rejoint LA CHOSE QUI LA RÉCLAME — un nœud porte
      ses journées, c'est ce qu'il est. Puis la simulation tourne à l'image :
      ce qu'on regarde alors est la disposition en train de se faire, quatre
      tours par image, pas une animation qui l'imiterait.

   À la fin, les groupes se nomment, un par un.
   ========================================================================== */

let TISSAGE = null;         // { phase, corpus, G, sim, vue, lueurs, trouves, pct, ancienne, groupes, err }
/* Le nombre de tours d'une disposition complète : c'est le travail à étaler. */
const TOURS_TISSAGE = 320;
let TISSAGE_BOUCLE = 0;

const PHASES = {
  rassemble: 'je relis tout',
  lit:       'elle lit',
  tisse:     'ça se tisse',
  fini:      null
};

/** Le temps restant, en clair. « dans 4 h 20 » se lit ; « 15 600 000 » non. */
function enClair(ms) {
  const m = Math.ceil(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, '0')}`;
}

/**
 * La place de départ d'une lueur : une spirale de tournesol.
 *
 * L'angle d'or répartit n points sans jamais former de rangée ni de rayon —
 * c'est la disposition la plus régulière qui n'ait pas l'air rangée. Une grille
 * dirait « voici un tableau de données » ; une spirale dit « voici beaucoup de
 * jours », ce qui est vrai.
 */
const OR = Math.PI * (3 - Math.sqrt(5));
function spirale(i, n, L, H) {
  const r = Math.sqrt((i + 0.5) / n) * Math.min(L, H) * 0.42;
  const a = i * OR;
  return { x: L / 2 + Math.cos(a) * r, y: H / 2 + Math.sin(a) * r };
}

/** La vue qui fait tenir un nuage de points dans le cadre, sans le déformer. */
function vuePour(pts, L, H, marge = 72) {
  if (!pts.length) return vueNeutre();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  /*
   * LE HAUT ET LE BAS SONT PRIS. Le titre occupe le premier cinquième de
   * l'écran, les groupes le dernier ; une toile centrée dans TOUT le cadre
   * passe donc dessous et sous les deux. On cadre dans ce qui reste.
   */
  const haut = H * 0.20, bas = H * 0.18;
  const dispo = H - haut - bas;
  const k = Math.min((L - marge * 2) / Math.max(1, x1 - x0),
                     (dispo - marge) / Math.max(1, y1 - y0), 1.5);
  return { k,
    x: marge + (L - marge * 2 - (x1 - x0) * k) / 2 - x0 * k,
    y: haut + (dispo - (y1 - y0) * k) / 2 - y0 * k };
}

const versLa = (a, b, t) => a + (b - a) * t;

function tissageMarkup() {
  const t = TISSAGE;
  if (!t) return '';
  const titre = t.err ? 'ça n’a pas abouti' : (PHASES[t.phase] ?? 'ta toile');
  return `<div class="tissage" id="tissage">
    <canvas id="tissagecv"></canvas>
    ${/* LE POURCENTAGE, en trait fin tout en haut. Il ne compte pas le temps —
          on ne sait pas combien le modèle va prendre — il compte ce qui est
          ARRIVÉ : les thèmes, les pistes, les nœuds, puis les tours de
          simulation. Un pourcentage tiré d'une horloge avance quand rien ne se
          passe, et ment donc pile au moment où l'on doute. */''}
    <div class="tsjauge"><i id="tsjaugei" style="width:0%"></i></div>
    <div class="tspct mono" id="tspct">0 %</div>
    <div class="tstrouves" id="tstrouves"></div>
    <div class="tsdessus">
      <div class="tstitre">${esc(titre)}</div>
      <div class="tsdit" id="tsdit">${esc(t.dit ?? '')}</div>
      ${t.err ? `<p class="tserr">${esc(t.err)}</p>` : ''}
      ${t.phase === 'fini' || t.err
        ? `<button class="btn" id="tsfin">${t.err ? 'revenir' : 'voir ma carte'}</button>` : ''}
    </div>
    ${t.groupes?.length ? `<div class="tsgroupes">${t.groupes.map((g, i) =>
      `<span class="tsg" style="--p:${g.teinte ?? TEINTES_DECLAREES[i % TEINTES_DECLAREES.length]};
              --d:${(i * 0.45).toFixed(2)}s">${esc(g.nom)}</span>`).join('')}</div>` : ''}
  </div>`;
}

/**
 * LE POURCENTAGE, ET IL NE RECULE JAMAIS.
 *
 * Il vient de deux sources — la structure reçue pendant la lecture, puis les
 * tours de simulation — et deux sources qui se relaient peuvent se croiser. Un
 * chiffre qui redescend fait douter de tout le reste, alors qu'il ne dit que
 * « j'ai changé de règle ». On garde donc le maximum atteint.
 */
function tissagePct(p) {
  if (!TISSAGE || !Number.isFinite(p)) return;
  TISSAGE.pct = Math.max(TISSAGE.pct ?? 0, Math.min(100, Math.round(p)));
  const j = $('#tsjaugei'), t = $('#tspct');
  if (j) j.style.width = `${TISSAGE.pct}%`;
  if (t) t.textContent = `${TISSAGE.pct} %`;
}

/**
 * UNE TROUVAILLE ARRIVE.
 *
 * C'est un nom que le modèle vient d'écrire, cueilli dans son JSON au moment
 * où il le referme. Rien n'est deviné : si la pastille dit « pensée de fin de
 * nuit », c'est que ces mots-là viennent d'être écrits.
 */
const GENRE_TROUVE = { theme: 'mécanisme', piste: 'groupe', noeud: 'chose' };
function tissageTrouve({ genre, nom }) {
  if (!TISSAGE) return;
  (TISSAGE.trouves ??= []).push({ genre, nom });
  const hote = $('#tstrouves');
  if (!hote) return;
  const el = document.createElement('span');
  el.className = `tstr ${genre}`;
  el.title = GENRE_TROUVE[genre] ?? '';
  el.textContent = nom;
  hote.appendChild(el);
  /*
   * LA BANDE DEBORDE, ET CE N'EST PAS N'IMPORTE QUOI QU'ON RETIRE.
   *
   * Les mécanismes et les groupes arrivent EN PREMIER dans le JSON, les choses
   * ensuite et en nombre. Un simple « on garde les vingt derniers » effaçait
   * donc exactement ce que l'utilisateur voulait voir apparaître -- les
   * patterns -- pour laisser une bande de noms d'objets. On ne fait rouler que
   * les choses ; les patterns restent, ils sont le sujet.
   */
  const roulants = [...hote.children].filter(x => x.classList.contains('noeud'));
  const trop = hote.children.length - 20;
  for (let i = 0; i < trop && i < roulants.length; i++) hote.removeChild(roulants[i]);
}

/** Le texte sous le titre, réécrit sans reconstruire la vue : elle porte un canvas. */
function tissageDit(texte) {
  if (TISSAGE) TISSAGE.dit = texte;
  const el = $('#tsdit');
  if (el) el.textContent = texte;
  const ti = $('.tstitre');
  if (ti && TISSAGE) ti.textContent = TISSAGE.err ? 'ça n’a pas abouti' : (PHASES[TISSAGE.phase] ?? 'ta toile');
}

/**
 * L'ANCIENNE TOILE, RECADREE POUR L'ECRAN OU ELLE S'EFFACE.
 *
 * Elle a ete disposee dans le cadre du Miroir, qui est plus petit et pas au
 * meme endroit que le voile plein ecran. Rejouee telle quelle, elle se tassait
 * dans un coin -- on voyait bien quelque chose s'en aller, mais pas SA carte.
 * On la refait donc tenir dans l'ecran, centree, avant de la disperser.
 */
function cadrerAncienne(pts, L, H) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  if (!Number.isFinite(x0)) return { k: 1, x: 0, y: 0 };
  const l = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const k = Math.min(L * 0.78 / l, H * 0.72 / h);
  return { k, x: L / 2 - (x0 + x1) / 2 * k, y: H / 2 - (y0 + y1) / 2 * k };
}

/**
 * LA BOUCLE. Une image, trois couches : les lueurs, les liens, les nœuds.
 *
 * Elle tourne du premier événement à la fin, et c'est la même boucle qui montre
 * les journées puis la toile — sans coupure, parce que ce sont les mêmes points.
 */
function tissageBoucle() {
  const cv = $('#tissagecv');
  if (!cv || !TISSAGE) { TISSAGE_BOUCLE = 0; return; }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const L = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== L * dpr) { cv.width = L * dpr; cv.height = H * dpr; }
  const ctx = cv.getContext('2d');
  const t = TISSAGE;
  t.image = (t.image ?? 0) + 1;

  // Les lueurs s'allument en deux secondes et demie, quel que soit le nombre de
  // journées et quelle que soit la machine — même raison que pour le tissage.
  if (t.lueurs && t.nees < t.lueurs.length) {
    const now = performance.now();
    t.neesDepuis = (t.neesDepuis ?? 0) + Math.min(120, now - (t.horlogeL ?? now));
    t.horlogeL = now;
    t.nees = Math.min(t.lueurs.length, Math.ceil(t.lueurs.length * (t.neesDepuis / 2500)));
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, L, H);

  /* ---- 0. l'ancienne toile, qui s'efface ----
     Six secondes pour se dissoudre : le temps de la reconnaître avant qu'elle
     s'en aille. Les nœuds se dispersent en s'éteignant — ils ne « fondent »
     pas, ils s'écartent, ce qui est ce qu'on va leur refaire faire juste
     après. */
  if (t.ancienne) {
    /*
     * SIX SECONDES DE MONTRE, PAS CENT QUATRE-VINGTS IMAGES.
     *
     * Compté par image, l'effacement durait six secondes sur une machine à
     * trente images et vingt-cinq sur une machine lente — et la vieille toile
     * était encore là, par-dessus la neuve, quand celle-ci finissait de se
     * poser. C'est le même piège que pour le tissage : on mesure le temps.
     */
    const now = performance.now();
    t.effDepuis = (t.effDepuis ?? 0) + Math.min(120, now - (t.horlogeE ?? now));
    t.horlogeE = now;
    t.effacee = Math.min(1, t.effDepuis / 6000);
    const o = 1 - t.effacee;
    if (o > 0.01) {
      const a = t.ancienne;
      const v = (a.cadre ??= cadrerAncienne(a.pts, L, H));
      const dansLa = p => ({ x: p.x * v.k + v.x, y: p.y * v.k + v.y });
      const derive = t.effacee * 70;
      const cx = L / 2, cy = H / 2;
      ctx.globalAlpha = o * 0.5;
      ctx.lineCap = 'round';
      for (const l of a.G.liens ?? []) {
        const p1 = dansLa(a.pts[l.s]), p2 = dansLa(a.pts[l.t]);
        if (!p1 || !p2) continue;
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
        ctx.strokeStyle = `hsl(${TEINTE_GENRE[a.G.noeuds[l.s]?.genre] ?? 288} 45% 46%)`;
        ctx.lineWidth = 0.8; ctx.stroke();
      }
      for (let i = 0; i < a.G.noeuds.length; i++) {
        const p = dansLa(a.pts[i]);
        if (!p) continue;
        // Chacun s'écarte du centre, un peu plus à chaque image.
        const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy) || 1;
        const x = p.x + dx / d * derive, y = p.y + dy / d * derive;
        const r = (4 + Math.log2(1 + (a.G.noeuds[i].jours ?? 1)) * 2.2) * v.k * (1 - t.effacee * 0.5);
        ctx.globalAlpha = o;
        ctx.strokeStyle = `hsl(${TEINTE_GENRE[a.G.noeuds[i].genre] ?? 288} 50% 56%)`;
        ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.arc(x, y, Math.max(0.5, r), 0, 7); ctx.stroke();
      }
    } else if (t.effacee >= 1) t.ancienne = null;
  }

  /* ---- la simulation avance, si elle a commencé ---- */
  if (t.sim && !t.pose) {
    /*
     * LE TISSAGE DURE SIX SECONDES. PAS TROIS CENT VINGT IMAGES.
     *
     * Le débit était compté PAR IMAGE. Sur une machine à soixante images par
     * seconde ça donnait les six secondes voulues ; sur une machine lente —
     * un vieux téléphone, un navigateur qui rame — la même chose prenait
     * cinquante secondes. Le spectacle n'a pas à punir celui qui a le moins de
     * puissance : c'est exactement l'inverse de ce qu'on veut.
     *
     * On mesure donc le TEMPS écoulé, et on rattrape ce qu'il faut de tours.
     * Et on garde la courbe : le début, où tout bouge et où c'est beau, prend
     * son temps ; la fin, où les points ne font que se caler au pixel près,
     * passe vite.
     */
    const DUREE = 6000;
    const now = performance.now();
    const dt = Math.min(120, now - (t.horloge ?? now));   // un onglet en fond ne rattrape pas tout d'un coup
    t.horloge = now;
    t.ecoule = (t.ecoule ?? 0) + dt;
    const avance = Math.min(1, t.ecoule / DUREE);
    // La vitesse va du simple au quintuple ; son intégrale sur la durée vaut
    // les 320 tours, quel que soit le nombre d'images qu'on a eues pour ça.
    const vitesse = TOURS_TISSAGE / DUREE * (0.4 + 1.2 * avance);
    t.debit = (t.debit ?? 0) + vitesse * dt;
    const n = Math.floor(t.debit);
    t.debit -= n;
    if (n > 0 && t.sim.pas(n)) t.pose = true;
    const cible = vuePour(t.sim.pts, L, H);
    // La vue rejoint sa cible au lieu d'y sauter : le cadre bouge à chaque tour
    // tant que la toile s'étale, et sauter donnerait un tremblement.
    t.vue = t.vue ? { k: versLa(t.vue.k, cible.k, 0.08),
                      x: versLa(t.vue.x, cible.x, 0.08),
                      y: versLa(t.vue.y, cible.y, 0.08) } : cible;
    // Une fois posée, on cesse de poursuivre : la vue se cale sur le cadrage
    // exact. Sinon elle s'arrête là où le rattrapage en était, et la toile
    // finit de travers pour une raison invisible.
    tissagePct(70 + 30 * Math.min(1, 1 - t.sim.restant() / TOURS_TISSAGE));
    if (t.pose) { t.arrivee = t.image; t.vue = cible; tissagePct(100); }
  }
  const v = t.vue ?? vueNeutre();
  const dansLaVue = p => ({ x: p.x * v.k + v.x, y: p.y * v.k + v.y });

  /* ---- 1. les lueurs : une par journée relue ---- */
  const resp = 0.5 + 0.5 * Math.sin(t.image / 26);
  for (let i = 0; i < (t.nees ?? 0); i++) {
    const g = t.lueurs[i];
    if (g.cible) {
      // Elle rejoint la chose qui la réclame. Un nœud PORTE ses journées :
      // ce trajet n'est pas une transition, c'est ce que la carte veut dire.
      const c = dansLaVue(t.sim.pts[g.cible.i]);
      const a = g.cible.a;
      g.x = versLa(g.x, c.x + Math.cos(a) * g.cible.r * v.k, 0.055);
      g.y = versLa(g.y, c.y + Math.sin(a) * g.cible.r * v.k, 0.055);
    } else if (g.perdue) {
      g.o = Math.max(0, (g.o ?? 1) - 0.012);      // aucune chose ne la réclame
    }
    const o = (g.o ?? 1) * (g.cible ? 0.85 : 0.34 + 0.3 * resp);
    if (o <= 0.01) continue;
    ctx.globalAlpha = o;
    ctx.fillStyle = g.c;
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.cible ? 1.5 : 1.9, 0, 7);
    ctx.fill();
  }

  /* ---- 2. les liens, puis 3. les nœuds — ils entrent quand la toile arrive ---- */
  if (t.G && t.sim) {
    const entree = Math.min(1, (t.image - (t.debutToile ?? t.image)) / 90);
    ctx.globalAlpha = entree * 0.5;
    ctx.lineCap = 'round';
    for (const l of t.G.liens) {
      const a = dansLaVue(t.sim.pts[l.s]), b = dansLaVue(t.sim.pts[l.t]);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const dx = b.x - a.x, dy = b.y - a.y;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(mx - dy * 0.13, my + dx * 0.13, b.x, b.y);
      ctx.strokeStyle = `hsl(${TEINTE_GENRE[t.G.noeuds[l.s].genre] ?? 288} 55% 58%)`;
      ctx.lineWidth = (0.7 + l.force * 2) * v.k;
      ctx.stroke();
    }

    /* Les enveloppes, tout à la fin : un îlot n'est un îlot qu'une fois posé. */
    if (t.pose && t.arrivee) {
      const ilots = Math.min(1, (t.image - t.arrivee) / 45);
      for (const a of t.G.ilots ?? []) {
        const dedans = t.G.noeuds.map((n, i) => [n, i]).filter(([n]) => n.ilot === a.i)
          .map(([, i]) => dansLaVue(t.sim.pts[i]));
        if (dedans.length < 2) continue;
        const forme = contour(dedans, 34 * v.k);
        ctx.globalAlpha = ilots * (a.nom ? 0.16 : 0.08);
        ctx.fillStyle = `hsl(${a.teinte ?? 288} 55% 58%)`;
        /* EN COURBES, comme sur la vraie carte : un polygone se lit comme un
           schéma, une forme lissée se lit comme un groupe. C'est le même tracé
           des deux côtés — ce qu'on regarde se faire doit ressembler à ce qu'on
           trouvera après. */
        ctx.beginPath();
        const mi = (x, y) => ({ x: (x.x + y.x) / 2, y: (x.y + y.y) / 2 });
        let m = mi(forme.at(-1), forme[0]);
        ctx.moveTo(m.x, m.y);
        for (let k = 0; k < forme.length; k++) {
          const suiv = mi(forme[k], forme[(k + 1) % forme.length]);
          ctx.quadraticCurveTo(forme[k].x, forme[k].y, suiv.x, suiv.y);
        }
        ctx.closePath();
        ctx.fill();
      }
    }

    for (let i = 0; i < t.G.noeuds.length; i++) {
      const n = t.G.noeuds[i], p = dansLaVue(t.sim.pts[i]);
      const r = (4 + Math.log2(1 + (n.jours ?? 1)) * 2.2) * v.k * entree;
      if (r < 0.4) continue;
      ctx.globalAlpha = entree;
      ctx.fillStyle = '#0a0c0b';
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill();
      ctx.strokeStyle = `hsl(${TEINTE_GENRE[n.genre] ?? 288} 58% 64%)`;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.stroke();
    }
  }

  TISSAGE_BOUCLE = requestAnimationFrame(tissageBoucle);
}

/**
 * Les lueurs, une par journée, colorées par l'ÉCART de leur journée.
 *
 * L'écart vient du serveur, avec la date. Il venait d'un cache du client qui
 * n'existe que dans « Année » et n'a pas cette forme : toutes les lueurs
 * sortaient donc de la même couleur, et on regardait une pluie de points
 * identiques au lieu de ses années dans les couleurs qu'elles ont eues.
 */
function poserLueurs(jours, L, H) {
  const n = jours.length || 1;
  return jours.map((j, i) => {
    const p = spirale(i, n, L, H);
    return { date: j.d, x: p.x, y: p.y, o: 1,
             c: deltaColor(j.e) ?? 'rgb(120,130,124)' };
  });
}

/**
 * LES LUEURS TROUVENT LEUR CHOSE.
 *
 * Chaque nœud porte ses journées. On répartit donc chaque lueur sur l'anneau du
 * nœud qui la réclame — le premier qui la réclame : une journée peut appartenir
 * à plusieurs choses, et la dupliquer en ferait deux journées.
 */
function accrocherLueurs(t) {
  const parDate = new Map();
  t.G.noeuds.forEach((n, i) => {
    const jours = (n.occurrences ?? []).map(j => (typeof j === 'string' ? j : j?.d)).filter(Boolean);
    jours.forEach((d, k) => {
      if (parDate.has(d)) return;
      parDate.set(d, { i, a: (k / Math.max(1, jours.length)) * Math.PI * 2,
                       r: 9 + Math.log2(1 + jours.length) * 3.4 });
    });
  });
  for (const g of t.lueurs) {
    const c = parDate.get(g.date);
    if (c) g.cible = c; else g.perdue = true;
  }
}

async function retisser() {
  if (TISSAGE) return;
  /*
   * ON NE PART PAS D'UNE PAGE NOIRE.
   *
   * Le voile s'ouvrait sur du vide, et la carte qu'on regardait disparaissait
   * d'un coup — comme si elle avait été effacée avant qu'on décide. Ce qui se
   * passe est l'inverse : on REFAIT celle-là. Elle est donc reprise telle
   * qu'elle est à l'écran, positions comprises, et elle se dissout pendant que
   * les journées s'allument.
   *
   * On copie les points : la simulation d'après écrit dans le même tableau, et
   * sans copie l'ancienne toile se mettrait à bouger avec la nouvelle.
   */
  const ancienne = (RELA?.noeuds?.length && RELA_DISPO?.pts?.length)
    ? { G: RELA, pts: RELA_DISPO.pts.map(p => ({ x: p.x, y: p.y })), cadre: null }
    : null;
  TISSAGE = { phase: 'rassemble', dit: 'je rassemble ton journal…', lueurs: null, nees: 0,
              G: null, sim: null, vue: null, groupes: null, err: null, image: 0,
              pct: 0, trouves: [], ancienne, effacee: 0 };
  await renderLecture();
  cancelAnimationFrame(TISSAGE_BOUCLE);
  TISSAGE_BOUCLE = requestAnimationFrame(tissageBoucle);

  /*
   * LA BOUCLE NE S'ARRETE PAS AVEC LE FLUX.
   *
   * Elle etait coupee a la fin du flux -- ce qui semblait propre, et ne l'etait
   * pas : le serveur a fini d'envoyer bien AVANT que la toile ait fini de se
   * poser. La simulation a trois cent vingt tours a jouer apres le dernier
   * evenement, et la couper la fige en six images. La boucle appartient a
   * l'ecran ; elle s'arrete quand on ferme le tissage, pas quand le serveur se
   * tait.
   */

  try {
    await fluxSSE('/api/lecture/retisser', {}, (ev, d) => {
      const cv = $('#tissagecv');
      const L = cv?.clientWidth || 900, H = cv?.clientHeight || 600;
      if (ev === 'refus') {
        TISSAGE.err = `Tu as retissé il y a peu — reviens dans ${enClair(d.attente)}.`;
        tissageDit('');
        rejouerTissage();
      } else if (ev === 'corpus') {
        TISSAGE.corpus = d;
        TISSAGE.lueurs = poserLueurs(d.jours ?? [], L, H);
        TISSAGE.nees = 0;
        tissageDit(`${d.journees} journées · ${d.ecrites} écrites · ${d.reperes} repères · ${d.motifs} motifs`);
      } else if (ev === 'trouve') {
        if (TISSAGE.phase !== 'lit') TISSAGE.phase = 'lit';
        tissageTrouve(d);
        tissagePct(d.pourcent);
      } else if (ev === 'lit') {
        if (TISSAGE.phase !== 'lit') { TISSAGE.phase = 'lit'; }
        tissagePct(d.pourcent);
        /*
         * CE QU'ELLE A TROUVÉ, pas combien de signes elle a tapés. « 14 208
         * signes » était honnête et vide — personne ne se demande combien de
         * signes. « 4 mécanismes, 11 choses » dit où en est le travail.
         */
        const c = d.comptes ?? {};
        const bouts = [];
        if (c.theme) bouts.push(`${c.theme} mécanisme${c.theme > 1 ? 's' : ''}`);
        if (c.piste) bouts.push(`${c.piste} groupe${c.piste > 1 ? 's' : ''}`);
        if (c.noeud) bouts.push(`${c.noeud} chose${c.noeud > 1 ? 's' : ''}`);
        tissageDit(bouts.length ? bouts.join(' · ')
                                : `${new Intl.NumberFormat('fr-FR').format(d.signes)} signes`);
      } else if (ev === 'toile') {
        LECTURE = { ...(LECTURE ?? {}), ...d, possible: true, perime: false, arelire: false };
        MOI = null;
        const pistes = d.lecture?.pistes ?? [];
        const G = versGraphe(d.lecture?.carte, pistes);
        /*
         * LA TOILE ATTEND QUE TOUTES LES JOURNEES SOIENT LA.
         *
         * Sur un journal court -- ou un modele rapide -- la lecture revient
         * avant que les lueurs aient fini de s'allumer, et la toile se posait
         * par-dessus des journees a moitie arrivees. On ne saute pas le premier
         * temps parce que le second est pret : ce qu'on relit merite d'etre vu
         * en entier, meme quand ca va vite.
         */
        const poser = () => {
          if (!TISSAGE) return;
          if (TISSAGE.lueurs && TISSAGE.nees < TISSAGE.lueurs.length) return setTimeout(poser, 120);
          TISSAGE.phase = 'tisse';
          TISSAGE.G = G;
          TISSAGE.sim = disposer(G, L, H, { progressif: true });
          TISSAGE.sim.pas(1);                    // un tour, pour que les centres existent
          TISSAGE.debutToile = TISSAGE.image;
          accrocherLueurs(TISSAGE);
          tissageDit(`${G.noeuds.length} choses, ${G.liens.length} liens`);
        };
        poser();
      } else if (ev === 'fini') {
        TISSAGE.groupes = d.groupes ?? [];
        if (d.usage) { S.usage = d.usage; syncGauge(); }
        // Les groupes ne se nomment qu'une fois la toile POSÉE : les annoncer
        // sur une toile qui bouge encore, c'est nommer ce qui n'a pas de forme.
        const attendre = () => {
          if (TISSAGE?.pose) { TISSAGE.phase = 'fini'; rejouerTissage(); }
          else if (TISSAGE) setTimeout(attendre, 200);
        };
        attendre();
      } else if (ev === 'erreur' || ev === 'error') {
        TISSAGE.err = d.error ?? 'la lecture n’a pas abouti';
        rejouerTissage();
      }
    });
  } catch (err) {
    if (TISSAGE) { TISSAGE.err = err.message; rejouerTissage(); }
  }
}

/* Redessine l'habillage SANS toucher au canvas : le reconstruire perdrait la
   toile en cours de tissage, qui vit dans son contexte. */
function rejouerTissage() {
  const hote = $('#tissage');
  if (!hote || !TISSAGE) return;
  const dessus = hote.querySelector('.tsdessus');
  const t = TISSAGE;
  if (dessus) {
    dessus.innerHTML = `<div class="tstitre">${esc(t.err ? 'ça n’a pas abouti' : (PHASES[t.phase] ?? 'ta toile'))}</div>
      <div class="tsdit" id="tsdit">${esc(t.dit ?? '')}</div>
      ${t.err ? `<p class="tserr">${esc(t.err)}</p>` : ''}
      ${t.phase === 'fini' || t.err
        ? `<button class="btn" id="tsfin">${t.err ? 'revenir' : 'voir ma carte'}</button>` : ''}`;
  }
  let g = hote.querySelector('.tsgroupes');
  if (t.groupes?.length && t.phase === 'fini') {
    if (!g) { g = document.createElement('div'); g.className = 'tsgroupes'; hote.appendChild(g); }
    g.innerHTML = t.groupes.map((x, i) =>
      `<span class="tsg" style="--p:${x.teinte ?? TEINTES_DECLAREES[i % TEINTES_DECLAREES.length]};
              --d:${(i * 0.45).toFixed(2)}s">${esc(x.nom)}</span>`).join('');
  }
}

/** Fermer le tissage : la toile est déjà en base, on affiche la vraie carte. */
async function fermerTissage() {
  cancelAnimationFrame(TISSAGE_BOUCLE);
  TISSAGE_BOUCLE = 0;
  TISSAGE = null;
  await renderLecture();
}

/**
 * UN FLUX SSE, LU À LA MAIN.
 *
 * `EventSource` ne sait pas faire de POST. Le compagnon lit déjà son flux comme
 * ça ; celui-ci suit la même forme — un événement par ligne `event:`, sa charge
 * sur la ligne `data:` qui suit.
 */
async function fluxSSE(url, corps, onEvent) {
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corps ?? {})
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => '')}`.slice(0, 200));
  const lecteur = res.body.getReader();
  const dec = new TextDecoder();
  let tampon = '';
  for (;;) {
    const { value, done } = await lecteur.read();
    if (done) break;
    tampon += dec.decode(value, { stream: true });
    const blocs = tampon.split('\n\n');
    tampon = blocs.pop() ?? '';
    for (const bloc of blocs) {
      let ev = 'message', data = '';
      for (const ligne of bloc.split('\n')) {
        if (ligne.startsWith('event: ')) ev = ligne.slice(7).trim();
        else if (ligne.startsWith('data: ')) data += ligne.slice(6);
      }
      if (!data) continue;
      /*
       * ON SÉPARE LA LECTURE DU TRAITEMENT, ET C'EST TOUT L'ENJEU.
       *
       * Les deux étaient dans le même `try` : un bloc partiel et un bug dans le
       * gestionnaire tombaient dans le même `catch` vide. Résultat, une erreur
       * dans le traitement d'un événement disparaissait sans trace — pas de
       * message, pas de ligne en console, juste un écran qui n'avance plus.
       *
       * Le `catch` ne couvre donc plus que l'analyse, qui est la seule chose
       * dont l'échec soit normal. Ce que fait le gestionnaire de la donnée,
       * lui, a le droit de casser bruyamment.
       */
      let charge;
      try { charge = JSON.parse(data); } catch { continue; }   // bloc partiel
      onEvent(ev, charge);
    }
  }
}
