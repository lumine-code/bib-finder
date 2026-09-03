const { CompositeDisposable } = require("lumine");
const fsp = require("fs/promises");
const bibtexParse = require("bibtex-parse");

module.exports = {
  items: null,
  nextId: null,
  id: null,
  selectList: null,
  selectListHost: null,
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

  activate(state) {
    const recentItemIds = [
      ...new Set(
        (Array.isArray(state?.recentlyUsed) ? state.recentlyUsed : []).filter(
          (id) => typeof id === "string",
        ),
      ),
    ];

    const selectListOptions = {
      emptyMessage: "No matches found",
      getItemId: (item) => item.id,
      search: {
        getFilterText: (item) => item.text,
        algorithm: "fuzzaldrin",
        ignoreDiacritics: true,
      },
      recents: {
        limit: lumine.config.get("bib-finder.recentCount"),
        adapter: {
          load: () => recentItemIds,
          // Package state is serialized from the model; no second in-memory
          // copy is needed merely to receive each change.
          save: () => {},
        },
      },
      source: {
        mode: "snapshot",
        loadingMessage: "Indexing project…",
        load: () => this.loadEntries(this.nextId),
      },
      renderItem: (item, { matchIndices, highlight }) => {
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
      commands: {
        "bib-finder:insert-key": {
          description: "Insert the citation key alone, with no LaTeX command around it.",
          didDispatch: (event) => this.performAction(event.detail.item, "name"),
        },
        "bib-finder:insert-cite": {
          description: "Insert the key wrapped in a LaTeX \\cite{…} command.",
          didDispatch: (event) => this.performAction(event.detail.item, "cite"),
        },
        "bib-finder:insert-cite-square": {
          description: "Insert \\cite[]{…} and put the cursor between the square brackets.",
          didDispatch: (event) => this.performAction(event.detail.item, "square"),
        },
        "bib-finder:rebuild-cache": {
          description: "Parse the .bib sources again to pick up new entries.",
          didDispatch: () => this.refresh(this.id),
        },
      },
      actions: [
        ...[
          ["bib-finder:insert-key", true],
          ["bib-finder:insert-cite", false],
          ["bib-finder:insert-cite-square", false],
        ].map(([command, primary]) => ({
          command,
          context: "item",
          primary,
          enabled: () => Boolean(this.targetEditor && !this.targetEditor.isDestroyed?.()),
          disabledReason: "There is no target editor for the citation.",
          group: "Insert",
          disposition: "close",
          recordsRecent: true,
          dispatch: "local",
        })),
        {
          command: "bib-finder:rebuild-cache",
          context: "dialog",
          group: "List",
          disposition: "stay",
          dispatch: "local",
        },
      ],
    };
    this.selectListHost = lumine.workspace.addSelectList(selectListOptions, {
      className: "bib-finder",
      crumb: "Bibliography",
    });
    this.selectList = this.selectListHost.getModel();
    this.disposables = new CompositeDisposable(
      lumine.commands.add("lumine-workspace", {
        "bib-finder:cite": {
          description: "Insert a citation, searching every configured source.",
          didDispatch: () => this.toggle(),
        },
        "bib-finder:cite-from-local": {
          description: "Insert a citation from the bib files beside this document.",
          didDispatch: () => this.toggle("local"),
        },
        "bib-finder:cite-from-source-1": {
          description: "Insert a citation from the first configured source alone.",
          didDispatch: () => this.toggle(1),
        },
        "bib-finder:cite-from-source-2": {
          description: "Insert a citation from the second configured source alone.",
          didDispatch: () => this.toggle(2),
        },
        "bib-finder:cite-from-source-3": {
          description: "Insert a citation from the third configured source alone.",
          didDispatch: () => this.toggle(3),
        },
        "bib-finder:cite-from-source-4": {
          description: "Insert a citation from the fourth configured source alone.",
          didDispatch: () => this.toggle(4),
        },
        "bib-finder:cite-from-source-5": {
          description: "Insert a citation from the fifth configured source alone.",
          didDispatch: () => this.toggle(5),
        },
        "bib-finder:cache": {
          description: "Read the bib files again after editing them outside.",
          didDispatch: () => this.refresh(this.id),
        },
        "bib-finder:clear-recent": {
          description: "Forget the recently used entries kept at the top of the list.",
          didDispatch: () => this.selectList.clearRecentItems(),
        },
        "bib-finder:open-source-1": {
          description: "Open the first configured bib file.",
          didDispatch: () => this.openBibFile(1),
        },
        "bib-finder:open-source-2": {
          description: "Open the second configured bib file.",
          didDispatch: () => this.openBibFile(2),
        },
        "bib-finder:open-source-3": {
          description: "Open the third configured bib file.",
          didDispatch: () => this.openBibFile(3),
        },
        "bib-finder:open-source-4": {
          description: "Open the fourth configured bib file.",
          didDispatch: () => this.openBibFile(4),
        },
        "bib-finder:open-source-5": {
          description: "Open the fifth configured bib file.",
          didDispatch: () => this.openBibFile(5),
        },
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
      lumine.config.onDidChange("bib-finder.recentCount", ({ newValue }) => {
        this.selectList.setRecentLimit(newValue);
      }),
      lumine.config.observe("bib-finder.showSource", (value) => {
        this.showSource = value;
        this.selectList.refresh();
      }),
      lumine.config.observe("bib-finder.path-1", (value) => {
        this.bibPath1 = value;
        this.items = null;
      }),
      lumine.config.observe("bib-finder.path-2", (value) => {
        this.bibPath2 = value;
        this.items = null;
      }),
      lumine.config.observe("bib-finder.path-3", (value) => {
        this.bibPath3 = value;
        this.items = null;
      }),
      lumine.config.observe("bib-finder.path-4", (value) => {
        this.bibPath4 = value;
        this.items = null;
      }),
      lumine.config.observe("bib-finder.path-5", (value) => {
        this.bibPath5 = value;
        this.items = null;
      }),
      lumine.config.observe("bib-finder.paths", (value) => {
        this.bibPathArray = value;
        this.items = null;
      }),
    );
  },

  serialize() {
    return { recentlyUsed: this.selectList.getRecentItemIds() };
  },

  async deactivate() {
    this.disposables.dispose();
    await this.selectListHost.destroy();
  },

  toggle(sourceId) {
    this.nextId = sourceId;
    this.targetEditor = lumine.textEditors.getActiveTextEditor();
    return this.selectListHost.toggle();
  },

  async refresh(sourceId) {
    this.items = null;
    this.nextId = sourceId;
    return this.selectListHost.isVisible() ? this.selectList.reload() : this.update(sourceId);
  },

  async update(sourceId) {
    const publication = await this.loadEntries(sourceId);
    await this.selectList.setItems(publication.items);
    return this.selectList.setStatus(publication.status);
  },

  async loadEntries(sourceId) {
    if (this.items && !this.reloadAlways && this.id === sourceId) {
      return { items: this.items, status: null };
    }
    try {
      await this.cache(sourceId);
      return { items: this.items, status: null };
    } catch (error) {
      return {
        items: [],
        status: { type: "error", message: `Could not index the project: ${error.message}` },
      };
    }
  },

  // Enumerate the `.bib` files under every project root. The editor drives
  // ripgrep here, which is where the `.git` exclusion and the NUL-terminated
  // output come from -- a `.bib` filename may legally contain a newline, and
  // splitting the old line-based output on one broke it into two paths that do
  // not exist.
  //
  // The standard project crawl policy applies, including the editor's VCS and
  // ignored-name settings. This package adds only its own ignored names.
  async crawlBibFiles() {
    const files = [];
    await lumine.project.crawl({
      inclusion: "**/*.bib",
      ignoredNames: lumine.config.get("bib-finder.ignoredNames") || [],
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
    const itemIds = new Map();
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
          const identity = `${entry.key}\0${fPath}`;
          const duplicateIndex = itemIds.get(identity) ?? 0;
          itemIds.set(identity, duplicateIndex + 1);
          this.items.push({
            id: `${identity}\0${duplicateIndex}`,
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

  performAction(item, mode) {
    if (!item) {
      return;
    }
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
    let filePath = lumine.config.get(`bib-finder.path-${id}`);
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
