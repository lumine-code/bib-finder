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
    await main.selectList.clearRecentItems();

    // The entries come from the user's own sources, so the specs seed the
    // cache directly. `nextId` matches what was cached, so the snapshot source finds
    // the list current and leaves these rows alone.
    await main.cache("local");
    main.nextId = "local";
    await main.selectList.setItems(main.items);
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
    await main.selectListHost.show();
    return main.selectList;
  }

  it("keeps the entries it inserted at the top, ruled off from the rest", async () => {
    await main.selectList.recordRecentItem(entry("stng51"));

    const selectList = await showList();

    expect(selectList.getFilteredItems()[0].key).toBe("stng51");
    const separator = selectList.getElement().querySelector(".select-list-separator");
    expect(separator.previousElementSibling.textContent).toContain("stng51");
    expect(separator.nextElementSibling.textContent).not.toContain("stng51");
  });

  it("records the entry for every action over it, not only the bare insert", async () => {
    const editor = await lumine.workspace.open();
    main.targetEditor = editor;
    const selectList = await showList();
    await selectList.selectItem(entry("stng51"));

    await selectList.runAction("bib-finder:insert-cite-square");

    expect(editor.getText()).toBe("\\cite[]{stng51}");
    expect(selectList.getRecentItemIds()).toEqual([entry("stng51").id]);
    expect(main.workspaceState.get("recentlyUsed", [])).toEqual([entry("stng51").id]);
  });

  it("records nothing when there is no editor to insert into", async () => {
    main.targetEditor = null;
    const selectList = await showList();
    await selectList.selectItem(entry("stng51"));

    const result = await selectList.runAction("bib-finder:insert-key");

    expect(result.status).toBe("disabled");
    expect(selectList.getRecentItemIds()).toEqual([]);
  });

  it("stands the section down under a query", async () => {
    await main.selectList.recordRecentItem(entry("stng51"));
    const selectList = await showList();

    selectList.getQueryEditor().setText("Hartmann");
    await lumine.views.getNextUpdatePromise();

    expect(selectList.getElement().querySelector(".select-list-separator")).toBeNull();
  });

  it("drops one entry from the section without closing the list", async () => {
    await main.selectList.recordRecentItem(entry("fhck07"));
    await main.selectList.recordRecentItem(entry("stng51"));
    const selectList = await showList();
    await selectList.selectItem(entry("stng51"));

    await selectList.runAction("select-list:remove-recent");

    expect(selectList.getRecentItemIds()).toEqual([entry("fhck07").id]);
    expect(main.selectListHost.isVisible()).toBe(true);
    expect(selectList.getSelectedItem().key).toBe("stng51");
  });

  it("offers the action only while a recent entry is selected", async () => {
    await main.selectList.recordRecentItem(entry("stng51"));
    const selectList = await showList();

    await selectList.selectItem(entry("stng51"));
    let actions = selectList.getAvailableActions().map((action) => action.command);
    expect(actions).toContain("select-list:remove-recent");

    await selectList.selectItem(entry("fhck07"));
    actions = selectList.getAvailableActions().map((action) => action.command);
    expect(actions).not.toContain("select-list:remove-recent");
    // The rest of the package's actions are unaffected by the filter.
    expect(actions).toContain("bib-finder:insert-cite");
  });

  it("caps the list at the configured count", async () => {
    lumine.config.set("bib-finder.recentCount", 1);
    await main.selectList.recordRecentItem(entry("fhck07"));
    await main.selectList.recordRecentItem(entry("stng51"));

    expect(main.selectList.getRecentItemIds()).toEqual([entry("stng51").id]);
  });

  it("forgets everything on clear-recent", async () => {
    await main.selectList.recordRecentItem(entry("stng51"));
    const selectList = await showList();

    await lumine.commands.dispatch(workspaceElement, "bib-finder:clear-recent");

    expect(selectList.getRecentItemIds()).toEqual([]);
    expect(selectList.getElement().querySelector(".select-list-separator")).toBeNull();
  });

  it("loads persisted project recents after package reactivation", async () => {
    await main.selectList.recordRecentItem(entry("stng51"));
    const saved = main.workspaceState.get("recentlyUsed", []);
    await lumine.packages.deactivatePackage("bib-finder");
    main = (await lumine.packages.activatePackage("bib-finder")).mainModule;

    expect(main.selectList.getRecentItemIds()).toEqual(saved);
  });
  it("projects stored history changes into the existing list and persists the next use", async () => {
    const list = main.selectList;
    const restored = entry("stng51").id;
    await main.workspaceState.update("recentlyUsed", [restored]);
    expect(main.selectList).toBe(list);
    expect(list.getRecentItemIds()).toEqual([restored]);
    await list.recordRecentItem(entry("fhck07"));
    expect(main.workspaceState.get("recentlyUsed", [])).toEqual([
      list.getItemId(entry("fhck07")),
      restored,
    ]);
  });
  it("keeps concurrent records from two window lists and honours removal and clear", async () => {
    const extra = await lumine.workspace.openEditorWindow({ show: false });
    try {
      const local = main.selectList;
      const remote = main._ensureSelectList(extra);
      const first = entry("fhck07");
      const second = entry("stng51");
      const ids = [local.getItemId(second), local.getItemId(first)];
      await Promise.all([local.recordRecentItem(first), remote.recordRecentItem(second)]);
      expect(main.workspaceState.get("recentlyUsed")).toEqual(ids);
      expect(local.getRecentItemIds()).toEqual(ids);
      expect(remote.getRecentItemIds()).toEqual(ids);
      await local.removeRecentItem(ids[1]);
      expect(main.workspaceState.get("recentlyUsed")).toEqual([ids[0]]);
      await remote.clearRecentItems();
      expect(main.workspaceState.get("recentlyUsed")).toEqual([]);
    } finally {
      await lumine.workspace.closeEditorWindow(extra);
    }
  });
});
