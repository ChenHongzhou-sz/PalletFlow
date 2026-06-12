import { showScannerPreparationMessage } from "@/services/scanner/browser-barcode";

export function ScanActionButton() {
  return (
    <button type="button" onClick={showScannerPreparationMessage} className="pf-button-secondary shrink-0">
      扫码
    </button>
  );
}

