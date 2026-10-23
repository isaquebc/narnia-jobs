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
    function getURL(path: string): string;
    function sendMessage(msg: unknown): Promise<unknown>;
    const onMessage: {
      addListener(
        cb: (msg: never, sender: never, sendResponse: (r: unknown) => void) => boolean | undefined,
      ): void;
    };
  }
  namespace permissions {
    function request(p: { origins: string[] }): Promise<boolean>;
  }
  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
    }
    interface Tab {
      windowId?: number;
    }
    function update(tabId: number, props: { url?: string; active?: boolean }): Promise<Tab>;
    function get(tabId: number): Promise<Tab>;
    function query(q: { active?: boolean; currentWindow?: boolean; url?: string }): Promise<Tab[]>;
    function create(props: { url: string }): Promise<Tab>;
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
      frameId?: number;
    }
    function executeScript(opts: {
      target: { tabId: number; allFrames?: boolean; frameIds?: number[] };
      files?: string[];
      // biome-ignore lint/suspicious/noExplicitAny: a função recebe os `args` que a chamada passar
      func?: (...args: any[]) => unknown;
      args?: unknown[];
    }): Promise<InjectionResult[]>;
  }
  namespace action {
    const onClicked: { addListener(cb: (tab: tabs.Tab) => void): void };
    function setBadgeText(opts: { text: string }): Promise<void>;
    function setTitle(opts: { title: string }): Promise<void>;
  }
}
