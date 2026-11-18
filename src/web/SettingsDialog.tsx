import { Button } from "@/components/base/buttons/button";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { loadSettings, saveSettings } from "./api";

const INPUT =
  "w-full rounded-lg border border-border-button-default bg-background-primary-default px-2.5 py-1.5 text-body-2-regular text-text-primary placeholder:text-text-placeholder outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-caption-1-medium text-text-primary">{label}</span>
        <span className="text-caption-2-regular text-text-tertiary">{hint}</span>
      </div>
      {children}
    </label>
  );
}

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function SettingsDialog({ open, onClose, onSaved }: SettingsDialogProps) {
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [extraPrompt, setExtraPrompt] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setError(null);
    setApiKey("");
    loadSettings()
      .then((settings) => {
        setBaseUrl(settings.baseUrl);
        setModel(settings.model);
        setExtraPrompt(settings.extraPrompt);
        setHasKey(settings.hasKey);
      })
      .catch(() => {
        // 读不到就当成空配置
      });
  }, [open]);

  if (!open) return null;

  async function handleSave() {
    setSaving(true);
    setError(null);

    try {
      const payload: Record<string, string> = {
        "ai.baseUrl": baseUrl.trim(),
        "ai.model": model.trim(),
        "ai.extraPrompt": extraPrompt,
      };
      // 留空表示不动已经存好的密钥
      if (apiKey.trim()) payload["ai.apiKey"] = apiKey.trim();

      await saveSettings(payload);
      onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[520px] rounded-2xl border border-border-button-default bg-background-primary-default p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-title-3-semibold text-text-primary">模型设置</h2>
        <p className="mt-1 text-caption-1-regular text-text-tertiary">
          填一个 OpenAI 兼容接口，用来分析技术栈。配置只存在本机数据库里。
        </p>

        <div className="mt-4 space-y-3">
          <Field label="接口地址" hint="到 /v1 为止">
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              className={INPUT}
              placeholder="https://api.deepseek.com/v1"
              spellCheck={false}
            />
          </Field>

          <Field label="API Key" hint={hasKey ? "已保存，留空则不修改" : "必填"}>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              className={INPUT}
              placeholder={hasKey ? "••••••••" : "sk-..."}
              spellCheck={false}
            />
          </Field>

          <Field label="模型名" hint="填服务商文档里的模型 id">
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              className={INPUT}
              placeholder="deepseek-chat"
              spellCheck={false}
            />
          </Field>

          <Field label="额外要求" hint="可选，会拼进分析请求">
            <textarea
              value={extraPrompt}
              onChange={(event) => setExtraPrompt(event.target.value)}
              className={`${INPUT} resize-none`}
              rows={2}
              placeholder="例如：重点关注测试和安全相关的依赖"
            />
          </Field>
        </div>

        {error && (
          <div className="mt-3 text-caption-1-regular text-text-error-primary">{error}</div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="small" onClick={onClose}>
            取消
          </Button>
          <Button size="small" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}
