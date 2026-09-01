import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Icon } from "../ui/Icon";
import { cn } from "@/lib/utils";
import { useSessionStore } from "../../stores/session-store";

type Tab = "discover" | "installed";

/** 从安装源提取展示名：npm:@scope/pkg → @scope/pkg。 */
function nameOfSource(spec: string): string {
  const i = spec.indexOf(":");
  return i >= 0 ? spec.slice(i + 1) : spec;
}

function MarketCard({
  item,
  installed,
  busy,
  onInstall,
  onRemove,
}: {
  item: PiMarketItem;
  installed: boolean;
  busy: boolean;
  onInstall(): void;
  onRemove(): void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-white/[0.02] p-3.5 transition-colors hover:border-border hover:bg-white/[0.04]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-foreground" title={item.name}>{item.name}</h3>
            {item.version && <Badge variant="secondary" className="shrink-0 font-mono text-[10px] font-normal">v{item.version}</Badge>}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {item.author && <span className="truncate">{item.author}</span>}
            {item.updated && <span className="shrink-0">· {item.updated.slice(0, 10)}</span>}
          </div>
        </div>
      </div>
      <p className="line-clamp-2 min-h-8 text-xs leading-relaxed text-muted-foreground">{item.description || "—"}</p>
      <div className="mt-auto flex items-center gap-2">
        {installed ? (
          <>
            <span className="flex items-center gap-1 text-xs text-success"><Icon name="check" className="size-3.5" />已安装</span>
            <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs text-muted-foreground hover:text-foreground" disabled={busy} onClick={onRemove}>
              {busy ? "处理中…" : "卸载"}
            </Button>
          </>
        ) : (
          <Button size="sm" className="ml-auto h-7 text-xs" disabled={busy} onClick={onInstall}>
            {busy ? "安装中…" : "安装"}
          </Button>
        )}
      </div>
    </div>
  );
}

export function PackageMarket({ onClose }: { onClose(): void }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>("discover");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<PiMarketItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [installed, setInstalled] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const engineReady = useSessionStore((s) => s.engineReady);

  // 已安装源 + 其裸名，用于双向匹配市场条目
  const installedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const spec of installed) {
      set.add(spec);
      set.add(`npm:${nameOfSource(spec)}`);
      set.add(nameOfSource(spec));
    }
    return set;
  }, [installed]);
  const isInstalled = useCallback((item: PiMarketItem) => installedKeys.has(item.source) || installedKeys.has(item.name), [installedKeys]);

  const loadInstalled = useCallback(() => {
    void window.pi.packagesList().then((r) => setInstalled(r.packages)).catch(() => setInstalled([]));
  }, []);

  const runSearch = useCallback((q: string) => {
    setSearching(true);
    void window.pi
      .packagesSearch(q)
      .then((r) => {
        if (!r.ok) {
          toast.error(r.error || "检索失败，请检查网络");
          setItems([]);
        } else {
          setItems(r.items as PiMarketItem[]);
        }
      })
      .catch((err) => toast.error(String((err as Error)?.message ?? err)))
      .finally(() => setSearching(false));
  }, []);

  useEffect(() => {
    loadInstalled();
  }, [loadInstalled]);

  // 搜索防抖（含首帧默认「发现」）
  useEffect(() => {
    const t = setTimeout(() => runSearch(query), query ? 350 : 0);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  const reloadExtensions = (): void => {
    if (engineReady) void window.pi.engineReload().then(() => toast.success("扩展已热重载"));
    else toast.message("下次选择项目时新扩展生效");
  };

  const doInstall = (item: PiMarketItem): void => {
    setBusy(item.source);
    toast.loading(`安装 ${item.name}…（经 pi CLI）`, { id: item.source, duration: 8000 });
    void window.pi
      .packagesInstall(item.source)
      .then(() => {
        toast.success(`${item.name} 已安装`, { id: item.source });
        loadInstalled();
        reloadExtensions();
      })
      .catch((err) => toast.error(String((err as Error)?.message ?? err), { id: item.source, duration: 8000 }))
      .finally(() => setBusy(null));
  };

  const doRemove = (spec: string): void => {
    setBusy(spec);
    void window.pi
      .packagesUninstall(spec)
      .then(() => {
        toast.success("已卸载");
        loadInstalled();
        reloadExtensions();
      })
      .catch((err) => toast.error(String((err as Error)?.message ?? err)))
      .finally(() => setBusy(null));
  };

  const doUpdateAll = (): void => {
    setBusy("__all__");
    toast.loading("更新全部扩展…", { id: "update-all", duration: 8000 });
    void window.pi
      .packagesUpdate()
      .then(() => toast.success("更新完成", { id: "update-all" }))
      .catch((err) => toast.error(String((err as Error)?.message ?? err), { id: "update-all", duration: 8000 }))
      .finally(() => setBusy(null));
  };

  const segBtn = (id: Tab, label: string): React.JSX.Element => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={cn("rounded-md px-3 py-1.5 text-xs font-medium transition-colors", tab === id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}
    >
      {label}
    </button>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-3xl flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 px-6 pb-3 pt-6">
          <DialogTitle>插件市场</DialogTitle>
          <DialogDescription className="text-xs">浏览并安装 pi-agent 社区扩展（npm 包），经 pi CLI 安装、热重载生效。</DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 items-center gap-1 border-b border-border px-6">
          {segBtn("discover", "发现")}
          {segBtn("installed", `已安装${installed.length ? ` (${installed.length})` : ""}`)}
          <div className="relative ml-auto my-2 w-56">
            <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => { setQuery(e.target.value); setTab("discover"); }} placeholder="搜索扩展…" className="h-8 pl-8 text-xs" />
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1 px-6 py-4">
          {tab === "discover" ? (
            searching && items.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Icon name="spinner" className="size-4 animate-spin" /> 正在检索 npm…
              </div>
            ) : items.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">没有匹配的扩展。</div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {items.map((item) => (
                  <MarketCard
                    key={item.source}
                    item={item}
                    installed={isInstalled(item)}
                    busy={busy === item.source}
                    onInstall={() => doInstall(item)}
                    onRemove={() => doRemove(item.source)}
                  />
                ))}
              </div>
            )
          ) : installed.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">还没有安装扩展，去「发现」页挑一个。</div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">已随 settings.packages 安装</span>
                <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy === "__all__"} onClick={doUpdateAll}>
                  {busy === "__all__" ? "更新中…" : "全部更新"}
                </Button>
              </div>
              {installed.map((spec) => (
                <div key={spec} className="flex items-center gap-3 rounded-lg border border-border/60 bg-white/[0.02] px-3.5 py-2.5">
                  <Icon name="package" className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={spec}>{nameOfSource(spec)}</span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{spec.slice(0, spec.indexOf(":") >= 0 ? spec.indexOf(":") : undefined)}</span>
                  <Button size="sm" variant="ghost" className="h-7 shrink-0 text-xs text-muted-foreground hover:text-destructive" disabled={busy === spec} onClick={() => doRemove(spec)}>
                    {busy === spec ? "处理中…" : "卸载"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
