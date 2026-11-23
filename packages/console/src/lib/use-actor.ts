"use client";

import { useCallback, useEffect, useState } from "react";

const ACTOR_KEY = "axa.actor";
const DEFAULT_ACTOR = "Boss";

export function useActor() {
  const [actor, setActorState] = useState(DEFAULT_ACTOR);

  useEffect(() => {
    const saved = window.localStorage.getItem(ACTOR_KEY)?.trim();
    if (saved) setActorState(saved);
  }, []);

  const setActor = useCallback((value: string) => {
    const next = value.trim() || DEFAULT_ACTOR;
    setActorState(next);
    window.localStorage.setItem(ACTOR_KEY, next);
  }, []);

  return { actor, setActor };
}
