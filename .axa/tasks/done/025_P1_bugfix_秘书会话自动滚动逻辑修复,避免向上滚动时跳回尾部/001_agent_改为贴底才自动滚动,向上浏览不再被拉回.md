---
agent: trae_26-11-22_09:38:50.767
---

# 秘书会话自动滚动逻辑修复

## 根因

`secretary-chat.tsx` 中的 `useEffect` 依赖 `messages`，而轮询每 1.5 秒都会写入新的 `messages` 数组，导致每次轮询都执行 `bottomRef.current.scrollIntoView({ block: "end" })`，用户向上翻历史时会被强制拉回底部。

## 修复

- 新增 `stickToBottomRef`：在 `.chat-scroll` 的 `onScroll` 中按 `scrollHeight - scrollTop - clientHeight < 40` 判断用户是否仍贴底。
- 自动滚动 effect 仅在 `stickToBottomRef.current` 为 true 时把 `scrollTop` 设为 `scrollHeight`，向上滚动后不再跳回尾部。
- Boss 主动发送消息时重置 `stickToBottomRef.current = true`，保证自己发消息后仍能看到最新回复。
- 移除不再需要的 `bottomRef` 锚点。

## 验证

- `pnpm lint`：82 files，无问题。
- `pnpm typecheck`：全部包通过。
- 浏览器验证（`.chat-scroll`，`scrollHeight=2288`、`clientHeight=387`、`maxScroll=1901`）：
  - 滚动到 `scrollTop=0` 后等待 6 秒，仍为 0，未被拉回底部；
  - 滚动到底部 `scrollTop=1901.35` 后等待 6 秒，仍保持在底部。
