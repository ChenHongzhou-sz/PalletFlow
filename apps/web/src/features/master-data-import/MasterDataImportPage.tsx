import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { ConfigNotice } from "@/components/feedback/ConfigNotice";
import { EmptyState } from "@/components/feedback/EmptyState";
import { StatCard } from "@/components/feedback/StatCard";
import { PageHeader } from "@/components/mobile/PageHeader";
import {
  validateBarcodeAliasesCsv,
  validateBarcodeAliasesMatrix,
  validateMaterialsCsv,
  validateMaterialsMatrix,
} from "@/lib/csv/import-validation";
import { decodeImportFile } from "@/lib/csv/decode-import-file";
import { resolveErrorMessage } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/formatters/date";
import { readImportWorkbook } from "@/lib/spreadsheet/import-workbook";
import { listRecentImportRuns } from "@/services/import/import-history-service";
import { commitBarcodeAliasImport, commitMaterialImport } from "@/services/import/master-data-import-service";
import { isSupabaseConfigured } from "@/services/supabase/client";
import type {
  BarcodeAliasImportRow,
  ImportMode,
  ImportPreviewResult,
  MasterDataImportRun,
  MaterialImportRow,
} from "@/types/import";

type PreviewState =
  | ImportPreviewResult<MaterialImportRow>
  | ImportPreviewResult<BarcodeAliasImportRow>
  | null;

const modeCopy: Record<ImportMode, { title: string; description: string; required: string }> = {
  materials: {
    title: "物料主数据",
    description: "导入 material_code、short_code、description 等基础主数据。空白字段不会覆盖已有值。",
    required: "必需列：material_code",
  },
  barcode_aliases: {
    title: "条码映射",
    description: "导入 barcode 到 material_code 的映射。同一个物料可以绑定多个条码。",
    required: "必需列：barcode、material_code",
  },
};

