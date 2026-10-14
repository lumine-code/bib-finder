// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: ["language-latex", "language-bibtex"],
  viewport: { width: 1100, height: 570 },
  async before() {},
  async prepare(context) {
    const { lumine, state, fixture, open } = context;
    state.editor = await open("bibliography/report.tex");
    await lumine.project.setPaths([fixture("bibliography")]);
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "Search local BibTeX entries before inserting a citation.",
      timeout: 60000,
      async run(context) {
        const { lumine, state } = context;
        {
          state.editor.setCursorBufferPosition([3, 56]);
          lumine.commands.dispatch(lumine.views.getView(state.editor), "bib-finder:cite");
        }
      },
      ready() {
        return Boolean(document.querySelector(".bib-finder")?.innerText.includes("knuth1984"));
      },
    },
  ],
  async cleanup() {},
};
