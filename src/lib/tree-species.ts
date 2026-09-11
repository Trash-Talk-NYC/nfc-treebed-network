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
 * close. Values are lowercase ("roble sauce"), because the door frame puts
 * them mid-sentence — "El cantero de este roble sauce…" — where a capital
 * would be ungrammatical; proper nouns inside a name keep theirs ("roble de
 * Shumard"). The checked-in seeds in store-dataset.ts follow the same rule.
 */

/** The generic wording an unknown species degrades to — never a guess. */
export const GENERIC_TREE = { en: 'tree', es: 'árbol' } as const;

/**
 * Keys are stored pre-normalized (see `normalizeCommonName`);
 * tests/tree-species.test.ts fails a key that isn't its own normalization.
 */
const SPANISH_BY_COMMON_NAME: Record<string, string> = {
  // Oaks — the captain's own block is willow oaks plus one white oak.
  oak: 'roble',
  'willow oak': 'roble sauce',
  'white oak': 'roble blanco',
  'pin oak': 'roble palustre',
  'northern red oak': 'roble rojo',
  'red oak': 'roble rojo',
  'scarlet oak': 'roble escarlata',
  'black oak': 'roble negro',
  'swamp white oak': 'roble blanco de los pantanos',
  'bur oak': 'roble bur',
  'english oak': 'roble inglés',
  'sawtooth oak': 'roble de dientes de sierra',
  'shumard oak': 'roble de Shumard',
  'chestnut oak': 'roble castaño',

  // Maples.
  maple: 'arce',
  'norway maple': 'arce noruego',
  // 'Crimson King' is a Norway maple cultivar; the census lists it apart.
  'crimson king maple': 'arce noruego',
  'red maple': 'arce rojo',
  'silver maple': 'arce plateado',
  'sugar maple': 'arce azucarero',
  'black maple': 'arce negro',
  'japanese maple': 'arce japonés',
  'amur maple': 'arce del Amur',
  'hedge maple': 'arce campestre',
  // Also "falso plátano"; "arce blanco" keeps the genus audible.
  'sycamore maple': 'arce blanco',
  boxelder: 'arce negundo',
  'box elder': 'arce negundo',
  'paperbark maple': 'arce de corteza de papel',
  'trident maple': 'arce tridente',

  // Planes — NYC's most numerous street tree.
  'london planetree': 'plátano de Londres',
  'london plane': 'plátano de Londres',
  // Also "sicomoro americano"; kept beside "plátano de Londres" so the two
  // planes read as kin.
  'american sycamore': 'plátano americano',
  sycamore: 'plátano americano',

  // Lindens.
  linden: 'tilo',
  'littleleaf linden': 'tilo de hoja pequeña',
  'american linden': 'tilo americano',
  basswood: 'tilo americano',
  'silver linden': 'tilo plateado',
  'crimean linden': 'tilo de Crimea',
  'european linden': 'tilo europeo',

  // Elms.
  elm: 'olmo',
  'american elm': 'olmo americano',
  'chinese elm': 'olmo chino',
  'siberian elm': 'olmo siberiano',
  'english elm': 'olmo inglés',
  'slippery elm': 'olmo rojo',

  // Ashes.
  ash: 'fresno',
  'green ash': 'fresno verde',
  'white ash': 'fresno blanco',
  'black ash': 'fresno negro',
  'european ash': 'fresno común',

  // Rosaceae: pears, cherries, plums and their kin.
  'callery pear': 'peral de Callery',
  pear: 'peral',
  'crab apple': 'manzano silvestre',
  crabapple: 'manzano silvestre',
  apple: 'manzano',
  cherry: 'cerezo',
  'japanese flowering cherry': 'cerezo japonés',
  // Kwanzan is a Prunus serrulata cultivar.
  'kwanzan cherry': 'cerezo japonés',
  'yoshino cherry': 'cerezo de Yoshino',
  'black cherry': 'cerezo negro',
  chokecherry: 'cerezo de Virginia',
  'schubert chokecherry': 'cerezo de Virginia',
  // Also "ciruelo mirobolano"; "rojo" is what nurseries actually say.
  'purple leaf plum': 'ciruelo rojo',
  plum: 'ciruelo',
  // "duraznero" over Spain's "melocotonero": it is the word on this block.
  peach: 'duraznero',
  hawthorn: 'espino',

  // Ginkgo.
  ginkgo: 'ginkgo',

  // Conifers.
  pine: 'pino',
  'eastern white pine': 'pino blanco americano',
  'white pine': 'pino blanco americano',
  'austrian pine': 'pino austríaco',
  'japanese black pine': 'pino negro japonés',
  'scots pine': 'pino silvestre',
  'red pine': 'pino rojo',
  baldcypress: 'ciprés calvo',
  'bald cypress': 'ciprés calvo',
  'eastern redcedar': 'enebro de Virginia',
  'atlas cedar': 'cedro del Atlas',
  'deodar cedar': 'cedro del Himalaya',
  cedar: 'cedro',
  fir: 'abeto',
  larch: 'alerce',
  'european larch': 'alerce europeo',
  tamarack: 'alerce americano',

  // Everything else NYC plants, alphabetical by English name.
  'american chestnut': 'castaño americano',
  'american holly': 'acebo americano',
  'american hornbeam': 'carpe americano',
  'amur cork tree': 'árbol del corcho del Amur',
  'amur corktree': 'árbol del corcho del Amur',
  blackgum: 'tupelo',
  'black gum': 'tupelo',
  'black tupelo': 'tupelo',
  'black walnut': 'nogal negro',
  'black willow': 'sauce negro',
  birch: 'abedul',
  butternut: 'nogal ceniciento',
  'chinese chestnut': 'castaño chino',
  'cornelian cherry': 'cornejo macho',
  cottonwood: 'álamo',
  'crepe myrtle': 'árbol de Júpiter',
  'crape myrtle': 'árbol de Júpiter',
  dogwood: 'cornejo',
  'eastern cottonwood': 'álamo americano',
  'eastern redbud': 'ciclamor canadiense',
  'english walnut': 'nogal común',
  'european hornbeam': 'carpe europeo',
  'european white birch': 'abedul común',
  'flowering dogwood': 'cornejo florido',
  'golden raintree': 'jabonero de la China',
  'goldenrain tree': 'jabonero de la China',
  'gray birch': 'abedul gris',
  hackberry: 'almez americano',
  'common hackberry': 'almez americano',
  holly: 'acebo',
  hornbeam: 'carpe',
  'horse chestnut': 'castaño de Indias',
  horsechestnut: 'castaño de Indias',
  'japanese pagoda tree': 'árbol de las pagodas',
  'japanese tree lilac': 'lilo japonés',
  'kentucky coffeetree': 'árbol del café de Kentucky',
  'kousa dogwood': 'cornejo japonés',
  'lombardy poplar': 'álamo de Lombardía',
  magnolia: 'magnolio',
  mimosa: 'árbol de la seda',
  'osage orange': 'naranjo de Osage',
  'pagoda tree': 'árbol de las pagodas',
  'paper birch': 'abedul de papel',
  persimmon: 'caqui americano',
  'common persimmon': 'caqui americano',
  poplar: 'álamo',
  'quaking aspen': 'álamo temblón',
  'red horse chestnut': 'castaño de Indias rojo',
  'river birch': 'abedul de río',
  sassafras: 'sasafrás',
  'saucer magnolia': 'magnolio chino',
  'scholar tree': 'árbol de las pagodas',
  'silk tree': 'árbol de la seda',
  sophora: 'árbol de las pagodas',
  'southern magnolia': 'magnolio',
  'sweetbay magnolia': 'magnolio',
  sweetgum: 'liquidámbar',
  'sweet gum': 'liquidámbar',
  'tree of heaven': 'ailanto',
  'tulip poplar': 'tulipanero',
  'tulip tree': 'tulipanero',
  tuliptree: 'tulipanero',
  'turkish hazelnut': 'avellano turco',
  walnut: 'nogal',
  'weeping willow': 'sauce llorón',
  'white birch': 'abedul blanco',
  'white poplar': 'álamo blanco',
  willow: 'sauce',
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
