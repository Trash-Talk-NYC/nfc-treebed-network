// Every visitor-facing string on the tap flow, in both languages.
//
// The captain's constraint (design-record.md, constraint 11) is that the whole
// page exists in Spanish — the takeovers, the problem categories, the free-text
// placeholder, the privacy sentence, all of it — with a toggle the visitor
// operates. Washington Heights is heavily Spanish-speaking; a plaque that only
// speaks English on that block excludes the people most likely to be standing
// at the tree.
//
// One dictionary, of `Phrase` values, so an untranslated string is a type
// error rather than a follow-up ticket: there is no way to write down an
// English string here without its Spanish beside it.
//
// The Spanish is written for the block rather than for a style guide.
// "Cantero" for the tree bed, which is what a Caribbean Spanish speaker in
// upper Manhattan would say — "alcorque" is the Peninsular word and reads as
// a translation. "Quien lo cuide" for steward, which avoids putting a gender
// on a stranger the way "cuidador" would.
//
// Not in here, on purpose:
//  - plain-text refusals for machine callers (405, "Not a tag on this
//    network."). Nothing renders those to a person standing at a tree; they
//    answer a script, and a script does not read Spanish.
//  - the wordmark and the bed's locality. Those are the bed's, not the
//    product's, and come from `presentation.ts`. (The mailing-list signup
//    line is not here either, and not anywhere: it is deliberately absent
//    until there is a real URL — see `thanks.astro`.)

import type { Phrase } from './i18n';

/** The toggle itself: each language names itself in its own language. */
export const LANG_COPY = {
  /** The accessible name of the control, in the language now showing. */
  toggleLabel: { en: 'Cambiar a español', es: 'Switch to English' } satisfies Phrase,
  /** What the toggle prints — the language it switches TO. */
  toggleText: { en: 'ES', es: 'EN' } satisfies Phrase,
};

export const COMMON = {
  backToBed: { en: '← Back to the bed', es: '← Volver al cantero' },
  backToChoices: { en: '← Back to the choices', es: '← Volver a las opciones' },
  stewards: { en: 'Stewards', es: 'Quienes lo cuidan' },
  /** The NYC Parks planting-space ID label. Ours is never shown. */
  bedNumber: { en: 'NYC tree bed', es: 'Cantero NYC' },
  optional: { en: 'optional', es: 'opcional' },
  addPhoto: { en: 'ADD A PHOTO · OPTIONAL', es: 'AÑADE UNA FOTO · OPCIONAL' },
  photoAttached: { en: '✓ Photo attached', es: '✓ Foto adjunta' },
  sendIt: { en: 'SEND IT', es: 'ENVIAR' },
  needsCare: { en: 'THIS BED NEEDS CARE', es: 'ESTE CANTERO NECESITA CUIDADO' },
} satisfies Record<string, Phrase>;

/** Door 1 — a bed with no steward yet. */
export const DOOR_UNSTEWARDED = {
  /** Split around the tree type, which is printed between them. */
  headBefore: { en: 'This ', es: 'El cantero de este ' },
  headAfter: { en: "'s bed is looking for a steward.", es: ' busca quien lo cuide.' },
  sub: {
    en: 'Put your name on it and the block knows who to thank.',
    es: 'Pon tu nombre y la cuadra sabrá a quién agradecer.',
  },
  adopt: { en: 'ADOPT THIS BED', es: 'ADOPTA ESTE CANTERO' },
} satisfies Record<string, Phrase>;

/**
 * Door 1, on a bed the captain has not offered a slot on yet (`offeredSlots`).
 * The invitation is withheld rather than shown and then refused: a screen may
 * not ask someone to put their name on a bed it has no way to accept.
 */
export const DOOR_NOT_OFFERED = {
  /** Split around the tree type, the same shape as the invitation above. */
  headBefore: { en: 'This ', es: 'El cantero de este ' },
  headAfter: {
    en: '’s bed isn’t open for adoption yet.',
    es: ' todavía no está abierto para adopción.',
  },
  sub: {
    en: 'We’re still getting this block ready. You can still tell us if it needs care.',
    es: 'Todavía estamos preparando esta cuadra. Aun así, puedes avisarnos si necesita cuidado.',
  },
} satisfies Record<string, Phrase>;

/** Door 2 — a bed that already has a steward. */
export const DOOR_STEWARDED = {
  headBefore: { en: 'This ', es: '¡El cantero de este ' },
  headAfter: { en: ' bed has been adopted!', es: ' ya tiene quien lo cuide!' },
  applaud: { en: 'SEND APPLAUSE', es: 'ENVÍA UN APLAUSO' },
  joinThem: { en: 'Want to steward it too? →', es: '¿Quieres cuidarlo tú también? →' },
} satisfies Record<string, Phrase>;

