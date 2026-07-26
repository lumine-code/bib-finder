# bib-finder

Search and insert BibTeX citation keys from bibliography files.

Supports multiple `.bib` files with fuzzy search and works in any file scope.

## Features

- **Fuzzy search**: quickly find entries by author, title, or key.
- **Multiple files**: use global or project-local `.bib` files.
- **Fast crawling**: project `.bib` files are discovered with the editor's bundled ripgrep.
- **Flexible insertion**: insert bare keys, `\cite{}`, or `\cite[]{}` formats.
- **Type filtering**: search by entry type with `@` or by key with `#`.

## Installation

To install `bib-finder` search for _bib-finder_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/bib-finder`.

## Commands

Commands available in `atom-workspace`:

- `bib-finder:cite`: open citation list,
- `bib-finder:cite-from-local`: open citation list from local `.bib` files only,
- `bib-finder:cite-from-source-N`: open citation list from source no. N,
- `bib-finder:cache`: re-cache entries from the `.bib` sources,
- `bib-finder:open-source-N`: open source no. N bib file.

Commands available in `.bib-finder`:

- `select-list:name`: insert `<key>`,
- `select-list:cite`: insert `\cite{<key>}`,
- `select-list:square`: insert `\cite[]{<key>}`,
- `select-list:update`: manually update list.

## Usage

To use the package, you need a bibliography file in BibTeX format `.bib`. This file should be created and maintained by the user. There are two ways to use it:

- global: you can specify the file paths in the package settings,
- local: you can use files in project directory.

Here's an example of the content in a bibliography file:

```bib
@book{fhck07,
  author = "Hartmann, Friedel and Katz, Casimir",
  title = "Structural Analysis with Finite Elements",
  publisher = "Springer-Verlag Berlin Heidelberg",
  address = "Germany",
  year = "2007",
  ISBN = "10-3-540-49698",
}

@book{stng51,
  author = "S. Timoshenko and J. N. Goodier",
  title = "Theory of elasticity",
  publisher = "{McGRAW-HILL BOOK Company Inc.}",
  address = "New York, Toronto, London",
  year = "1951",
}
```

## Customization

The citation list can be restyled from your stylesheet, e.g.:

```less
.bib-finder {
  .tag {
    color: var(--text-color-info);
  }
  .secondary-line {
    color: var(--text-color-subtle);
  }
}
```

## Services

- **[icons.class](https://lumine-code.github.io/docs.html#services/icons.class)** (`^1.0.0`): consumed to decorate each entry's source path with its file-type icon.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
