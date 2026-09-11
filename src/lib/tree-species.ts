/**
 * English → Spanish street-tree species names, checked in like the tag
 * registry: a table the team curates, not something any runtime translates.
 *
 * Why it exists: `Bed.treeType` is bilingual because the door headline is,
 * and NYC's own data supplies only the ENGLISH common name. Without this
 * table every bed added on the admin page asked a human for a Spanish
 * species name they'd have to go and look up.
 *
 * Why it is a table and not a translation call: the name renders inside a
 * sentence on a public screen on the neighbour's own street. A wrong species
 * name there is worse than a generic one, so an English name this table does
 * not know falls back to the generic "árbol" (the same wording
 * `normalizeData` uses for a bed with no tree type at all) — it never
 * guesses, transliterates, or calls out to a translator.
 *
 * What the set covers: the common names in NYC's 2015 street tree census
 * (`spc_common` on dataset uvpi-gqnh) and NYC Parks' street-tree planting
 * lists, plus the species already seeded in this repo (willow oak, white
 * oak) and the frequent spelling variants of each ("tulip tree" /
 * "tulip-poplar"). Matching is tolerant of case, incidental whitespace,
 * hyphens and cultivar quotes — and of nothing else, so a name the table
 * doesn't know stays unknown rather than half-matching a different species.
 *
 * The gender constraint, load-bearing: the Spanish door frame is fixed copy
 * — "El cantero de este <especie>…" (copy.ts) — so every name here must sit
 * naturally after the masculine "este". Species whose accepted Spanish names
 * are all feminine are deliberately ABSENT and take the generic fallback:
 * honeylocust (la acacia de tres espinas), black locust (la falsa acacia),
 * mulberry (la morera), catalpa (la catalpa), zelkova (la zelkova), beech
 * (el haya, but "esta haya"), the spruces (la pícea) and dawn redwood (la
 * metasecuoya). Adding one of those means first teaching the door copy
 * gender agreement, not bending the name. Serviceberry and paulownia are
 * absent for the other reason a name can be wrong: their dictionary names
 * ("guillomo", "kiri") are not names Spanish-speaking New Yorkers use.
 *
 * Where a species has more than one accepted Spanish name, the value is the
 * one most transparent to the Caribbean and Mexican Spanish spoken around
 * Washington Heights; the alternatives are noted inline where the choice was
 * close. Values are capitalized like the seed's ("Roble sauce") — the door
 * highlight picks the species out of the sentence either way.
 */

/** The generic wording an unknown species degrades to — never a guess. */
export const GENERIC_TREE = { en: 'tree', es: 'árbol' } as const;

/**
 * Keys are stored pre-normalized (see `normalizeCommonName`);
 * tests/tree-species.test.ts fails a key that isn't its own normalization.
 */
