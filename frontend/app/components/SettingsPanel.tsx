"use client";

import React, { useEffect, useState } from "react";
import { Check, LoaderCircle, X } from "lucide-react";
import { getSettings, saveSettings, testSettings } from "../lib/api";
import { useI18n, type Lang } from "../lib/i18n";

type Field = {
  label: string;
  key: string;
  type?: "text" | "password" | "number";
  placeholder?: string;
  keySet?: boolean;
  step?: string;
  min?: number;
  max?: number;
};

function Field({
  field,
  value,
  setValue,
}: {
  field: Field;
  value: string;
  setValue: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-3 text-sm">
      <span className="w-28 shrink-0 text-zinc-500 dark:text-zinc-400">
        {field.label}
      </span>
      <input
        type={field.type ?? "text"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={
          field.type === "password"
            ? field.keySet
              ? "Configured (leave blank to clear)"
              : "Not configured"
            : field.placeholder
        }
        min={field.min}
        max={field.max}
        step={field.step}
        className="h-8 w-full min-w-0 flex-1 rounded-lg border border-black/[0.07] bg-zinc-50 px-3 text-[13px] text-zinc-800 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-300 focus:bg-white dark:border-white/10 dark:bg-zinc-800/60 dark:text-zinc-100 dark:focus:bg-zinc-800"
      />
    </label>
  );
}

function TestButton({
  kind,
  onResult,
}: {
  kind: "llm" | "embedding";
  onResult: (msg: { ok: boolean; message: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const test = async () => {
    setBusy(true);
    try {
      const r = await testSettings(kind);
      onResult(r);
    } catch (e) {
      onResult({ ok: false, message: String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={test}
      disabled={busy}
      className="flex items-center gap-1.5 rounded-full border border-black/[0.07] px-3 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-black/[0.04] hover:text-zinc-800 disabled:opacity-50 dark:border-white/10 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-zinc-100"
      title="Test connection"
    >
      {busy ? (
        <LoaderCircle className="h-3 w-3 animate-spin" strokeWidth={2} />
      ) : (
        <span>Test connection</span>
      )}
    </button>
  );
}

type SectionProps = {
  title: string;
  hint?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
};

function Section({ title, hint, children, actions }: SectionProps) {
  return (
    <div className="space-y-3 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">
            {title}
          </h3>
          {hint && (
            <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">{hint}</p>
          )}
        </div>
        {actions}
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

export default function SettingsPanel({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const { lang, setLang, t } = useI18n();
  const [s, setS] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [keySet, setKeySet] = useState<{ llm: boolean; openai: boolean }>({
    llm: false,
    openai: false,
  });
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSettings()
      .then((data) => {
        const init: Record<string, string> = {};
        for (const [k, v] of Object.entries(data)) {
          if (typeof v === "string" || typeof v === "number") init[k] = String(v);
        }
        setS(init);
        setKeySet({
          llm: !!data.DEEPSEEK_API_KEY_SET,
          openai: !!data.OPENAI_API_KEY_SET,
        });
      })
      .catch((e) => setResult({ ok: false, message: String(e) }));
  }, []);

  const set = (k: string) => (v: string) => {
    setS((prev) => ({ ...prev, [k]: v }));
    setDirty((prev) => new Set(prev).add(k));
  };

  const save = async () => {
    setSaving(true);
    try {
      const keys = [
        "DEEPSEEK_BASE_URL",
        "DEEPSEEK_API_KEY",
        "CHAT_MODEL",
        "EMBEDDING_PROVIDER",
        "LOCAL_EMBEDDING_MODEL",
        "OPENAI_BASE_URL",
        "OPENAI_API_KEY",
        "EMBEDDING_MODEL",
        "TOP_K",
        "CANDIDATE_K",
        "MMR_LAMBDA",
      ];
      const patch: Record<string, unknown> = {};
      for (const k of keys) {
        if (!dirty.has(k)) continue;
        const v = (s[k] ?? "").trim();
        patch[k] = v === "" ? "" : v;
      }
      if (Object.keys(patch).length === 0) {
        setResult({ ok: true, message: "Nothing to save" });
        return;
      }
      await saveSettings(patch);
      onSaved("Settings saved & applied");
      onClose();
    } catch (e) {
      setResult({ ok: false, message: String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-2xl dark:border-white/10 dark:bg-[#22262b]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-black/[0.05] px-5 dark:border-white/10">
          <h2 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">
            {t("settings.title")}
          </h2>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-zinc-400 transition-colors hover:bg-black/[0.04] hover:text-zinc-600 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
            title={t("ui.close")}
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5">
          <div className="space-y-4 divide-y divide-black/[0.05] dark:divide-white/10">
            <Section
              title="Chat model"
              hint="DeepSeek / OpenAI-compatible endpoint, applies immediately"
              actions={<TestButton kind="llm" onResult={setResult} />}
            >
              <Field
                field={{
                  label: "Base URL",
                  key: "DEEPSEEK_BASE_URL",
                  placeholder: "https://api.deepseek.com",
                }}
                value={s.DEEPSEEK_BASE_URL ?? ""}
                setValue={set("DEEPSEEK_BASE_URL")}
              />
              <Field
                field={{
                  label: "API Key",
                  key: "DEEPSEEK_API_KEY",
                  type: "password",
                  keySet: keySet.llm,
                }}
                value={s.DEEPSEEK_API_KEY ?? ""}
                setValue={set("DEEPSEEK_API_KEY")}
              />
              <Field
                field={{ label: "Model", key: "CHAT_MODEL", placeholder: "deepseek-chat" }}
                value={s.CHAT_MODEL ?? ""}
                setValue={set("CHAT_MODEL")}
              />
            </Section>

            <Section
              title="Embedding model"
              hint="Local fastembed (bge-small-zh) or OpenAI-compatible service; re-index documents after switching"
              actions={<TestButton kind="embedding" onResult={setResult} />}
            >
              <label className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0 text-zinc-500 dark:text-zinc-400">Provider</span>
                <select
                  value={s.EMBEDDING_PROVIDER ?? "local"}
                  onChange={(e) => set("EMBEDDING_PROVIDER")(e.target.value)}
                  className="h-8 w-full min-w-0 flex-1 rounded-lg border border-black/[0.07] bg-zinc-50 px-3 text-[13px] text-zinc-800 outline-none transition-colors focus:border-zinc-300 focus:bg-white dark:border-white/10 dark:bg-zinc-800/60 dark:text-zinc-100 dark:focus:bg-zinc-800"
                >
                  <option value="local">Local fastembed</option>
                  <option value="openai">OpenAI-compatible API</option>
                </select>
              </label>
              {s.EMBEDDING_PROVIDER === "local" ? (
                <Field
                  field={{
                    label: "Model name",
                    key: "LOCAL_EMBEDDING_MODEL",
                    placeholder: "BAAI/bge-small-zh-v1.5",
                  }}
                  value={s.LOCAL_EMBEDDING_MODEL ?? ""}
                  setValue={set("LOCAL_EMBEDDING_MODEL")}
                />
              ) : (
                <>
                  <Field
                    field={{
                      label: "Base URL",
                      key: "OPENAI_BASE_URL",
                      placeholder: "http://localhost:11434/v1",
                    }}
                    value={s.OPENAI_BASE_URL ?? ""}
                    setValue={set("OPENAI_BASE_URL")}
                  />
                  <Field
                    field={{
                      label: "API Key",
                      key: "OPENAI_API_KEY",
                      type: "password",
                      keySet: keySet.openai,
                    }}
                    value={s.OPENAI_API_KEY ?? ""}
                    setValue={set("OPENAI_API_KEY")}
                  />
                  <Field
                    field={{
                      label: "Model name",
                      key: "EMBEDDING_MODEL",
                      placeholder: "nomic-embed-text",
                    }}
                    value={s.EMBEDDING_MODEL ?? ""}
                    setValue={set("EMBEDDING_MODEL")}
                  />
                </>
              )}
            </Section>

            <Section title="Retrieval" hint="Candidates fetched, reranked & diversity per answer">
              <Field
                field={{ label: "Citations per answer", key: "TOP_K", type: "number", min: 1, max: 20 }}
                value={s.TOP_K ?? ""}
                setValue={set("TOP_K")}
              />
              <Field
                field={{ label: "Candidates", key: "CANDIDATE_K", type: "number", min: 1, max: 50 }}
                value={s.CANDIDATE_K ?? ""}
                setValue={set("CANDIDATE_K")}
              />
              <Field
                field={{ label: "Diversity λ", key: "MMR_LAMBDA", type: "number", step: "0.1", min: 0, max: 1 }}
                value={s.MMR_LAMBDA ?? ""}
                setValue={set("MMR_LAMBDA")}
              />
            </Section>

            <Section
              title={t("settings.language")}
              hint={t("settings.language.hint")}
            >
              <label className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0 text-zinc-500 dark:text-zinc-400">
                  {t("settings.language")}
                </span>
                <select
                  value={lang}
                  onChange={(e) => setLang(e.target.value as Lang)}
                  className="h-8 w-full min-w-0 flex-1 rounded-lg border border-black/[0.07] bg-zinc-50 px-3 text-[13px] text-zinc-800 outline-none transition-colors focus:border-zinc-300 focus:bg-white dark:border-white/10 dark:bg-zinc-800/60 dark:text-zinc-100 dark:focus:bg-zinc-800"
                >
                  <option value="zh">简体中文</option>
                  <option value="en">English</option>
                </select>
              </label>
            </Section>
          </div>

          {result && (
            <div
              className={`my-3 rounded-lg px-3 py-2 text-xs ${
                result.ok
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                  : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400"
              }`}
            >
              {result.message}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-black/[0.05] px-5 py-3 dark:border-white/10">
          <button
            onClick={onClose}
            className="rounded-full px-4 py-2 text-[13px] font-medium text-zinc-500 transition-colors hover:bg-black/[0.04] dark:text-zinc-400 dark:hover:bg-white/[0.06]"
          >
            {t("settings.cancel")}
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="press flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-[var(--card)] px-4 py-2 text-[13px] font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-white/10 dark:bg-[#1f2327] dark:text-zinc-200 dark:hover:bg-[#2a2d33]"
          >
            {saving ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <Check className="h-3.5 w-3.5" strokeWidth={2} />
            )}
            {t("settings.save")}
          </button>
        </div>
      </div>
    </div>
  );
}