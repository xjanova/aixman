"use client";

/**
 * The interactive bits of /docs: copyable code blocks and the client-setup tabs.
 * Everything else on the page is static, server-rendered text.
 */

import { useState, type ReactNode } from "react";

const mono: React.CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" };

export function CopyButton({ text, label = "คัดลอก" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(
      () => {
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      },
      () => setDone(false)
    );
  };
  return (
    <button type="button" onClick={copy} className="docs-copy" aria-label="คัดลอกโค้ด">
      {done ? "คัดลอกแล้ว ✓" : label}
    </button>
  );
}

/** A code sample with its language (or file name) and a copy button. */
export function Code({ code, lang, title }: { code: string; lang?: string; title?: string }) {
  return (
    <div className="docs-code">
      <div className="docs-code-bar">
        <span>{title ?? lang ?? ""}</span>
        <CopyButton text={code} />
      </div>
      <pre style={mono}>{code}</pre>
    </div>
  );
}

export interface Tab {
  id: string;
  label: string;
  badge?: string;
  body: ReactNode;
}

/** Tabs that keep every panel in the page (search and print still find them); only the chosen one shows. */
export function Tabs({ tabs, initial }: { tabs: Tab[]; initial?: string }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.id);
  return (
    <div className="docs-tabs">
      <div className="docs-tablist" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            className={active === t.id ? "docs-tab docs-tab-on" : "docs-tab"}
            onClick={() => setActive(t.id)}
          >
            {t.label}
            {t.badge && <span className="docs-tab-badge">{t.badge}</span>}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" hidden={active !== t.id} className="docs-tabpanel">
          {t.body}
        </div>
      ))}
    </div>
  );
}
