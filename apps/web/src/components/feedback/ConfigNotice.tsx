import { isSupabaseConfigured } from "@/services/supabase/client";

export function ConfigNotice() {
  if (isSupabaseConfigured) {
    return null;
  }

  return (
    <div className="pf-panel break-words border-amber-200 bg-amber-50/90 p-4 text-sm leading-7 text-amber-900">
      还没配置 Supabase 环境变量。页面结构已经可用，但正式数据读写要先填写
      <code className="mx-1 break-all rounded bg-white px-1 py-0.5">apps/web/.env</code>
      里的
      <code className="mx-1 break-all rounded bg-white px-1 py-0.5">VITE_SUPABASE_URL</code>
      和
      <code className="ml-1 break-all rounded bg-white px-1 py-0.5">VITE_SUPABASE_ANON_KEY</code>
      。
    </div>
  );
}
