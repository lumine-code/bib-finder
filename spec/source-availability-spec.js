describe("configured bibliography source availability", () => {
  it("uses configuration without reading source files and invalidates when it changes", async () => {
    await lumine.packages.activatePackage("bib-finder");
    const changed = spyOn(lumine.commands, "invalidateAvailability").and.callThrough();
    const target = lumine.workspace.getElement();
    try {
      for (let n = 1; n <= 5; n++) {
        const key = "bib-finder.path-" + n,
          command = "bib-finder:open-source-" + n;
        lumine.config.set(key, "");
        expect(lumine.commands.canDispatch(target, command)).toBe(false);
        lumine.config.set(key, "unopened-source.bib");
        expect(lumine.commands.canDispatch(target, command)).toBe(true);
        lumine.config.unset(key);
      }
      expect(changed).toHaveBeenCalled();
    } finally {
      await lumine.packages.deactivatePackage("bib-finder");
    }
  });
});
