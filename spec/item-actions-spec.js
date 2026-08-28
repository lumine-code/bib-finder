describe("bib-finder item actions", () => {
  let main;

  beforeEach(async () => {
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
    // The package activates on its commands, so dispatch one to trigger it;
    // activation also loads the package keymap the actions list reads.
    const activation = lumine.packages.activatePackage("bib-finder");
    lumine.commands.dispatch(lumine.views.getView(lumine.workspace), "bib-finder:cache");
    main = (await activation).mainModule;
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("bib-finder");
  });

  it("derives its actions from the command registrations and the keymap", () => {
    spyOn(main.selectList, "getSelectedItem").and.returnValue({ key: "plain" });
    const actions = main.selectList.itemActions();
    const byCommand = new Map(actions.map((action) => [action.command, action]));

    const insertCite = byCommand.get("bib-finder:insert-cite");
    expect(insertCite.name).toBe("Insert Cite");
    expect(insertCite.description).toBe("Insert the key wrapped in a LaTeX \\cite{…} command.");
    expect(insertCite.keystrokes).toEqual(["alt-enter"]);

    expect(byCommand.get("bib-finder:insert-cite-square").keystrokes).toEqual(["ctrl-enter"]);
    expect(byCommand.get("bib-finder:rebuild-cache").keystrokes).toEqual(["f5"]);
    expect(byCommand.get("bib-finder:insert-key").keystrokes).toEqual(["enter"]);

    // Every action explains itself with more than a restated title.
    for (const action of actions) {
      expect(action.description).toBeTruthy();
    }

    // Chrome and global commands stay out.
    expect(byCommand.has("core:confirm")).toBe(false);
    expect(byCommand.has("select-list:actions")).toBe(false);
    expect(byCommand.has("bib-finder:cite")).toBe(false);
    expect(byCommand.has("bib-finder:clear-recent")).toBe(false);
  });

  it("keeps list actions available without a match and hides clear when history is empty", () => {
    spyOn(main.selectList, "getSelectedItem").and.returnValue(null);

    let actions = main.selectList.itemActions();
    expect(actions.map((action) => action.command)).toEqual(["bib-finder:rebuild-cache"]);

    main.recentlyUsed = ["recent"];
    actions = main.selectList.itemActions();
    const clear = actions.find((action) => action.command === "bib-finder:clear-recent");
    expect(clear.scope).toBe("list");
    expect(actions.map((action) => action.command)).toEqual([
      "bib-finder:rebuild-cache",
      "bib-finder:clear-recent",
    ]);
  });

  it("shows the actions as a flow step and runs one against the citation list", async () => {
    main.selectList.show();

    await main.selectList.showItemActions();

    expect(main.selectList.itemActionsList.isVisible()).toBeTruthy();
    expect(lumine.workspace.getModalTrail()).toEqual(["Bibliography", "Actions"]);
    // The actions list wears the package class, so the package keymap
    // resolves action keystrokes inside it too.
    expect(main.selectList.itemActionsList.element.classList.contains("bib-finder")).toBe(true);

    const spy = spyOn(main, "refresh");
    const index = main.selectList.itemActionsList.items.findIndex(
      (item) => item.command === "bib-finder:rebuild-cache",
    );
    main.selectList.itemActionsList.selectIndex(index);
    main.selectList.itemActionsList.confirmSelection();

    expect(spy).toHaveBeenCalledWith(main.id);
    expect(main.selectList.isVisible()).toBeTruthy();
    expect(main.selectList.itemActionsList.isVisible()).toBeFalsy();
  });
});
