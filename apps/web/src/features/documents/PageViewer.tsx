import * as RadixDialog from "@radix-ui/react-dialog";
import { useEffect } from "react";
import { Button } from "../../components/ui/button";
import { t } from "../../i18n";

/**
 * Página do PDF em tela cheia: abre ao clicar na prévia, com anterior e próxima (botões e setas do teclado) e Esc para
 * fechar. A imagem ocupa a altura da tela e rola quando a pessoa precisa ler de perto.
 */
export function PageViewer({
  pages,
  page,
  onPageChange,
  onClose,
}: {
  /** URL de cada página, na ordem. */
  pages: string[];
  /** Página aberta (1…n). */
  page: number;
  onPageChange: (n: number) => void;
  onClose: () => void;
}) {
  const total = pages.length;
  const go = (n: number) => (n >= 1 && n <= total ? onPageChange(n) : undefined);
  // na janela, não no conteúdo: o botão desligado na última página perde o foco
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && page > 1) onPageChange(page - 1);
      else if (e.key === "ArrowRight" && page < total) onPageChange(page + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, total, onPageChange]);
  return (
    <RadixDialog.Root open onOpenChange={(o) => (o ? null : onClose())}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/80" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col bg-black/90 text-white outline-none"
        >
          <div className="flex items-center justify-between gap-2 px-4 py-2">
            <RadixDialog.Title className="text-sm font-medium">
              {t("documents.pageOf", { n: page, total })}
            </RadixDialog.Title>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => go(page - 1)}
              >
                {t("documents.prevPage")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page >= total}
                onClick={() => go(page + 1)}
              >
                {t("documents.nextPage")}
              </Button>
              <RadixDialog.Close asChild>
                <Button type="button" size="sm">
                  {t("documents.close")}
                </Button>
              </RadixDialog.Close>
            </div>
          </div>
          <div className="flex flex-1 justify-center overflow-auto p-4">
            <img
              src={pages[page - 1]}
              alt={t("documents.page", { n: page })}
              className="h-auto max-w-full self-start bg-white shadow-lg md:h-full md:max-h-full md:w-auto"
            />
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
