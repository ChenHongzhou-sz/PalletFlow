import { createHashRouter } from "react-router-dom";
import { AppShell } from "@/app/layouts/AppShell";
import { CycleCountPage } from "@/features/cycle-count/CycleCountPage";
import { HomePage } from "@/features/home/HomePage";
import { InboundPage } from "@/features/inbound/InboundPage";
import { InventoryExportPage } from "@/features/inventory-export/InventoryExportPage";
import { MasterDataImportPage } from "@/features/master-data-import/MasterDataImportPage";
import { MaterialSearchPage } from "@/features/material-search/MaterialSearchPage";
import { OperationLogPage } from "@/features/operation-log/OperationLogPage";
import { OutboundPage } from "@/features/outbound/OutboundPage";
import { PalletSearchPage } from "@/features/pallet-search/PalletSearchPage";
import { appRoutes } from "@/lib/constants/routes";

export const router = createHashRouter([
  {
    path: appRoutes.home,
    element: <AppShell />,
    children: [
      {
        index: true,
        element: <HomePage />,
      },
      {
        path: "materials",
        element: <MaterialSearchPage />,
      },
      {
        path: "pallets",
        element: <PalletSearchPage />,
      },
      {
        path: "inbound",
        element: <InboundPage />,
      },
      {
        path: "outbound",
        element: <OutboundPage />,
      },
      {
        path: "counts",
        element: <CycleCountPage />,
      },
      {
        path: "logs",
        element: <OperationLogPage />,
      },
      {
        path: "exports",
        element: <InventoryExportPage />,
      },
      {
        path: "master-data-import",
        element: <MasterDataImportPage />,
      },
    ],
  },
]);
