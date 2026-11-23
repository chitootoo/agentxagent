"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { secretaryClient } from "@/lib/client";
import { errorMessage } from "@/lib/format";
import { ArrowLeftIcon } from "./icons";

interface Preset {
  label: string;
  baseUrl: string;
  model: string;
}

const PRESETS: Preset[] = [
  { label: "OpenAI GPT-4.1", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1" },
  { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { label: "Moonshot Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "kimi-k2-0711-preview" },
  {
    label: "Gemini (原生)",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-3.5-flash",
  },
];

export function SecretarySettingsView() {
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await secretaryClient.getSecretaryState({});
      const settings = response.settings;
      setBaseUrl(settings?.baseUrl ?? "");
      setModel(settings?.model ?? "");
      setHasKey(settings?.hasApiKey ?? false);
      setError(undefined);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const response = await secretaryClient.updateSecretarySettings({
        baseUrl,
        model,
        apiKey,
        clearApiKey,
      });
      setHasKey(response.settings?.hasApiKey ?? false);
      setApiKey("");
      setClearApiKey(false);
      setNotice("已保存，下一条消息会使用新模型。");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  function applyPreset(preset: Preset) {
    setBaseUrl(preset.baseUrl);
    setModel(preset.model);
    setNotice(`已填入 ${preset.label}，保存后生效。`);
  }

  return (
    <div className="page-stack secretary-settings">
      <div className="page-heading split">
        <div>
          <h1>秘书设置</h1>
          <p>秘书通过 OpenAI 兼容接口或 Gemini 原生接口调用模型。配置只保存在本机 ~/.axa 下。</p>
        </div>
        <Link className="button ghost" href="/">
          <ArrowLeftIcon size={16} />
          返回对话
        </Link>
      </div>

      {error ? (
        <div className="banner error" role="alert">
          <strong>加载或保存失败</strong>
          <span>{error}</span>
        </div>
      ) : null}
      {notice ? (
        <div className="banner success" role="status">
          <span>{notice}</span>
        </div>
      ) : null}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>模型信息</h2>
            <p className="form-hint">
              当前状态：{hasKey ? "已保存 API Key" : "未配置 API Key"} · 支持 OpenAI 兼容端点与
              Gemini 原生端点
            </p>
          </div>
        </div>

        <div className="preset-row">
          {PRESETS.map((preset) => (
            <button
              className="filter-chip"
              key={preset.label}
              onClick={() => applyPreset(preset)}
              type="button"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <form className="form-grid" onSubmit={(event) => void save(event)}>
          <label className="field field-wide">
            <span>Base URL</span>
            <input
              disabled={loading}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.openai.com/v1"
              required
              value={baseUrl}
            />
            <small>
              需要包含版本路径，例如 https://api.deepseek.com/v1 或
              https://generativelanguage.googleapis.com/v1beta。
            </small>
          </label>

          <label className="field">
            <span>模型</span>
            <input
              disabled={loading}
              onChange={(event) => setModel(event.target.value)}
              placeholder="gpt-4.1"
              required
              value={model}
            />
          </label>

          <label className="field field-wide">
            <span>API Key</span>
            <input
              autoComplete="off"
              disabled={loading}
              onChange={(event) => {
                setApiKey(event.target.value);
                if (event.target.value) setClearApiKey(false);
              }}
              placeholder={hasKey ? "已保存，留空则保持不变" : "sk-…"}
              type="password"
              value={apiKey}
            />
            <small>Key 以明文保存在本机 ~/.axa/secretary.json，不会上传到远程服务。</small>
          </label>

          {hasKey ? (
            <label className="check-field">
              <input
                checked={clearApiKey}
                onChange={(event) => setClearApiKey(event.target.checked)}
                type="checkbox"
              />
              删除已保存的 API Key
            </label>
          ) : null}

          <div className="form-actions field-wide">
            <button className="button primary" disabled={loading || saving} type="submit">
              {saving ? "保存中…" : "保存设置"}
            </button>
            <span className="form-hint">保存后新消息立即生效，进行中的回复不受影响。</span>
          </div>
        </form>
      </section>
    </div>
  );
}
