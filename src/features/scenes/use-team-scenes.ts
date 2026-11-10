"use client";

import { useCallback, useEffect, useState } from "react";
import type { TeamScenes } from "@/components/app/scene-picker";
import { listTeamScenes, saveTeamScene, type TeamScene } from "./actions";

/**
 * The team's saved scenes for a category, and saving an upload as one (with the picked style). A
 * saved scene joins the list at once. Empty until loaded, when no category is chosen, or on failure.
 */
export function useTeamScenes(category: string, style: string | null): TeamScenes {
  const [loaded, setLoaded] = useState<{ category: string; scenes: TeamScene[]; canSave: boolean }>({ category: "", scenes: [], canSave: false });

  useEffect(() => {
    if (!category) return;
    let live = true;
    listTeamScenes(category)
      .then((result) => live && setLoaded({ category, ...result }))
      .catch(() => live && setLoaded({ category, scenes: [], canSave: false }));
    return () => {
      live = false;
    };
  }, [category]);

  const save = useCallback(
    async (file: File, name: string, roomType: string) => {
      const data = new FormData();
      data.set("image", file);
      data.set("name", name);
      data.set("category", category);
      data.set("roomType", roomType);
      if (style) data.set("style", style);
      const result = await saveTeamScene(data);
      if (!result.ok) return null;
      setLoaded((current) => (current.category === category ? { ...current, scenes: [...current.scenes, result.scene] } : current));
      return result.scene;
    },
    [category, style],
  );

  const current = loaded.category === category ? loaded : { scenes: [], canSave: false };
  return { scenes: current.scenes, canSave: current.canSave, save };
}
