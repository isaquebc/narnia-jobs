import { useState } from "react";
import { TabPanel, Tabs } from "../../components/ui/tabs";
import { t } from "../../i18n";
import { FileSource } from "./FileSource";
import { GithubSource } from "./github/GithubSource";
import { PendingRuns } from "./PendingRuns";

/** Nova ingestão (F03 §4): GitHub, currículo e texto livre; execuções em andamento e pendentes no topo. */
export function IngestionPage() {
  const [tab, setTab] = useState("github");
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("ingestion.title")}</h1>
      <PendingRuns />
      <Tabs
        value={tab}
        onValueChange={setTab}
        items={[
          { value: "github", label: t("ingestion.sources.github") },
          { value: "cv", label: t("ingestion.sources.cv") },
          { value: "text", label: t("ingestion.sources.text") },
        ]}
      >
        <TabPanel value="github">
          <GithubSource />
        </TabPanel>
        <TabPanel value="cv">
          <FileSource kind="cv" />
        </TabPanel>
        <TabPanel value="text">
          <FileSource kind="text" />
        </TabPanel>
      </Tabs>
    </div>
  );
}
