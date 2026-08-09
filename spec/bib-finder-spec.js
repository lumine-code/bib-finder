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

describe("bib-finder", () => {
  let mainModule, tempDir;

  beforeEach(async () => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bib-finder-")));
    fs.writeFileSync(path.join(tempDir, "a.bib"), BOOK_A);
    fs.mkdirSync(path.join(tempDir, "sub"));
    fs.writeFileSync(path.join(tempDir, "sub", "b.bib"), BOOK_B);
    fs.mkdirSync(path.join(tempDir, ".git"));
    fs.writeFileSync(path.join(tempDir, ".git", "c.bib"), BOOK_GIT);
    fs.writeFileSync(path.join(tempDir, "notes.txt"), "not a bibliography");
    lumine.project.setPaths([tempDir]);

    // The package defers activation until one of its commands is dispatched.
    const workspaceElement = lumine.views.getView(lumine.workspace);
    const activation = lumine.packages.activatePackage("bib-finder");
    lumine.commands.dispatch(workspaceElement, "bib-finder:open-source-1");
    mainModule = (await activation).mainModule;
  });

  afterEach(() => {
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
      lumine.config.set("bib-finder.bibPaths.path1", path.join(tempDir, "sub", "b.bib"));
      await mainModule.cache(1);
      expect(mainModule.items.map((item) => item.key)).toEqual(["fhck07"]);
      expect(mainModule.items[0].type).toBe("article");
    });
  });
});
