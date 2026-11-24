---
name: refer
description: 使用 refer CLI 通过 .ref 清单把外部 git 仓库、仓库子目录或本地目录链接进项目。仓库里存在 .ref 文件，或需要新增、恢复、检查、清理依赖链接时使用。
---

# refer

`.ref` 是唯一需要提交的记录；checkout 和 symlink 都通过 `refer get` 重建。

## 常用命令

| 目的 | 命令 |
| --- | --- |
| 恢复当前目录所有引用 | `refer get` |
| 递归恢复 | `refer get -R` |
| 只恢复指定清单 | `refer get path/to/x.ref` |
| 新增远程引用 | `refer get -r https://host/repo.git` |
| 固定分支、标签或提交 | `refer get -r https://host/repo.git@v1.2.0` |
| 只链接仓库子目录 | `refer get -r https://host/repo.git/sub/dir -s ./dir` |
| 新增本地目录引用 | `refer get -l ~/notes -s ./notes` |
| 检查状态 | `refer list [-R]` |
| 清理链接和本地 checkout | `refer clean x.ref` |

## 规则

- 添加引用后提交 `.ref` 和对应的 `.gitignore`；不要提交 checkout 或 symlink。
- 用 `-s` 指定链接位置，可重复；`-s` 不带值会自动命名。子目录引用通常要加 `-s`。
- `-g` 把 checkout 放到共享缓存，适合多个项目复用；默认放在 `./<repo>`。
- 需要更新 checkout 时加 `-u`，或让清单包含 `flags: update`。
- 修改清单里的 URL、分支、标签或提交后，已有 checkout 不会自动切换；先清理该 checkout 再重新 `get`。
- 需要可复现构建时固定 `@<sha>`。
- 路径相对 `.ref` 所在目录；只展开 `~`、`$VAR`、`${VAR}`，不会执行 shell 命令。
- 清理前先运行 `refer list`。不要手工 `rm` checkout，用 `refer clean`。
- `refer clean` 会拒绝有未提交或未推送内容的 checkout；不要主动加 `-f`。清理前确认没有本地提交或 stash，包括 detached HEAD。
- `-f` 可能替换真实文件或目录，只在用户明确要求时使用；不要用 `.`、`..` 或根目录作为 checkout/链接目标。
- 不支持 Windows。

完整说明见 [README.md](README.md)。