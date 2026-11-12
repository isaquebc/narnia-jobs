import type { TodoItem } from "@narnia-jobs/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TodosCard } from "../../src/features/todos/TodosCard";
import { TodosPage } from "../../src/features/todos/TodosPage";
import { renderWithProviders } from "../helpers";

/** F15/M1 · Tarefas: kanban com as três colunas, filtros, criar, mover e o cartão na candidatura. */
const todo = (o: Partial<TodoItem>): TodoItem => ({
  id: "t1",
  title: "Fazer a triagem pelo WhatsApp",
  note: null,
  status: "todo",
  position: 0,
  dueAt: null,
  actionUrl: null,
  source: "manual",
  kind: null,
  tags: [],
  applicationId: null,
  postingId: null,
  mailMessageId: null,
  doneAt: null,
  createdAt: "2026-11-12T12:00:00.000Z",
  updatedAt: "2026-11-12T12:00:00.000Z",
  application: null,
  mailUrl: null,
  ...o,
});

const emailTodo = todo({
  source: "email",
  kind: "screening",
  tags: ["acme", "triagem"],
  dueAt: "2020-01-01T12:00:00.000Z",
  actionUrl: "https://triagem.example/start",
  mailUrl: "https://mail.google.com/mail/u/0/#all/g1",
  applicationId: "a1",
  application: { id: "a1", company: "Acme", title: "Dev Backend" },
});

function api(
  todos: TodoItem[] = [emailTodo, todo({ id: "t2", title: "Estudar", status: "doing" })],
) {
  return {
    listTodos: vi.fn(async (f: { tag?: string; overdue?: boolean } = {}) => ({
      todos: todos.filter(
        (x) => (!f.tag || x.tags.includes(f.tag)) && (!f.overdue || x.id === "t1"),
      ),
      tags: [
        { tag: "acme", count: 1 },
        { tag: "triagem", count: 1 },
      ],
    })),
    createTodo: vi.fn(async (b: object) => todo({ id: "t3", ...b })),
    moveTodo: vi.fn(async () => todo({})),
    deleteTodo: vi.fn(async () => undefined),
    patchTodo: vi.fn(async () => todo({})),
    listJobApplications: async () => ({ applications: [], saved: [] }),
  };
}

describe("F15/M1 · Tarefas", () => {
  it("mostra as três colunas; o cartão do e-mail tem origem, tipo, tags, vencida e os links", async () => {
    renderWithProviders(<TodosPage />, { api: api() as never });
    const todoCol = await screen.findByRole("list", { name: "A fazer" });
    const card = await within(todoCol).findByRole("listitem", {
      name: "Fazer a triagem pelo WhatsApp",
    });
    expect(within(card).getByText("Do e-mail")).toBeInTheDocument();
    expect(within(card).getByText("Triagem")).toBeInTheDocument();
    expect(within(card).getByText("#acme")).toBeInTheDocument();
    expect(within(card).getByText(/^Vencida: 01\/01\/2020/)).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Abrir a ação" })).toHaveAttribute(
      "href",
      "https://triagem.example/start",
    );
    expect(within(card).getByRole("link", { name: "Ver o e-mail" })).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Acme · Dev Backend" })).toHaveAttribute(
      "href",
      "/candidaturas/a1",
    );
    expect(
      within(screen.getByRole("list", { name: "Fazendo" })).getByText("Estudar"),
    ).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Feito" })).toBeInTheDocument();
  });

  it("filtra por tag e só as vencidas", async () => {
    const a = api();
    renderWithProviders(<TodosPage />, { api: a as never });
    await screen.findByText("Estudar");
    await userEvent.selectOptions(screen.getByLabelText("Tag"), "acme");
    await waitFor(() =>
      expect(a.listTodos).toHaveBeenCalledWith(expect.objectContaining({ tag: "acme" })),
    );
    await waitFor(() => expect(screen.queryByText("Estudar")).toBeNull());
    await userEvent.click(screen.getByLabelText("Só as vencidas"));
    await waitFor(() =>
      expect(a.listTodos).toHaveBeenCalledWith(
        expect.objectContaining({ tag: "acme", overdue: true }),
      ),
    );
  });

  it("cria uma tarefa com prazo no fuso da pessoa e tags separadas por vírgula", async () => {
    const a = api([]);
    renderWithProviders(<TodosPage />, { api: a as never });
    expect(
      await screen.findByText("Nenhuma tarefa. Crie a primeira em Nova tarefa."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Nova tarefa" }));
    await userEvent.type(screen.getByLabelText(/Título/), "Estudar system design");
    await userEvent.type(screen.getByLabelText("Tags"), "estudo, Acme");
    await userEvent.type(screen.getByLabelText("Prazo"), "2026-11-20T09:00");
    await userEvent.click(screen.getByRole("button", { name: "Criar" }));
    await waitFor(() =>
      expect(a.createTodo).toHaveBeenCalledWith({
        title: "Estudar system design",
        note: null,
        // 09:00 em São Paulo
        dueAt: "2026-11-20T12:00:00.000Z",
        actionUrl: null,
        tags: ["estudo", "Acme"],
        applicationId: null,
      }),
    );
  });

  it("move pelo menu e apaga com confirmação", async () => {
    const a = api();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<TodosPage />, { api: a as never });
    const card = await screen.findByRole("listitem", { name: "Estudar" });
    await userEvent.click(within(card).getByRole("button", { name: "Mover" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Feito" }));
    await waitFor(() => expect(a.moveTodo).toHaveBeenCalledWith("t2", { status: "done" }));
    await userEvent.click(within(card).getByRole("button", { name: "Apagar" }));
    await waitFor(() => expect(a.deleteTodo).toHaveBeenCalledWith("t2"));
    confirm.mockRestore();
  });

  it("aberta pelo aviso (/tarefas?id=…): a tarefa fica em destaque", async () => {
    window.history.pushState({}, "", "/tarefas?id=t2");
    try {
      renderWithProviders(<TodosPage />, { api: api() as never });
      const card = await screen.findByRole("listitem", { name: "Estudar" });
      expect(card).toHaveAttribute("data-highlight", "true");
      expect(
        screen.getByRole("listitem", { name: "Fazer a triagem pelo WhatsApp" }),
      ).not.toHaveAttribute("data-highlight");
    } finally {
      window.history.pushState({}, "", "/");
    }
  });

  it("cartão na candidatura: as abertas dela e Nova tarefa já ligada", async () => {
    const a = api();
    renderWithProviders(<TodosCard applicationId="a1" />, { api: a as never });
    const card = await screen.findByRole("region", { name: "Tarefas" });
    await within(card).findByText("Fazer a triagem pelo WhatsApp");
    expect(a.listTodos).toHaveBeenCalledWith({ applicationId: "a1" });
    await userEvent.click(within(card).getByRole("button", { name: "Nova tarefa" }));
    await userEvent.type(screen.getByLabelText(/Título/), "Mandar documentos");
    await userEvent.click(screen.getByRole("button", { name: "Criar" }));
    await waitFor(() =>
      expect(a.createTodo).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Mandar documentos", applicationId: "a1" }),
      ),
    );
  });
});
