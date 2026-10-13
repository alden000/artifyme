// Every style is painted by Masterpiece+ (on‑device generative img2img).
// "master" styles are steered toward a specific artwork/painter; "reimagine"
// styles toward a medium or look (anime, 3D cartoon…).
export type StyleKind = 'master' | 'generative';

export interface ArtStyle {
  id: string;
  kind: StyleKind;
  name: string;
  artist: string;
  year: string;
  movement: string;
  blurb: string;
  accent: string;
  thumb: string;
}

const neural = (
  id: string,
  name: string,
  artist: string,
  year: string,
  movement: string,
  accent: string,
  blurb: string,
): ArtStyle => ({ id, kind: 'master', name, artist, year, movement, accent, blurb, thumb: `styles/${id}.webp` });

export const MASTERS: ArtStyle[] = [
  neural('starry', 'The Starry Night', 'Vincent van Gogh', '1889', 'Post‑Impressionism', '#4f7fd6', 'Swirling skies and restless, luminous brushwork.'),
  neural('wave', 'The Great Wave', 'Katsushika Hokusai', 'c. 1831', 'Ukiyo‑e', '#3d6f9e', 'Prussian blues and the crisp line of the woodblock.'),
  neural('kiss', 'The Kiss', 'Gustav Klimt', '1908', 'Vienna Secession', '#d8b04c', 'Gold leaf, mosaic pattern and opulent ornament.'),
  neural('scream', 'The Scream', 'Edvard Munch', '1893', 'Expressionism', '#e0773a', 'Molten sunset bands and existential motion.'),
  neural('sunflowers', 'Sunflowers', 'Vincent van Gogh', '1888', 'Post‑Impressionism', '#e3b23c', 'Thick impasto in chrome yellow and ochre.'),
  neural('kandinsky', 'Composition VII', 'Wassily Kandinsky', '1913', 'Abstract', '#c4485a', 'An explosive symphony of colour and form.'),
  neural('monet', 'Impression, Sunrise', 'Claude Monet', '1872', 'Impressionism', '#e07a4f', 'Hazy harbour light in quick, broken strokes.'),
  neural('lilies', 'Water Lilies', 'Claude Monet', '1906', 'Impressionism', '#6f9fc4', 'Dreamy reflections on still, violet water.'),
  neural('gris', 'Portrait of Picasso', 'Juan Gris', '1912', 'Cubism', '#a08a6c', 'Faceted planes and analytic, geometric light.'),
  neural('mondrian', 'Composition II', 'Piet Mondrian', '1930', 'De Stijl', '#d8321e', 'Primary colours locked in a rhythmic grid.'),
  neural('seurat', 'La Grande Jatte', 'Georges Seurat', '1884', 'Pointillism', '#6f9a6a', 'A shimmering field of countless dots.'),
  neural('mucha', 'Spring', 'Alphonse Mucha', '1896', 'Art Nouveau', '#d9a87c', 'Flowing lines and soft, poster‑like pastels.'),
  neural('marc', 'Fate of the Animals', 'Franz Marc', '1913', 'Expressionism', '#c0392b', 'Shattered prisms of crimson and cobalt.'),
  neural('cypress', 'Wheat Field with Cypresses', 'Vincent van Gogh', '1889', 'Post‑Impressionism', '#5c8f6a', 'Wind‑tossed fields under rolling clouds.'),
  neural('schiele', 'Self‑Portrait', 'Egon Schiele', '1912', 'Expressionism', '#b9774a', 'Raw contour and nervous, angular line.'),
  neural('hiroshige', 'Plum Garden', 'Utagawa Hiroshige', '1857', 'Ukiyo‑e', '#b8433c', 'Bold silhouettes and graduated bokashi skies.'),
  neural('rousseau', 'The Dream', 'Henri Rousseau', '1910', 'Naïve Art', '#4f8a4a', 'Lush, enchanted jungle foliage.'),
  neural('rembrandt', 'The Night Watch', 'Rembrandt', '1642', 'Dutch Golden Age', '#b08a3e', 'Dramatic chiaroscuro and burnished gold.'),
  neural('vermeer', 'Pearl Earring', 'Johannes Vermeer', '1665', 'Dutch Golden Age', '#4a6fa5', 'Velvet shadows and pearlescent light.'),
  neural('davinci', 'Mona Lisa', 'Leonardo da Vinci', '1503', 'High Renaissance', '#8a7a4a', 'Sfumato haze and Renaissance glaze.'),
  neural('bosch', 'Earthly Delights', 'Hieronymus Bosch', 'c. 1500', 'Northern Renaissance', '#7a9a6a', 'Surreal, jewel‑toned fantasia.'),
];

// Masterpiece+ only: no single source painting — the generative model draws these.
const gen = (id: string, name: string, artist: string, movement: string, accent: string, blurb: string): ArtStyle => ({
  id,
  kind: 'generative',
  name,
  artist,
  year: 'Masterpiece+',
  movement,
  accent,
  blurb,
  thumb: `styles/mp-${id}.webp`,
});
export const REIMAGINE: ArtStyle[] = [
  gen('anime', 'Anime', 'Cel‑shaded illustration', 'Anime', '#b48cff', 'Clean line art, luminous cel shading.'),
  gen('cartoon3d', '3D Cartoon', 'Animated feature look', '3D animation', '#5aa9ff', 'Big expressive eyes, soft studio lighting.'),
  gen('comic', 'Comic Book', 'Ink & halftone', 'Graphic novel', '#ff5a4f', 'Bold inks, halftone dots, flat colour.'),
  gen('sketch', 'Pencil Sketch', 'Graphite on paper', 'Drawing', '#c9c3b6', 'Hand‑drawn graphite with cross‑hatching.'),
  gen('watercolor', 'Watercolour', 'Wet‑on‑wet washes', 'Watercolour', '#ff9fb8', 'Soft bleeding pigments on cold‑press paper.'),
  gen('popart', 'Pop Art', '1960s screen print', 'Pop art', '#ffd23f', 'Flat colour, thick outlines, Ben‑Day dots.'),
];

export const ALL_STYLES = [...MASTERS, ...REIMAGINE];

export const findStyle = (id: string) => ALL_STYLES.find((s) => s.id === id);
