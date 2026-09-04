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

  it("derives its actions from the command registrations and the keymap", async () => {
    main.selectListHost.getPanel();
    const item = {
      id: "plain\u0000source.bib\u00000",
      key: "plain",
      description: "Plain entry",
      type: "book",
      text: "plain Plain entry @book",
      fPath: "source.bib",
    };
    await main.selectList.setItems([item]);
    const actions = main.selectList.getAvailableActions();
    const byCommand = new Map(actions.map((action) => [action.command, action]));

    const insertCite = byCommand.get("bib-finder:insert-cite");
    expect(insertCite.name).toBe("Insert Cite");
    expect(insertCite.description).toBe("Insert the key wrapped in a LaTeX \\cite{…} command.");
    expect(insertCite.keystrokes).toEqual(["alt-enter"]);

    expect(byCommand.get("bib-finder:insert-cite-square").keystrokes).toEqual(["ctrl-enter"]);
    expect(byCommand.get("bib-finder:rebuild-cache").keystrokes).toEqual(["f5"]);
    expect(byCommand.get("bib-finder:insert-key").primary).toBe(true);

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

  it("wraps summaries while keeping source paths on one line", async () => {
    main.showSource = true;
    const item = {
      id: "plain\u0000source.bib\u00000",
      key: "plain",
      description: "Plain entry",
      type: "book",
      text: "plain Plain entry @book variant=american",
      fPath: "a/very/long/path/to/source.bib",
    };

    await main.selectListHost.show();
    await main.selectList.setItems([item]);

    const row = main.selectList.getElement().querySelector("li");
    expect(row.classList.contains("two-lines")).toBe(true);
    expect(row.querySelector(".entry-summary").textContent).toBe("Plain entry");
    expect(row.querySelector(".source-line").textContent).toBe(item.fPath);
    const summaryStyle = getComputedStyle(row.querySelector(".entry-summary"));
    expect(summaryStyle.whiteSpace).toBe("normal");
    expect(summaryStyle.overflowWrap).toBe("anywhere");
    expect(getComputedStyle(row.querySelector(".source-line")).whiteSpace).toBe("nowrap");

    main.selectList.getQueryEditor().setText("variant=american");
    await lumine.views.getNextUpdatePromise();
    expect(main.selectList.getFilteredItems()).toEqual([item]);
    expect(main.selectList.getElement().querySelector("li").textContent).not.toContain(
      "variant=american",
    );
    expect(main.selectList.getElement().querySelector(".character-match")).toBeNull();
  });

  it("keeps list actions available without a match and hides clear when history is empty", async () => {
    await main.selectList.selectNone();

    let actions = main.selectList.getAvailableActions();
    expect(actions.map((action) => action.command)).toEqual(["bib-finder:rebuild-cache"]);

    await main.selectList.setRecentItemIds(["recent"]);
    actions = main.selectList.getAvailableActions();
    const clear = actions.find((action) => action.command === "select-list:clear-recents");
    expect(clear.context).toBe("dialog");
    expect(actions.map((action) => action.command)).toEqual([
      "bib-finder:rebuild-cache",
      "select-list:clear-recents",
    ]);
  });

  it("shows the actions as a flow step and runs one against the citation list", async () => {
    await main.selectListHost.show();

    await main.selectListHost.showActions();

    expect(lumine.workspace.getModalTrail()).toEqual(["Bibliography", "Actions"]);

    const spy = spyOn(main, "refresh");
    lumine.workspace.popModal();
    await main.selectList.runAction("bib-finder:rebuild-cache");

    expect(spy).toHaveBeenCalledWith(main.id);
    expect(main.selectListHost.isVisible()).toBeTruthy();
  });
});
