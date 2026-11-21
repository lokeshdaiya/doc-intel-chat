"use client";

import { useEffect, useState } from "react";

type Source = "app" | "env" | "default";
type SettingsResponse = {
  settings: { extractor: string; azureModel: string; ocrLanguages: string };
  sources: { extractor: Source; azureModel: Source; ocrLanguages: Source };
  extractors: { id: string; label: string; description: string; configured: boolean; configHint: string | null }[];
};

const SOURCE_LABEL: Record<Source, string> = {
  app: "set here",
  env: "from .env",
  default: "default",
};

const AZURE_MODELS = [
  "prebuilt-layout",
  "prebuilt-read",
  "prebuilt-invoice",
  "prebuilt-receipt",
  "prebuilt-idDocument",
  "prebuilt-businessCard",
  "prebuilt-contract",
];

export default function SettingsPage() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [extractor, setExtractor] = useState("");
  const [azureModel, setAzureModel] = useState("");
  const [ocrLanguages, setOcrLanguages] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  function apply(d: SettingsResponse) {
    setData(d);
    // Only app-level overrides are shown as selected; blank means "use .env / default".
    setExtractor(d.sources.extractor === "app" ? d.settings.extractor : "");
    setAzureModel(d.sources.azureModel === "app" ? d.settings.azureModel : "");
    setOcrLanguages(d.sources.ocrLanguages === "app" ? d.settings.ocrLanguages : "");
  }

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(apply)
      .catch(() => setMessage({ kind: "error", text: "Could not load settings. Is the database running?" }));
  }, []);

  async function save(update: Partial<Record<"extractor" | "azureModel" | "ocrLanguages", string>>) {
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
    const body = await res.json();
    if (res.ok) {
      apply(body);
      setMessage({ kind: "ok", text: "Saved. New uploads and reprocessed documents use these settings." });
    } else {
      setMessage({ kind: "error", text: body.error ?? "Save failed" });
    }
    setSaving(false);
  }

  if (!data) {
    return message ? <p className="text-red-600">{message.text}</p> : <p className="text-zinc-500">Loading…</p>;
  }

  const active = data.extractors.find((e) => e.id === data.settings.extractor);

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Values set here override <code>.env.local</code>. Choose <em>Use .env</em> to go back to the env value.
        </p>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="font-semibold">Extraction service</h2>
          <p className="text-sm text-zinc-500">
            Currently using <strong>{active?.label ?? data.settings.extractor}</strong>{" "}
            <span className="text-xs">({SOURCE_LABEL[data.sources.extractor]})</span>
          </p>
        </div>

        <div className="space-y-2">
          <ExtractorOption
            id=""
            label="Use .env"
            description="DOCUMENT_EXTRACTOR from .env.local. If it's unset or 'auto', Azure is used when configured, otherwise Local."
            checked={extractor === ""}
            onSelect={() => save({ extractor: "" })}
            disabled={saving}
          />
          {data.extractors.map((e) => (
            <ExtractorOption
              key={e.id}
              id={e.id}
              label={e.label}
              description={e.description}
              hint={e.configured ? null : e.configHint}
              checked={extractor === e.id}
              onSelect={() => save({ extractor: e.id })}
              disabled={saving || !e.configured}
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Azure AI Document Intelligence</h2>
        <SettingRow
          label="Model"
          source={SOURCE_LABEL[data.sources.azureModel]}
          effective={data.settings.azureModel}
        >
          <input
            list="azure-models"
            value={azureModel}
            placeholder={`Use .env (${data.sources.azureModel === "app" ? "prebuilt-layout" : data.settings.azureModel})`}
            onChange={(e) => setAzureModel(e.target.value)}
            className="w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 font-mono text-sm dark:border-zinc-700"
          />
          <datalist id="azure-models">
            {AZURE_MODELS.map((m) => <option key={m} value={m} />)}
          </datalist>
        </SettingRow>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Local extractor</h2>
        <SettingRow
          label="OCR languages"
          source={SOURCE_LABEL[data.sources.ocrLanguages]}
          effective={data.settings.ocrLanguages}
          help="Tesseract language codes joined with +, e.g. eng, eng+hin, eng+deu. Language data downloads on first use."
        >
          <input
            value={ocrLanguages}
            placeholder={`Use .env (${data.sources.ocrLanguages === "app" ? "eng" : data.settings.ocrLanguages})`}
            onChange={(e) => setOcrLanguages(e.target.value)}
            className="w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 font-mono text-sm dark:border-zinc-700"
          />
        </SettingRow>
      </section>

      <div className="flex items-center gap-3">
        <button
          onClick={() => save({ azureModel, ocrLanguages })}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {message && (
          <span className={`text-sm ${message.kind === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}

function ExtractorOption(props: {
  id: string;
  label: string;
  description: string;
  hint?: string | null;
  checked: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={`flex gap-3 rounded-lg border p-3 ${
        props.checked ? "border-blue-600 bg-blue-50 dark:bg-blue-950/30" : "border-zinc-200 dark:border-zinc-800"
      } ${props.disabled && !props.checked ? "opacity-60" : "cursor-pointer"}`}
    >
      <input
        type="radio"
        name="extractor"
        value={props.id}
        checked={props.checked}
        disabled={props.disabled}
        onChange={props.onSelect}
        className="mt-1"
      />
      <span>
        <span className="font-medium">{props.label}</span>
        <span className="block text-sm text-zinc-600 dark:text-zinc-400">{props.description}</span>
        {props.hint && <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">Not configured: {props.hint}</span>}
      </span>
    </label>
  );
}

function SettingRow(props: { label: string; source: string; effective: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{props.label}</span>
        <span className="text-xs text-zinc-500">
          in use: <code>{props.effective}</code> ({props.source})
        </span>
      </div>
      {props.children}
      {props.help && <p className="text-xs text-zinc-500">{props.help}</p>}
    </div>
  );
}
