import bottlenecks from './bottlenecks.json';
import palettes from './palettes.json';
import { DEFAULT_FINISH, type Finish, type Palette, type Surface } from '../ai/finish';

export type StyleKind = 'neural' | 'procedural';
export type Procedural = 'minecraft' | 'arcade' | 'bricks';

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
  /** 100‑d style embedding (neural styles). */
  bottleneck?: number[];
  procedural?: Procedural;
  /** Painterly finishing recipe (neural styles). */
  finish?: Finish;
  /** Lab colour statistics of the reference artwork. */
  palette?: Palette;
}

// brush size · impasto · ground · palette pull — tuned per artwork.
// Values are relative intensities; the scaling keeps the finish restrained — heavier
// settings tested worse (mushy faces, palette forcing drains skin tones).
const F = (brush: number, impasto: number, surface: Surface, colorMatch: number): Finish => ({ brush: brush * 0.5, impasto: impasto * 0.4, surface, colorMatch: colorMatch * 0.25 });
const FINISH: Record<string, Finish> = {
  starry: F(1, 1, 'canvas', 0.6),
  wave: F(0.45, 0, 'paper', 0.7),
  kiss: F(0.6, 0.45, 'canvas', 0.65),
  scream: F(0.9, 0.45, 'canvas', 0.6),
  sunflowers: F(1, 1, 'canvas', 0.6),
  kandinsky: F(0.75, 0.55, 'canvas', 0.5),
  monet: F(1, 0.7, 'canvas', 0.65),
  lilies: F(1, 0.6, 'canvas', 0.6),
  gris: F(0.5, 0.3, 'canvas', 0.55),
  mondrian: F(0.3, 0.2, 'canvas', 0.35),
  seurat: F(0.35, 0.35, 'canvas', 0.55),
  mucha: F(0.5, 0, 'paper', 0.6),
  marc: F(0.8, 0.5, 'canvas', 0.5),
  cypress: F(1, 1, 'canvas', 0.6),
  schiele: F(0.6, 0.2, 'paper', 0.5),
  hiroshige: F(0.45, 0, 'paper', 0.7),
  rousseau: F(0.7, 0.4, 'canvas', 0.55),
  rembrandt: F(0.85, 0.6, 'canvas', 0.7),
  vermeer: F(0.8, 0.4, 'canvas', 0.6),
  davinci: F(0.6, 0.3, 'panel', 0.7),
  bosch: F(0.6, 0.3, 'panel', 0.6),
};
const pal = palettes as unknown as Record<string, Palette>;

const vec = bottlenecks as Record<string, number[]>;

const neural = (
  id: string,
  name: string,
  artist: string,
  year: string,
  movement: string,
  accent: string,
  blurb: string,
): ArtStyle => ({
  id,
  kind: 'neural',
  name,
  artist,
  year,
  movement,
  accent,
  blurb,
  thumb: `styles/${id}.webp`,
  bottleneck: vec[id],
  finish: FINISH[id] ?? DEFAULT_FINISH,
  palette: pal[id],
});

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

export const PIXEL_WORLDS: ArtStyle[] = [
  {
    id: 'minecraft',
    kind: 'procedural',
    procedural: 'minecraft',
    name: 'Blockcraft',
    artist: 'Minecraft‑inspired',
    year: '16×16',
    movement: 'Voxel',
    accent: '#5fae4a',
    blurb: 'Rebuilt block by block from grass, stone, wood and wool.',
    thumb: '',
  },
  {
    id: 'arcade',
    kind: 'procedural',
    procedural: 'arcade',
    name: '8‑Bit Arcade',
    artist: 'Retro console',
    year: '1985',
    movement: 'Pixel art',
    accent: '#ff4f8b',
    blurb: 'A limited palette, ordered dithering and CRT glow.',
    thumb: '',
  },
  {
    id: 'bricks',
    kind: 'procedural',
    procedural: 'bricks',
    name: 'Brick Builder',
    artist: 'Toy bricks',
    year: '1×1',
    movement: 'Mosaic',
    accent: '#f2c230',
    blurb: 'A glossy mosaic of studded plastic bricks.',
    thumb: '',
  },
];

export const ALL_STYLES = [...MASTERS, ...PIXEL_WORLDS];

export const findStyle = (id: string) => ALL_STYLES.find((s) => s.id === id);
