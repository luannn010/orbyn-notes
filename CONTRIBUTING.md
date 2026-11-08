# Contributing

Orbyn Notes is being built. Start with an issue labelled `good first issue` or `help wanted`, and say in it that you are taking it.

## Contributor agreement

The code is source-available under PolyForm Strict, so every outside contribution needs the [Orbyn contributor agreement](https://github.com/orbyn-dev/.github/blob/main/CLA.md) before it can be merged. On your first pull request, comment `/orbynAgree` on a line of its own. You agree once, and it covers your earlier and later contributions in every Orbyn repository. The **CLA** check turns green right after.

## Designs

Every screen follows the internal Orbyn designs exactly: values, copy, three themes (Light, Dark, Dim) and motion. An issue that needs a design links to the frames you can see. If something you need is not designed, ask in the issue; do not invent it.

## Titles

Pull request and issue titles use the Conventional Commits form `type(scope): summary`.

- Kinds: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`, `style` or `revert`. An issue may also use `question`.
- The scope is optional and lowercase. `!` before the colon marks a breaking change.
- The summary is a short imperative phrase with a lowercase first letter and no full stop. The whole title is at most 72 characters.
- A title never credits a tool or an assistant.

The [Title](.github/workflows/pr-title.yml) check enforces this.

## Branches and commits

- Branch from `main`: `feat/`, `fix/`, `docs/`, `chore/` or `refactor/` plus a purpose name.
- Write Conventional Commits subjects.
- No agent or tool attribution in commits or branch names, including `Co-Authored-By` lines for AI tools. The [Commit trailers](.github/workflows/pr-commit-trailers.yml) check fails a pull request that has one. Whoever merges writes the merge message by hand.

## Pull requests

- Fill in the template. Say what you verified and what you did not.
- Keep it short: bullets, under about 150 words outside AI usage.
- Merge with a merge commit once every required check is green.

## AI usage

Every pull request says how it was made. Tick "Written by hand", or give the harness and its version, every model by exact ID and what it did, the effort level, what a person decided, and every outside source. The [AI usage](.github/workflows/pr-ai-usage.yml) check fails while the section is empty. Dependabot is exempt.

## Dependencies

Dependabot opens weekly grouped minor and patch updates. Major versions are planned work in their own pull request. Pin GitHub Actions to a full commit SHA with the version in a comment.
