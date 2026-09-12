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
 * close. Spanish values are lowercase ("roble sauce"), because the door
 * frame puts them mid-sentence — "El cantero de este roble sauce…" — where a
 * capital would be ungrammatical; proper nouns inside a name keep theirs
 * ("roble de Shumard").
 *
 * The ENGLISH name is authored here too, and for the opposite reason: its
 * frame is mid-sentence as well ("This willow oak's bed…"), but English
 * common names are full of proper adjectives that keep their capital there —
 * Norway maple, Japanese zelkova, London planetree, Callery pear. No derived
 * rule can serve both languages, so each entry carries the casing it should
 * read WITH inside a sentence, and a species this table does not know is
 * stored and rendered exactly as the person typed it — never lowercased,
 * never capitalized, by us. Standalone surfaces capitalize at the render
 * site (`capitalizeFirst`, format.ts). The checked-in seeds in
 * checked-in-beds.ts carry what this table says for their species.
 */

/** The generic wording an unknown species degrades to — never a guess. */
export const GENERIC_TREE = { en: 'tree', es: 'árbol' } as const;

/** The table's own spelling of one species, both languages, mid-sentence. */
type SpeciesNames = readonly [en: string, es: string];

/**
 * Keys are stored pre-normalized (see `normalizeCommonName`);
 * tests/tree-species.test.ts fails a key that isn't its own normalization.
 */
