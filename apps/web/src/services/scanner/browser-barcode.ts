export function canUseNativeBarcodeDetector() {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

export function showScannerPreparationMessage() {
  if (canUseNativeBarcodeDetector()) {
    window.alert("当前页面已经预留扫码入口。下一步接入相机预览和条码识别流程即可启用。");
    return;
  }

  window.alert("当前浏览器没有原生扫码能力。后续接入 zxing-js/browser 或 html5-qrcode 后即可启用扫码。");
}

