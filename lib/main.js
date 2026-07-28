const { CompositeDisposable, ripgrepPath } = require("atom");
const { spawn } = require("child_process");
const fsp = require("fs/promises");
const bibtexParse = require("bibtex-parse");

const VIEW_ID = "bib-finder.citations";

const HELP = [
  "Available commands:",
  "- **Enter**: Insert citation key",
  "- **Alt+Enter**: Insert `\\cite{key}`",
  "- **Ctrl+Enter**: Insert `\\cite[]{key}` with cursor in brackets",
  "- **F5**: Refresh bibliography cache",
].join("\n");

// The matcher joins these with a single space, which reproduces the filter
// string the rows used to carry by hand — `<key> <description> @<type>` — so
// `@book` still narrows the list to books. Splitting it into named fields is
// what lets the kernel hand each rendered fragment its own match offsets.
const FIELDS = [
  { name: "key", get: (entry) => entry.fields.key },
  { name: "description", get: (entry) => entry.fields.description },
  { name: "type", get: (entry) => entry.fields.type },
];

module.exports = {
  items: null,
  id: null,
  sourceId: null,
  disposables: null,
  bibLocal: null,
  allowDuplicate: null,
  reloadAlways: null,
  showSource: null,
  bibPath1: null,
  bibPath2: null,
  bibPath3: null,
  bibPath4: null,
  bibPath5: null,
  bibPathArray: null,

  activate() {
    this.disposables = new CompositeDisposable(
      atom.commands.add("atom-workspace", {
        "bib-finder:cite": () => this.toggle(),
        "bib-finder:cite-from-local": () => this.toggle("local"),
        "bib-finder:cite-from-source-1": () => this.toggle(1),
        "bib-finder:cite-from-source-2": () => this.toggle(2),
        "bib-finder:cite-from-source-3": () => this.toggle(3),
        "bib-finder:cite-from-source-4": () => this.toggle(4),
        "bib-finder:cite-from-source-5": () => this.toggle(5),
        "bib-finder:cache": () => this.recache(),
        "bib-finder:open-source-1": () => this.openBibFile(1),
        "bib-finder:open-source-2": () => this.openBibFile(2),
        "bib-finder:open-source-3": () => this.openBibFile(3),
        "bib-finder:open-source-4": () => this.openBibFile(4),
        "bib-finder:open-source-5": () => this.openBibFile(5),
      }),
      atom.config.observe("bib-finder.bibLocal", (value) => {
        this.bibLocal = value;
        this.items = null;
      }),
      atom.config.observe("bib-finder.allowDuplicate", (value) => {
        this.allowDuplicate = value;
        this.items = null;
      }),
      atom.config.observe("bib-finder.reloadAlways", (value) => {
        this.reloadAlways = value;
      }),
      atom.config.observe("bib-finder.showSource", (value) => {
        this.showSource = value;
        // The flag only changes how a row draws, but rows belong to the kernel
        // now, so an open list has to be re-run to pick the change up.
        const session = this.session();
        if (session) session.refresh();
      }),
      atom.config.observe("bib-finder.bibPaths.path1", (value) => {
        this.bibPath1 = value;
        this.items = null;
      }),
      atom.config.observe("bib-finder.bibPaths.path2", (value) => {
        this.bibPath2 = value;
        this.items = null;
      }),
      atom.config.observe("bib-finder.bibPaths.path3", (value) => {
        this.bibPath3 = value;
        this.items = null;
      }),
      atom.config.observe("bib-finder.bibPaths.path4", (value) => {
        this.bibPath4 = value;
        this.items = null;
      }),
      atom.config.observe("bib-finder.bibPaths.path5", (value) => {
        this.bibPath5 = value;
        this.items = null;
      }),
      atom.config.observe("bib-finder.bibPaths.array", (value) => {
        this.bibPathArray = value;
        this.items = null;
      }),
    );
  },

  deactivate() {
    this.disposables.dispose();
    const session = this.session();
    if (session) session.cancel("api");
  },

  // The active modal session, but only while it is this package's own.
  session() {
    const session = atom.modals.getActiveSession();
    return session && session.rootSpec.id === VIEW_ID ? session : null;
  },

  toggle(sourceId) {
    this.sourceId = sourceId;
    return atom.modals.toggle({
      id: VIEW_ID,
      className: "bib-finder",
      emptyMessage: "No matches found",
      help: HELP,
      source: (req) => this.loadItems(req),
      matcher: atom.modals.matchers.fuzzy({
        maxResults: 50,
        algorithm: "fuzzaldrin",
        fields: FIELDS,
      }),
      renderer: {
        entry: (item) => ({
          // Keys repeat on purpose when `allowDuplicate` is on, so identity is
          // the item itself — a key string would collapse two distinct rows.
          id: item,
          text: item.key,
          fields: {
            key: item.key,
            description: item.description,
            // The sigil is part of the haystack, not decoration: it is what
            // makes `@book` a type filter rather than a substring of a title.
            type: `@${item.type}`,
          },
        }),
        element: (item, ctx) => this.rowElement(item, ctx),
      },
      actions: [
        {
          name: "name",
          label: "Insert citation key",
          keystroke: "enter",
          run: ({ item, target }) => this.insert(item, "name", target),
        },
        {
          name: "cite",
          label: "Insert \\cite{key}",
          keystroke: "alt-enter",
          run: ({ item, target }) => this.insert(item, "cite", target),
        },
        {
          name: "square",
          label: "Insert \\cite[]{key} with cursor in brackets",
          keystroke: "ctrl-enter",
          run: ({ item, target }) => this.insert(item, "square", target),
        },
        {
          name: "update",
          label: "Refresh bibliography cache",
          keystroke: "f5",
          when: "always",
          run: () => {
            // Kept as it was: refreshing from inside the list has always
            // rebuilt from every source, whichever one it was opened for.
            this.items = null;
            this.sourceId = undefined;
            return { keepOpen: true, refresh: true };
          },
        },
      ],
      confirm: ({ item, target }) => this.insert(item, "name", target),
    });
  },

  // Entries are cached across openings; only a stale cache, a different source
  // than the cache holds, or `reloadAlways` pays for the crawl again.
  async loadItems(req) {
    if (this.items && !this.reloadAlways && this.id === this.sourceId) {
      return this.items;
    }
    req.progress({ busy: true, message: "Indexing project…" });
    await this.cache(this.sourceId);
    req.progress({ busy: false, message: null });
    return this.items;
  },

  // `bib-finder:cache` rebuilds the cache for whichever source it currently
  // holds, whether or not the list is open.
  recache() {
    this.items = null;
    const session = this.session();
    if (session) {
      return session.refresh();
    }
    return this.cache(this.id);
  },

  // Enumerate the `.bib` files of a directory with the ripgrep binary bundled
  // in the editor. A positive `-g` glob overrides gitignore rules on its own,
  // and the previous crawler saw VCS-ignored files too, so pass --no-ignore-vcs
  // explicitly and always keep `.git` internals out of the results.
  crawlBibFiles(dirPath) {
    return new Promise((resolve) => {
      const args = ["--files", "--no-ignore-vcs", "-g", "**/*.bib", "-g", "!**/.git/**", dirPath];
      const child = spawn(ripgrepPath, args);
      const files = [];
      let remainder = "";
      const pushLine = (line) => {
        // Guard against CRLF line endings from the Windows binary.
        const fPath = line.endsWith("\r") ? line.slice(0, -1) : line;
        if (fPath) {
          files.push(fPath);
        }
      };
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        // Accumulate across chunk boundaries: a chunk may end mid-line.
        const lines = (remainder + chunk).split("\n");
        remainder = lines.pop();
        lines.forEach(pushLine);
      });
      child.on("error", () => resolve(files));
      child.on("close", () => {
        pushLine(remainder);
        resolve(files);
      });
    });
  },

  async cache(sourceId) {
    let paths = [];
    if (sourceId === "local" || (!sourceId && this.bibLocal)) {
      for (const pPath of atom.project.getPaths()) {
        paths.push(...(await this.crawlBibFiles(pPath)));
      }
    }
    if (sourceId === 1 || !sourceId) {
      if (this.bibPath1) paths.push(this.bibPath1);
    }
    if (sourceId === 2 || !sourceId) {
      if (this.bibPath2) paths.push(this.bibPath2);
    }
    if (sourceId === 3 || !sourceId) {
      if (this.bibPath3) paths.push(this.bibPath3);
    }
    if (sourceId === 4 || !sourceId) {
      if (this.bibPath4) paths.push(this.bibPath4);
    }
    if (sourceId === 5 || !sourceId) {
      if (this.bibPath5) paths.push(this.bibPath5);
    }
    if (!sourceId && this.bibPathArray) {
      paths.push(...this.bibPathArray);
    }
    this.id = sourceId;
    this.items = [];
    const keys = [];
    for (const fPath of paths) {
      try {
        const text = await fsp.readFile(fPath, "utf-8");
        const entries = bibtexParse.entries(text);
        for (const entry of entries) {
          if (keys.includes(entry.key)) {
            continue;
          }
          let description = [];
          for (const key in entry) {
            if (key === "key" || key === "type") {
              continue;
            }
            description.push(entry[key]);
          }
          description = this.formatText(description.join(" | "));
          this.items.push({
            key: entry.key,
            description: description,
            type: entry.type,
            fPath: fPath,
          });
          if (!this.allowDuplicate) {
            keys.push(entry.key);
          }
        }
      } catch (err) {
        if (err.code === "ENOENT") {
          atom.notifications.addError(`The bib file ${fPath} does not exist`);
        } else {
          console.error(`bib-finder: Error parsing ${fPath}:`, err);
        }
      }
    }
  },

  // Three fields on one row, so the row owns its own DOM. The offsets are the
  // kernel's per-field split of a single match — nothing here counts characters
  // across the concatenated filter string the way the old renderer had to.
  rowElement(item, ctx) {
    const highlights = ctx.highlights;
    const li = document.createElement("li");
    li.classList.add("two-lines");

    const priBlock = document.createElement("div");
    priBlock.classList.add("primary-line");
    const typeBlock = document.createElement("span");
    typeBlock.classList.add("tag");
    // The type field is the searchable `@book` spelling while the chip prints
    // the bare type, so each offset sits one past the character it marks; the
    // sigil's own offset lands at -1, which `highlight` drops.
    typeBlock.appendChild(
      ctx.highlight(
        item.type,
        (highlights.type ?? []).map((offset) => offset - 1),
      ),
    );
    priBlock.appendChild(typeBlock);
    priBlock.appendChild(ctx.highlight(item.key, highlights.key ?? []));
    li.appendChild(priBlock);

    const secBlock = document.createElement("div");
    secBlock.classList.add("secondary-line");
    secBlock.appendChild(ctx.highlight(item.description, highlights.description ?? []));
    li.appendChild(secBlock);

    if (this.showSource) {
      const pathBlock = document.createElement("div");
      pathBlock.textContent = item.fPath;
      atom.icons.applyTo(
        pathBlock,
        { path: item.fPath, context: "bib-finder", hints: { directory: false } },
        { classes: ["icon-line"] },
      );
      li.appendChild(pathBlock);
    }
    return li;
  },

  insert(item, mode, target) {
    if (!item) {
      return { keepOpen: true };
    }
    const editor = target.editor;
    // Nothing to write to: close anyway, as the old list did — it hid itself
    // before it went looking for the editor.
    if (!editor) {
      return undefined;
    }
    if (mode === "name") {
      editor.insertText(item.key);
    } else if (mode === "cite") {
      editor.insertText(`\\cite{${item.key}}`);
    } else if (mode === "square") {
      editor.transact(() => {
        editor.insertText(`\\cite[]{${item.key}}`);
        for (const cursor of editor.getCursors()) {
          const bufPos = cursor.getBufferPosition();
          cursor.setBufferPosition([bufPos.row, bufPos.column - item.key.length - 3]);
        }
      });
    }
    return undefined;
  },

  openBibFile(id) {
    let filePath = atom.config.get(`bib-finder.bibPaths.path${id}`);
    if (filePath) {
      atom.workspace.open(filePath);
    } else {
      atom.notifications.addError(`The path of BibTeX-${id} has not been set`);
    }
  },

  formatText(text) {
    return text
      .trim()
      .replace(/~+/g, " ")
      .replace(/--/g, "–")
      .replace(/(?<!\\)\$/g, "")
      .replace(/\\\$/g, "$")
      .replace(/\\%/g, "%")
      .replace(/\\theta/, "θ")
      .replace(/\\Theta/, "Θ")
      .replace(/\\omega/, "ω")
      .replace(/\\Omega/, "Ω")
      .replace(/\\varepsilon/, "ε")
      .replace(/\\Epsilon/, "Ε")
      .replace(/\\epsilon/, "ϵ")
      .replace(/\\rho/, "ρ")
      .replace(/\\Rho/, "Ρ")
      .replace(/\\tau/, "τ")
      .replace(/\\Tau/, "Τ")
      .replace(/\\psi/, "ψ")
      .replace(/\\Psi/, "Ψ")
      .replace(/\\upsilon/, "υ")
      .replace(/\\Upsilon/, "Υ")
      .replace(/\\iota/, "ι")
      .replace(/\\Iota/, "Ι")
      .replace(/\\omicron/, "ο")
      .replace(/\\Omicron/, "Ο")
      .replace(/\\pi/, "π")
      .replace(/\\Pi/, "Π")
      .replace(/\\alpha/, "α")
      .replace(/\\Alpha/, "Α")
      .replace(/\\sigma/, "σ")
      .replace(/\\Sigma/, "Σ")
      .replace(/\\delta/, "δ")
      .replace(/\\Delta/, "Δ")
      .replace(/\\varphi/, "φ")
      .replace(/\\theta/, "ϑ")
      .replace(/\\gamma/, "γ")
      .replace(/\\Gamma/, "Γ")
      .replace(/\\eta/, "η")
      .replace(/\\Eta/, "Η")
      .replace(/\\phi/, "ϕ")
      .replace(/\\Phi/, "Φ")
      .replace(/\\kappa/, "κ")
      .replace(/\\Kappa/, "Κ")
      .replace(/\\lambda/, "λ")
      .replace(/\\Lambda/, "Λ")
      .replace(/\\zeta/, "ζ")
      .replace(/\\Zeta/, "Ζ")
      .replace(/\\xi/, "ξ")
      .replace(/\\Xi/, "Ξ")
      .replace(/\\chi/, "χ")
      .replace(/\\Chi/, "Χ")
      .replace(/\\beta/, "β")
      .replace(/\\Beta/, "Β")
      .replace(/\\nu/, "ν")
      .replace(/\\Nu/, "Ν")
      .replace(/\\mu/, "μ")
      .replace(/\\Mu/, "Μ");
  },
};