const SPECIES_BY_COMMON_NAME: Record<string, SpeciesNames> = {
  // Oaks — the captain's own block is willow oaks plus one white oak.
  oak: ['oak', 'roble'],
  'willow oak': ['willow oak', 'roble sauce'],
  'white oak': ['white oak', 'roble blanco'],
  'pin oak': ['pin oak', 'roble palustre'],
  'northern red oak': ['northern red oak', 'roble rojo'],
  'red oak': ['red oak', 'roble rojo'],
  'scarlet oak': ['scarlet oak', 'roble escarlata'],
  'black oak': ['black oak', 'roble negro'],
  'swamp white oak': ['swamp white oak', 'roble blanco de los pantanos'],
  'bur oak': ['bur oak', 'roble bur'],
  'english oak': ['English oak', 'roble inglés'],
  'sawtooth oak': ['sawtooth oak', 'roble de dientes de sierra'],
  'shumard oak': ['Shumard oak', 'roble de Shumard'],
  'chestnut oak': ['chestnut oak', 'roble castaño'],

  // Maples.
  maple: ['maple', 'arce'],
  'norway maple': ['Norway maple', 'arce noruego'],
  // 'Crimson King' is a Norway maple cultivar; the census lists it apart.
  'crimson king maple': ['Crimson King maple', 'arce noruego'],
  'red maple': ['red maple', 'arce rojo'],
  'silver maple': ['silver maple', 'arce plateado'],
  'sugar maple': ['sugar maple', 'arce azucarero'],
  'black maple': ['black maple', 'arce negro'],
  'japanese maple': ['Japanese maple', 'arce japonés'],
  'amur maple': ['Amur maple', 'arce del Amur'],
  'hedge maple': ['hedge maple', 'arce campestre'],
  // Also "falso plátano"; "arce blanco" keeps the genus audible.
  'sycamore maple': ['sycamore maple', 'arce blanco'],
  boxelder: ['boxelder', 'arce negundo'],
  'box elder': ['box elder', 'arce negundo'],
  'paperbark maple': ['paperbark maple', 'arce de corteza de papel'],
  'trident maple': ['trident maple', 'arce tridente'],

  // Planes — NYC's most numerous street tree.
  'london planetree': ['London planetree', 'plátano de Londres'],
  'london plane': ['London plane', 'plátano de Londres'],
  // Also "sicomoro americano"; kept beside "plátano de Londres" so the two
  // planes read as kin.
  'american sycamore': ['American sycamore', 'plátano americano'],
  sycamore: ['sycamore', 'plátano americano'],

  // Lindens.
  linden: ['linden', 'tilo'],
  'littleleaf linden': ['littleleaf linden', 'tilo de hoja pequeña'],
  'american linden': ['American linden', 'tilo americano'],
  basswood: ['basswood', 'tilo americano'],
  'silver linden': ['silver linden', 'tilo plateado'],
  'crimean linden': ['Crimean linden', 'tilo de Crimea'],
  'european linden': ['European linden', 'tilo europeo'],

  // Elms.
  elm: ['elm', 'olmo'],
  'american elm': ['American elm', 'olmo americano'],
  'chinese elm': ['Chinese elm', 'olmo chino'],
  'siberian elm': ['Siberian elm', 'olmo siberiano'],
  'english elm': ['English elm', 'olmo inglés'],
  'slippery elm': ['slippery elm', 'olmo rojo'],

  // Ashes.
  ash: ['ash', 'fresno'],
  'green ash': ['green ash', 'fresno verde'],
  'white ash': ['white ash', 'fresno blanco'],
  'black ash': ['black ash', 'fresno negro'],
  'european ash': ['European ash', 'fresno común'],

  // Rosaceae: pears, cherries, plums and their kin.
  'callery pear': ['Callery pear', 'peral de Callery'],
  pear: ['pear', 'peral'],
  'crab apple': ['crab apple', 'manzano silvestre'],
  crabapple: ['crabapple', 'manzano silvestre'],
  apple: ['apple', 'manzano'],
  cherry: ['cherry', 'cerezo'],
  'japanese flowering cherry': ['Japanese flowering cherry', 'cerezo japonés'],
  // Kwanzan is a Prunus serrulata cultivar.
  'kwanzan cherry': ['Kwanzan cherry', 'cerezo japonés'],
  'yoshino cherry': ['Yoshino cherry', 'cerezo de Yoshino'],
  'black cherry': ['black cherry', 'cerezo negro'],
  chokecherry: ['chokecherry', 'cerezo de Virginia'],
  'schubert chokecherry': ['Schubert chokecherry', 'cerezo de Virginia'],
  // Also "ciruelo mirobolano"; "rojo" is what nurseries actually say.
  'purple leaf plum': ['purple leaf plum', 'ciruelo rojo'],
  plum: ['plum', 'ciruelo'],
  // "duraznero" over Spain's "melocotonero": it is the word on this block.
  peach: ['peach', 'duraznero'],
  hawthorn: ['hawthorn', 'espino'],

  // Ginkgo.
  ginkgo: ['ginkgo', 'ginkgo'],

  // Conifers.
  pine: ['pine', 'pino'],
  'eastern white pine': ['eastern white pine', 'pino blanco americano'],
  'white pine': ['white pine', 'pino blanco americano'],
  'austrian pine': ['Austrian pine', 'pino austríaco'],
  'japanese black pine': ['Japanese black pine', 'pino negro japonés'],
  'scots pine': ['Scots pine', 'pino silvestre'],
  'red pine': ['red pine', 'pino rojo'],
  baldcypress: ['baldcypress', 'ciprés calvo'],
  'bald cypress': ['bald cypress', 'ciprés calvo'],
  'eastern redcedar': ['eastern redcedar', 'enebro de Virginia'],
  'atlas cedar': ['Atlas cedar', 'cedro del Atlas'],
  'deodar cedar': ['deodar cedar', 'cedro del Himalaya'],
  cedar: ['cedar', 'cedro'],
  fir: ['fir', 'abeto'],
  larch: ['larch', 'alerce'],
  'european larch': ['European larch', 'alerce europeo'],
  tamarack: ['tamarack', 'alerce americano'],

  // Everything else NYC plants, alphabetical by English name.
  'american chestnut': ['American chestnut', 'castaño americano'],
  'american holly': ['American holly', 'acebo americano'],
  'american hornbeam': ['American hornbeam', 'carpe americano'],
  'amur cork tree': ['Amur cork tree', 'árbol del corcho del Amur'],
  'amur corktree': ['Amur corktree', 'árbol del corcho del Amur'],
  blackgum: ['blackgum', 'tupelo'],
  'black gum': ['black gum', 'tupelo'],
  'black tupelo': ['black tupelo', 'tupelo'],
  'black walnut': ['black walnut', 'nogal negro'],
  'black willow': ['black willow', 'sauce negro'],
  birch: ['birch', 'abedul'],
  butternut: ['butternut', 'nogal ceniciento'],
  'chinese chestnut': ['Chinese chestnut', 'castaño chino'],
  'cornelian cherry': ['Cornelian cherry', 'cornejo macho'],
  cottonwood: ['cottonwood', 'álamo'],
  'crepe myrtle': ['crepe myrtle', 'árbol de Júpiter'],
  'crape myrtle': ['crape myrtle', 'árbol de Júpiter'],
  dogwood: ['dogwood', 'cornejo'],
  'eastern cottonwood': ['eastern cottonwood', 'álamo americano'],
  'eastern redbud': ['eastern redbud', 'ciclamor canadiense'],
  'english walnut': ['English walnut', 'nogal común'],
  'european hornbeam': ['European hornbeam', 'carpe europeo'],
  'european white birch': ['European white birch', 'abedul común'],
  'flowering dogwood': ['flowering dogwood', 'cornejo florido'],
  'golden raintree': ['golden raintree', 'jabonero de la China'],
  'goldenrain tree': ['goldenrain tree', 'jabonero de la China'],
  'gray birch': ['gray birch', 'abedul gris'],
  hackberry: ['hackberry', 'almez americano'],
  'common hackberry': ['common hackberry', 'almez americano'],
  holly: ['holly', 'acebo'],
  hornbeam: ['hornbeam', 'carpe'],
  'horse chestnut': ['horse chestnut', 'castaño de Indias'],
  horsechestnut: ['horsechestnut', 'castaño de Indias'],
  'japanese pagoda tree': ['Japanese pagoda tree', 'árbol de las pagodas'],
  'japanese tree lilac': ['Japanese tree lilac', 'lilo japonés'],
  'kentucky coffeetree': ['Kentucky coffeetree', 'árbol del café de Kentucky'],
  'kousa dogwood': ['kousa dogwood', 'cornejo japonés'],
  'lombardy poplar': ['Lombardy poplar', 'álamo de Lombardía'],
  magnolia: ['magnolia', 'magnolio'],
  mimosa: ['mimosa', 'árbol de la seda'],
  'osage orange': ['Osage orange', 'naranjo de Osage'],
  'pagoda tree': ['pagoda tree', 'árbol de las pagodas'],
  'paper birch': ['paper birch', 'abedul de papel'],
  persimmon: ['persimmon', 'caqui americano'],
  'common persimmon': ['common persimmon', 'caqui americano'],
  poplar: ['poplar', 'álamo'],
  'quaking aspen': ['quaking aspen', 'álamo temblón'],
  'red horse chestnut': ['red horse chestnut', 'castaño de Indias rojo'],
  'river birch': ['river birch', 'abedul de río'],
  sassafras: ['sassafras', 'sasafrás'],
  'saucer magnolia': ['saucer magnolia', 'magnolio chino'],
  'scholar tree': ['scholar tree', 'árbol de las pagodas'],
  'silk tree': ['silk tree', 'árbol de la seda'],
  sophora: ['sophora', 'árbol de las pagodas'],
  'southern magnolia': ['southern magnolia', 'magnolio'],
  'sweetbay magnolia': ['sweetbay magnolia', 'magnolio'],
  sweetgum: ['sweetgum', 'liquidámbar'],
  'sweet gum': ['sweet gum', 'liquidámbar'],
  'tree of heaven': ['tree of heaven', 'ailanto'],
  'tulip poplar': ['tulip poplar', 'tulipanero'],
  'tulip tree': ['tulip tree', 'tulipanero'],
  tuliptree: ['tuliptree', 'tulipanero'],
  'turkish hazelnut': ['Turkish hazelnut', 'avellano turco'],
  walnut: ['walnut', 'nogal'],
  'weeping willow': ['weeping willow', 'sauce llorón'],
  'white birch': ['white birch', 'abedul blanco'],
  'white poplar': ['white poplar', 'álamo blanco'],
  willow: ['willow', 'sauce'],
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
  return SPECIES_BY_COMMON_NAME[normalizeCommonName(englishCommonName)]?.[1] ?? null;
}

