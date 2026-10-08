import { useEffect, useState } from "react";
import { useWs } from "../app/context";
import type { WsStatus } from "../lib/ws";

export function useWsStatus(): WsStatus {
  const ws = useWs();
  const [status, setStatus] = useState<WsStatus>(ws.status);
  useEffect(() => ws.onStatus(setStatus), [ws]);
  return status;
}
