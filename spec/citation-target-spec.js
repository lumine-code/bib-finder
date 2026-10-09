describe("bib-finder citation command target", () => {
  let main, workspaceElement, documentEditor, embeddedEditors;
  const item = {
    id: "reference\u0000source.bib\u00000",
    key: "reference",
    description: "A reference",
    type: "book",
    text: "reference A reference @book",
    fPath: "source.bib",
  };

  beforeEach(async () => {
    workspaceElement = lumine.views.getView(lumine.workspace);
    jasmine.attachToDOM(workspaceElement);
    embeddedEditors = [];
    documentEditor = await lumine.workspace.open();
    documentEditor.setText("Document: ");
    documentEditor.setCursorBufferPosition(documentEditor.getEofBufferPosition());
    documentEditor.getBuffer().clearUndoStack();
    lumine.config.set("bib-finder.bibLocal", false);
    lumine.config.set("bib-finder.paths", []);
    main = (await lumine.packages.activatePackage("bib-finder")).mainModule;
    spyOn(main, "toggle").and.callThrough();
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("bib-finder");
    for (const editor of embeddedEditors) editor.destroy();
    documentEditor.destroy();
  });

  function embeddedEditor(mini = false) {
    const editor = lumine.workspace.buildTextEditor({ mini });
    embeddedEditors.push(editor);
    const element = lumine.views.getView(editor);
    workspaceElement.appendChild(element);
    element.focus();
    return { editor, element };
  }

  async function cite(target, command = "bib-finder:cite") {
    lumine.commands.dispatch(target, command);
    await main.toggle.calls.mostRecent().returnValue;
    await main.selectList.setItems([item]);
    await main.selectList.runAction("bib-finder:insert-cite");
  }

  it("uses the active document rather than a focused mini editor", async () => {
    const { editor: mini, element } = embeddedEditor(true);
    mini.setText("Prompt");
    expect(lumine.workspace.getFocusedTextEditor()).toBe(mini);

    await cite(element);

    expect(documentEditor.getText()).toBe("Document: \\cite{reference}");
    expect(mini.getText()).toBe("Prompt");
    documentEditor.undo();
    expect(documentEditor.getText()).toBe("Document: ");
  });

  it("uses the active document when a workspace panel has focus", async () => {
    const button = document.createElement("button");
    workspaceElement.appendChild(button);
    button.focus();
    expect(lumine.workspace.getFocusedTextEditor()).toBeNull();

    await cite(button, "bib-finder:cite-from-local");

    expect(documentEditor.getText()).toBe("Document: \\cite{reference}");
  });

  it("keeps a non-mini command origin ahead of the active pane editor", async () => {
    const { editor: origin, element } = embeddedEditor();
    origin.setText("Origin: ");
    origin.setCursorBufferPosition(origin.getEofBufferPosition());
    lumine.views.getView(documentEditor).focus();
    expect(lumine.workspace.getActiveTextEditor()).toBe(documentEditor);

    await cite(element, "bib-finder:cite-from-source-1");

    expect(origin.getText()).toBe("Origin: \\cite{reference}");
    expect(documentEditor.getText()).toBe("Document: ");
  });
});
