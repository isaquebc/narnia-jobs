/**
 * Só a parte das APIs do Chrome que a extensão usa (F12/M1, M2). Declarada à mão para não trazer `@types/chrome`;
 * cresce junto com o uso nos próximos marcos.
 */
declare namespace chrome {
  namespace storage {
    interface StorageArea {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string[]): Promise<void>;
    }
    const local: StorageArea;
    const session: StorageArea;
  }
  namespace runtime {
    function openOptionsPage(): Promise<void>;
    function getManifest(): { version: string };
  }
  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
    }
    function update(tabId: number, props: { url?: string }): Promise<Tab>;
  }
  namespace windows {
    interface Window {
      id?: number;
      left?: number;
      top?: number;
      width?: number;
      height?: number;
      tabs?: tabs.Tab[];
    }
    function get(id: number, opts?: { populate?: boolean }): Promise<Window>;
    function getCurrent(): Promise<Window>;
    function update(id: number, props: { focused?: boolean }): Promise<Window>;
    function create(props: {
      url: string;
      type: "popup" | "normal";
      width?: number;
      height?: number;
      left?: number;
      top?: number;
    }): Promise<Window>;
  }
  namespace scripting {
    interface InjectionResult {
      result?: unknown;
    }
    function executeScript(opts: {
      target: { tabId: number };
      files?: string[];
      func?: () => unknown;
    }): Promise<InjectionResult[]>;
  }
  namespace action {
    const onClicked: { addListener(cb: (tab: tabs.Tab) => void): void };
    function setBadgeText(opts: { text: string }): Promise<void>;
    function setTitle(opts: { title: string }): Promise<void>;
  }
}
