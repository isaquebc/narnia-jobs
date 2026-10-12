import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// Auditoria E2 (19f): as rotas sob demanda (Configurações, execução, chat) são transformadas pelo Vite na primeira
// importação de cada arquivo de teste; com a suíte inteira disputando a CPU isso passava do 1 s padrão do findBy/waitFor
// e o teste falhava por tempo, não por defeito (reproduzido com carga artificial). 5 s só pesam quando o teste falha.
configure({ asyncUtilTimeout: 5_000 });

// o jsdom não implementa scrollTo (janela e elementos); o router volta a janela e o <main> ao topo a cada navegação
// (auditoria D) e cada chamada virava um erro no log dos testes
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => undefined;
window.scrollTo = (() => undefined) as typeof window.scrollTo;

afterEach(() => cleanup());
