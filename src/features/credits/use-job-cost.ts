"use client";

import { useEffect, useState } from "react";
import { DEFAULT_CREDIT_RULES, type PricedFeature } from "@/lib/credits";
import { getJobCosts } from "./actions";

// Loaded once per page load and shared by every tool. The server charges from the same rules, so
// this is only what the user sees before a job; the default shows until it arrives.
let costs: Promise<Record<PricedFeature, number>> | null = null;

/** Credits one job of `feature` costs, as set in Admin → Credits. */
export function useJobCost(feature: PricedFeature) {
  const [cost, setCost] = useState(DEFAULT_CREDIT_RULES.featureCosts[feature]);
  useEffect(() => {
    costs ??= getJobCosts().catch(() => {
      costs = null;
      return DEFAULT_CREDIT_RULES.featureCosts;
    });
    let live = true;
    costs.then((all) => live && setCost(all[feature]));
    return () => {
      live = false;
    };
  }, [feature]);
  return cost;
}
