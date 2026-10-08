const { CompositeDisposable, Disposable } = require("lumine");
const fsp = require("fs/promises");
const { parse: parseBibTeX } = require("@lumine-code/bibtex-parse");

module.exports = {
  provideBackgroundTips() {
    return {
      packageName: "bib-finder",
      tips: [
        "You can insert a citation key from your BibTeX sources with {{ 'bib-finder:cite' | keystroke }}",
      ],
    };
  },

  items: null,
  nextId: null,
  id: null,
  _selectList: null,
  // A direct caller (notably workspace restoration) may need the list before
  // the post-activation microtask runs. Treat that access as an explicit
  // first-use request while keeping ordinary activation cold.
  get selectList() {
    return this._selectList || this._ensureSelectList?.() || null;
  },
  set selectList(value) {
    this._selectList = value;
  },
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
  recentItemIds: null,

  activate(state) {
    const activation = Symbol("bib-finder activation");
    this.activation = activation;
    this.cacheRevision = 0;
    this.currentLoad = null;
    this.items = null;
    this.id = null;
    const recentItemIds = [
      ...new Set(
        (Array.isArray(state?.recentlyUsed) ? state.recentlyUsed : []).filter(
          (id) => typeof id === "string",
        ),
      ),
    ];
    this.recentItemIds = recentItemIds;

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
        load: ({ signal } = {}) => this.loadEntries(this.nextId, { signal }),
      },
      renderItem: (item, { matchIndices, highlight }) => {
        const li = document.createElement("li");
        let issueTooltip = null;
        const matches = matchIndices || [];
        if (item.description || this.showSource) li.classList.add("two-lines");
        const priBlock = document.createElement("div");
        priBlock.classList.add("primary-line");
        if (item.diagnostics?.length) {
          li.classList.add("has-parsing-issues");
          const trailingBlock = document.createElement("div");
          trailingBlock.classList.add("trailing-block");
          const issueBadge = document.createElement("span");
          const hasError = item.diagnostics.some(({ severity }) => severity === "error");
          issueBadge.classList.add(
            "parse-issues-badge",
            "badge",
            hasError ? "badge-error" : "badge-warning",
          );
          const noun = item.diagnostics.length === 1 ? "issue" : "issues";
          issueBadge.textContent = `${item.diagnostics.length} ${noun}`;
          const tooltipText = [
            item.fPath,
            ...item.diagnostics.map((diagnostic) => this.describeDiagnostic(diagnostic)),
          ].join("\n");
          issueBadge.setAttribute("aria-label", tooltipText);
          issueTooltip = lumine.tooltips.add(issueBadge, { title: tooltipText });
          trailingBlock.appendChild(issueBadge);
          priBlock.appendChild(trailingBlock);
        }
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
        if (item.description) {
          const descOffset = item.key.length + 1;
          const secBlock = document.createElement("div");
          secBlock.classList.add("secondary-line", "entry-summary");
          secBlock.appendChild(
            highlight(
              item.description,
              matches.map((x) => x - descOffset),
            ),
          );
          li.appendChild(secBlock);
        }
        if (this.showSource) {
          const pathBlock = document.createElement("div");
          pathBlock.classList.add("secondary-line", "source-line");
          pathBlock.textContent = item.fPath;
          lumine.icons.applyTo(
            pathBlock,
            { path: item.fPath, context: "bib-finder", hints: { directory: false } },
            { classes: ["icon-line"] },
          );
          li.appendChild(pathBlock);
        }
        return issueTooltip
          ? {
              element: li,
              destroy: () => issueTooltip.dispose(),
            }
          : li;
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
    const ensureSelectList = () => {
      if (this.selectListHost) return this.selectList;
      this.selectListHost = lumine.workspace.addSelectList(selectListOptions, {
        className: "bib-finder",
        crumb: "Bibliography",
      });
      this._selectList = this.selectListHost.getModel();
      return this._selectList;
    };
    this._ensureSelectList = ensureSelectList;
    // Creating the select-list host can synchronously build a modal view on a
    // cold window. Publish commands/config observers now, then build the host
    // once the package activation batch has left the stack.
    queueMicrotask(() => {
      if (this.disposables && this.activation === activation) ensureSelectList();
    });
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
        "bib-finder:clear-recent": {
          description: "Forget the recently used entries kept at the top of the list.",
          didDispatch: () => this._ensureSelectList?.()?.clearRecentItems(),
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
        this.invalidateCache();
      }),
      lumine.config.observe("bib-finder.allowDuplicate", (value) => {
        this.allowDuplicate = value;
        this.invalidateCache();
      }),
      lumine.config.observe("bib-finder.reloadAlways", (value) => {
        this.reloadAlways = value;
      }),
      lumine.config.onDidChange("bib-finder.recentCount", ({ newValue }) => {
        this._selectList?.setRecentLimit(newValue);
      }),
      lumine.config.observe("bib-finder.showSource", (value) => {
        this.showSource = value;
        this._selectList?.refresh();
      }),
      lumine.config.observe("bib-finder.path-1", (value) => {
        this.bibPath1 = value;
        this.invalidateCache();
      }),
      lumine.config.observe("bib-finder.path-2", (value) => {
        this.bibPath2 = value;
        this.invalidateCache();
      }),
      lumine.config.observe("bib-finder.path-3", (value) => {
        this.bibPath3 = value;
        this.invalidateCache();
      }),
      lumine.config.observe("bib-finder.path-4", (value) => {
        this.bibPath4 = value;
        this.invalidateCache();
      }),
      lumine.config.observe("bib-finder.path-5", (value) => {
        this.bibPath5 = value;
        this.invalidateCache();
      }),
      lumine.config.observe("bib-finder.paths", (value) => {
        this.bibPathArray = value;
        this.invalidateCache();
      }),
      lumine.config.onDidChange("bib-finder.ignoredNames", () => this.invalidateCache()),
      lumine.config.onDidChange("core.ignoredNames", () => this.invalidateCache()),
      lumine.config.onDidChange("core.excludeVcsIgnoredPaths", () => this.invalidateCache()),
      lumine.config.onDidChange("core.followSymlinks", () => this.invalidateCache()),
      lumine.project.onDidChangePaths(() => this.invalidateCache()),
    );
  },

  serialize() {
    return {
      recentlyUsed: this._selectList?.getRecentItemIds?.() || this.recentItemIds || [],
    };
  },

  async deactivate() {
    const host = this.selectListHost;
    this.activation = null;
    this.disposables?.dispose();
    this.disposables = null;
    this.invalidateCache();
    this.selectListHost = null;
    this._selectList = null;
    this._ensureSelectList = null;
    this.recentItemIds = null;
    this.targetEditor = null;
    await host?.destroy();
  },

  toggle(sourceId) {
    this._ensureSelectList?.();
    this.nextId = sourceId;
    this.targetEditor = lumine.workspace.getFocusedTextEditor();
    return this.selectListHost.toggle();
  },

  async refresh(sourceId) {
    this._ensureSelectList?.();
    this.invalidateCache();
    this.nextId = sourceId;
    if (!this.selectListHost) return;
    return this.selectListHost.isVisible() ? this.selectList.reload() : this.update(sourceId);
  },

  async update(sourceId) {
    if (!this.disposables) return;
    this._ensureSelectList?.();
    const list = this._selectList;
    const pending = this.loadEntries(sourceId);
    const request = this.currentLoad;
    const publication = await pending;
    if (!publication || !this.isCurrentLoad(request) || this._selectList !== list || list.destroyed)
      return;
    await list.setItems(publication.items);
    if (!this.isCurrentLoad(request) || this._selectList !== list || list.destroyed) return;
    return list.setStatus(publication.status);
  },

  invalidateCache() {
    this.items = null;
    this.cacheRevision++;
    this.currentLoad = null;
    this._selectList?.cancelSource("bibliography-changed");
  },

  isCurrentLoad(request) {
    return (
      request != null &&
      this.disposables != null &&
      this.disposables === request.owner &&
      this.currentLoad === request &&
      this.cacheRevision === request.revision &&
      !request.signal?.aborted
    );
  },

  async loadEntries(sourceId, { force = false, signal } = {}) {
    if (!this.disposables || signal?.aborted) return;
    const request = {
      owner: this.disposables,
      revision: this.cacheRevision,
      signal,
      sourceId,
      local: this.bibLocal,
      allowDuplicate: this.allowDuplicate,
      sources: [this.bibPath1, this.bibPath2, this.bibPath3, this.bibPath4, this.bibPath5],
      extraPaths: [...(this.bibPathArray ?? [])],
      ignoredNames: [...(lumine.config.get("bib-finder.ignoredNames") ?? [])],
      directoryPaths: [...lumine.project.getPaths()],
    };
    this.currentLoad = request;
    if (!force && this.items && !this.reloadAlways && this.id === sourceId) {
      return { items: this.items, status: null };
    }
    this.items = null;
    this.id = sourceId;
    try {
      const result = await this.buildEntries(request);
      if (!this.isCurrentLoad(request)) return;
      this.items = result.items;
      for (const { fPath, error } of result.errors) {
        if (!this.isCurrentLoad(request)) return;
        if (error.code === "ENOENT") {
          lumine.notifications.addError(`The bib file ${fPath} does not exist`);
        } else {
          console.error(`bib-finder: Error parsing ${fPath}:`, error);
        }
      }
      if (!this.isCurrentLoad(request)) return;
      this.reportFileDiagnostics(result.fileDiagnosticReports);
      if (!this.isCurrentLoad(request)) return;
      return { items: result.items, status: null };
    } catch (error) {
      if (!this.isCurrentLoad(request)) return;
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
  async crawlBibFiles(options = {}) {
    if (options.signal?.aborted) return [];
    const files = [];
    const crawl = lumine.project.crawl({
      inclusion: "**/*.bib",
      directoryPaths: options.directoryPaths,
      ignoredNames: options.ignoredNames ?? lumine.config.get("bib-finder.ignoredNames") ?? [],
      didFindPaths: (paths) => files.push(...paths),
    });
    const cancel = () => crawl.cancel?.();
    const cleanup = new Disposable(cancel);
    const owner = options.owner ?? this.disposables;
    owner?.add(cleanup);
    options.signal?.addEventListener("abort", cancel, { once: true });
    try {
      await crawl;
    } finally {
      owner?.remove(cleanup);
      options.signal?.removeEventListener("abort", cancel);
    }
    return files;
  },

  async cache(sourceId) {
    await this.loadEntries(sourceId, { force: true });
  },

  async buildEntries(request) {
    const { sourceId } = request;
    let paths = [];
    if (sourceId === "local" || (!sourceId && request.local)) {
      paths.push(...(await this.crawlBibFiles(request)));
    }
    for (const [index, sourcePath] of request.sources.entries()) {
      if ((sourceId === index + 1 || !sourceId) && sourcePath) paths.push(sourcePath);
    }
    if (!sourceId) paths.push(...request.extraPaths);
    const items = [];
    const errors = [];
    const keys = [];
    const itemIds = new Map();
    const fileDiagnosticReports = [];
    for (const fPath of paths) {
      if (!this.isCurrentLoad(request)) return;
      try {
        const text = await fsp.readFile(fPath, "utf-8");
        if (!this.isCurrentLoad(request)) return;
        const document = parseBibTeX(text, { sourceName: fPath });
        const { byEntry, fileDiagnostics } = this.partitionDiagnostics(
          document.entries,
          document.diagnostics,
        );
        for (const entry of document.entries) {
          const diagnostics = byEntry.get(entry) ?? [];
          if (entry.entryType === "xdata") {
            fileDiagnostics.push(...diagnostics);
            continue;
          }
          if (keys.includes(entry.key)) {
            fileDiagnostics.push(...diagnostics);
            continue;
          }
          const { description, searchDetails } = this.describeEntry(entry);
          const identity = `${entry.key}\0${fPath}`;
          const duplicateIndex = itemIds.get(identity) ?? 0;
          itemIds.set(identity, duplicateIndex + 1);
          items.push({
            id: `${identity}\0${duplicateIndex}`,
            key: entry.key,
            description: description,
            type: entry.entryType,
            // Keep the visible segments first so match indices still line up
            // with renderItem. Non-summary metadata follows as hidden search
            // text, retaining searches by DOI, ISBN, annotation, and the like.
            text: `${entry.key} ${description} @${entry.entryType}${
              searchDetails ? ` ${searchDetails}` : ""
            }`,
            fPath: fPath,
            diagnostics,
          });
          if (!request.allowDuplicate) {
            keys.push(entry.key);
          }
        }
        if (fileDiagnostics.length > 0) {
          fileDiagnostics.sort(
            (left, right) => left.location.start.offset - right.location.start.offset,
          );
          fileDiagnosticReports.push({ fPath, diagnostics: fileDiagnostics });
        }
      } catch (err) {
        if (!this.isCurrentLoad(request)) return;
        errors.push({ fPath, error: err });
      }
    }
    return { items, errors, fileDiagnosticReports };
  },

  describeEntry(entry) {
    const fields = Object.entries(entry.values)
      .filter(([, value]) => value != null)
      .map(([name, value]) => ({ name: name.toUpperCase(), value: this.normalizeText(value) }))
      .filter(({ value }) => value.length > 0);
    const fieldsByName = new Map(fields.map((field) => [field.name, field]));
    const summaryFields = [];
    const summaryNames = new Set();
    const summaryValues = new Set();
    const creator = fieldsByName.get("AUTHOR") ?? fieldsByName.get("EDITOR");
    const title = fieldsByName.get("TITLE");
    const subtitle = fieldsByName.get("SUBTITLE");
    const date = fieldsByName.get("DATE") ?? fieldsByName.get("YEAR");
    const addSummary = (value, names) => {
      for (const name of names) summaryNames.add(name);
      if (!value || summaryValues.has(value)) return;
      summaryFields.push(value);
      summaryValues.add(value);
    };

    addSummary(creator?.value, creator ? [creator.name] : []);
    addSummary(
      title && subtitle ? `${title.value}: ${subtitle.value}` : (title?.value ?? subtitle?.value),
      [title?.name, subtitle?.name].filter(Boolean),
    );
    addSummary(date?.value, date ? [date.name] : []);

    return {
      description: summaryFields.join(" • "),
      searchDetails: fields
        .filter((field) => !summaryNames.has(field.name))
        .map((field) => field.value)
        .join(" "),
    };
  },

  partitionDiagnostics(entries, diagnostics) {
    const byEntry = new Map();
    const fileDiagnostics = [];
    let entryIndex = 0;

    for (const diagnostic of diagnostics) {
      const startOffset = diagnostic.location.start.offset;
      while (
        entryIndex < entries.length &&
        entries[entryIndex].location.end.offset <= startOffset
      ) {
        entryIndex += 1;
      }
      const entry = entries[entryIndex];
      if (
        entry &&
        entry.location.start.offset <= startOffset &&
        diagnostic.location.end.offset <= entry.location.end.offset
      ) {
        let entryDiagnostics = byEntry.get(entry);
        if (!entryDiagnostics) {
          entryDiagnostics = [];
          byEntry.set(entry, entryDiagnostics);
        }
        entryDiagnostics.push(diagnostic);
      } else {
        fileDiagnostics.push(diagnostic);
      }
    }

    return { byEntry, fileDiagnostics };
  },

  describeDiagnostic(diagnostic) {
    const { line, column } = diagnostic.location.start;
    return `line ${line}, column ${column}: ${diagnostic.message}`;
  },

  reportFileDiagnostics(reports) {
    if (reports.length === 0) {
      return;
    }

    const issueCount = reports.reduce((count, { diagnostics }) => count + diagnostics.length, 0);
    const firstReport = reports[0];
    const first = firstReport.diagnostics[0];
    const issueNoun = issueCount === 1 ? "issue" : "issues";
    const detail =
      reports.length === 1
        ? `${firstReport.fPath} has ${issueCount} file-level ${issueNoun}. First: ${this.describeDiagnostic(first)}`
        : `${reports.length} bibliography sources have ${issueCount} file-level ${issueNoun}. First: ${firstReport.fPath}, ${this.describeDiagnostic(first)}`;
    const title =
      reports.length === 1
        ? "Bibliography source contains file-level parsing issues"
        : "Bibliography sources contain file-level parsing issues";
    lumine.notifications.addWarning(title, {
      detail,
      dismissable: true,
    });
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

  normalizeText(text) {
    return String(text).trim().replace(/\s+/g, " ");
  },
};
