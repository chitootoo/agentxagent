---
agent: trae_26-11-21_00:08:27.475
---

# 改动

控制台任务列表的筛选默认值由「全部」改为「待处理」：

- `packages/console/src/components/inbox-view.tsx:46`
  `useState<InboxFilterKey>("all")` → `useState<InboxFilterKey>("attention")`。

「待处理」筛选项沿用 `INBOX_FILTERS` 中已有的 `attention`（BACKLOG + REVIEW），
首次进入消息页即展示待人工处理的任务；空状态文案本身已针对 `attention` 做了区分，
无需额外调整。用户仍可手动切回「全部」等其它筛选。

# 验证

- `pnpm --filter @contagxt/axa-console typecheck`：通过（tsc --noEmit 无错误）。
- `pnpm exec biome check packages/console/src/components/inbox-view.tsx`：通过，0 issues。