export function MasterDataImportPage() {
  const [mode, setMode] = useState<ImportMode>("materials");
  const [operatorName, setOperatorName] = useState("");
  const [sourceFileName, setSourceFileName] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceEncoding, setSourceEncoding] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState>(null);
  const [importRuns, setImportRuns] = useState<MasterDataImportRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const modeMeta = modeCopy[mode];
  const canSubmit = Boolean(preview && preview.validRows.length > 0 && preview.issues.length === 0 && isSupabaseConfigured);

  const validPreviewRows = useMemo(() => preview?.validRows.slice(0, 8) ?? [], [preview]);
  const previewIssues = useMemo(() => preview?.issues.slice(0, 8) ?? [], [preview]);

  async function loadImportRuns() {
    if (!isSupabaseConfigured) {
      setImportRuns([]);
      return;
    }

    setLoadingRuns(true);

    try {
      const runs = await listRecentImportRuns();
      setImportRuns(runs);
    } catch {
      setImportRuns([]);
    } finally {
      setLoadingRuns(false);
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setError(null);
    setMessage(null);
    setPreview(null);

    if (!file) {
      return;
    }

    setSourceFileName(file.name);
    setSourceFile(file);

    if (file.name.toLowerCase().endsWith(".xlsx")) {
      setSourceEncoding(null);
      setSourceText("");
      setMessage(`已载入 Excel 文件：${file.name}。点击“预校验并生成预览”后会读取 ${mode === "materials" ? "materials" : "barcode_aliases"} 工作表。`);
      return;
    }

    const decoded = await decodeImportFile(file);
    setSourceEncoding(decoded.encoding);
    setSourceText(decoded.text);
    setMessage(`已载入文件：${file.name}（自动识别为 ${decoded.encoding} 编码）。`);
  }

  async function handlePreview() {
    setError(null);
    setMessage(null);
    setPreviewing(true);

    try {
      if (sourceFile && sourceFile.name.toLowerCase().endsWith(".xlsx")) {
        const matrix = await readImportWorkbook(sourceFile, mode);
        const nextPreview = mode === "materials" ? validateMaterialsMatrix(matrix) : validateBarcodeAliasesMatrix(matrix);
        setPreview(nextPreview);
        return;
      }

      if (!sourceText.trim()) {
        setPreview(null);
        setError("请先上传 Excel / CSV 文件，或者把 CSV 内容粘贴到文本框。");
        return;
      }

      const nextPreview = mode === "materials" ? validateMaterialsCsv(sourceText) : validateBarcodeAliasesCsv(sourceText);
      setPreview(nextPreview);
    } catch (reason) {
      setPreview(null);
      setError(resolveErrorMessage(reason));
    } finally {
      setPreviewing(false);
    }
  }

  async function handleCommit() {
    if (!preview || !preview.validRows.length) {
      return;
    }

    const confirmed = window.confirm(`确认提交 ${preview.validRows.length} 行${modeMeta.title}吗？`);
    if (!confirmed) {
      return;
    }

    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const result =
        mode === "materials"
          ? await commitMaterialImport(preview.validRows as MaterialImportRow[], sourceFileName, operatorName)
          : await commitBarcodeAliasImport(preview.validRows as BarcodeAliasImportRow[], sourceFileName, operatorName);

      setMessage(`导入完成：处理 ${result.processed_count} 行，新增 ${result.created_count} 行，更新 ${result.updated_count} 行。`);
      await loadImportRuns();
    } catch (reason) {
      setError(resolveErrorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  }

  function handleModeChange(nextMode: ImportMode) {
    setMode(nextMode);
    setPreview(null);
    setError(null);
    setMessage(null);
  }

  useEffect(() => {
    if (isSupabaseConfigured) {
      loadImportRuns().catch(() => {
        // handled inside loadImportRuns
      });
    }
  }, []);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Master Data Import"
        title="主数据导入"
        description="给物料主数据和条码映射提供一条受控导入通道。前端先预校验，正式落库再走数据库事务函数。"
      />
      <ConfigNotice />

      <section className="pf-panel space-y-5 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          {(["materials", "barcode_aliases"] as const).map((item) => {
            const active = mode === item;
            return (
              <button
                key={item}
                type="button"
                onClick={() => handleModeChange(item)}
                className={`rounded-[1.6rem] p-4 text-left transition ${
                  active ? "bg-ink text-white" : "bg-slate-100/90 text-ink"
                }`}
              >
                <p className="font-display text-xl font-semibold">{modeCopy[item].title}</p>
                <p className={`mt-2 text-sm leading-6 ${active ? "text-white/80" : "text-slate-600"}`}>
                  {modeCopy[item].description}
                </p>
              </button>
            );
          })}
        </div>

        <div className="rounded-[1.6rem] bg-slate-100/80 p-4 text-sm leading-6 text-slate-600">
          <p className="font-semibold text-ink">{modeMeta.required}</p>
          <p className="mt-2">
            模板下载：
            <a className="ml-2 font-semibold text-ink underline" href={`${import.meta.env.BASE_URL}templates/materials-import-template.csv`} download>
              物料 CSV 模板
            </a>
            <a className="ml-4 font-semibold text-ink underline" href={`${import.meta.env.BASE_URL}templates/barcode-aliases-import-template.csv`} download>
              条码 CSV 模板
            </a>
            <a className="ml-4 font-semibold text-ink underline" href={`${import.meta.env.BASE_URL}templates/PalletFlow-master-data-import-template.xlsx`} download>
              Excel 模板
            </a>
          </p>
          <p className="mt-2">
            现在页面已经支持两种入口：直接上传 `.xlsx` 模板，或者上传 / 粘贴 CSV。Excel 会按当前模式读取对应工作表。
          </p>
          <p className="mt-2">
            如果你的 CSV 来自 Excel，系统会自动识别 `UTF-8`、`GB18030` 或 `GBK` 编码，减少中文和特殊符号乱码问题。
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          <div className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-600">上传文件</span>
              <input
                type="file"
                accept=".csv,text/csv,.txt,.xlsx"
                onChange={handleFileChange}
                className="pf-input cursor-pointer file:mr-4 file:rounded-full file:border-0 file:bg-ember file:px-4 file:py-2 file:font-semibold file:text-ink"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-600">操作人</span>
              <input
                value={operatorName}
                onChange={(event) => setOperatorName(event.target.value)}
                className="pf-input"
                placeholder="可选，例如 管理员"
              />
            </label>

            {sourceFileName && sourceEncoding ? (
              <div className="rounded-[1.4rem] bg-white/80 px-4 py-3 text-sm text-slate-600">
                已识别编码：<span className="font-semibold text-ink">{sourceEncoding}</span>
              </div>
            ) : null}

            <button type="button" onClick={handlePreview} disabled={previewing} className="pf-button-secondary w-full">
              {previewing ? "正在预校验..." : "预校验并生成预览"}
            </button>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-600">CSV 内容</span>
            <textarea
              value={sourceText}
              onChange={(event) => {
                setSourceFile(null);
                setSourceEncoding(null);
                setSourceText(event.target.value);
              }}
              className="pf-input min-h-64"
              placeholder="也可以直接把 CSV 内容粘贴到这里。"
            />
          </label>
        </div>
      </section>

      {error ? <div className="pf-panel border-red-200 bg-red-50/90 p-4 text-sm text-red-800">{error}</div> : null}
      {message ? <div className="pf-panel border-emerald-200 bg-emerald-50/90 p-4 text-sm text-emerald-800">{message}</div> : null}

      {preview ? (
        <>
          <section className="grid gap-3 sm:grid-cols-4">
            <StatCard label="数据行" value={String(preview.totalRows)} tone="dark" />
            <StatCard label="可提交" value={String(preview.validRows.length)} />
            <StatCard label="问题数" value={String(preview.issues.length)} tone={preview.issues.length ? "accent" : "default"} />
            <StatCard label="重复键" value={String(preview.duplicateKeys.length)} />
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.1fr_1fr]">
            <div className="pf-panel p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-2xl font-semibold text-ink">可提交预览</h2>
                <span className="text-xs text-slate-500">仅显示前 8 行</span>
              </div>
              {validPreviewRows.length ? (
                <div className="mt-4 space-y-3">
                  {validPreviewRows.map((row) => (
                    <div key={`${mode}-${row.rowNumber}`} className="rounded-[1.4rem] bg-slate-100/90 p-4 text-sm text-slate-700">
                      <p className="font-semibold text-ink">第 {row.rowNumber} 行</p>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-body text-xs">{JSON.stringify(row, null, 2)}</pre>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="没有可提交数据" description="请先修复重复键、缺失必填列或空主键问题。" />
              )}
            </div>

            <div className="pf-panel p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-2xl font-semibold text-ink">校验问题</h2>
                <span className="text-xs text-slate-500">仅显示前 8 条</span>
              </div>
              {previewIssues.length ? (
                <div className="mt-4 space-y-3">
                  {previewIssues.map((issue, index) => (
                    <div key={`${issue.rowNumber}-${issue.field}-${index}`} className="rounded-[1.4rem] bg-red-50 p-4 text-sm text-red-800">
                      <p className="font-semibold">
                        第 {issue.rowNumber} 行 · {issue.field}
                      </p>
                      <p className="mt-2 leading-6">{issue.message}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="当前没有结构问题" description="这批数据已经通过前端预校验，可以继续提交到正式数据库。" />
              )}
            </div>
          </section>

          <button type="button" onClick={handleCommit} disabled={!canSubmit || submitting} className="pf-button-primary w-full">
            {submitting ? "正在导入..." : "确认提交主数据"}
          </button>

          {!isSupabaseConfigured ? (
            <p className="text-sm text-slate-500">当前环境还没连接 Supabase，所以暂时只能做本地预校验，不能正式提交。</p>
          ) : null}
        </>
      ) : (
        <EmptyState title="先上传或粘贴 CSV" description="点击“预校验并生成预览”后，系统会先拦住重复键和缺失必填列，再允许正式提交。" />
      )}

      <section className="pf-panel p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink">最近导入记录</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">用来追踪谁在什么时间导入了主数据，以及本次是新增还是更新。</p>
          </div>
          <button type="button" onClick={() => loadImportRuns()} className="pf-button-secondary">
            刷新记录
          </button>
        </div>

        {loadingRuns ? <p className="mt-4 text-sm text-slate-500">正在读取导入记录...</p> : null}

        {!loadingRuns && !importRuns.length ? (
          <div className="mt-4">
            <EmptyState title="还没有导入记录" description="等你第一次正式提交物料主数据或条码映射后，这里会自动显示最近记录。" />
          </div>
        ) : null}

        {importRuns.length ? (
          <div className="mt-4 space-y-3">
            {importRuns.map((run) => (
              <div key={run.id} className="rounded-[1.4rem] bg-slate-100/90 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-xl font-semibold text-ink">
                      {run.importType === "materials" ? "物料主数据" : "条码映射"}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {run.sourceFileName || "未记录文件名"}
                      {run.operatorName ? ` · 操作人 ${run.operatorName}` : ""}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">{formatDateTime(run.createdAt)}</p>
                  </div>
                  <div className="grid min-w-56 grid-cols-4 gap-2 text-center text-xs">
                    <div className="rounded-2xl bg-white px-2 py-3">
                      <p className="text-slate-500">处理</p>
                      <p className="mt-1 font-semibold text-ink">{run.processedRows}</p>
                    </div>
                    <div className="rounded-2xl bg-white px-2 py-3">
                      <p className="text-slate-500">新增</p>
                      <p className="mt-1 font-semibold text-ink">{run.createdRows}</p>
                    </div>
                    <div className="rounded-2xl bg-white px-2 py-3">
                      <p className="text-slate-500">更新</p>
                      <p className="mt-1 font-semibold text-ink">{run.updatedRows}</p>
                    </div>
                    <div className="rounded-2xl bg-white px-2 py-3">
                      <p className="text-slate-500">拒绝</p>
                      <p className="mt-1 font-semibold text-ink">{run.rejectedRows}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
