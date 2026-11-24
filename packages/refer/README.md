# refer

**Use code from other repositories without copying it.** Commit a tiny `.ref` file instead of a vendored copy or a git submodule. `refer` clones the repo (or links one folder of it, or a local directory) where your project expects it, and keeps the result out of git.

```console
$ refer get -r https://github.com/anthropics/skills.git/skills/skill-creator -g \
            -s .agents/skills/skill-creator -s .claude/skills/skill-creator
Cloning https://github.com/anthropics/skills.git into ~/.local/share/refer/repos/github.com/anthropics/skills
Linked .agents/skills/skill-creator -> ~/.local/share/refer/repos/github.com/anthropics/skills/skills/skill-creator
Added /skill-creator to .agents/skills/.gitignore
Linked .claude/skills/skill-creator -> ~/.local/share/refer/repos/github.com/anthropics/skills/skills/skill-creator
Added /skill-creator to .claude/skills/.gitignore
Wrote ./skill-creator.ref
```

Commit `skill-creator.ref` and the two `.gitignore` files. A teammate who clones the project runs `refer get -R` and gets the same layout.

## Why

Projects keep needing things that live somewhere else:

- a sub-repository inside a monorepo that you do not want to vendor or wire up as a submodule;
- one folder of a big repository, such as a single skill from a skills collection;
- the same checkout in several places at once, such as `.agents/skills/` for Codex and `.claude/skills/` for Claude Code;
- a directory from elsewhere on your machine that a tool expects inside the project.

Copying goes stale and bloats history. Submodules check out the whole repository at one path and need extra commands from everyone. Hand-made symlinks are not reproducible. `refer` records *what* you depend on and *where* it should appear, and rebuilds that on any machine with one command.

|  | Vendored copy | git submodule | **refer** |
| --- | --- | --- | --- |
| What gets committed | the whole dependency | a gitlink + `.gitmodules` | a tiny `.ref` text file |
| Use only one subfolder | yes, by copying | no, the whole repo | yes |
| One clone shared by many paths and projects | no | no | yes (`-g`) |
| Reference a local directory | no | no | yes |
| Exact commit pinned by default | yes | yes | no: follows a branch unless you pin `@<sha>` |
| Works on Windows without symlinks | yes | yes | no |

If you need a byte-for-byte reproducible build, pin a commit (`@<sha>`) or use a submodule.

## Install

Requires Node.js 22 or newer and git.

```sh
npm install -g @contagxt/refer
# or
pnpm add -g @contagxt/refer
```

Linux, macOS and WSL are supported. Windows is not supported because the tool relies on symbolic links.

## Usage

```sh
# Clone a repo into ./tools and record tools.ref
refer get -r https://github.com/example/tools.git

# Link only one folder of a repo, pinned to a tag
refer get -r https://github.com/example/mono.git@v2.1.0/packages/ui -s ./ui

# One shared clone, linked into several places (also reused by other projects)
refer get -r https://github.com/example/skills.git/skills/pdf -g \
          -s .agents/skills/pdf -s .claude/skills/pdf

# Make a local directory visible inside the project
refer get -l ~/notes -s ./notes

# Restore every manifest in the current directory
refer get

# Restore every manifest below this directory too
refer get -R

# Show manifests and the state of their checkouts and links
refer list

# Remove the links and the local checkout; the .ref file stays
refer clean tools.ref
```

### `refer get`

| Option | Meaning |
| --- | --- |
| `-r, --remote <remote>` | Git remote as `<url>[@<branch\|tag\|sha>][/<sub/path>]`. The URL must end in `.git` when a revision or sub path follows. |
| `-l, --local [<path>]` | With `-r`: where to clone (default `:auto` = `./<repo>`). Without `-r`: the existing local file or directory to link. |
| `-g, --global` | Keep the clone in the shared cache `$REFER_REPOS_ROOT` instead of the project. |
| `-s, --symlink [<path>]` | Create a symlink to the reference. Repeatable. Without a value, `refer` picks a free name (`name`, `name2`, ...). |
| `-u, --update` | Fast-forward existing checkouts. Stored in the manifest, so later restores update too. |
| `-n, --name <name>` | Manifest name, if the default (repo name or sub path basename) is taken. |
| `-R, --recursive` | Replay `.ref` files in subdirectories too. `refer get -R` alone restores the whole tree. |
| `-f, --force` | Replace an existing real file or directory at a symlink path. |

Run `refer get` with no file arguments to replay every manifest in the current directory; `-R` includes subdirectories. Pass `.ref` files to replay only those, or use shell expansion such as `refer get *.ref`.

### `refer clean`

`refer clean <name>[.ref]...` removes what a manifest created and keeps the manifest:

- symlinks are removed;
- a project-local checkout is deleted, but **only if it has no uncommitted changes and no unpushed commits** (`-f` overrides);
- shared `-g` checkouts are kept, because other links and projects may use them;
- the source of a local-only reference is never touched.

### `refer list`

`refer list [-R]` prints each manifest and the state of its checkout and symlinks. `-R` includes subdirectories. States are `ok`, `missing`, `stale`, `not a symlink`, or `not a git checkout`. The command is read-only.

Global options: `-h/--help`, `-V/--version`, `-v/--verbose`.

## How it works

A `.ref` file is plain text, one `key: value` per line:

```yaml
# Lines starting with "#" are comments.
remote: https://github.com/user/repo.git@main/sub/path
local: :auto
symlink: ./sub-path
flags: update
```

| Key | Values |
| --- | --- |
| `remote` | `<url>[@<rev>][/<sub/path>]`. Empty or missing means a local-only reference. |
| `local` | `:auto` (`./<repo>`), `:global` (shared cache), or a path. For local-only references, the path being linked. |
| `symlink` | A path, or `:auto` for a free name. Repeatable. |
| `flags` | `update` to fast-forward on every replay. `global` is still read for compatibility. |

When a manifest is replayed, `refer`:

1. clones the remote if it is not there yet: into `./<repo>` (`:auto`), into `$REFER_REPOS_ROOT/<host>/<path>` (`:global`), or into the given path. Commit SHAs are checked out detached and are never "updated";
2. fast-forwards existing checkouts if `update` is set (`git pull --ff-only`; a failure is only a warning, so you can work offline);
3. creates each symlink pointing at the checkout, or at the sub path inside it;
4. adds `/<name>` for every project-local checkout and symlink to the `.gitignore` next to it (only inside a git work tree, and only if git does not already ignore it).

Details that keep this predictable:

- Relative paths are resolved from the directory of the `.ref` file, so manifests work from any working directory.
- `~`, `$VAR` and `${VAR}` are expanded from the environment, and nothing else. A `.ref` file cannot run commands, and an unset variable is an error. Paths under `$HOME` are written back as `~/...`; quote a variable (`-l '$DATA_DIR'`) to keep it literal in the manifest.
- Replays are idempotent. Running `refer get -R` twice changes nothing.
- `refer get -R` skips nested git repositories, so the manifests inside your dependencies are not run.
- Existing files are never overwritten by a symlink unless you pass `-f`.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `REFER_REPOS_ROOT` | `${XDG_DATA_HOME:-~/.local/share}/refer/repos` | Shared checkout cache |
| `REFER_VERBOSE` | `0` | `1` prints debug output, same as `-v` |

### Security note

Replaying a `.ref` file clones its remote and creates symlinks at the paths it names. Treat `.ref` files from untrusted sources like any other script and read them before you run `refer get` on them.

## License

[MIT](LICENSE)