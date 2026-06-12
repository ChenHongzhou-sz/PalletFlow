import { ConfigNotice } from "@/components/feedback/ConfigNotice";
import { ActionTile } from "@/components/mobile/ActionTile";
import { appRoutes } from "@/lib/constants/routes";

export function HomePage() {
  return (
    <div className="space-y-5">
      <section className="pf-panel overflow-hidden p-5 sm:p-7">
        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <div className="min-w-0">
            <span className="pf-pill bg-ember text-ink">查找优先</span>
            <h2 className="mt-4 max-w-xl font-display text-[2.5rem] font-semibold leading-tight text-ink sm:text-4xl">
              让仓管员先看到
              <span className="block text-slate-500">“物料在哪” 和 “卡板里有什么”</span>
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-7 text-slate-600">
              所有库存以批次为单位记录，FIFO 按生产年月执行。浏览器只缓存页面和草稿，正式数据不依赖本地存储。
            </p>
          </div>
          <div className="rounded-[2rem] bg-ink p-5 text-white">
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-white/70">今天最常用</p>
            <div className="mt-4 space-y-3">
              <ActionTile to={appRoutes.materialSearch} title="查物料" subtitle="输入 100UF / SZ121 / 完整料号" tone="primary" />
              <ActionTile to={appRoutes.palletSearch} title="查卡板" subtitle="直接查 A01 / B15 / C08" tone="dark" />
            </div>
          </div>
        </div>
      </section>

      <ConfigNotice />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <ActionTile to={appRoutes.inbound} title="进卡板" subtitle="3 步录入卡板、物料、批次" tone="soft" />
        <ActionTile to={appRoutes.outbound} title="出卡板" subtitle="按生产年月自动给出 FIFO 建议" tone="soft" />
        <ActionTile to={appRoutes.cycleCount} title="盘点" subtitle="从卡板开始核对系统数量与实际数量" tone="soft" />
      </section>
    </div>
  );
}
