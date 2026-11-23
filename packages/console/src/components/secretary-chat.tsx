"use client";

import {
  SecretaryMessageStatus,
  SecretaryRole,
  type SecretarySettings,
  type SecretaryState,
} from "@contagxt/axa-proto";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { secretaryClient } from "@/lib/client";
import { errorMessage } from "@/lib/format";
import { taskLink } from "@/lib/project-link";
import { useVisiblePolling } from "@/lib/use-visible-polling";
import { ChatIcon, SendIcon, TrashIcon } from "./icons";

const SUGGESTIONS = [
  "介绍一下现在所有项目的任务情况",
  "看看有没有需要我验收的任务",
  "帮我把「补充单元测试」拆成一个任务交给 worker",
] as const;

function roleOf(role: SecretaryRole): "boss" | "secretary" {
  return role === SecretaryRole.BOSS ? "boss" : "secretary";
}

export function SecretaryChat() {
  const [state, setState] = useState<SecretaryState>();
  const [settings, setSettings] = useState<SecretarySettings>();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await secretaryClient.getSecretaryState({});
      setState(response.state);
      setSettings(response.settings);
      setError(undefined);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useVisiblePolling(() => {
    void load(true);
  }, 1500);

  const busy = state?.busy ?? false;
  const messages = state?.messages ?? [];

  useEffect(() => {
    if (messages.length > 0 && stickToBottomRef.current) {
      const element = scrollRef.current;
      if (element) element.scrollTop = element.scrollHeight;
    }
  }, [messages]);
  const hasKey = settings?.hasApiKey ?? false;

  function onScroll() {
    const element = scrollRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    stickToBottomRef.current = distance < 40;
  }

  async function send(message: string) {
    const text = message.trim();
    if (!text || sending) return;
    // Sending is an explicit intent to see the reply, so resume sticking to the bottom.
    stickToBottomRef.current = true;
    setSending(true);
    setError(undefined);
    try {
      await secretaryClient.sendBossMessage({ message: text });
      setDraft("");
      await load(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSending(false);
    }
  }

  async function clearChat() {
    if (!window.confirm("清空 Boss 与秘书的对话记录？任务不会被删除。")) return;
    try {
      await secretaryClient.clearSecretaryChat({});
      await load(true);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  return (
    <div className="chat secretary-chat">
      <header className="chat-head">
        <span className="secretary-avatar" aria-hidden="true">
          <ChatIcon size={19} />
        </span>
        <div className="chat-head-copy">
          <div className="chat-head-title">
            <h1>秘书</h1>
            <span className={`secretary-status${busy ? " busy" : ""}`}>
              {busy ? "处理中" : "在线"}
            </span>
          </div>
          <p>Boss ↔ secretary · {settings?.model ?? "未配置模型"}</p>
        </div>
        <button
          aria-label="清空对话"
          className="icon-button"
          onClick={() => void clearChat()}
          title="清空对话"
          type="button"
        >
          <TrashIcon size={17} />
        </button>
        <Link className="button ghost secretary-settings-link" href="/secretary/settings">
          设置
        </Link>
      </header>

      {!hasKey ? (
        <div className="banner error chat-banner" role="status">
          <strong>秘书还没有模型</strong>
          <span>填入 Base URL、模型名与 API Key 后即可对话。</span>
          <Link className="text-button" href="/secretary/settings">
            去设置
          </Link>
        </div>
      ) : null}

      {error ? (
        <div className="banner error chat-banner" role="alert">
          <strong>出错了</strong>
          <span>{error}</span>
          <button className="text-button" onClick={() => setError(undefined)} type="button">
            关闭
          </button>
        </div>
      ) : null}

      <div className="chat-scroll" onScroll={onScroll} ref={scrollRef}>
        {loading && messages.length === 0 ? (
          <div className="secretary-empty">
            <span className="skeleton skeleton-line" />
            <span className="skeleton skeleton-line short" />
          </div>
        ) : messages.length === 0 ? (
          <div className="secretary-empty">
            <span className="empty-icon">
              <ChatIcon size={24} />
            </span>
            <h2>Boss，今天要处理什么？</h2>
            <p>
              我管理你所有项目和任务。简单问题我直接回答；需要改代码或耗时的工作，我会创建 axa
              任务交给 worker，完成后向你汇总。
            </p>
            <div className="secretary-suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  className="suggestion-chip"
                  key={suggestion}
                  onClick={() => setDraft(suggestion)}
                  type="button"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="chat-stream">
            {messages.map((message) => {
              const role = roleOf(message.role);
              const pending = message.status === SecretaryMessageStatus.PENDING;
              const failed = message.status === SecretaryMessageStatus.ERROR;
              return (
                <div
                  className={`chat-line from-${role === "boss" ? "user" : "agent"}`}
                  key={message.id}
                >
                  <div className={`chat-bubble${failed ? " bubble-error" : ""}`}>
                    <div className="bubble-meta">
                      <span>{role === "boss" ? "Boss" : "秘书"}</span>
                      <span className="bubble-title">
                        {pending ? "正在处理…" : failed ? "处理失败" : ""}
                      </span>
                    </div>
                    {pending ? (
                      <span className="typing" role="status" aria-label="秘书正在处理">
                        <i />
                        <i />
                        <i />
                      </span>
                    ) : (
                      <p className="bubble-body">{message.body}</p>
                    )}
                    {message.taskId && message.projectId ? (
                      <Link
                        className="bubble-task-link"
                        href={taskLink(message.projectId, message.taskId)}
                      >
                        查看任务 #{message.taskId}
                      </Link>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <footer className="chat-foot">
        {busy ? <p className="secretary-hint">秘书正在处理上一条消息，你仍可以继续发送。</p> : null}
        <form
          className="chat-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send(draft);
          }}
        >
          <textarea
            aria-label="给秘书发消息"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(draft);
              }
            }}
            placeholder="给秘书发消息…（Enter 发送，Shift+Enter 换行）"
            rows={1}
            value={draft}
          />
          <button
            aria-label="发送"
            className="send-button"
            disabled={!draft.trim() || sending}
            type="submit"
          >
            <SendIcon size={17} />
          </button>
        </form>
      </footer>
    </div>
  );
}
