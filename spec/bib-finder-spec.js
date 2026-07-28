const fs = require("fs");
const os = require("os");
const path = require("path");

const BOOK_A = `@book{fhck07,
  author = "Hartmann, Friedel and Katz, Casimir",
  title = "Structural Analysis with Finite Elements",
  year = "2007",
}

@book{stng51,
  author = "S. Timoshenko and J. N. Goodier",
  title = "Theory of elasticity",
  year = "1951",
}
`;

const BOOK_B = `@article{fhck07,
  author = "Someone Else",
  title = "A duplicate key on purpose",
  year = "2020",
}
`;

const BOOK_GIT = `@book{gitc01,
  author = "Should never show up",
  title = "Lives inside .git",
  year = "1999",
}
`;

const BOOK_LATE = `@inproceedings{late99,
  author = "Written after the list opened",
  title = "A late arrival",
  year = "1999",
}
`;

describe("bib-finder", () => {
  let mainModule, modals, tempDir, workspaceElement;

  beforeEach(async () => {
    // The shared modal vocabulary lives in the editor checkout, which sits at a
    // different depth relative to this package in the workspace than it does in
    // CI, so resolve it through the running editor instead.
    modals = require(
      path.join(atom.getLoadSettings().resourcePath, "spec", "helpers", "modal-helpers"),
    );

    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bib-finder-")));
    fs.writeFileSync(path.join(tempDir, "a.bib"), BOOK_A);
    fs.mkdirSync(path.join(tempDir, "sub"));
    fs.writeFileSync(path.join(tempDir, "sub", "b.bib"), BOOK_B);
    fs.mkdirSync(path.join(tempDir, ".git"));
    fs.writeFileSync(path.join(tempDir, ".git", "c.bib"), BOOK_GIT);
    fs.writeFileSync(path.join(tempDir, "notes.txt"), "not a bibliography");
    atom.project.setPaths([tempDir]);

    workspaceElement = atom.views.getView(atom.workspace);
    jasmine.attachToDOM(workspaceElement);

    // The package defers activation until one of its commands is dispatched.
    const activation = atom.packages.activatePackage("bib-finder");
    atom.commands.dispatch(workspaceElement, "bib-finder:open-source-1");
    mainModule = (await activation).mainModule;
  });

  afterEach(async () => {
    if (atom.modals.isOpen()) {
      modals.cancel();
      await modals.settle();
    }
    atom.project.setPaths([]);
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Windows can refuse to delete freshly watched directories.
    }
  });

  describe("crawlBibFiles", () => {
    it("finds .bib files recursively with ripgrep, excluding .git", async () => {
      const files = await mainModule.crawlBibFiles(tempDir);
      const normalized = files.map((fPath) => path.normalize(fPath)).sort();
      expect(normalized).toEqual([path.join(tempDir, "a.bib"), path.join(tempDir, "sub", "b.bib")]);
    });
  });

  describe("cache", () => {
    it("parses entries from every local .bib file in the project", async () => {
      await mainModule.cache("local");
      const keys = mainModule.items.map((item) => item.key).sort();
      expect(keys).toEqual(["fhck07", "fhck07", "stng51"]);
      expect(keys).not.toContain("gitc01");

      const entry = mainModule.items.find((item) => item.key === "stng51");
      expect(entry.type).toBe("book");
      expect(entry.description).toContain("Theory of elasticity");
      expect(path.normalize(entry.fPath)).toBe(path.join(tempDir, "a.bib"));
    });

    it("drops duplicate keys when allowDuplicate is disabled", async () => {
      atom.config.set("bib-finder.allowDuplicate", false);
      await mainModule.cache("local");
      const keys = mainModule.items.map((item) => item.key).sort();
      expect(keys).toEqual(["fhck07", "stng51"]);
    });

    it("reads a configured global source only", async () => {
      atom.config.set("bib-finder.bibPaths.path1", path.join(tempDir, "sub", "b.bib"));
      await mainModule.cache(1);
      expect(mainModule.items.map((item) => item.key)).toEqual(["fhck07"]);
      expect(mainModule.items[0].type).toBe("article");
    });
  });

  describe("the citation list", () => {
    let editor;

    async function openList(command = "bib-finder:cite") {
      atom.commands.dispatch(workspaceElement, command);
      await modals.settle();
    }

    function keys() {
      return modals
        .visibleItems()
        .map((item) => item.key)
        .sort();
    }

    function itemFor(key) {
      return modals.visibleItems().find((item) => item.key === key);
    }

    function focus(key) {
      modals.activeSession().focusItem(itemFor(key));
    }

    beforeEach(async () => {
      editor = await atom.workspace.open();
    });

    it("lists every cached entry, duplicates included", async () => {
      await openList();

      expect(atom.modals.isOpen()).toBe(true);
      expect(keys()).toEqual(["fhck07", "fhck07", "stng51"]);
    });

    it("closes again when the command runs a second time", async () => {
      await openList();
      await openList();

      expect(atom.modals.isOpen()).toBe(false);
    });

    // The type is part of the haystack rather than decoration, so the sigil is
    // what makes `@article` a type filter and not a substring of a title.
    it("narrows to an entry type through the @ sigil", async () => {
      await openList();
      modals.setQuery("@article");
      await modals.settle();

      expect(modals.visibleItems().map((item) => item.type)).toEqual(["article"]);
    });

    it("matches words from the description", async () => {
      await openList();
      modals.setQuery("elasticity");
      await modals.settle();

      expect(keys()).toEqual(["stng51"]);
    });

    it("inserts the bare key on confirm", async () => {
      await openList();
      await modals.confirmItem((item) => item.key === "stng51");

      expect(editor.getText()).toBe("stng51");
      expect(atom.modals.isOpen()).toBe(false);
    });

    it("wraps the key in \\cite{}", async () => {
      await openList();
      focus("stng51");
      modals.dispatch("modals:cite");
      await modals.settle();

      expect(editor.getText()).toBe("\\cite{stng51}");
      expect(atom.modals.isOpen()).toBe(false);
    });

    it("wraps the key in \\cite[]{} and parks the cursor in the brackets", async () => {
      await openList();
      focus("stng51");
      modals.dispatch("modals:square");
      await modals.settle();

      expect(editor.getText()).toBe("\\cite[]{stng51}");
      expect(editor.getCursorBufferPosition().column).toBe(6);
    });

    it("stays open and re-reads the sources on refresh", async () => {
      await openList();
      fs.writeFileSync(path.join(tempDir, "late.bib"), BOOK_LATE);

      modals.dispatch("modals:update");
      await modals.settle();

      expect(atom.modals.isOpen()).toBe(true);
      expect(keys()).toContain("late99");
    });

    it("redraws the rows when the source path setting changes", async () => {
      atom.config.set("bib-finder.showSource", true);
      await openList();
      const row = () => modals.modalElement().querySelector("ol.list-group > li").textContent;

      expect(row()).toContain(".bib");

      atom.config.set("bib-finder.showSource", false);
      await modals.settle();

      expect(row()).not.toContain(".bib");
    });
  });
});
