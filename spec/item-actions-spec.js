describe("bib-finder item actions", () => {
  let main;

  beforeEach(async () => {
    jasmine.attachToDOM(atom.views.getView(atom.workspace));
    // The package activates on its commands, so dispatch one to trigger it;
    // activation also loads the package keymap the actions list reads.
    const activation = atom.packages.activatePackage("bib-finder");
    atom.commands.dispatch(atom.views.getView(atom.workspace), "bib-finder:cache");
    main = (await activation).mainModule;
  });

  afterEach(async () => {
    await atom.packages.deactivatePackage("bib-finder");
  });

  it("derives its actions from the command registrations and the keymap", () => {
    const actions = main.selectList.itemActions();
    const byCommand = new Map(actions.map((action) => [action.command, action]));

    const insertCite = byCommand.get("bib-finder:insert-cite");
    expect(insertCite.name).toBe("Insert Cite");
    expect(insertCite.description).toBe("Insert the key wrapped in a LaTeX \\cite{…} command");
    expect(insertCite.keystrokes).toEqual(["alt-enter"]);

    expect(byCommand.get("bib-finder:insert-cite-square").keystrokes).toEqual(["ctrl-enter"]);
    expect(byCommand.get("bib-finder:rebuild-cache").keystrokes).toEqual(["f5"]);
    // The bare insert is what Enter's confirm does, so it carries no binding.
    expect(byCommand.get("bib-finder:insert-key").keystrokes).toEqual([]);

    // Every action explains itself with more than a restated title.
    for (const action of actions) {
      expect(action.description).toBeTruthy();
    }

    // Chrome and global commands stay out.
    expect(byCommand.has("core:confirm")).toBe(false);
    expect(byCommand.has("select-list:actions")).toBe(false);
    expect(byCommand.has("bib-finder:cite")).toBe(false);
  });

  it("shows the actions as a flow step and runs one against the citation list", async () => {
    main.selectList.show();

    await main.selectList.showItemActions();

    expect(main.selectList.itemActionsList.isVisible()).toBeTruthy();
    expect(atom.workspace.getModalTrail()).toEqual(["Bibliography", "Actions"]);
    // The actions list wears the package class, so the package keymap
    // resolves action keystrokes inside it too.
    expect(main.selectList.itemActionsList.element.classList.contains("bib-finder")).toBe(true);

    const spy = spyOn(main, "refresh");
    const index = main.selectList.itemActionsList.items.findIndex(
      (item) => item.command === "bib-finder:rebuild-cache",
    );
    main.selectList.itemActionsList.selectIndex(index);
    main.selectList.itemActionsList.confirmSelection();

    expect(spy).toHaveBeenCalled();
    expect(main.selectList.isVisible()).toBeTruthy();
    expect(main.selectList.itemActionsList.isVisible()).toBeFalsy();
  });
});
