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

const MULTILINE_ENTRY = `@incollection{westfahl:space,
  author = {Westfahl, Gary},
  title = {The True Frontier},
  subtitle = {Confronting and Avoiding the Realities of Space in {American}
              Science Fiction Films},
  pages = {55--65},
  crossref = {westfahl:frontier},
  langidopts = {variant=american},
  annotation = {A cross-referenced article from a \\texttt{collection}. This is
                deliberately long metadata that should remain searchable},
}
`;

const UNICODE_ENTRY = String.raw`@article{muller2026,
  author = {M\"{u}ller, Anna},
  title = {Repeated \alpha{} and \alpha},
  year = 2026,
}
`;

const PARTIALLY_BROKEN_LIBRARY = `@article{before,
  title = {Before},
}

@article{broken,
  title {Missing equals},
}

@book{after,
  title = {After},
}
`;

const INHERITED_ENTRY = `@xdata{shared,
  author = {Inherited Author},
  publisher = {Inherited Press},
}

@incollection{child,
  title = {A Chapter},
  xdata = {shared},
}
`;

describe("bib-finder", () => {
  let mainModule, tempDir;

  beforeEach(async () => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bib-finder-")));
    fs.writeFileSync(path.join(tempDir, "a.bib"), BOOK_A);
    fs.mkdirSync(path.join(tempDir, "sub"));
    fs.writeFileSync(path.join(tempDir, "sub", "b.bib"), BOOK_B);
    fs.mkdirSync(path.join(tempDir, ".git"));
    fs.writeFileSync(path.join(tempDir, ".git", "c.bib"), BOOK_GIT);
    fs.mkdirSync(path.join(tempDir, "ignored"));
    fs.writeFileSync(path.join(tempDir, "ignored", "c.bib"), BOOK_GIT);
    fs.writeFileSync(path.join(tempDir, ".gitignore"), "ignored/\n");
    fs.writeFileSync(path.join(tempDir, "notes.txt"), "not a bibliography");
    lumine.project.setPaths([tempDir]);
    lumine.config.set("core.excludeVcsIgnoredPaths", true);

    // The package defers activation until one of its commands is dispatched.
    const workspaceElement = lumine.views.getView(lumine.workspace);
    const activation = lumine.packages.activatePackage("bib-finder");
    lumine.commands.dispatch(workspaceElement, "bib-finder:open-source-1");
    mainModule = (await activation).mainModule;
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("bib-finder");
    lumine.project.setPaths([]);
    try {
      // Retries because Windows keeps a directory non-empty until the last handle on a
      // child closes, and `force` swallows only ENOENT.
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
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

    it("adds package ignored names to the editor's crawl policy", async () => {
      lumine.config.set("bib-finder.ignoredNames", ["sub"]);
      const files = await mainModule.crawlBibFiles();
      expect(files.map((filePath) => path.normalize(filePath))).toEqual([
        path.join(tempDir, "a.bib"),
      ]);
    });

    it("follows the editor's VCS discovery policy", async () => {
      lumine.config.set("core.excludeVcsIgnoredPaths", false);
      const files = await mainModule.crawlBibFiles();
      expect(files.map((filePath) => path.normalize(filePath))).toContain(
        path.join(tempDir, "ignored", "c.bib"),
      );
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
      expect(entry.text).toContain("stng51");
      expect(entry.text).toContain("@book");
      expect(path.normalize(entry.fPath)).toBe(path.join(tempDir, "a.bib"));
    });

    it("drops duplicate keys when allowDuplicate is disabled", async () => {
      lumine.config.set("bib-finder.allowDuplicate", false);
      await mainModule.cache("local");
      const keys = mainModule.items.map((item) => item.key).sort();
      expect(keys).toEqual(["fhck07", "stng51"]);
    });

    it("reads a configured global source only", async () => {
      lumine.config.set("bib-finder.path-1", path.join(tempDir, "sub", "b.bib"));
      await mainModule.cache(1);
      expect(mainModule.items.map((item) => item.key)).toEqual(["fhck07"]);
      expect(mainModule.items[0].type).toBe("article");
    });

    it("reads every source from the configured paths array", async () => {
      lumine.config.set("bib-finder.bibLocal", false);
      lumine.config.set("bib-finder.paths", [
        path.join(tempDir, "a.bib"),
        path.join(tempDir, "sub", "b.bib"),
      ]);
      await mainModule.cache();
      expect(mainModule.items.map((item) => item.key).sort()).toEqual([
        "fhck07",
        "fhck07",
        "stng51",
      ]);
    });

    it("builds a compact summary while retaining non-summary fields for search", async () => {
      fs.writeFileSync(path.join(tempDir, "multiline.bib"), MULTILINE_ENTRY);

      await mainModule.cache("local");

      const entry = mainModule.items.find((item) => item.key === "westfahl:space");
      expect(entry.description).toBe(
        "Westfahl, Gary • The True Frontier: " +
          "Confronting and Avoiding the Realities of Space in American Science Fiction Films",
      );
      expect(entry.description).not.toContain("cross-referenced");
      expect(entry.description).not.toContain("variant=american");
      expect(entry.description).not.toContain("55–65");
      expect(entry.text).toContain("cross-referenced");
      expect(entry.text).toContain("variant=american");
      expect(entry.text).not.toMatch(/[\r\n]|\s{2,}/);

      await mainModule.selectList.setItems(mainModule.items);
      await mainModule.selectListHost.show();
      mainModule.selectList.getQueryEditor().setText("deliberately long metadata");
      await lumine.views.getNextUpdatePromise();
      expect(mainModule.selectList.getFilteredItems().map((item) => item.key)).toEqual([
        "westfahl:space",
      ]);
    });

    it("uses decoded Unicode values from the maintained parser", async () => {
      fs.writeFileSync(path.join(tempDir, "unicode.bib"), UNICODE_ENTRY);

      await mainModule.cache("local");

      const entry = mainModule.items.find((item) => item.key === "muller2026");
      expect(entry.description).toBe("Müller, Anna • Repeated α and α • 2026");
      expect(entry.text).not.toContain("\\alpha");
    });

    it("indexes inherited values without exposing xdata records as citations", async () => {
      fs.writeFileSync(path.join(tempDir, "inherited.bib"), INHERITED_ENTRY);

      await mainModule.cache("local");

      expect(mainModule.items.some((item) => item.key === "shared")).toBeFalse();
      const entry = mainModule.items.find((item) => item.key === "child");
      expect(entry.description).toBe("Inherited Author • A Chapter");
      expect(entry.text).toContain("Inherited Press");
    });

    it("keeps valid entries around malformed input and reports one warning", async () => {
      const sourcePath = path.join(tempDir, "broken.bib");
      fs.writeFileSync(sourcePath, PARTIALLY_BROKEN_LIBRARY);
      lumine.config.set("bib-finder.path-1", sourcePath);
      const addWarning = spyOn(lumine.notifications, "addWarning");

      await mainModule.cache(1);

      expect(mainModule.items.map((item) => item.key)).toEqual(["before", "after"]);
      expect(addWarning).toHaveBeenCalledTimes(1);
      const [message, options] = addWarning.calls.mostRecent().args;
      expect(message).toBe("Bibliography source contains parsing issues");
      expect(options.detail).toContain("broken.bib has 1 issue");
      expect(options.detail).toContain("line 6");
      expect(options.dismissable).toBeTrue();
    });
  });
});
