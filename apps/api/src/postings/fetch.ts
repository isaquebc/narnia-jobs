/** A busca de vaga por link mudou para o core (F14/M4: o worker abre os links das vagas vindas de e-mail). */
export {
  extractPosting,
  type FetchFailure,
  type FetchPostingOptions,
  type FetchPostingResult,
  fetchPostingPage,
  hostGuard,
  isBlockedAddress,
  type PageRender,
  POSTING_USER_AGENT,
  robotsAllows,
} from "@narnia-jobs/core";
