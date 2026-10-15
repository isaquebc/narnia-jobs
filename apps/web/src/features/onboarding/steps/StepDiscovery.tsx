import { lazy, Suspense, useState } from "react";
import { useApi } from "../../../app/context";
import { describeError } from "../../../components/ErrorState";
import { Alert } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { useChatSessions } from "../../../hooks/useChat";
import { useProfiles } from "../../../hooks/useProfiles";
import { t } from "../../../i18n";
import type { StepProps } from "../Wizard";

// o chat fica no chunk sob demanda da rota /chat (F04): o wizard não o carrega no bundle inicial
const ChatView = lazy(() => import("../../chat/ChatPage").then((m) => ({ default: m.ChatView })));

/**
 * Passo 6 · entrevista de descoberta (auditoria E2, 18a; 02-fluxos passo 7, 05-layouts: reutiliza L2). Opcional: o
 * recrutador pergunta só as lacunas (`fact_gaps`) e as respostas vão para a revisão por `ingest_text`. A conversa é de
 * categoria `discovery`; voltar ao passo retoma a mesma. O primeiro uso só conclui ao sair daqui (pular ou concluir).
 */
export function StepDiscovery({ finish }: StepProps) {
  const api = useApi();
  const { active } = useProfiles();
  const { sessions, create, isLoading } = useChatSessions();
  const existing = sessions.find((s) => s.category === "discovery" && s.state !== "archived");
  const [error, setError] = useState<unknown>(null);
  const [starting, setStarting] = useState(false);
  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      const r = await create.mutateAsync({
        category: "discovery",
        title: t("discovery.sessionTitle"),
      });
      await api.sendChatMessage(r.session.id, t("discovery.kickoff"));
    } catch (e) {
      setError(e);
    } finally {
      setStarting(false);
    }
  };
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">{t("discovery.title")}</h2>
        <p className="text-sm text-muted-fg">{t("discovery.hint")}</p>
      </div>
      {error ? <Alert tone="danger">{describeError(error).title}</Alert> : null}
      {existing ? (
        <>
          <div className="flex h-[60vh] min-h-0 flex-col">
            <Suspense fallback={<p className="text-sm text-muted-fg">{t("app.loading")}</p>}>
              <ChatView sessionId={existing.id} />
            </Suspense>
          </div>
          <p className="text-xs text-muted-fg">{t("discovery.reviewNote")}</p>
          <div className="flex justify-end">
            <Button onClick={() => void finish()}>{t("discovery.finish")}</Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-fg">{t("discovery.optional")}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => void finish()}>
              {t("discovery.skip")}
            </Button>
            <Button onClick={() => void start()} disabled={isLoading || starting || !active}>
              {t("discovery.start")}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
