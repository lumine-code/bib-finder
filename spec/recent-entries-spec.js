const fs = require("fs");
const os = require("os");
const path = require("path");

const SOURCE = `@book{fhck07,
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

describe("bib-finder recent entries", () => {
  let main, tempDir, workspaceElement;

  beforeEach(async () => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bib-finder-recent-")));
    fs.writeFileSync(path.join(tempDir, "a.bib"), SOURCE);
    lumine.project.setPaths([tempDir]);
    lumine.config.set("bib-finder.recentCount", 10);

    workspaceElement = lumine.views.getView(lumine.workspace);
    jasmine.attachToDOM(workspaceElement);

    // The package activates on its commands, so dispatch one to trigger it —
    // `clear-recent` because it is the only one that starts no caching of its
    // own to race the seeding below.
    const activation = lumine.packages.activatePackage("bib-finder");
    lumine.commands.dispatch(workspaceElement, "bib-finder:clear-recent");
    main = (await activation).mainModule;
    main.clearRecent();

    // The entries come from the user's own sources, so the specs seed the
    // cache directly. `nextId` matches what was cached, so `willShow` finds
    // the list current and leaves these rows alone.
    await main.cache("local");
    main.nextId = "local";
    await main.selectList.update({ items: main.items, recentIds: main.recentlyUsed });
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("bib-finder");
    lumine.project.setPaths([]);
    try {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } catch {
      // Windows can refuse to delete freshly watched directories.
    }
  });

  function entry(key) {
    return main.items.find((item) => item.key === key);
  }

  async function showList() {
    main.selectList.show();
    await main.selectList.update({});
    return main.selectList;
  }

  it("keeps the entries it inserted at the top, ruled off from the rest", async () => {
    main.recordRecent(entry("stng51"));

    const selectList = await showList();

    expect(selectList.items[0].key).toBe("stng51");
    const separator = selectList.element.querySelector(".select-list-separator");
    expect(separator.previousElementSibling.textContent).toContain("stng51");
    expect(separator.nextElementSibling.textContent).not.toContain("stng51");
  });

  it("records the entry for every action over it, not only the bare insert", async () => {
    const editor = await lumine.workspace.open();
    main.targetEditor = editor;
    const selectList = await showList();
    await selectList.selectItem(entry("stng51"));

    main.performAction("square");

    expect(editor.getText()).toBe("\\cite[]{stng51}");
    expect(main.recentlyUsed).toEqual(["stng51"]);
    expect(main.serialize()).toEqual({ recentlyUsed: ["stng51"] });
  });

  it("records nothing when there is no editor to insert into", async () => {
    main.targetEditor = null;
    const selectList = await showList();
    await selectList.selectItem(entry("stng51"));

    main.performAction("name");

    expect(main.recentlyUsed).toEqual([]);
  });

  it("stands the section down under a query", async () => {
    main.recordRecent(entry("stng51"));
    const selectList = await showList();

    selectList.refs.queryEditor.setText("Hartmann");
    await lumine.views.getNextUpdatePromise();

    expect(selectList.element.querySelector(".select-list-separator")).toBeNull();
  });

  it("drops one entry from the section without closing the list", async () => {
    main.recordRecent(entry("fhck07"));
    main.recordRecent(entry("stng51"));
    const selectList = await showList();
    await selectList.selectItem(entry("stng51"));

    lumine.commands.dispatch(selectList.element, "bib-finder:remove-from-recent");
    await lumine.views.getNextUpdatePromise();

    expect(main.recentlyUsed).toEqual(["fhck07"]);
    expect(selectList.isVisible()).toBe(true);
    expect(selectList.getSelectedItem().key).toBe("stng51");
  });

  it("offers the action only while a recent entry is selected", async () => {
    main.recordRecent(entry("stng51"));
    const selectList = await showList();

    await selectList.selectItem(entry("stng51"));
    let actions = selectList.itemActions().map((action) => action.command);
    expect(actions).toContain("bib-finder:remove-from-recent");

    await selectList.selectItem(entry("fhck07"));
    actions = selectList.itemActions().map((action) => action.command);
    expect(actions).not.toContain("bib-finder:remove-from-recent");
    // The rest of the package's actions are unaffected by the filter.
    expect(actions).toContain("bib-finder:insert-cite");
  });

  it("caps the list at the configured count", () => {
    lumine.config.set("bib-finder.recentCount", 1);
    main.recordRecent(entry("fhck07"));
    main.recordRecent(entry("stng51"));

    expect(main.recentlyUsed).toEqual(["stng51"]);
  });

  it("forgets everything on clear-recent", async () => {
    main.recordRecent(entry("stng51"));
    const selectList = await showList();

    lumine.commands.dispatch(workspaceElement, "bib-finder:clear-recent");
    await lumine.views.getNextUpdatePromise();

    expect(main.recentlyUsed).toEqual([]);
    expect(selectList.element.querySelector(".select-list-separator")).toBeNull();
  });

  it("restores what it serialized", () => {
    main.recordRecent(entry("stng51"));
    const state = main.serialize();
    main.deactivate();

    main.activate(state);

    expect(main.recentlyUsed).toEqual(["stng51"]);
  });
});
