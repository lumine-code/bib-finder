const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const fsp = require("node:fs/promises");

describe("bib-finder parser loading", () => {
  let main, loader, directory;

  beforeEach(async () => {
    main = (await lumine.packages.activatePackage("bib-finder")).mainModule;
    loader = require("../lib/parser-loader");
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "bib-finder-parser-"));
    const filePath = path.join(directory, "source.bib");
    fs.writeFileSync(filePath, "@book{key, title={A book}}\n");
    main.bibLocal = false;
    main.bibPath1 = filePath;
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("bib-finder");
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("shares concurrent first imports and uses the CommonJS default export", async () => {
    const parse = () => ({ entries: [] });
    const imports = jasmine.createSpy("importParser").and.resolveTo({ default: { parse } });
    const load = loader.createParserLoader(imports);
    const first = load();
    const second = load();
    expect(first).toBe(second);
    expect(imports).not.toHaveBeenCalled();
    await expectAsync(first).toBeResolvedTo(parse);
    expect(imports).toHaveBeenCalledTimes(1);
  });

  it("can retry a parser that was unavailable during the first import", async () => {
    const failure = new Error("parser unavailable");
    const imports = jasmine.createSpy("importParser").and.rejectWith(failure);
    const load = loader.createParserLoader(imports);
    await expectAsync(load()).toBeRejectedWith(failure);
    const parse = () => ({ entries: [] });
    imports.and.resolveTo({ default: { parse } });
    await expectAsync(load()).toBeResolvedTo(parse);
    expect(imports).toHaveBeenCalledTimes(2);
  });

  it("does not read bibliography files after cancellation during the import", async () => {
    let release;
    spyOn(loader, "loadParser").and.returnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    spyOn(fsp, "readFile").and.callThrough();
    const parse = jasmine.createSpy("parse");
    const controller = new AbortController();
    const pending = main.loadEntries(1, { force: true, signal: controller.signal });
    controller.abort();
    release(parse);

    await expectAsync(pending).toBeResolvedTo(undefined);
    expect(fsp.readFile).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
  });

  it("reports a loading error and succeeds on a later indexing request", async () => {
    const loadParser = loader.loadParser;
    const failure = new Error("parser unavailable");
    spyOn(loader, "loadParser").and.rejectWith(failure);
    const failed = await main.loadEntries(1, { force: true });
    expect(failed.status.message).toContain(failure.message);

    loader.loadParser.and.callFake(loadParser);
    const result = await main.loadEntries(1, { force: true });
    expect(result.items.map((item) => item.key)).toEqual(["key"]);
    expect(result.status).toBeNull();
  });

  it("does not load the parser when no sources are configured", async () => {
    main.bibPath1 = "";
    spyOn(loader, "loadParser").and.callThrough();
    const result = await main.loadEntries(1, { force: true });
    expect(result.items).toEqual([]);
    expect(loader.loadParser).not.toHaveBeenCalled();
  });
});
