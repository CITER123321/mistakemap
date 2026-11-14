import { handle, PlanBody } from "@/lib/api";
import { stepPlan } from "@/lib/pipeline";

export const maxDuration = 300;

export function POST(req: Request) {
  return handle(req, PlanBody, (b, llm) => stepPlan(b.task, b.answers, b.misconceptions, llm));
}
