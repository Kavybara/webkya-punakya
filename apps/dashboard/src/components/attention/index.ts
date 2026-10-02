// The queue and the arithmetic that feeds it, in one import, because a page
// that renders one always needs the other and importing them from two places
// is how the two drift apart.
export { AttentionQueue } from "./AttentionQueue";
export {
  attentionTotal,
  PAGES_WITHOUT_ATTENTION,
  systemStateFor,
  systemStateLabel,
} from "./attention";
export type { AttentionItem, AttentionSide, AttentionTone, SystemState } from "./attention";
