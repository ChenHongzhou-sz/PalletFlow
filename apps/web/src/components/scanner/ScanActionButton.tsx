import { useState } from "react";
import { CameraScannerDialog } from "@/components/scanner/CameraScannerDialog";

interface ScanActionButtonProps {
  onScan: (value: string) => void;
}

export function ScanActionButton({ onScan }: ScanActionButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="pf-button-secondary shrink-0">
        扫码
      </button>

      <CameraScannerDialog
        open={open}
        onClose={() => setOpen(false)}
        onDetected={(value) => {
          onScan(value.trim());
          setOpen(false);
        }}
      />
    </>
  );
}
