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
//  - the wordmark, the signup URL and the bed's locality. Those are the bed's,
//    not the product's, and come from `presentation.ts`.

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
  username: { en: 'Username', es: 'Nombre de usuario' },
  pin: { en: 'PIN', es: 'PIN' },
  email: { en: 'Email', es: 'Correo electrónico' },
  phone: { en: 'Phone', es: 'Teléfono' },
  pinHelp: {
    en: "Pick a PIN to sign in later — 4 to 8 digits. It's the only thing you'll need to remember.",
    es: 'Elige un PIN para entrar después: de 4 a 8 dígitos. Es lo único que tendrás que recordar.',
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
  slotsJustFilled: {
    en: 'Both slots just filled up. This bed has the people it needs.',
    es: 'Los dos lugares se acaban de ocupar. Este cantero ya tiene quien lo cuide.',
  },
  busy: {
    en: 'Too many people are signing up at once. Give it a moment and try again.',
    es: 'Demasiada gente se está registrando a la vez. Espera un momento e inténtalo otra vez.',
  },
} satisfies Record<string, Phrase>;

/** Field-level validation messages. Same keys as `AdoptInput`. */
export const ADOPT_ERRORS = {
  firstName: { en: 'Tell us your first name.', es: 'Dinos tu nombre.' },
  lastName: { en: 'Tell us your last name.', es: 'Dinos tu apellido.' },
  username: {
    en: 'Usernames are 2–24 letters, numbers, or underscores.',
    es: 'El nombre de usuario lleva de 2 a 24 letras, números o guiones bajos.',
  },
  usernameTaken: { en: 'That username is taken.', es: 'Ese nombre de usuario ya está en uso.' },
  pin: { en: 'PIN must be 4–8 digits.', es: 'El PIN debe tener de 4 a 8 dígitos.' },
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
  signupBefore: {
    en: 'Want to hear about tree guard builds and neighborhood cleanups? Sign up at ',
    es: '¿Quieres enterarte de los armados de protectores y las limpiezas del barrio? Apúntate en ',
  },
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

/** Sign-in, for a steward coming back. */
export const AUTH = {
  title: { en: 'Sign in', es: 'Entrar' },
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

/** The steward's own view of their bed. */
export const MINE = {
  yourBed: { en: 'YOUR BED', es: 'TU CANTERO' },
  streak: { en: 'week photo streak', es: 'semanas seguidas con foto' },
  points: { en: 'club points', es: 'puntos del club' },
  openReport: { en: 'SOMEONE REPORTED THIS', es: 'ALGUIEN LO REPORTÓ' },
  cleared: { en: 'CLEAR · YOU SORTED IT', es: 'RESUELTO · TÚ LO ARREGLASTE' },
  clearIt: { en: 'I SORTED IT — CLOSE THE REPORT', es: 'YA LO ARREGLÉ — CERRAR EL REPORTE' },
  givePhoto: { en: "GIVE THIS WEEK'S PHOTO", es: 'SUBE LA FOTO DE ESTA SEMANA' },
  photoIn: { en: 'PHOTO IN THIS WEEK ✓', es: 'FOTO DE ESTA SEMANA ✓' },
} satisfies Record<string, Phrase>;
