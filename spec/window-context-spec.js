describe("bibliography pickers in editor windows", () => {
  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage("bib-finder");
  });
  afterEach(async () => {
    await lumine.packages.deactivatePackage("bib-finder");
    await lumine.workspace.discardEditorWindows();
  });
  it("keeps source requests and citation targets independent between native windows", async () => {
    const workspace = lumine.workspace;
    const first = await workspace.open();
    const extra = await workspace.openEditorWindow({ show: false });
    const second = workspace.buildTextEditor();
    extra.getEditorContainer().getActivePane().activateItem(second, { activatePane: true });
    const main = lumine.packages.getActivePackage("bib-finder").mainModule;
    const item = {
      id: "citation",
      key: "citation",
      text: "citation",
      description: "",
      type: "article",
      diagnostics: [],
    };
    spyOn(main, "buildEntries").and.resolveTo({
      items: [item],
      errors: [],
      fileDiagnosticReports: [],
    });
    await lumine.commands.dispatch(first.getElement(), "bib-finder:cite");
    await lumine.commands.dispatch(second.getElement(), "bib-finder:cite");
    const local = main.windowLists.get(workspace.getMainWindow());
    const remote = main.windowLists.get(extra);
    expect(local.host.isVisible()).toBe(true);
    expect(remote.model.getElement().ownerDocument).toBe(extra.getDocument());
    await remote.model.selectItem(item);
    await remote.model.runAction("bib-finder:insert-key");
    expect(second.getText()).toBe("citation");
    expect(first.getText()).toBe("");
    expect(local.model.getRecentItemIds()).toEqual(remote.model.getRecentItemIds());
    await workspace.attachWindow(extra);
    expect(main.windowLists.has(extra)).toBe(false);
  });
});