/**
 * The table's own spelling of an English common name it knows, or null for
 * one it does not — a species the table has never heard of is stored and
 * printed exactly as the person typed it, because they are the one standing
 * at the tree and they know whether its name carries a proper noun.
 */
export function englishSpeciesFor(englishCommonName: string): string | null {
  return SPECIES_BY_COMMON_NAME[normalizeCommonName(englishCommonName)]?.[0] ?? null;
}

/**
 * The table's own spelling of a Spanish name a human supplied, when the two
 * differ only in casing — otherwise null, meaning "that is their name, not
 * ours, leave it alone".
 *
 * One predicate for both write paths that can meet a human-typed `es`: the
 * admin add-bed form (service.ts) and the remediation script that corrects a
 * store seeded before the casing rule (scripts/species-casing-rewrite.mjs).
 * A typed "Roble Sauce" is the table's value shouted, so it becomes "roble
 * sauce" and reads grammatically mid-sentence; a typed "Mi roble favorito"
 * is a name and is stored byte-for-byte.
 */
export function tableSpeciesCasingFor(
  englishCommonName: string,
  spanishName: string,
): string | null {
  const expected = spanishSpeciesFor(englishCommonName);
  if (expected === null) return null;
  return spanishName.toLowerCase() === expected.toLowerCase() ? expected : null;
}

/** For the tests that hold every entry to the table's own rules. */
export function speciesTableEntries(): ReadonlyArray<[string, SpeciesNames]> {
  return Object.entries(SPECIES_BY_COMMON_NAME);
}

export { normalizeCommonName };