/** The one short form behind ADOPT THIS BED. */
export const ADOPT = {
  title: { en: 'Put your name on it', es: 'Pon tu nombre' },
  firstName: { en: 'First name', es: 'Nombre' },
  lastName: { en: 'Last name', es: 'Apellido' },
  email: { en: 'Email', es: 'Correo electrónico' },
  phone: { en: 'Phone', es: 'Teléfono' },
  // No password, no PIN, no code: the captain chose passwordless, and there is
  // deliberately nothing here to invent or forget.
  noSecret: {
    en: 'No password to invent or forget.',
    es: 'Sin contraseña que inventar ni que olvidar.',
  },
  // No policy exists yet, so no link is rendered — a dead link on a form
  // collecting an email and a phone number is worse than none
  // (design-record.md, answered open question 1). The sentence stands alone,
  // and `adopt.astro` marks the single place a link goes when there is one.
  privacy: {
    en: 'Only your username and initials appear on the plaque. Your email and phone are never shown publicly.',
    es: 'En la placa solo aparecen tu nombre de usuario y tus iniciales. Tu correo y tu teléfono nunca se muestran en público.',
  },
  submit: { en: 'PUT MY NAME ON IT', es: 'PON MI NOMBRE' },
  full: {
    en: 'Both slots are taken. This bed has the people it needs — but others on the block are still waiting.',
    es: 'Los dos lugares están ocupados. Este cantero ya tiene quien lo cuide, pero otros de la cuadra siguen esperando.',
  },
  // A bed with slots built but not OFFERED on the admin page (`offeredSlots`).
  // "Both slots are taken" would be a lie there, and this screen is only
  // reachable by typing the URL — the door screen shows no invitation at all.
  noOpenSlot: {
    en: 'There’s no open slot on this bed right now — but others on the block are still waiting, and this one still needs eyes on it.',
    es: 'Ahora mismo no hay ningún lugar libre en este cantero, pero otros de la cuadra siguen esperando y este sigue necesitando quien lo mire.',
  },
  slotsJustFilled: {
    en: 'Both slots just filled up. This bed has the people it needs.',
    es: 'Los dos lugares se acaban de ocupar. Este cantero ya tiene quien lo cuide.',
  },
} satisfies Record<string, Phrase>;

/** Field-level validation messages. Same keys as `AdoptErrorCode`. */
export const ADOPT_ERRORS = {
  firstName: { en: 'Tell us your first name.', es: 'Dinos tu nombre.' },
  lastName: { en: 'Tell us your last name.', es: 'Dinos tu apellido.' },
  email: { en: 'That email doesn’t look right.', es: 'Ese correo no parece correcto.' },
  phone: { en: 'That phone number doesn’t look right.', es: 'Ese teléfono no parece correcto.' },
} satisfies Record<string, Phrase>;

/** The full-screen purple moment straight after signing up. */
export const ADOPTED_TAKEOVER = {
  big: { en: 'Adopted!', es: '¡Adoptado!' },
  subBefore: { en: 'This ', es: 'Este ' },
  subAfter: { en: ' is yours to look after.', es: ' queda a tu cuidado.' },
  // Uppercase like every other button in this identity; the arrow belongs
  // to the Barlow ghost links, not to a Londrina button.
  onward: { en: 'SEE YOUR BED', es: 'VER TU CANTERO' },
} satisfies Record<string, Phrase>;

/** The problem picker, and the sentence box behind "something else". */
export const CARE = {
  title: { en: "What's the matter?", es: '¿Qué pasa?' },
  noteTitle: { en: "What's going on?", es: '¿Qué está pasando?' },
  noteHelp: {
    en: 'A sentence is plenty. Whoever comes to look will read it.',
    es: 'Con una frase basta. Quien venga a mirar lo leerá.',
  },
  notePlaceholder: {
    en: 'The guard is bent where a car hit it, and the soil has washed out on that side.',
    es: 'El protector está doblado donde lo golpeó un carro y la tierra se lavó por ese lado.',
  },
  photoHelp: {
    en: 'Add a photo if you can — it helps whoever comes to clear it.',
    es: 'Añade una foto si puedes: le ayuda a quien venga a arreglarlo.',
  },
  pickOne: { en: 'Pick one to send it.', es: 'Elige una para enviarlo.' },
} satisfies Record<string, Phrase>;

