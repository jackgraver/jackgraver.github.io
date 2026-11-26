export interface Project {
  name: string;
  short: string;
  // TODO(jack): fill in stack tags for the hover card.
  stack: string[];
  href: string;
  linkLabel: string;
  // Drop a screenshot in /public/previews and set e.g. "/previews/cs2c.png".
  // Without one, the hover card shows a generated placeholder.
  image?: string;
}

export const projects: Project[] = [
  {
    name: "cs2c",
    short: "Counter-Strike 2D replay visualizer",
    stack: [],
    href: "https://github.com/jackgraver/cs2c",
    linkLabel: "github",
  },
  {
    name: "CrossfireGG",
    short: "Tournament organizer website and management platform",
    stack: [],
    href: "https://crossfiregg.com",
    linkLabel: "crossfiregg.com",
  },
  {
    name: "simpletrack",
    short: "Nutrition and gym tracking app",
    stack: [],
    href: "https://github.com/jackgraver/simple-track",
    linkLabel: "github",
  },
  {
    name: "And-Tree model",
    short: "AI And-Tree model implementation",
    stack: [],
    href: "https://github.com/jackgraver/CPSC433-Project-Floette",
    linkLabel: "github",
  },
];
