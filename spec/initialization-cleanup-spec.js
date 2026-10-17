describe("bib-finder recovery bootstrap", () => {
  it("unloads after external initialization before activation", async () => {
    if (lumine.packages.isPackageLoaded("bib-finder"))
      await lumine.packages.unloadPackage("bib-finder", { serialize: false });
    const pack = lumine.packages.loadPackage("bib-finder");
    pack.requireMainModule();
    pack.initializeForExternalUse("workspace restoration");
    expect(pack.mainInitialized).toBe(true);
    expect(pack.mainActivated).toBe(false);
    await expectAsync(
      lumine.packages.unloadPackage("bib-finder", { serialize: false }),
    ).toBeResolved();
  });
});
