// o mapa de erros amigáveis mora no `shared` (auditoria D): a web também classifica erros das rotas com ele
export {
  FRIENDLY_MESSAGES,
  type FriendlyError,
  type FriendlyErrorKey,
  friendlyError,
  friendlyText,
} from "@narnia-jobs/shared";
