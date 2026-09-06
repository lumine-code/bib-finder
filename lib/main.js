const { CompositeDisposable } = require("lumine");
const fsp = require("fs/promises");
const { parse: parseBibTeX } = require("@lumine-code/bibtex-parse");

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
    this.targetEditor = lumine.workspace.getFocusedTextEditor();
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
    const fileDiagnosticReports = [];
    for (const fPath of paths) {
      try {
        const text = await fsp.readFile(fPath, "utf-8");
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
          this.items.push({
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
          if (!this.allowDuplicate) {
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
        if (err.code === "ENOENT") {
          lumine.notifications.addError(`The bib file ${fPath} does not exist`);
        } else {
          console.error(`bib-finder: Error parsing ${fPath}:`, err);
        }
      }
    }
    this.reportFileDiagnostics(fileDiagnosticReports);
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
