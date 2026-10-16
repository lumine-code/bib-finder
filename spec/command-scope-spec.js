describe("bib-finder menu command scopes", () => {
  const commands = [
    "cite",
    "cite-from-local",
    "cite-from-source-1",
    "cite-from-source-2",
    "cite-from-source-3",
    "cite-from-source-4",
    "cite-from-source-5",
  ].map((name) => `bib-finder:${name}`);
  let editor, mini, button;

  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage("bib-finder");
    editor = await lumine.workspace.open();
    mini = lumine.workspace.buildTextEditor({ mini: true });
    button = document.createElement("button");
    lumine.workspace.getElement().append(mini.getElement(), button);
  });

  afterEach(async () => {
    button.remove();
    mini.destroy();
    editor.destroy();
    await lumine.packages.deactivatePackage("bib-finder");
  });

  it("requires the focused writable editor rather than an unrelated surface", () => {
    for (const command of commands) {
      expect(lumine.commands.canDispatch(editor.getElement(), command))
        .withContext(command)
        .toBe(true);
      expect(lumine.commands.canDispatch(button, command)).withContext(command).toBe(false);
      expect(lumine.commands.canDispatch(mini.getElement(), command))
        .withContext(command)
        .toBe(false);
    }
    editor.getElement().setAttribute("readonly", "");
    for (const command of commands)
      expect(lumine.commands.canDispatch(editor.getElement(), command))
        .withContext(command)
        .toBe(false);
  });

  it("does not consume mutation shortcuts in a read-only editor", () => {
    const element = editor.getElement();
    for (const name of ["cite"])
      expect(
        lumine.keymaps.findKeyBindings({ target: element, command: `bib-finder:${name}` }).length,
      )
        .withContext(name)
        .toBeGreaterThan(0);
    element.setAttribute("readonly", "");
    for (const name of ["cite"])
      expect(lumine.keymaps.findKeyBindings({ target: element, command: `bib-finder:${name}` }))
        .withContext(name)
        .toEqual([]);
    for (const name of ["open-source-1"])
      expect(
        lumine.keymaps.findKeyBindings({ target: element, command: `bib-finder:${name}` }).length,
      )
        .withContext(name)
        .toBeGreaterThan(0);
  });

  it("does not offer document actions in an empty workspace", () => {
    editor.destroy();
    for (const command of commands)
      expect(lumine.commands.canDispatch(lumine.workspace.getElement(), command))
        .withContext(command)
        .toBe(false);
  });
});