/** The full-screen green moment after a report or an applause. */
export const THANKS_TAKEOVER = {
  reported: { en: 'Thank you.', es: 'Gracias.' },
  applauded: { en: 'Applause sent.', es: 'Aplauso enviado.' },
  applaudedSub: {
    en: 'They will hear that somebody noticed.',
    es: 'Sabrán que alguien se dio cuenta.',
  },
} satisfies Record<string, Phrase>;

/** A well-formed tag ID no binding speaks for — a normal state, not an error. */
export const UNBOUND = {
  title: {
    en: "This tag isn't assigned to a bed yet.",
    es: 'Esta etiqueta todavía no está asignada a un cantero.',
  },
  body: {
    en: "The tag works — it just hasn't been matched to a spot on the street yet. If it's mounted somewhere, the crew that placed it will hook it up soon.",
    es: 'La etiqueta funciona, solo que aún no se ha emparejado con un sitio en la calle. Si ya está puesta, el equipo que la colocó la conectará pronto.',
  },
  tagLabel: { en: 'TAG', es: 'ETIQUETA' },
} satisfies Record<string, Phrase>;

/** Where a refused upload lands. */
export const TOO_LARGE = {
  tabOverLimit: { en: 'Photo too large', es: 'Foto demasiado grande' },
  tabBusy: { en: 'Tag busy', es: 'Etiqueta ocupada' },
  tabIncomplete: { en: "Upload didn't finish", es: 'La subida no terminó' },
  titleOverLimit: { en: 'That photo was too large.', es: 'Esa foto era demasiado grande.' },
  titleBusy: { en: 'The tag is busy right now.', es: 'La etiqueta está ocupada ahora mismo.' },
  titleIncomplete: { en: "That upload didn't finish.", es: 'Esa subida no terminó.' },
  standing: {
    en: 'NOTHING SENT YET · WHAT YOU PICKED IS STILL YOURS TO SEND',
    es: 'AÚN NO SE HA ENVIADO NADA · LO QUE ELEGISTE SIGUE SIENDO TUYO PARA ENVIAR',
  },
  bodyOverLimit: {
    en: "Photos this large don't make it through the tag. The photo is optional — what you told us is the part that gets someone out here.",
    es: 'Las fotos de este tamaño no pasan por la etiqueta. La foto es opcional: lo que nos dijiste es lo que hace que alguien venga.',
  },
  bodyBusy: {
    en: 'Too many uploads landed on the tag at once. Nothing was lost — send it again and it goes into the queue.',
    es: 'Llegaron demasiadas subidas a la etiqueta a la vez. No se perdió nada: envíalo otra vez y entra en la cola.',
  },
  bodyIncomplete: {
    en: 'The photo stopped coming through before all of it arrived. The photo is optional — what you told us is the part that gets someone out here.',
    es: 'La foto dejó de llegar antes de completarse. La foto es opcional: lo que nos dijiste es lo que hace que alguien venga.',
  },
  youPicked: { en: 'You picked', es: 'Elegiste' },
  sendWithout: { en: 'SEND IT WITHOUT THE PHOTO', es: 'ENVIAR SIN LA FOTO' },
  sendAgain: { en: 'SEND IT AGAIN', es: 'ENVIAR OTRA VEZ' },
  pickAgain: { en: 'PICK IT AGAIN', es: 'ELEGIR OTRA VEZ' },
  back: { en: 'Back to the bed', es: 'Volver al cantero' },
} satisfies Record<string, Phrase>;

/**
 * Sign-in, for a steward coming back.
 *
 * Pre-existing, and untouched on purpose: the captain's passwordless decision
 * removes the secret from the ADOPT form, and migrating these screens to a
 * tap-to-sign-in link is `adopt-name-split-r5`. Nobody created by the new
 * adopt form has a PIN, so nobody created by it can use this screen yet.
 */
export const AUTH = {
  title: { en: 'Sign in', es: 'Entrar' },
  username: { en: 'Username', es: 'Nombre de usuario' },
  pin: { en: 'PIN', es: 'PIN' },
  sub: {
    en: 'Your username and the PIN you picked.',
    es: 'Tu nombre de usuario y el PIN que elegiste.',
  },
  submit: { en: 'SIGN IN', es: 'ENTRAR' },
  bad: { en: 'Username and PIN don’t match.', es: 'El nombre de usuario y el PIN no coinciden.' },
  busy: {
    en: 'Too many people are signing in at once. Give it a moment and try again.',
    es: 'Demasiada gente está entrando a la vez. Espera un momento e inténtalo otra vez.',
  },
} satisfies Record<string, Phrase>;

