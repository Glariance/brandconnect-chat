import { createContext, useContext, type ReactNode } from "react";
import type { ApiBrand } from "@/lib/chat-api";

export type BrandFilterValue = {
  /** "all" or numeric brand id as string (matches AppShell select). */
  brandId: string;
  setBrandId: (id: string) => void;
  brands: ApiBrand[];
};

const BrandFilterContext = createContext<BrandFilterValue | null>(null);

export function BrandFilterProvider({
  value,
  children,
}: {
  value: BrandFilterValue;
  children: ReactNode;
}) {
  return <BrandFilterContext.Provider value={value}>{children}</BrandFilterContext.Provider>;
}

export function useBrandFilter(): BrandFilterValue {
  const ctx = useContext(BrandFilterContext);
  if (!ctx) {
    return { brandId: "all", setBrandId: () => {}, brands: [] };
  }
  return ctx;
}

export function parseBrandFilterId(brandId: string): number | "all" {
  if (brandId === "all" || brandId === "") return "all";
  const n = Number(brandId);
  return Number.isFinite(n) && n > 0 ? n : "all";
}