const SPANISH_BY_COMMON_NAME: Record<string, string> = {
  // Oaks — the captain's own block is willow oaks plus one white oak.
  oak: 'Roble',
  'willow oak': 'Roble sauce',
  'white oak': 'Roble blanco',
  'pin oak': 'Roble palustre',
  'northern red oak': 'Roble rojo',
  'red oak': 'Roble rojo',
  'scarlet oak': 'Roble escarlata',
  'black oak': 'Roble negro',
  'swamp white oak': 'Roble blanco de los pantanos',
  'bur oak': 'Roble bur',
  'english oak': 'Roble inglés',
  'sawtooth oak': 'Roble de dientes de sierra',
  'shumard oak': 'Roble de Shumard',
  'chestnut oak': 'Roble castaño',

  // Maples.
  maple: 'Arce',
  'norway maple': 'Arce noruego',
  // 'Crimson King' is a Norway maple cultivar; the census lists it apart.
  'crimson king maple': 'Arce noruego',
  'red maple': 'Arce rojo',
  'silver maple': 'Arce plateado',
  'sugar maple': 'Arce azucarero',
  'black maple': 'Arce negro',
  'japanese maple': 'Arce japonés',
  'amur maple': 'Arce del Amur',
  'hedge maple': 'Arce campestre',
  // Also "falso plátano"; "arce blanco" keeps the genus audible.
  'sycamore maple': 'Arce blanco',
  boxelder: 'Arce negundo',
  'box elder': 'Arce negundo',
  'paperbark maple': 'Arce de corteza de papel',
  'trident maple': 'Arce tridente',

  // Planes — NYC's most numerous street tree.
  'london planetree': 'Plátano de Londres',
  'london plane': 'Plátano de Londres',
  // Also "sicomoro americano"; kept beside "Plátano de Londres" so the two
  // planes read as kin.
  'american sycamore': 'Plátano americano',
  sycamore: 'Plátano americano',

  // Lindens.
  linden: 'Tilo',
  'littleleaf linden': 'Tilo de hoja pequeña',
  'american linden': 'Tilo americano',
  basswood: 'Tilo americano',
  'silver linden': 'Tilo plateado',
  'crimean linden': 'Tilo de Crimea',
  'european linden': 'Tilo europeo',

  // Elms.
  elm: 'Olmo',
  'american elm': 'Olmo americano',
  'chinese elm': 'Olmo chino',
  'siberian elm': 'Olmo siberiano',
  'english elm': 'Olmo inglés',
  'slippery elm': 'Olmo rojo',

  // Ashes.
  ash: 'Fresno',
  'green ash': 'Fresno verde',
  'white ash': 'Fresno blanco',
  'black ash': 'Fresno negro',
  'european ash': 'Fresno común',

  // Rosaceae: pears, cherries, plums and their kin.
  'callery pear': 'Peral de Callery',
  pear: 'Peral',
  'crab apple': 'Manzano silvestre',
  crabapple: 'Manzano silvestre',
  apple: 'Manzano',
  cherry: 'Cerezo',
  'japanese flowering cherry': 'Cerezo japonés',
  // Kwanzan is a Prunus serrulata cultivar.
  'kwanzan cherry': 'Cerezo japonés',
  'yoshino cherry': 'Cerezo de Yoshino',
  'black cherry': 'Cerezo negro',
  chokecherry: 'Cerezo de Virginia',
  'schubert chokecherry': 'Cerezo de Virginia',
  // Also "ciruelo mirobolano"; "rojo" is what nurseries actually say.
  'purple leaf plum': 'Ciruelo rojo',
  plum: 'Ciruelo',
  // "Duraznero" over Spain's "melocotonero": it is the word on this block.
  peach: 'Duraznero',
  hawthorn: 'Espino',

  // Ginkgo.
  ginkgo: 'Ginkgo',

  // Conifers.
  pine: 'Pino',
  'eastern white pine': 'Pino blanco americano',
  'white pine': 'Pino blanco americano',
  'austrian pine': 'Pino austríaco',
  'japanese black pine': 'Pino negro japonés',
  'scots pine': 'Pino silvestre',
  'red pine': 'Pino rojo',
  baldcypress: 'Ciprés calvo',
  'bald cypress': 'Ciprés calvo',
  'eastern redcedar': 'Enebro de Virginia',
  'atlas cedar': 'Cedro del Atlas',
  'deodar cedar': 'Cedro del Himalaya',
  cedar: 'Cedro',
  fir: 'Abeto',
  larch: 'Alerce',
  'european larch': 'Alerce europeo',
  tamarack: 'Alerce americano',

  // Everything else NYC plants, alphabetical by English name.
  'american chestnut': 'Castaño americano',
  'american holly': 'Acebo americano',
  'american hornbeam': 'Carpe americano',
  'amur cork tree': 'Árbol del corcho del Amur',
  'amur corktree': 'Árbol del corcho del Amur',
  blackgum: 'Tupelo',
  'black gum': 'Tupelo',
  'black tupelo': 'Tupelo',
  'black walnut': 'Nogal negro',
  'black willow': 'Sauce negro',
  birch: 'Abedul',
  butternut: 'Nogal ceniciento',
  'chinese chestnut': 'Castaño chino',
  'cornelian cherry': 'Cornejo macho',
  cottonwood: 'Álamo',
  'crepe myrtle': 'Árbol de Júpiter',
  'crape myrtle': 'Árbol de Júpiter',
  dogwood: 'Cornejo',
  'eastern cottonwood': 'Álamo americano',
  'eastern redbud': 'Ciclamor canadiense',
  'english walnut': 'Nogal común',
  'european hornbeam': 'Carpe europeo',
  'european white birch': 'Abedul común',
  'flowering dogwood': 'Cornejo florido',
  'golden raintree': 'Jabonero de la China',
  'goldenrain tree': 'Jabonero de la China',
  'gray birch': 'Abedul gris',
  hackberry: 'Almez americano',
  'common hackberry': 'Almez americano',
  holly: 'Acebo',
  hornbeam: 'Carpe',
  'horse chestnut': 'Castaño de Indias',
  horsechestnut: 'Castaño de Indias',
  'japanese pagoda tree': 'Árbol de las pagodas',
  'japanese tree lilac': 'Lilo japonés',
  'kentucky coffeetree': 'Árbol del café de Kentucky',
  'kousa dogwood': 'Cornejo japonés',
  'lombardy poplar': 'Álamo de Lombardía',
  magnolia: 'Magnolio',
  mimosa: 'Árbol de la seda',
  'osage orange': 'Naranjo de Osage',
  'pagoda tree': 'Árbol de las pagodas',
  'paper birch': 'Abedul de papel',
  persimmon: 'Caqui americano',
  'common persimmon': 'Caqui americano',
  poplar: 'Álamo',
  'quaking aspen': 'Álamo temblón',
  'red horse chestnut': 'Castaño de Indias rojo',
  'river birch': 'Abedul de río',
  sassafras: 'Sasafrás',
  'saucer magnolia': 'Magnolio chino',
  'scholar tree': 'Árbol de las pagodas',
  'silk tree': 'Árbol de la seda',
  sophora: 'Árbol de las pagodas',
  'southern magnolia': 'Magnolio',
  'sweetbay magnolia': 'Magnolio',
  sweetgum: 'Liquidámbar',
  'sweet gum': 'Liquidámbar',
  'tree of heaven': 'Ailanto',
  'tulip poplar': 'Tulipanero',
  'tulip tree': 'Tulipanero',
  tuliptree: 'Tulipanero',
  'turkish hazelnut': 'Avellano turco',
  walnut: 'Nogal',
  'weeping willow': 'Sauce llorón',
  'white birch': 'Abedul blanco',
  'white poplar': 'Álamo blanco',
  willow: 'Sauce',
};

/**
 * Case, incidental whitespace, hyphens and cultivar quotes carry no species
 * information in NYC's common names ("tulip-poplar" / "Tulip poplar",
 * "'Schubert' chokecherry"), so they are folded away. Nothing else is: a
 * plural, a typo or an unlisted name misses, and missing is the safe answer.
 */
function normalizeCommonName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['‘’]/g, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The Spanish species name for an English common name, or null for one the
 * table does not know — the caller degrades to `GENERIC_TREE.es`, it never
 * invents a name.
 */
export function spanishSpeciesFor(englishCommonName: string): string | null {
  return SPANISH_BY_COMMON_NAME[normalizeCommonName(englishCommonName)] ?? null;
}

/** For the tests that hold every entry to the table's own rules. */
export function speciesTableEntries(): ReadonlyArray<[string, string]> {
  return Object.entries(SPANISH_BY_COMMON_NAME);
}

export { normalizeCommonName };