/**
 * The block admin — every string, both languages, like every other screen
 * (design-record.md, constraint 11): the captain reads it, and so does
 * whoever the captain hands a phone to on the sidewalk.
 *
 * Three values are identical in both languages and legitimately so — "ADMIN",
 * "NFC" and "DEMO" are the same words in the Spanish of this block — and
 * tests/i18n.test.ts names each one, so anything else identical still fails.
 */
export const ADMIN = {
  /** After the wordmark in the admin bar: TRASH TALK NYC · ADMIN. */
  adminLabel: { en: 'ADMIN', es: 'ADMIN' },
  signInTitle: { en: 'Admin', es: 'Administración' },
  signInSub: {
    en: 'This page holds stewards’ contact details. Enter the admin key to open it.',
    es: 'Esta página guarda los datos de contacto de quienes cuidan los canteros. Escribe la clave de administración para abrirla.',
  },
  keyLabel: { en: 'Admin key', es: 'Clave de administración' },
  signInSubmit: { en: 'OPEN THE ADMIN', es: 'ABRIR LA ADMINISTRACIÓN' },
  /** In the admin bar on every admin screen: the way back out of the PII. */
  signOut: { en: 'SIGN OUT', es: 'CERRAR SESIÓN' },
  badKey: { en: 'That key doesn’t open this.', es: 'Esa clave no abre esto.' },
  blocksTitle: { en: 'Blocks', es: 'Cuadras' },
  demoBadge: { en: 'DEMO', es: 'DEMO' },
  refAddress: { en: 'Reference address', es: 'Dirección de referencia' },
  addBed: { en: '+ ADD A BED', es: '+ AÑADIR UN CANTERO' },
  legendAdopted: { en: 'Adopted', es: 'Adoptado' },
  legendOpen: { en: 'Open for adoption', es: 'En adopción' },
  legendClosed: { en: 'Closed / not yet offered', es: 'Cerrado / aún no ofrecido' },
  badgeNfc: { en: 'NFC ADOPTED', es: 'ADOPTADO NFC' },
  badgePaper: { en: 'PEN & PAPER ADOPTED', es: 'ADOPTADO EN PAPEL' },
  badgeNfcShort: { en: 'NFC', es: 'NFC' },
  badgePaperShort: { en: 'PEN', es: 'PAPEL' },
  badgeOpen: { en: 'OPEN', es: 'EN ADOPCIÓN' },
  badgeClosed: { en: 'NOT OPEN', es: 'CERRADO' },
  /** The bed list's small line: which guard state the bed is in. */
  guardOrdered: { en: 'guard ordered', es: 'protector pedido' },
  guardInstalled: { en: 'guard installed', es: 'protector instalado' },
  guardNone: { en: 'no guard', es: 'sin protector' },
  guardToggle: { en: 'Guard installed', es: 'Protector instalado' },
  guardToggleSub: { en: 'Marks the bed as protected', es: 'Marca el cantero como protegido' },
  /** `#<NYC id> · ours BED-…` — the one surface that shows our plate. */
  oursLabel: { en: 'ours', es: 'la nuestra' },
  /**
   * A bed with no NYC planting space matched. Explicitly unresolved — the
   * admin never invents a number, and this is what it says instead.
   */
  nycUnresolved: { en: 'NYC bed not matched yet', es: 'Cantero NYC sin emparejar todavía' },
  slotWord: { en: 'Slot', es: 'Lugar' },
  slotOpen: { en: 'open for adoption', es: 'en adopción' },
  slotNotOffered: { en: 'not offered', es: 'no ofrecido' },
  addSlot: { en: '+ ADD SLOT', es: '+ AÑADIR LUGAR' },
  stewardHint: {
    en: 'Open a steward for their full name, email and phone.',
    es: 'Abre a una persona para ver su nombre completo, correo y teléfono.',
  },
  addStewardLink: { en: '+ ADD A STEWARD', es: '+ AÑADIR A ALGUIEN' },
  /** The steward detail's "how they came to be here" row. */
  kvKind: { en: 'Signed up', es: 'Se apuntó' },
  save: { en: 'SAVE CHANGES', es: 'GUARDAR CAMBIOS' },
  noUnsaved: { en: 'No unsaved changes', es: 'No hay cambios sin guardar' },
  unsaved: { en: 'Unsaved changes', es: 'Hay cambios sin guardar' },
  saved: { en: 'Changes saved', es: 'Cambios guardados' },
  piiNote: {
    en: 'Contact details are admin-only. They are never rendered on the public plaque — a passer-by sees a username and initials, nothing more.',
    es: 'Los datos de contacto son solo para la administración. Nunca aparecen en la placa pública: quien pasa ve un nombre de usuario y unas iniciales, nada más.',
  },
  selectBed: { en: 'Open a bed to edit it.', es: 'Abre un cantero para editarlo.' },
  /** Steward detail: how this steward came to be on the bed. */
  kindNfc: { en: 'Adopted at the tag (NFC)', es: 'Adoptado en la etiqueta (NFC)' },
  kindPaper: { en: 'Written in — pen & paper', es: 'Anotado a mano — en papel' },
  noContactValue: { en: 'none', es: 'ninguno' },
  noEmailNote: {
    en: 'No email — they cannot sign in, and the record is held on their behalf. A missing email is never consent to be contacted.',
    es: 'Sin correo: no puede iniciar sesión y el registro se guarda en su nombre. Que falte el correo nunca es permiso para contactar.',
  },
  addStewardTitle: { en: 'Add a steward', es: 'Añadir a alguien que lo cuide' },
  addStewardBody: {
    en: 'They said yes on the sidewalk. Their tag still works for reporting care.',
    es: 'Dijo que sí en la acera. Su etiqueta sigue sirviendo para reportar cuidados.',
  },
  optionalHere: { en: 'optional here', es: 'opcional aquí' },
  noEmailWarning: {
    en: 'Without an email they cannot sign in later — you would be looking after the record for them.',
    es: 'Sin correo no podrá iniciar sesión más adelante: tú te encargarías de su registro.',
  },
  addStewardSubmit: { en: 'ADD AS PEN & PAPER', es: 'AÑADIR EN PAPEL' },
  usernameTaken: { en: 'That username is taken.', es: 'Ese nombre de usuario ya está en uso.' },
  usernameInvalid: {
    en: 'Usernames are lowercase letters, numbers and underscores.',
    es: 'Los nombres de usuario llevan minúsculas, números y guiones bajos.',
  },
  bedFull: {
    en: 'Every slot on this bed is filled.',
    es: 'Todos los lugares de este cantero están ocupados.',
  },
  addBedTitle: { en: 'Add a bed', es: 'Añadir un cantero' },
  addBedBody: {
    en: 'A new bed starts closed, with one slot, no guard and no NYC number — the NYC bed is matched from the city’s own data, never typed.',
    es: 'Un cantero nuevo empieza cerrado, con un lugar, sin protector y sin número NYC: el cantero NYC se empareja con los datos de la ciudad, nunca se escribe a mano.',
  },
  treeTypeEn: { en: 'Tree type (English)', es: 'Tipo de árbol (inglés)' },
  treeTypeEs: { en: 'Tree type (Spanish)', es: 'Tipo de árbol (español)' },
  addBedSubmit: { en: 'ADD THE BED', es: 'AÑADIR EL CANTERO' },
  treeTypeMissing: { en: 'Name the tree.', es: 'Dinos el árbol.' },
  /**
   * A slot selection with a gap in it. `offeredSlots` is a count covering
   * slots 1..n, so the switches have to run from the first open one — saving
   * the size of a gapped selection would re-render a switch nobody flipped.
   */
  slotsNotContiguous: {
    en: 'Open slots run in order. Switch on the first free slot before the one after it.',
    es: 'Los lugares se abren en orden. Enciende el primer lugar libre antes del siguiente.',
  },
} satisfies Record<string, Phrase>;

/** The steward's own view of their bed. */
export const MINE = {
  yourBed: { en: 'YOUR BED', es: 'TU CANTERO' },
  streak: { en: 'week photo streak', es: 'semanas seguidas con foto' },
  points: { en: 'club points', es: 'puntos del club' },
  openReport: { en: 'SOMEONE REPORTED THIS', es: 'ALGUIEN LO REPORTÓ' },
  cleared: { en: 'CLEAR · YOU SORTED IT', es: 'RESUELTO · TÚ LO ARREGLASTE' },
  alsoSaid: { en: 'NEIGHBOURS ALSO SAID', es: 'LOS VECINOS TAMBIÉN DIJERON' },
  alsoReported: { en: 'reported this as', es: 'lo reportó como' },
  clearIt: { en: 'I SORTED IT — CLOSE THE REPORT', es: 'YA LO ARREGLÉ — CERRAR EL REPORTE' },
  givePhoto: { en: "GIVE THIS WEEK'S PHOTO", es: 'SUBE LA FOTO DE ESTA SEMANA' },
  photoIn: { en: 'PHOTO IN THIS WEEK ✓', es: 'FOTO DE ESTA SEMANA ✓' },
} satisfies Record<string, Phrase>;
