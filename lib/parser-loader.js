function createParserLoader(importParser = () => import("@lumine-code/bibtex-parse")) {
  let pending;
  return function loadParser() {
    pending ||= Promise.resolve()
      .then(importParser)
      .then((namespace) => (namespace.default ?? namespace).parse)
      .catch((error) => {
        pending = null;
        throw error;
      });
    return pending;
  };
}

module.exports = { createParserLoader, loadParser: createParserLoader() };
