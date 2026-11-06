"use client";

import { useEffect, useState } from "react";
import { DEFAULT_CREDIT_RULES } from "@/lib/credits";
import type { PlanId } from "@/lib/plans";
import { getAdminCredits } from "../actions";

/** Monthly credits per plan as set in Admin → Credits (defaults until loaded). */
export function usePlanCredits(): Record<PlanId, number> {
  const [credits, setCredits] = useState(DEFAULT_CREDIT_RULES.planCredits);
  useEffect(() => {
    getAdminCredits().then((r) => r.ok && setCredits(r.rules.planCredits));
  }, []);
  return credits;
}
