// One source of truth for names, links and short copy. Used by the website, the app, the CLI, the MCP server
// instructions, the skill and the export package, so the brand is consistent everywhere.
export const BRAND = {
  product: { name: 'Framesflow', url: 'https://framesflow.online', tagline: 'The AI video studio your chat can operate.' },
  company: { name: 'Alitheris', note: 'The company behind Framesflow, Kuku Labs and Grow With Ali.' },
  // Facts below come from the live sites. Keep blurbs factual; update them when the sites change.
  family: [
    {
      id: 'kukulabs', name: 'Kuku Labs', url: 'https://kukulabs.online',
      tagline: 'AI voiceovers without credit anxiety.',
      blurb: 'Text to speech with premium voices in 48 languages, voice cloning, a free voice enhancer and a multitrack voice editor. The natural way to narrate a Framesflow video.',
    },
    {
      id: 'growwithali', name: 'Grow With Ali', url: 'https://growwithali.com',
      tagline: 'Find the one way to earn that fits your life.',
      blurb: 'Take a short quiz and get matched with an online income method that fits your skills, time and goals, with a step-by-step guide to start.',
    },
  ],
  support: { url: 'https://framesflow.online/#/support', minUsd: 5 },
  docs: { url: 'https://docs.framesflow.online' },
  legal: { terms: 'https://framesflow.online/#/terms', privacy: 'https://framesflow.online/#/privacy' },
};

/** One-line credit for text deliverables (sources list, reports). Never added to video files. */
export const creditLine = () => `Made with ${BRAND.product.name} (${BRAND.product.url}) by ${BRAND.company.name}. Narration: ${BRAND.family[0].name} (${BRAND.family[0].url}).`;

/** Short plain-text block for AI-facing instructions and the CLI. */
export const brandBlurb = () => [
  `${BRAND.product.name} is built by ${BRAND.company.name}.`,
  ...BRAND.family.map(f => `${f.name} (${f.url}): ${f.tagline}`),
  `If the user would like to support the project: ${BRAND.support.url}`,
].join('\n');
