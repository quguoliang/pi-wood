import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { MemoryItem, MemoryListResult, MemoryScope, MemoryType } from "@pi-wood/ipc-schema";
import { cn } from "@/lib/utils";

const TYPES: MemoryType[] = ["fact", "preference", "reference"];

function reviewedBadge(reviewed: boolean): React.JSX.Element {
  return reviewed ? (
    <Badge variant="success" className="shrink-0 text-[10px]">已确认</Badge>
  ) : (
    <Badge variant="warning" className="shrink-0 text-[10px]">待确认</Badge>
  );
}

function Row({ item, onChanged }: { item: MemoryItem; onChanged: () => void }): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ title: string; body: string }>({ title: item.title, body: item.body });
  const busy = (fn: () => Promise<unknown>): void => {
    void fn().then(onChanged);
  };
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>
        <Badge variant="outline" className="shrink-0 text-[10px]">{item.type}</Badge>
        {reviewedBadge(item.reviewed)}
      </div>
      {editing ? (
        <div className="mt-2 space-y-1.5">
          <Input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="标题" />
          <Textarea rows={3} value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} placeholder="内容" />
          <div className="flex gap-1.5">
            <Button size="sm" onClick={() => busy(() => window.pi.memoryUpdate({ id: item.id, title: draft.title, body: draft.body }).then(() => setEditing(false)))}>保存</Button>
            <Button size="sm" variant="ghost" onClick={() => { setDraft({ title: item.title, body: item.body }); setEditing(false); }}>取消</Button>
          </div>
        </div>
      ) : (
        <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">{item.body}</p>
      )}
      <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
        <span className="font-mono">{item.id}</span>
        <span className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => busy(() => window.pi.memorySetReviewed(item.id, !item.reviewed))}>
            {item.reviewed ? "取消确认" : "确认"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)}>编辑</Button>
          <Button size="sm" variant="ghost" onClick={() => busy(() => window.pi.memoryDelete(item.id))}>删除</Button>
        </span>
      </div>
    </div>
  );
}

function AddForm({ onAdded }: { onAdded: () => void }): React.JSX.Element {
  const [scope, setScope] = useState<MemoryScope>("global");
  const [type, setType] = useState<MemoryType>("preference");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const add = (): void => {
    if (!title.trim() || !body.trim()) return;
    void window.pi.memorySave({ title: title.trim(), body: body.trim(), scope, type }).then(() => {
      setTitle("");
      setBody("");
      onAdded();
    });
  };
  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/10 p-2.5">
      <p className="text-xs font-medium text-muted-foreground">手动新增记忆</p>
      <div className="flex flex-wrap gap-2">
        <select className="h-8 rounded-md border border-input bg-transparent px-2 text-xs" value={scope} onChange={(e) => setScope(e.target.value as MemoryScope)}>
          <option value="global">global（跨项目）</option>
          <option value="project">project（当前项目）</option>
        </select>
        <select className="h-8 rounded-md border border-input bg-transparent px-2 text-xs" value={type} onChange={(e) => setType(e.target.value as MemoryType)}>
          {TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题" />
      <Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="内容" />
      <Button size="sm" onClick={add} disabled={!title.trim() || !body.trim()}>添加</Button>
    </div>
  );
}

export function MemorySettingsPanel(): React.JSX.Element {
  const [data, setData] = useState<MemoryListResult>({ global: [], project: [] });
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    void window.pi.memoryList().then((d) => {
      setData(d);
      setLoading(false);
    });
  }, []);
  useEffect(reload, [reload]);

  if (loading) return <p className="text-xs text-muted-foreground">正在加载记忆…</p>;
  const empty = data.global.length === 0 && data.project.length === 0;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Agent 可跨会话保存的长期记忆（agent 通过 <span className="font-mono">memory.*</span> 工具读写）。
        agent 存的一律标「待确认」，你确认后才视为可靠长期记忆；project 记忆只在当前项目可见。
      </p>
      <AddForm onAdded={reload} />
      {empty && <p className="text-xs text-muted-foreground">还没有记忆。</p>}
      {(["project", "global"] as const).map((scope) => {
        const list = data[scope];
        if (list.length === 0) return null;
        return (
          <div key={scope} className="space-y-2">
            <p className={cn("text-xs font-medium uppercase tracking-wide", scope === "project" ? "text-foreground" : "text-muted-foreground")}>
              {scope === "project" ? "本项目记忆" : "全局记忆"} · {list.length}
            </p>
            {list.map((m) => (
              <Row key={m.id} item={m} onChanged={reload} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
