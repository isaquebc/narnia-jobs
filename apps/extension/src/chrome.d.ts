/**
 * Só a parte das APIs do Chrome que a extensão usa (F12/M1). Declarada à mão para não trazer `@types/chrome`; cresce
 * junto com o uso nos próximos marcos.
 */
declare namespace chrome {
  namespace storage {
    interface StorageArea {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string[]): Promise<void>;
    }
    const local: StorageArea;
  }
  namespace runtime {
    function openOptionsPage(): Promise<void>;
    function getManifest(): { version: string };
  }
  namespace action {
    const onClicked: { addListener(cb: () => void): void };
  }
}
