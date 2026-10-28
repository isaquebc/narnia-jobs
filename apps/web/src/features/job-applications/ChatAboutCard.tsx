import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useApi } from "../../app/context";
import { describeError } from "../../components/ErrorState";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card, CardTitle } from "../../components/ui/card";
import { Textarea } from "../../components/ui/input";
import { t } from "../../i18n";

/**
 * Conversar sobre a candidatura (F07/M6): a mensagem abre a conversa dela com o recrutador (uma por candidatura; as
 * próximas seguem na mesma), que lê a candidatura, move, agenda e registra os contatos pelas tools.
 */
export function ChatAboutCard({ appId }: { appId: string }) {
  const api = useApi();
  const navigate = useNavigate();
  const [message, setMessage] = useState("");
  const open = useMutation({
    mutationFn: () => api.openJobApplicationChat(appId, message.trim()),
    onSuccess: ({ session }) => void navigate({ to: `/chat/${session.id}` as string }),
  });
  return (
    <Card className="flex flex-col gap-2">
      <CardTitle>{t("jobApplications.chat.title")}</CardTitle>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (message.trim()) open.mutate();
        }}
      >
        <Textarea
          aria-label={t("jobApplications.chat.message")}
          placeholder={t("jobApplications.chat.placeholder")}
          rows={2}
          maxLength={4000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={!message.trim() || open.isPending}>
            {t("jobApplications.chat.send")}
          </Button>
        </div>
        {open.isError ? <Alert tone="danger">{describeError(open.error).title}</Alert> : null}
      </form>
    </Card>
  );
}
