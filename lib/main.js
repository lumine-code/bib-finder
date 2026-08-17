const { CompositeDisposable } = require("lumine");
const fsp = require("fs/promises");
const bibtexParse = require("bibtex-parse");

module.exports = {
  items: null,
  nextId: null,
  id: null,
  selectList: null,
  targetEditor: null,
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
    this.selectList = lumine.workspace.buildSelectList({
      className: "bib-finder",
      crumb: "Bibliography",
      emptyMessage: "No matches found",
      filterKeyForItem: (item) => item.text,
      removeDiacritics: true,
      algorithm: "fuzzaldrin",
      willShow: () => this.update(this.nextId),
      elementForItem: (item, { matchIndices, highlight }) => {
        const li = document.createElement("li");
        const matches = matchIndices || [];
        li.classList.add("two-lines");
        const priBlock = document.createElement("div");
        priBlock.classList.add("primary-line");
        const typeOffset = item.key.length + 1 + item.description.length + 2;
        const typeBlock = document.createElement("span");
        typeBlock.classList.add("tag");
        typeBlock.appendChild(
          highlight(
            item.type,
            matches.map((x) => x - typeOffset),
          ),
        );
        priBlock.appendChild(typeBlock);
        priBlock.appendChild(highlight(item.key, matches));
        li.appendChild(priBlock);
        const descOffset = item.key.length + 1;
        const secBlock = document.createElement("div");
        secBlock.classList.add("secondary-line");
        secBlock.appendChild(
          highlight(
            item.description,
            matches.map((x) => x - descOffset),
          ),
        );
        li.appendChild(secBlock);
        if (this.showSource) {
          const pathBlock = document.createElement("div");
          pathBlock.textContent = item.fPath;
          lumine.icons.applyTo(
            pathBlock,
            { path: item.fPath, context: "bib-finder", hints: { directory: false } },
            { classes: ["icon-line"] },
          );
          li.appendChild(pathBlock);
        }
        return li;
      },
      didConfirmSelection: () => this.performAction("name"),
      didCancelSelection: () => this.selectList.hide(),
    });
    this.disposables = new CompositeDisposable(
      // Registered in the package's own namespace: the item-actions list
      // (F12) derives its rows — label, description, keybinding — from these
      // registrations and the keymap, so nothing is documented twice. Every
      // description says something the humanized command name does not.
      lumine.commands.add(this.selectList.element, {
        "bib-finder:insert-key": {
          description: "Insert the citation key alone, with no LaTeX command around it.",
          didDispatch: () => this.performAction("name"),
        },
        "bib-finder:insert-cite": {
          description: "Insert the key wrapped in a LaTeX \\cite{…} command.",
          didDispatch: () => this.performAction("cite"),
        },
        "bib-finder:insert-cite-square": {
          description: "Insert \\cite[]{…} and put the cursor between the square brackets.",
          didDispatch: () => this.performAction("square"),
        },
        "bib-finder:rebuild-cache": {
          description: "Parse the .bib sources again to pick up new entries.",
          actionScope: "list",
          didDispatch: () => this.refresh(),
        },
      }),
      lumine.commands.add("lumine-workspace", {
        "bib-finder:cite": () => this.toggle(),
        "bib-finder:cite-from-local": () => this.toggle("local"),
        "bib-finder:cite-from-source-1": () => this.toggle(1),
        "bib-finder:cite-from-source-2": () => this.toggle(2),
        "bib-finder:cite-from-source-3": () => this.toggle(3),
        "bib-finder:cite-from-source-4": () => this.toggle(4),
        "bib-finder:cite-from-source-5": () => this.toggle(5),
        "bib-finder:cache": () => this.refresh(this.id),
        "bib-finder:open-source-1": () => this.openBibFile(1),
        "bib-finder:open-source-2": () => this.openBibFile(2),
        "bib-finder:open-source-3": () => this.openBibFile(3),
        "bib-finder:open-source-4": () => this.openBibFile(4),
        "bib-finder:open-source-5": () => this.openBibFile(5),
      }),
      lumine.config.observe("bib-finder.bibLocal", (value) => {
        this.bibLocal = value;
        this.items = null;
      }),
      lumine.config.observe("bib-finder.allowDuplicate", (value) => {
        this.allowDuplicate = value;
        this.items = null;
      }),
      lumine.config.observe("bib-finder.reloadAlways", (value) => {
        this.reloadAlways = value;
      }),
      lumine.config.observe("bib-finder.showSource", (value) => {
        this.showSource = value;
        this.selectList.update({});
      }),
      lumine.config.observe("bib-finder.bibPaths.path1", (value) => {
        this.bibPath1 = value;
        this.items = null;
      }),
      lumine.config.observe("bib-finder.bibPaths.path2", (value) => {
        this.bibPath2 = value;
        this.items = null;
      }),
      lumine.config.observe("bib-finder.bibPaths.path3", (value) => {
        this.bibPath3 = value;
        this.items = null;
      }),
      lumine.config.observe("bib-finder.bibPaths.path4", (value) => {
        this.bibPath4 = value;
        this.items = null;
      }),
      lumine.config.observe("bib-finder.bibPaths.path5", (value) => {
        this.bibPath5 = value;
        this.items = null;
      }),
      lumine.config.observe("bib-finder.bibPaths.array", (value) => {
        this.bibPathArray = value;
        this.items = null;
      }),
    );
  },

  deactivate() {
    this.disposables.dispose();
    this.selectList.destroy();
  },

  toggle(sourceId) {
    this.nextId = sourceId;
    this.targetEditor = lumine.textEditors.getActiveTextEditor();
    this.selectList.toggle();
  },

  refresh(sourceId) {
    this.items = null;
    this.update(sourceId);
  },

  update(sourceId) {
    if (!this.items || this.reloadAlways || this.id !== sourceId) {
      this.selectList.update({
        items: [],
        loadingMessage: "Indexing project\u2026",
        status: null,
      });
      // The clear used to sit only on the success path, so a crawl that
      // rejected left "Indexing project\u2026" up until the picker was reopened.
      this.cache(sourceId)
        .then(() => {
          this.selectList.update({
            items: this.items,
            loadingMessage: null,
          });
        })
        .catch((error) => {
          this.selectList.update({
            items: [],
            loadingMessage: null,
            status: { type: "error", message: `Could not index the project: ${error.message}` },
          });
        });
    }
  },

  // Enumerate the `.bib` files under every project root. The editor drives
  // ripgrep here, which is where the `.git` exclusion and the NUL-terminated
  // output come from -- a `.bib` filename may legally contain a newline, and
  // splitting the old line-based output on one broke it into two paths that do
  // not exist.
  //
  // `excludeVcsIgnoredPaths: false` keeps the previous behaviour of listing
  // bibliographies a repository ignores. `core.ignoredNames` does apply, unlike
  // before: a name the user has asked not to be shown should not come back as a
  // bibliography.
  async crawlBibFiles() {
    const files = [];
    await lumine.project.crawl({
      inclusion: "**/*.bib",
      excludeVcsIgnoredPaths: false,
      didFindPaths: (paths) => files.push(...paths),
    });
    return files;
  },

  async cache(sourceId) {
    let paths = [];
    if (sourceId === "local" || (!sourceId && this.bibLocal)) {
      paths.push(...(await this.crawlBibFiles()));
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
          description = this.formatText(description.join(" • "));
          this.items.push({
            key: entry.key,
            description: description,
            type: entry.type,
            text: entry.key + " " + description + " @" + entry.type,
            fPath: fPath,
          });
          if (!this.allowDuplicate) {
            keys.push(entry.key);
          }
        }
      } catch (err) {
        if (err.code === "ENOENT") {
          lumine.notifications.addError(`The bib file ${fPath} does not exist`);
        } else {
          console.error(`bib-finder: Error parsing ${fPath}:`, err);
        }
      }
    }
  },

  performAction(mode) {
    const item = this.selectList.getSelectedItem();
    if (!item) {
      return;
    }
    this.selectList.hide();
    if (!mode) {
      mode = "name";
    }
    let editor = this.targetEditor;
    if (!editor) {
      return;
    }
    if (mode === "name") {
      editor.insertText(item.key);
    } else if (mode === "cite") {
      editor.insertText(`\\cite{${item.key}}`);
    } else if (mode === "square") {
      editor.transact(() => {
        editor.insertText(`\\cite[]{${item.key}}`);
        for (let cursor of editor.getCursors()) {
          let bufPos = cursor.getBufferPosition();
          cursor.setBufferPosition([bufPos.row, bufPos.column - item.key.length - 3]);
        }
      });
    }
  },

  openBibFile(id) {
    let filePath = lumine.config.get(`bib-finder.bibPaths.path${id}`);
    if (filePath) {
      lumine.workspace.open(filePath);
    } else {
      lumine.notifications.addError(`The path of BibTeX-${id} has not been set`);
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
